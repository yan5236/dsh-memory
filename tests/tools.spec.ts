import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryStateStore } from '../src/bookkeeping.js'
import { MemoryFiles } from '../src/files.js'
import { registerMemoryTools, type ToolRegistryRuntime } from '../src/tools.js'
import { fakeKv } from './helpers.js'

let root: string | undefined

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

interface ToolLike {
  name: string
  execute(args: Record<string, unknown>): Promise<unknown>
}

async function harness(): Promise<{ files: MemoryFiles; state: MemoryStateStore; tools: Map<string, ToolLike> }> {
  root = await mkdtemp(join(tmpdir(), 'dsh-memory-tools-'))
  const { facility } = fakeKv()
  const state = new MemoryStateStore(() => facility)
  await state.init()
  const files = new MemoryFiles(root)
  await files.ensureLayout()
  const tools = new Map<string, ToolLike>()
  const registry: ToolRegistryRuntime = {
    register(definition: unknown): () => void {
      const tool = definition as ToolLike
      tools.set(tool.name, tool)
      return () => tools.delete(tool.name)
    },
  }
  registerMemoryTools(registry, files, state)
  return { files, state, tools }
}

function execute(tool: ToolLike | undefined, args: Record<string, unknown>): Promise<unknown> {
  if (tool === undefined) throw new Error('tool not registered')
  return tool.execute(args)
}

describe('memory tools usage tracking', () => {
  it('records usage for memory_read on successful reads only', async () => {
    const { files, state, tools } = await harness()
    await files.writeAtomic('MEMORY.md', '# memory handbook\n')

    const read = tools.get('memory_read')
    await execute(read, { path: 'MEMORY.md' })
    expect(state.usageOf('MEMORY.md')).toMatchObject({ count: 1 })
    await execute(read, { path: 'MEMORY.md' })
    expect(state.usageOf('MEMORY.md')).toMatchObject({ count: 2, lastAt: expect.any(Number) })

    // Missing file: no usage recorded.
    await execute(read, { path: 'rollout_summaries/nope.md' })
    expect(state.usageOf('rollout_summaries/nope.md')).toBeUndefined()
  })

  it('records usage for files surfaced by memory_search, not for memory_list', async () => {
    const { files, state, tools } = await harness()
    await files.writeAtomic('MEMORY.md', '# handbook\n\n- 中文偏好\n')
    await files.writeAtomic('rollout_summaries/a.md', '回顾 A 中文\n')
    await files.writeAtomic('rollout_summaries/b.md', '回顾 B 英文\n')

    const search = tools.get('memory_search')
    const result = await execute(search, { query: '中文' })
    expect(String(result)).toContain('MEMORY.md')
    expect(String(result)).toContain('a.md')
    expect(String(result)).not.toContain('b.md')
    expect(state.usageOf('MEMORY.md')).toMatchObject({ count: 1 })
    expect(state.usageOf('rollout_summaries/a.md')).toMatchObject({ count: 1 })
    expect(state.usageOf('rollout_summaries/b.md')).toBeUndefined()

    // Browsing the tree is not usage.
    const list = tools.get('memory_list')
    await execute(list, {})
    expect(state.usageCount).toBe(2)
  })

  it('skips usage when a search finds nothing', async () => {
    const { files, state, tools } = await harness()
    await files.writeAtomic('MEMORY.md', '# handbook\n')
    const search = tools.get('memory_search')
    const result = await execute(search, { query: '不存在的关键词xyz' })
    expect(String(result)).toContain('未找到')
    expect(state.usageCount).toBe(0)
  })

  it('memory_add still writes notes and sets the pending flag', async () => {
    const { files, state, tools } = await harness()
    const add = tools.get('memory_add')
    const result = await execute(add, { note: '记住：用 PowerShell', slug: 'use-powershell' })
    expect(String(result)).toContain('extensions/ad_hoc/notes/')
    expect(await files.hasPendingNotes()).toBe(true)
    expect(state.pendingConsolidation).toBe(true)
  })
})
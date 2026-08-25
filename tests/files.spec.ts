import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryFiles } from '../src/files.js'

let root: string | undefined

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function makeFiles(): Promise<MemoryFiles> {
  root = await mkdtemp(join(tmpdir(), 'dsh-memory-files-'))
  return new MemoryFiles(root)
}

describe('MemoryFiles', () => {
  it('creates the standard layout', async () => {
    const files = await makeFiles()
    await files.ensureLayout()
    expect(await files.readIfExists('memory_summary.md')).toBeUndefined()
    const tree = await files.listTree()
    expect(tree.some(entry => entry.path === 'rollout_summaries' && entry.kind === 'dir')).toBe(true)
    expect(tree.some(entry => entry.path === 'extensions/ad_hoc/notes' && entry.kind === 'dir')).toBe(true)
  })

  it('writes and reads atomically', async () => {
    const files = await makeFiles()
    await files.ensureLayout()
    await files.writeAtomic('MEMORY.md', '# memory\n')
    expect(await files.readIfExists('MEMORY.md')).toBe('# memory\n')
  })

  it('rejects paths escaping the root', async () => {
    const files = await makeFiles()
    expect(() => files.rel('../outside.md')).toThrow('escapes')
    expect(() => files.rel('C:/outside.md')).toThrow('relative')
    expect(() => files.rel('/etc/passwd')).toThrow('relative')
    expect(() => files.rel('a/../../outside.md')).toThrow('escapes')
    expect(files.rel('rollout_summaries/x.md')).toBe(join(root!, 'rollout_summaries', 'x.md'))
  })

  it('appends raw blocks and rotates them into the archive', async () => {
    const files = await makeFiles()
    await files.ensureLayout()
    await files.appendText('raw_memories.md', 'block one\n')
    await files.appendText('raw_memories.md', 'block two\n')
    await files.rotateRaw()
    const raw = await files.readIfExists('raw_memories.md')
    const archive = await files.readIfExists('raw_memories.archive.md')
    expect(raw).toContain('archived at')
    expect(raw).not.toContain('block one')
    expect(archive).toContain('block one')
    expect(archive).toContain('block two')
  })

  it('makes rollout slugs unique per session', async () => {
    const files = await makeFiles()
    await files.ensureLayout()
    await files.writeAtomic('rollout_summaries/demo.md', 'x')
    const first = await files.uniqueRolloutSlug('demo', 'session-aaaaaaaa')
    expect(first).not.toBe('demo')
    expect(first).toContain('demo')
    expect(first).toContain('aaaaaaaa')
  })

  it('collects file stats', async () => {
    const files = await makeFiles()
    await files.ensureLayout()
    await files.writeAtomic('MEMORY.md', 'memory')
    await files.writeAtomic('memory_summary.md', 'v1\nsummary')
    await files.writeAtomic('rollout_summaries/a.md', 'a')
    await files.writeAtomic('rollout_summaries/b.md', 'b')
    const stats = await files.stats()
    expect(stats.memoryChars).toBe(6)
    expect(stats.summaryChars).toBeGreaterThan(0)
    expect(stats.rollouts).toBe(2)
    expect(stats.retired).toBe(0)
  })

  it('writes run logs and lists them newest first', async () => {
    const files = await makeFiles()
    await files.ensureLayout()
    await files.writeRunLog('phase1', { outcome: 'done 1', detail: { done: 1 } }, 1000)
    await files.writeRunLog('phase2', { outcome: 'consolidated', detail: { memoryChars: 5 } }, 3000)
    await files.writeRunLog('phase1', { outcome: 'skipped', detail: {} }, 2000)
    const logs = await files.listRunLogs()
    expect(logs.map(entry => entry.outcome)).toEqual(['consolidated', 'skipped', 'done 1'])
    expect(logs[0]?.at).toBe(3000)
    expect(logs[0]?.stage).toBe('phase2')
    expect(logs[1]?.detail).toBeUndefined()
    expect((await files.stats()).logCount).toBe(3)
  })

  it('prunes run logs beyond the cap, keeping the newest', async () => {
    const files = await makeFiles()
    await files.ensureLayout()
    for (let index = 0; index < 55; index += 1) {
      await files.writeRunLog('phase1', { outcome: `run ${index}`, detail: {} }, 1000 + index)
    }
    const logs = await files.listRunLogs(200)
    expect(logs.length).toBe(50)
    expect(logs[0]?.outcome).toBe('run 54')
    expect(logs.every(entry => Number(entry.name.slice(0, 4)) >= 1970)).toBe(true)
  })

  it('retires rollout summaries into .retired and counts them separately', async () => {
    const files = await makeFiles()
    await files.ensureLayout()
    await files.writeAtomic('rollout_summaries/stale.md', 'old')
    await files.writeAtomic('rollout_summaries/fresh.md', 'new')
    const moved = await files.retireRolloutSummary('stale')
    expect(moved).toBe('rollout_summaries/.retired/stale.md')
    expect(await files.readIfExists('rollout_summaries/stale.md')).toBeUndefined()
    expect(await files.readIfExists('rollout_summaries/.retired/stale.md')).toBe('old')

    const stats = await files.stats()
    expect(stats.rollouts).toBe(1)
    expect(stats.retired).toBe(1)

    // Rollout index must not surface retired files.
    const index = await files.rolloutIndex()
    expect(index.some(line => line.includes('.retired'))).toBe(false)
    expect(index.some(line => line.includes('fresh.md'))).toBe(true)
  })

  it('handles retired-name collisions with a timestamp suffix and missing files', async () => {
    const files = await makeFiles()
    await files.ensureLayout()
    await files.writeAtomic('rollout_summaries/x.md', 'first')
    await files.writeAtomic('rollout_summaries/.retired/x.md', 'already retired')
    const moved = await files.retireRolloutSummary('x', 1700000000000)
    expect(moved).toBe('rollout_summaries/.retired/x-1700000000000.md')
    expect(await files.readIfExists(moved)).toBe('first')
    // Missing source returns undefined instead of throwing.
    expect(await files.retireRolloutSummary('never-existed')).toBeUndefined()
  })

  it('rejects invalid slugs and path traversal in retire requests', async () => {
    const files = await makeFiles()
    await files.ensureLayout()
    await expect(files.retireRolloutSummary('../escape')).rejects.toThrow('invalid rollout summary slug')
    await expect(files.retireRolloutSummary('a/b')).rejects.toThrow('invalid rollout summary slug')
    await expect(files.retireRolloutSummary('')).rejects.toThrow('invalid rollout summary slug')
    await expect(files.retireRolloutSummary('UPPER Case')).rejects.toThrow('invalid rollout summary slug')
  })
})

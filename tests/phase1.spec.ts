import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryStateStore } from '../src/bookkeeping.js'
import { resolveConfig } from '../src/config.js'
import { MemoryFiles } from '../src/files.js'
import { Phase1Runner } from '../src/phase1.js'
import type { SessionHeaderLite, SessionReader } from '../src/types.js'
import { fakeKv, fakeLlm, PHASE1_JSON, userMessage, type FakeResponse } from './helpers.js'

let root: string | undefined

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

interface Harness {
  runner: Phase1Runner
  state: MemoryStateStore
  files: MemoryFiles
  headers: SessionHeaderLite[]
  setEvents: (id: string, events: unknown[]) => void
  clock: { value: number }
}

async function harness(responses: Array<FakeResponse>): Promise<Harness> {
  root = await mkdtemp(join(tmpdir(), 'dsh-memory-phase1-'))
  const { facility } = fakeKv()
  const state = new MemoryStateStore(() => facility)
  await state.init()
  const files = new MemoryFiles(root)
  const { llm } = fakeLlm(responses)
  const events = new Map<string, unknown[]>()
  const headers: SessionHeaderLite[] = []
  const reader: SessionReader = {
    async listSessions() {
      return headers
    },
    async readSession(id) {
      return { session: { id }, events: events.get(id) ?? [] }
    },
  }
  const cfg = resolveConfig({ provider: 'mock', model: 'mock' })
  const clock = { value: Date.now() }
  const runner = new Phase1Runner({
    llm,
    state,
    files,
    sessions: () => reader,
    config: () => cfg,
    route: () => ({ provider: 'mock', model: 'mock' }),
    now: () => clock.value,
  })
  return {
    runner,
    state,
    files,
    headers,
    setEvents: (id, list) => events.set(id, list),
    clock,
  }
}

const activeHeader = (id: string, createdAt = Date.now()): SessionHeaderLite =>
  ({ id, createdAt, cwd: '/work/repo' })

describe('Phase1Runner', () => {
  it('extracts a session into a rollout summary and raw memory', async () => {
    const h = await harness([PHASE1_JSON('Demo Session 1!')])
    h.headers.push(activeHeader('s1'))
    h.setEvents('s1', [
      userMessage('请搭建记忆管道'),
      { type: 'assistant/message', data: { content: [{ type: 'text', text: '完成了' }] } },
      userMessage('再补上测试'),
      { type: 'tool/call', data: { name: 'bash', arguments: { command: 'pnpm test' } } },
      { type: 'tool/result', data: { name: 'bash', isError: false, content: [{ type: 'text', text: '3 passed' }] } },
    ])

    const summary = await h.runner.run()
    expect(summary).toMatchObject({ selected: 1, done: 1, noop: 0, failed: 0 })

    const rollout = await h.files.readIfExists('rollout_summaries/demo-session-1.md')
    expect(rollout).toContain('# demo summary')
    expect(rollout).toContain('session: s1')
    const raw = await h.files.readIfExists('raw_memories.md')
    expect(raw).toContain('dsh-memory raw')
    expect(raw).toContain('keywords: demo, pipeline')

    expect(h.state.processedOf('s1')).toMatchObject({ status: 'done', slug: 'demo-session-1' })
    expect(h.state.pendingConsolidation).toBe(true)
  })

  it('marks no-op when the model returns all-empty fields', async () => {
    const h = await harness(['{"raw_memory":"","rollout_summary":"","rollout_slug":""}'])
    h.headers.push(activeHeader('s1'))
    h.setEvents('s1', [userMessage('你好')])

    const summary = await h.runner.run()
    expect(summary).toMatchObject({ done: 0, noop: 1 })
    expect(h.state.processedOf('s1')?.status).toBe('noop')
    expect(await h.files.readIfExists('raw_memories.md')).toBeUndefined()
    expect(h.state.pendingConsolidation).toBe(false)
  })

  it('accepts a structured memory_save tool call', async () => {
    const h = await harness([{
      calls: [{ name: 'memory_save', arguments: JSON.stringify({
        raw_memory: 'description: 工具路径\ncwd: /work\nkeywords: tool\n\n### Task 1: t\n\ntask_outcome: success\n',
        rollout_summary: '# tool summary\n\n## Task 1: t\n\nOutcome: success\n',
        rollout_slug: 'tool-path-session',
      }) }],
    }])
    h.headers.push(activeHeader('s1'))
    h.setEvents('s1', [userMessage('一'), userMessage('二'), userMessage('三'), userMessage('四')])

    const summary = await h.runner.run()
    expect(summary).toMatchObject({ done: 1, failed: 0 })
    expect(h.state.processedOf('s1')).toMatchObject({ status: 'done', slug: 'tool-path-session' })
    expect(await h.files.readIfExists('rollout_summaries/tool-path-session.md')).toContain('# tool summary')
  })

  it('retries a truncated extraction with a halved transcript', async () => {
    const h = await harness([
      { text: '{"rollout_summary":', truncated: true },
      { calls: [{ name: 'memory_save', arguments: JSON.stringify({
        raw_memory: 'description: shrink ok\ncwd: /work\nkeywords: shrink\n\n### Task 1\n\ntask_outcome: success\n',
        rollout_summary: '# shrunk\n\nOutcome: success\n',
        rollout_slug: 'shrunk-session',
      }) }] },
    ])
    h.headers.push(activeHeader('s1'))
    h.setEvents('s1', Array.from({ length: 20 }, (_, index) => userMessage(`第${index}条：${'内容'.repeat(450)}`)))

    const summary = await h.runner.run()
    expect(summary).toMatchObject({ done: 1, failed: 0 })
    expect(h.state.processedOf('s1')).toMatchObject({ status: 'done', slug: 'shrunk-session' })
  })

  it('skips sessions below the minimum event count', async () => {
    const h = await harness([])
    h.headers.push(activeHeader('s1'))
    h.setEvents('s1', [userMessage('只有一个事件')])

    const summary = await h.runner.run()
    expect(summary).toMatchObject({ selected: 1, noop: 1 })
    expect(h.state.processedOf('s1')?.status).toBe('noop')
  })

  it('records failures with attempts and retries after the backoff window', async () => {
    const h = await harness([new Error('llm down'), PHASE1_JSON('retry-session')])
    h.headers.push(activeHeader('s1', h.clock.value))
    h.setEvents('s1', [userMessage('任务一'), userMessage('任务二'), userMessage('任务三'), userMessage('任务四')])

    const first = await h.runner.run()
    expect(first).toMatchObject({ failed: 1 })
    expect(h.state.processedOf('s1')).toMatchObject({ status: 'failed', attempts: 1 })

    // Inside the backoff window the claim stays parked.
    const parked = await h.runner.run()
    expect(parked).toMatchObject({ selected: 0 })

    // After the backoff expires the next run retries and succeeds.
    h.clock.value += 5 * 60_000
    const second = await h.runner.run()
    expect(second).toMatchObject({ done: 1 })
    expect(h.state.processedOf('s1')).toMatchObject({ status: 'done', attempts: 2 })
  })

  it('does not process subagent sessions', async () => {
    const h = await harness([])
    h.headers.push({ id: 'child', createdAt: Date.now(), origin: 'subagent', parentSession: 'parent' })

    const summary = await h.runner.run()
    expect(summary.selected).toBe(0)
    expect(h.state.processedOf('child')).toBeUndefined()
  })

  it('salvages a truncated but structurally complete JSON response', async () => {
    const h = await harness([{ text: PHASE1_JSON('truncated-but-ok'), truncated: true }])
    h.headers.push(activeHeader('s1'))
    h.setEvents('s1', [userMessage('一'), userMessage('二'), userMessage('三'), userMessage('四')])

    const summary = await h.runner.run()
    expect(summary).toMatchObject({ done: 1, failed: 0 })
    expect(h.state.processedOf('s1')).toMatchObject({ status: 'done', slug: 'truncated-but-ok' })
  })

  it('fails a truncated response whose JSON is incomplete, with route context', async () => {
    const h = await harness([{ text: '{"rollout_summary":"未闭合', truncated: true }])
    h.headers.push(activeHeader('s1'))
    h.setEvents('s1', [userMessage('一'), userMessage('二'), userMessage('三'), userMessage('四')])

    const summary = await h.runner.run()
    expect(summary).toMatchObject({ failed: 1 })
    const claim = h.state.processedOf('s1')
    expect(claim?.status).toBe('failed')
    expect(claim?.error).toContain('truncated')
    expect(claim?.error).toContain('route=mock/mock')
  })

  const withSeq = (event: unknown, seq: number): unknown => ({ ...(event as object), seq })
  const DELTA_CALL = {
    calls: [{ name: 'memory_save', arguments: JSON.stringify({
      raw_memory: 'description: delta ok\ncwd: /work\nkeywords: delta\n\n### Task 1\n\ntask_outcome: success\n',
      rollout_summary: '# delta part\n\nOutcome: success\n',
      rollout_slug: 'base-slug',
    }) }],
  }

  it('extracts session growth as a delta part with an advanced watermark', async () => {
    const h = await harness([DELTA_CALL])
    h.state.claimRunning('s1')
    h.state.claimDone('s1', 'base-slug', 2, 1)
    h.clock.value += 31 * 60_000
    h.headers.push(activeHeader('s1', h.clock.value))
    h.setEvents('s1', [
      withSeq(userMessage('旧内容一'), 0),
      withSeq(userMessage('旧内容二'), 1),
      withSeq(userMessage('旧内容三'), 2),
      withSeq(userMessage('新增一'), 3),
      withSeq(userMessage('新增二'), 4),
      withSeq(userMessage('新增三'), 5),
      withSeq(userMessage('新增四'), 6),
      withSeq(userMessage('新增五'), 7),
      withSeq(userMessage('新增六'), 8),
    ])

    const summary = await h.runner.run()
    expect(summary).toMatchObject({ done: 1, unchanged: 0 })
    expect(h.state.processedOf('s1')).toMatchObject({ status: 'done', slug: 'base-slug-part2', lastSeq: 8, parts: 2 })
    expect(await h.files.readIfExists('rollout_summaries/base-slug-part2.md')).toContain('# delta part')
    expect(h.state.pendingConsolidation).toBe(true)
  })

  it('baselines legacy done claims without re-extracting their content', async () => {
    const { llm, calls } = fakeLlm([])
    root = await mkdtemp(join(tmpdir(), 'dsh-memory-phase1-'))
    const { facility } = fakeKv()
    const state = new MemoryStateStore(() => facility)
    await state.init()
    const files = new MemoryFiles(root)
    const headers: SessionHeaderLite[] = [{ id: 's1', createdAt: Date.now() }]
    const clock = { value: Date.now() }
    state.claimRunning('s1')
    state.claimDone('s1', 'legacy-slug')
    clock.value += 31 * 60_000
    headers[0] = { id: 's1', createdAt: clock.value }
    const events: unknown[] = [withSeq(userMessage('一'), 0), withSeq(userMessage('二'), 1), withSeq(userMessage('三'), 2), withSeq(userMessage('四'), 3)]
    const runner = new Phase1Runner({
      llm,
      state,
      files,
      sessions: () => ({
        async listSessions() { return headers },
        async readSession(id) { return { session: { id }, events } },
      }),
      config: () => resolveConfig({ provider: 'mock', model: 'mock' }),
      route: () => ({ provider: 'mock', model: 'mock' }),
      now: () => clock.value,
    })

    const summary = await runner.run()
    expect(summary).toMatchObject({ unchanged: 1, done: 0 })
    expect(calls).toHaveLength(0)
    expect(state.processedOf('s1')).toMatchObject({ status: 'done', slug: 'legacy-slug', lastSeq: 3 })
  })

  it('re-extracts legacy noop sessions fully (no watermark yet)', async () => {
    const h = await harness([DELTA_CALL])
    h.state.claimRunning('s1')
    h.state.claimNoop('s1')
    h.clock.value += 31 * 60_000
    h.headers.push(activeHeader('s1', h.clock.value))
    h.setEvents('s1', [0, 1, 2, 3, 4, 5].map(i => withSeq(userMessage(`内容${i}`), i)))

    const summary = await h.runner.run()
    expect(summary).toMatchObject({ done: 1 })
    const claim = h.state.processedOf('s1')
    expect(claim).toMatchObject({ status: 'done', lastSeq: 5, parts: 1 })
    expect(claim?.slug).toContain('base-slug')
  })

  it('leaves grown sessions untouched when the delta is below the threshold', async () => {
    const h = await harness([])
    h.state.claimRunning('s1')
    h.state.claimDone('s1', 'base-slug', 5, 1)
    h.clock.value += 31 * 60_000
    h.headers.push(activeHeader('s1', h.clock.value))
    h.setEvents('s1', [
      withSeq(userMessage('旧一'), 0),
      withSeq(userMessage('旧二'), 3),
      withSeq(userMessage('新一'), 6),
      withSeq(userMessage('新二'), 7),
    ])

    const summary = await h.runner.run()
    expect(summary).toMatchObject({ unchanged: 1, done: 0 })
    expect(h.state.processedOf('s1')).toMatchObject({ status: 'done', lastSeq: 7 })
  })

  it('skips the batch when no model route is available', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-memory-phase1-'))
    const { facility } = fakeKv()
    const state = new MemoryStateStore(() => facility)
    await state.init()
    const files = new MemoryFiles(root)
    const { llm } = fakeLlm([])
    const reader: SessionReader = {
      async listSessions() {
        return [{ id: 's1', createdAt: Date.now() }]
      },
      async readSession(id) {
        return { session: { id }, events: [] }
      },
    }
    const runner = new Phase1Runner({
      llm,
      state,
      files,
      sessions: () => reader,
      config: () => resolveConfig({}),
      route: () => undefined,
    })
    const summary = await runner.run()
    expect(summary.skippedNoRoute).toBe(true)

    const logs = await files.listRunLogs()
    expect(logs).toHaveLength(1)
    expect(logs[0]?.outcome).toBe('skipped:no-route')
  })

  it('writes a run log with per-session outcomes after a batch', async () => {
    const h = await harness([PHASE1_JSON('first'), PHASE1_JSON('second')])
    h.headers.push(activeHeader('s1'), activeHeader('s2'))
    h.setEvents('s1', [userMessage('任务一'), userMessage('补充'), userMessage('补充'), userMessage('补充')])
    h.setEvents('s2', [userMessage('任务二'), userMessage('补充'), userMessage('补充'), userMessage('补充')])

    await h.runner.run()
    const logs = await h.files.listRunLogs()
    expect(logs).toHaveLength(1)
    expect(logs[0]?.stage).toBe('phase1')
    expect(logs[0]?.route).toBe('mock/mock')
    expect(logs[0]?.outcome).toContain('done 2/2')

    const full = await h.files.readIfExists(`logs/${logs[0]!.name}`)
    const parsed = JSON.parse(full!) as { detail: { summary: unknown; sessions: Array<{ id: string; outcome: string }> } }
    expect(parsed.detail.summary).toMatchObject({ selected: 2, done: 2 })
    expect(parsed.detail.sessions).toEqual([
      { id: 's1', outcome: 'done' },
      { id: 's2', outcome: 'done' },
    ])
  })
})

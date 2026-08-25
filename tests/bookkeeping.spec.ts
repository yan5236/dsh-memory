import { describe, expect, it } from 'vitest'
import { MemoryStateStore } from '../src/bookkeeping.js'
import { fakeKv } from './helpers.js'

describe('MemoryStateStore', () => {
  it('starts fresh and tracks claim lifecycle', async () => {
    const { facility } = fakeKv()
    const store = new MemoryStateStore(() => facility)
    await store.init()
    expect(store.storageAvailable).toBe(true)
    expect(store.processedOf('s1')).toBeUndefined()

    store.claimRunning('s1')
    expect(store.processedOf('s1')?.status).toBe('running')
    store.claimDone('s1', 'slug-1')
    expect(store.processedOf('s1')).toMatchObject({ status: 'done', slug: 'slug-1' })
    store.claimNoop('s2')
    store.claimRunning('s3')
    store.claimFailed('s3', 'boom')
    expect(store.processedOf('s2')?.status).toBe('noop')
    expect(store.processedOf('s3')).toMatchObject({ status: 'failed', attempts: 1, error: 'boom' })
    await store.dispose()
  })

  it('persists state across store instances', async () => {
    const { facility } = fakeKv()
    const first = new MemoryStateStore(() => facility)
    await first.init()
    first.claimDone('s1', 'slug')
    first.setPendingConsolidation(true)
    first.setOverrides({ maxRolloutsPerRun: 9 })
    await first.dispose()

    const second = new MemoryStateStore(() => facility)
    await second.init()
    expect(second.processedOf('s1')).toMatchObject({ status: 'done', slug: 'slug' })
    expect(second.pendingConsolidation).toBe(true)
    expect(second.snapshot().overrides.maxRolloutsPerRun).toBe(9)
    await second.dispose()
  })

  it('recovers orphaned running claims after a restart', async () => {
    const { facility, records } = fakeKv()
    records.set('main', {
      v: 1,
      processed: { orphan: { status: 'running', at: Date.now() - 60 * 60_000, attempts: 2 } },
      lastPhase1At: 0,
      lastPhase2At: 0,
      pendingConsolidation: false,
      overrides: {},
    })
    const store = new MemoryStateStore(() => facility)
    await store.init()
    expect(store.processedOf('orphan')).toMatchObject({ status: 'failed', error: 'interrupted by restart' })
    await store.dispose()
  })

  it('keeps fresh running claims untouched', async () => {
    const { facility, records } = fakeKv()
    records.set('main', {
      v: 1,
      processed: { active: { status: 'running', at: Date.now(), attempts: 1 } },
      lastPhase1At: 0,
      lastPhase2At: 0,
      pendingConsolidation: false,
      overrides: {},
    })
    const store = new MemoryStateStore(() => facility)
    await store.init()
    expect(store.processedOf('active')?.status).toBe('running')
    await store.dispose()
  })

  it('degrades to process-local state when storage is unavailable', async () => {
    const store = new MemoryStateStore(() => undefined)
    await store.init()
    expect(store.storageAvailable).toBe(false)
    expect(store.storageError).toContain('unavailable')
    store.claimDone('s1')
    expect(store.processedOf('s1')?.status).toBe('done')
    await store.dispose()
  })

  it('records pipeline timing and cooldown fields', async () => {
    const { facility } = fakeKv()
    const store = new MemoryStateStore(() => facility)
    await store.init()
    store.recordPhase1(1000)
    store.recordPhase2(2000)
    expect(store.snapshot().lastPhase1At).toBe(1000)
    expect(store.lastPhase2At).toBe(2000)
    store.recordPhase2(3000, 'consolidation failed')
    expect(store.phase2Error).toBe('consolidation failed')
    store.recordPhase2(4000)
    expect(store.phase2Error).toBeUndefined()
    await store.dispose()
  })

  it('re-queues failed claims on reset, leaving other claims alone', async () => {
    const { facility } = fakeKv()
    const store = new MemoryStateStore(() => facility)
    await store.init()
    store.claimRunning('a')
    store.claimFailed('a', 'boom')
    store.claimRunning('b')
    store.claimFailed('b', 'boom')
    store.claimDone('c', 'slug')
    store.claimNoop('d')

    expect(store.resetFailedClaims()).toBe(2)
    expect(store.processedOf('a')).toBeUndefined()
    expect(store.processedOf('b')).toBeUndefined()
    expect(store.processedOf('c')).toMatchObject({ status: 'done' })
    expect(store.processedOf('d')?.status).toBe('noop')
    expect(store.resetFailedClaims()).toBe(0)
    await store.dispose()
  })

  it('advances the watermark on unchanged rechecks without losing claim fields', async () => {
    const { facility } = fakeKv()
    const store = new MemoryStateStore(() => facility)
    await store.init()
    store.claimRunning('a')
    store.claimDone('a', 'slug-a', 2, 1)
    store.claimUnchanged('a', 9)
    expect(store.processedOf('a')).toMatchObject({ status: 'done', slug: 'slug-a', parts: 1, lastSeq: 9 })

    store.claimRunning('b')
    store.claimNoop('b')
    store.claimUnchanged('b', 4)
    expect(store.processedOf('b')).toMatchObject({ status: 'noop', lastSeq: 4 })
    await store.dispose()
  })

  it('records per-file usage, counting and last-use timestamps', async () => {
    const { facility } = fakeKv()
    const store = new MemoryStateStore(() => facility)
    await store.init()
    expect(store.usageOf('rollout_summaries/a.md')).toBeUndefined()
    store.recordUsage('rollout_summaries/a.md', 1000)
    store.recordUsage('rollout_summaries/a.md', 2000)
    store.recordUsage('MEMORY.md', 1500)
    expect(store.usageOf('rollout_summaries/a.md')).toEqual({ count: 2, lastAt: 2000 })
    expect(store.usageCount).toBe(2)
    expect(store.usageSnapshot()).toEqual({
      'rollout_summaries/a.md': { count: 2, lastAt: 2000 },
      'MEMORY.md': { count: 1, lastAt: 1500 },
    })
    await store.dispose()
  })

  it('persists usage and retired state across store instances', async () => {
    const { facility } = fakeKv()
    const first = new MemoryStateStore(() => facility)
    await first.init()
    first.recordUsage('rollout_summaries/a.md', 1000)
    first.recordRetired('stale-slug', 2500)
    await first.dispose()

    const second = new MemoryStateStore(() => facility)
    await second.init()
    expect(second.usageOf('rollout_summaries/a.md')).toEqual({ count: 1, lastAt: 1000 })
    expect(second.retiredAtOf('stale-slug')).toBe(2500)
    expect(second.retiredAtOf('other')).toBeUndefined()
    await second.dispose()
  })

  it('loads legacy archives without usage/retired fields', async () => {
    const { facility, records } = fakeKv()
    records.set('main', {
      v: 1,
      processed: { s1: { status: 'done', at: 1, attempts: 0 } },
      lastPhase1At: 0,
      lastPhase2At: 0,
      pendingConsolidation: false,
      overrides: {},
    })
    const store = new MemoryStateStore(() => facility)
    await store.init()
    expect(store.usageCount).toBe(0)
    expect(store.usageSnapshot()).toEqual({})
    expect(store.retiredAtOf('x')).toBeUndefined()
    expect(() => store.recordUsage('MEMORY.md', 5)).not.toThrow()
    await store.dispose()
  })

  it('counts consecutive phase2 failures, clears on success, and resets explicitly', async () => {
    const { facility } = fakeKv()
    const store = new MemoryStateStore(() => facility)
    await store.init()
    expect(store.phase2Failures).toBe(0)

    expect(store.recordPhase2Failure(1000, 'boom 1')).toBe(1)
    expect(store.recordPhase2Failure(2000, 'boom 2')).toBe(2)
    expect(store.phase2Failures).toBe(2)
    expect(store.phase2Error).toBe('boom 2')

    store.recordPhase2(3000)
    expect(store.phase2Failures).toBe(0)
    expect(store.phase2Error).toBeUndefined()

    store.recordPhase2Failure(4000, 'boom again')
    store.resetPhase2Failures()
    expect(store.phase2Failures).toBe(0)
    await store.dispose()
  })
})

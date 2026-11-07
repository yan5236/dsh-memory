/** Transient-failure classification, call deadline, and retry-budget accounting. */

import { describe, expect, it, vi } from 'vitest'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { MemoryStateStore } from '../src/bookkeeping.js'
import {
  collectResponseWithDeadline,
  isTransientError,
  LlmCallError,
} from '../src/llm.js'
import { selectCandidates } from '../src/rollout.js'
import type { SessionClaim } from '../src/types.js'
import { fakeKv } from './helpers.js'

const OPTIONS = {
  provider: 'mock',
  model: 'mock',
  system: '',
  temperature: 0,
  maxTokens: 16,
  messages: [],
} as unknown as GenerateOptions

describe('isTransientError', () => {
  it('classifies provider and transport blips as transient', () => {
    expect(isTransientError(new Error('DeepSeek Messages stream ended before message_stop'))).toBe(true)
    expect(isTransientError(new Error('Internal Server Error (request_id: abc)'))).toBe(true)
    expect(isTransientError(new Error('HTTP 503 service unavailable'))).toBe(true)
    expect(isTransientError(new Error('read ECONNRESET'))).toBe(true)
    expect(isTransientError(new LlmCallError('aborted', 'request aborted'))).toBe(true)
  })

  it('keeps content failures out of the transient bucket', () => {
    expect(isTransientError(new LlmCallError('invalid-json', 'tool call args are not valid JSON'))).toBe(false)
    expect(isTransientError(new Error('output truncated and result incomplete'))).toBe(false)
    expect(isTransientError(new LlmCallError('max-tokens', 'hit the cap'))).toBe(false)
  })
})

describe('collectResponseWithDeadline', () => {
  it('aborts a stalled stream and reports a timeout', async () => {
    const runtime = {
      stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        return (async function* () {
          await new Promise<never>((_resolve, reject) => {
            options.signal?.addEventListener('abort', () => reject(new Error('aborted')))
          })
        })()
      },
    }
    await expect(collectResponseWithDeadline(runtime, OPTIONS, 40)).rejects.toThrow(/exceeded/)
  })

  it('passes a normal response through', async () => {
    const runtime = {
      stream(): AsyncIterable<StreamChunk> {
        return (async function* () {
          yield { type: 'text-delta', index: 0, text: 'hello' } as const
          yield { type: 'finish', reason: { kind: 'stop' } } as const
        })()
      },
    }
    const response = await collectResponseWithDeadline(runtime, OPTIONS, 1_000)
    expect(response.text).toBe('hello')
    expect(response.truncated).toBe(false)
  })
})

describe('claimFailedTransient', () => {
  it('rolls the attempt counter back and marks the claim transient', async () => {
    const { facility } = fakeKv()
    const state = new MemoryStateStore(() => facility, () => 1_000)
    await state.init()
    state.claimRunning('session-a')
    state.claimRunning('session-a')
    expect(state.processedOf('session-a')?.attempts).toBe(2)

    state.claimFailedTransient('session-a', 'Internal Server Error')
    const claim = state.processedOf('session-a')
    expect(claim?.status).toBe('failed')
    expect(claim?.attempts).toBe(1)
    expect(claim?.transient).toBe(true)
    expect(claim?.error).toContain('Internal Server Error')
  })

  it('never lets the counter go negative', async () => {
    const { facility } = fakeKv()
    const state = new MemoryStateStore(() => facility, () => 1_000)
    await state.init()
    state.claimFailedTransient('session-b', 'rate limit')
    expect(state.processedOf('session-b')?.attempts).toBe(0)
  })
})

describe('selectCandidates with transient failures', () => {
  const header = (id: string, createdAt: number): { id: string; createdAt: number } => ({ id, createdAt })

  it('keeps retrying transient failures past the retry limit', () => {
    const claims: Record<string, SessionClaim> = {
      s1: { status: 'failed', at: 0, attempts: 9, error: 'Internal Server Error', transient: true },
    }
    const result = selectCandidates([header('s1', 5_000)], id => claims[id], {
      now: () => 10 * 60_000,
      maxAgeDays: 365,
      maxPerRun: 5,
      retryLimit: 3,
      recheckIntervalMs: 1,
    })
    expect(result.candidates.map(item => item.id)).toEqual(['s1'])
  })

  it('waits out the short backoff for a fresh transient failure', () => {
    const claims: Record<string, SessionClaim> = {
      s2: { status: 'failed', at: 0, attempts: 0, error: 'stream ended before message_stop', transient: true },
    }
    const selection = selectCandidates([header('s2', -1000)], id => claims[id], {
      now: () => 10_000,
      maxAgeDays: 365,
      maxPerRun: 5,
      retryLimit: 3,
      recheckIntervalMs: 1,
    })
    expect(selection.candidates).toEqual([])
  })

  it('still parks permanent failures at the retry limit', () => {
    const claims: Record<string, SessionClaim> = {
      s3: { status: 'failed', at: 0, attempts: 3, error: 'tool call args are not valid JSON' },
    }
    const selection = selectCandidates([header('s3', -1000)], id => claims[id], {
      now: () => 24 * 60 * 60_000,
      maxAgeDays: 365,
      maxPerRun: 5,
      retryLimit: 3,
      recheckIntervalMs: 1,
    })
    expect(selection.candidates).toEqual([])
  })
})

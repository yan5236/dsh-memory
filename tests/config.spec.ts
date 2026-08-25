import { describe, expect, it } from 'vitest'
import { DEFAULTS, clampOverrides, resolveConfig } from '../src/config.js'

describe('config: maxUnusedDays', () => {
  it('defaults to 30 days (Codex parity) and resolves from base and overrides', () => {
    expect(DEFAULTS.maxUnusedDays).toBe(30)
    expect(resolveConfig({}).maxUnusedDays).toBe(30)
    expect(resolveConfig({ maxUnusedDays: 14 }).maxUnusedDays).toBe(14)
    expect(resolveConfig({ maxUnusedDays: 14 }, { maxUnusedDays: 60 }).maxUnusedDays).toBe(60)
  })

  it('clamps within the allowed range and accepts 0 to disable forgetting', () => {
    expect(clampOverrides({ maxUnusedDays: 0 }).maxUnusedDays).toBe(0)
    expect(clampOverrides({ maxUnusedDays: -5 }).maxUnusedDays).toBe(0)
    expect(clampOverrides({ maxUnusedDays: 999 }).maxUnusedDays).toBe(730)
    expect(clampOverrides({ maxUnusedDays: 7.6 }).maxUnusedDays).toBe(8)
    expect(clampOverrides({ maxUnusedDays: '45' }).maxUnusedDays).toBe(45)
    expect(clampOverrides({ maxUnusedDays: 'abc' }).maxUnusedDays).toBeUndefined()
  })

  it('keeps unrelated override keys untouched when maxUnusedDays is patched', () => {
    expect(clampOverrides({ maxUnusedDays: 10, retryLimit: 4 })).toEqual({ maxUnusedDays: 10, retryLimit: 4 })
  })

  it('allows phase2MaxTokens up to 131072 with a high default (full-file rewrites truncate otherwise)', () => {
    expect(DEFAULTS.phase2MaxTokens).toBe(32768)
    expect(clampOverrides({ phase2MaxTokens: 65536 }).phase2MaxTokens).toBe(65536)
    expect(clampOverrides({ phase2MaxTokens: 999999 }).phase2MaxTokens).toBe(131072)
    expect(clampOverrides({ phase2MaxTokens: 100 }).phase2MaxTokens).toBe(512)
  })
})

describe('config: per-phase reasoning effort', () => {
  it('defaults both phases to empty (provider default) and resolves base/overrides', () => {
    expect(DEFAULTS.phase1ReasoningEffort).toBe('')
    expect(DEFAULTS.phase2ReasoningEffort).toBe('')
    expect(resolveConfig({}).phase1ReasoningEffort).toBe('')
    expect(resolveConfig({ phase1ReasoningEffort: 'high' }).phase1ReasoningEffort).toBe('high')
    expect(resolveConfig({}, { phase2ReasoningEffort: 'max' }).phase2ReasoningEffort).toBe('max')
  })

  it('passes through string effort values and rejects non-strings / oversized values', () => {
    expect(clampOverrides({ phase1ReasoningEffort: 'off' })).toEqual({ phase1ReasoningEffort: 'off' })
    expect(clampOverrides({ phase2ReasoningEffort: 'high' })).toEqual({ phase2ReasoningEffort: 'high' })
    expect(clampOverrides({ phase1ReasoningEffort: 42 }).phase1ReasoningEffort).toBeUndefined()
    expect(clampOverrides({ phase1ReasoningEffort: 'x'.repeat(65) }).phase1ReasoningEffort).toBeUndefined()
    expect(clampOverrides({ phase2ReasoningEffort: true }).phase2ReasoningEffort).toBeUndefined()
  })
})
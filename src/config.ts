/** Plugin configuration: composition `config` provides the base layer, the settings page writes overrides. */

import z from '@deepseek-ai/schemastery'

export interface Config {
  /** Master switch: extraction, consolidation, and injection. */
  enabled: boolean
  /** Whether the left sidebar shows the 记忆库 entry that opens the vault page. */
  showVaultInSidebar: boolean
  /** Memory root directory; empty resolves to `$DSH_HOME/memories` (or `~/.dsh/memories`). */
  memoryRoot: string
  /** Optional dedicated LLM route for the memory pipeline; empty uses the deployment default model. */
  provider: string
  model: string
  /**
   * Reasoning effort (思考等级) for Phase 1 extraction calls. One of the
   * adapter-exposed ids (`off`/`low`/`high`/`max` on DeepSeek); empty uses the
   * provider default. Invalid values degrade to the default at call time.
   */
  phase1ReasoningEffort: string
  /** Reasoning effort for Phase 2 consolidation calls; empty uses the provider default. */
  phase2ReasoningEffort: string
  /** Debounce delay between a root session turn stopping and the extraction run. */
  idleDebounceMs: number
  /** Sessions extracted per pipeline run. */
  maxRolloutsPerRun: number
  /** Parallel extraction workers. */
  extractionConcurrency: number
  /** Sessions with fewer rendered events are skipped as no-op. */
  minSessionEvents: number
  /** Already-processed sessions are re-checked for growth no more often than this. */
  recheckIntervalMs: number
  /** Minimum new rendered events a grown session needs before a delta extraction. */
  minDeltaEvents: number
  /** Sessions older than this many days are marked no-op instead of extracted. */
  maxRolloutAgeDays: number
  /** Hard cap on the rendered transcript sent to the extraction model. */
  maxTranscriptChars: number
  /** Output token cap for one Phase 1 extraction call. */
  phase1MaxTokens: number
  /** Cooldown between automatic Phase 2 consolidations. */
  consolidationCooldownMs: number
  /** Hard cap on raw memories fed into one consolidation call. */
  maxRawChars: number
  /**
   * Output token cap for one Phase 2 consolidation call. Defaults high
   * because the model rewrites MEMORY.md in full and reasoning models burn
   * budget inside this cap; raise it when consolidation keeps truncating.
   */
  phase2MaxTokens: number
  /** Hard cap on the memory summary injected into the system prompt. */
  maxSummaryChars: number
  /** Extraction attempts before a session is permanently failed. */
  retryLimit: number
  /**
   * Forgetting threshold: rollout summaries whose last use (or creation, when
   * never used) is older than this many days become forgetting candidates in
   * Phase 2; the model may retire them into `rollout_summaries/.retired/`.
   * 0 disables the forgetting mechanism. Default 30 aligns with Codex.
   */
  maxUnusedDays: number
}

export const DEFAULTS: Config = {
  enabled: true,
  showVaultInSidebar: true,
  memoryRoot: '',
  provider: '',
  model: '',
  phase1ReasoningEffort: '',
  phase2ReasoningEffort: '',
  idleDebounceMs: 3 * 60_000,
  maxRolloutsPerRun: 3,
  extractionConcurrency: 1,
  minSessionEvents: 4,
  recheckIntervalMs: 30 * 60_000,
  minDeltaEvents: 6,
  maxRolloutAgeDays: 30,
  maxTranscriptChars: 60_000,
  // Truncated JSON is a secondary failure source: give the extractor room for a
  // full markdown recap. The settings-page clamp still allows up to 16_384.
  phase1MaxTokens: 8_192,
  consolidationCooldownMs: 6 * 60 * 60_000,
  maxRawChars: 120_000,
  phase2MaxTokens: 32_768,
  maxSummaryChars: 8_000,
  retryLimit: 3,
  maxUnusedDays: 30,
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(DEFAULTS.enabled),
  showVaultInSidebar: z.boolean().default(DEFAULTS.showVaultInSidebar),
  memoryRoot: z.string().default(DEFAULTS.memoryRoot),
  provider: z.string().default(DEFAULTS.provider),
  model: z.string().default(DEFAULTS.model),
  phase1ReasoningEffort: z.string().default(DEFAULTS.phase1ReasoningEffort),
  phase2ReasoningEffort: z.string().default(DEFAULTS.phase2ReasoningEffort),
  idleDebounceMs: z.number().default(DEFAULTS.idleDebounceMs),
  maxRolloutsPerRun: z.number().default(DEFAULTS.maxRolloutsPerRun),
  extractionConcurrency: z.number().default(DEFAULTS.extractionConcurrency),
  minSessionEvents: z.number().default(DEFAULTS.minSessionEvents),
  recheckIntervalMs: z.number().default(DEFAULTS.recheckIntervalMs),
  minDeltaEvents: z.number().default(DEFAULTS.minDeltaEvents),
  maxRolloutAgeDays: z.number().default(DEFAULTS.maxRolloutAgeDays),
  maxTranscriptChars: z.number().default(DEFAULTS.maxTranscriptChars),
  phase1MaxTokens: z.number().default(DEFAULTS.phase1MaxTokens),
  consolidationCooldownMs: z.number().default(DEFAULTS.consolidationCooldownMs),
  maxRawChars: z.number().default(DEFAULTS.maxRawChars),
  phase2MaxTokens: z.number().default(DEFAULTS.phase2MaxTokens),
  maxSummaryChars: z.number().default(DEFAULTS.maxSummaryChars),
  retryLimit: z.number().default(DEFAULTS.retryLimit),
  maxUnusedDays: z.number().default(DEFAULTS.maxUnusedDays),
})

/** Merge composition base and runtime overrides over schema defaults. */
export function resolveConfig(base: Partial<Config> = {}, overrides: Partial<Config> = {}): Config {
  const merged: Record<string, unknown> = { ...DEFAULTS }
  for (const key of Object.keys(DEFAULTS) as (keyof Config)[]) {
    const override = overrides[key]
    if (override !== undefined) {
      merged[key] = override
      continue
    }
    const baseValue = base[key]
    if (baseValue !== undefined) merged[key] = baseValue
  }
  return merged as unknown as Config
}

/** Whitelisted keys the settings page may override, with safe range clamps. */
export const OVERRIDABLE_KEYS = [
  'enabled',
  'showVaultInSidebar',
  'provider',
  'model',
  'phase1ReasoningEffort',
  'phase2ReasoningEffort',
  'idleDebounceMs',
  'maxRolloutsPerRun',
  'extractionConcurrency',
  'minSessionEvents',
  'maxRolloutAgeDays',
  'maxTranscriptChars',
  'phase1MaxTokens',
  'consolidationCooldownMs',
  'maxRawChars',
  'phase2MaxTokens',
  'maxSummaryChars',
  'retryLimit',
  'maxUnusedDays',
] as const

export type OverridableKey = (typeof OVERRIDABLE_KEYS)[number]

const RANGES: Record<OverridableKey, readonly [number, number]> = {
  enabled: [0, 1],
  showVaultInSidebar: [0, 1],
  provider: [0, 0],
  model: [0, 0],
  phase1ReasoningEffort: [0, 0],
  phase2ReasoningEffort: [0, 0],
  idleDebounceMs: [10_000, 3_600_000],
  maxRolloutsPerRun: [1, 50],
  extractionConcurrency: [1, 8],
  minSessionEvents: [1, 100],
  maxRolloutAgeDays: [1, 365],
  maxTranscriptChars: [10_000, 300_000],
  phase1MaxTokens: [256, 16_384],
  consolidationCooldownMs: [60_000, 7 * 24 * 60 * 60_000],
  maxRawChars: [10_000, 500_000],
  phase2MaxTokens: [512, 131_072],
  maxSummaryChars: [1_000, 50_000],
  retryLimit: [1, 10],
  maxUnusedDays: [0, 730],
}

/** Validate and clamp one settings-page override patch. */
export function clampOverrides(patch: Record<string, unknown>): Partial<Config> {
  const out: Record<string, unknown> = {}
  for (const key of OVERRIDABLE_KEYS) {
    const value = patch[key]
    if (value === undefined) continue
    if (key === 'enabled' || key === 'showVaultInSidebar') {
      out[key] = value === true || value === 'true'
      continue
    }
    if (key === 'provider' || key === 'model') {
      if (typeof value === 'string' && value.length <= 200) out[key] = value
      continue
    }
    if (key === 'phase1ReasoningEffort' || key === 'phase2ReasoningEffort') {
      if (typeof value === 'string' && value.length <= 64) out[key] = value
      continue
    }
    if (typeof value !== 'number' && typeof value !== 'string') continue
    const numeric = typeof value === 'number' ? value : Number.parseFloat(value)
    if (!Number.isFinite(numeric)) continue
    const [min, max] = RANGES[key]
    out[key] = Math.min(max, Math.max(min, Math.round(numeric)))
  }
  return out as Partial<Config>
}

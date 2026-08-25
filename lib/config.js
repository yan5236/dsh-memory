/** Plugin configuration: composition `config` provides the base layer, the settings page writes overrides. */
import z from '@deepseek-ai/schemastery';
export const DEFAULTS = {
    enabled: true,
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
    phase1MaxTokens: 4_096,
    consolidationCooldownMs: 6 * 60 * 60_000,
    maxRawChars: 120_000,
    phase2MaxTokens: 32_768,
    maxSummaryChars: 8_000,
    retryLimit: 3,
    maxUnusedDays: 30,
};
export const Config = z.object({
    enabled: z.boolean().default(DEFAULTS.enabled),
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
});
/** Merge composition base and runtime overrides over schema defaults. */
export function resolveConfig(base = {}, overrides = {}) {
    const merged = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS)) {
        const override = overrides[key];
        if (override !== undefined) {
            merged[key] = override;
            continue;
        }
        const baseValue = base[key];
        if (baseValue !== undefined)
            merged[key] = baseValue;
    }
    return merged;
}
/** Whitelisted keys the settings page may override, with safe range clamps. */
export const OVERRIDABLE_KEYS = [
    'enabled',
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
];
const RANGES = {
    enabled: [0, 1],
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
};
/** Validate and clamp one settings-page override patch. */
export function clampOverrides(patch) {
    const out = {};
    for (const key of OVERRIDABLE_KEYS) {
        const value = patch[key];
        if (value === undefined)
            continue;
        if (key === 'enabled') {
            out[key] = value === true || value === 'true';
            continue;
        }
        if (key === 'provider' || key === 'model') {
            if (typeof value === 'string' && value.length <= 200)
                out[key] = value;
            continue;
        }
        if (key === 'phase1ReasoningEffort' || key === 'phase2ReasoningEffort') {
            if (typeof value === 'string' && value.length <= 64)
                out[key] = value;
            continue;
        }
        if (typeof value !== 'number' && typeof value !== 'string')
            continue;
        const numeric = typeof value === 'number' ? value : Number.parseFloat(value);
        if (!Number.isFinite(numeric))
            continue;
        const [min, max] = RANGES[key];
        out[key] = Math.min(max, Math.max(min, Math.round(numeric)));
    }
    return out;
}
//# sourceMappingURL=config.js.map
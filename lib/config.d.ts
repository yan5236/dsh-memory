/** Plugin configuration: composition `config` provides the base layer, the settings page writes overrides. */
import z from '@deepseek-ai/schemastery';
export interface Config {
    /** Master switch: extraction, consolidation, and injection. */
    enabled: boolean;
    /** Whether the left sidebar shows the 记忆库 entry that opens the vault page. */
    showVaultInSidebar: boolean;
    /** Memory root directory; empty resolves to `$DSH_HOME/memories` (or `~/.dsh/memories`). */
    memoryRoot: string;
    /** Optional dedicated LLM route for the memory pipeline; empty uses the deployment default model. */
    provider: string;
    model: string;
    /**
     * Reasoning effort (思考等级) for Phase 1 extraction calls. One of the
     * adapter-exposed ids (`off`/`low`/`high`/`max` on DeepSeek); empty uses the
     * provider default. Invalid values degrade to the default at call time.
     */
    phase1ReasoningEffort: string;
    /** Reasoning effort for Phase 2 consolidation calls; empty uses the provider default. */
    phase2ReasoningEffort: string;
    /** Debounce delay between a root session turn stopping and the extraction run. */
    idleDebounceMs: number;
    /** Sessions extracted per pipeline run. */
    maxRolloutsPerRun: number;
    /** Parallel extraction workers. */
    extractionConcurrency: number;
    /** Sessions with fewer rendered events are skipped as no-op. */
    minSessionEvents: number;
    /** Already-processed sessions are re-checked for growth no more often than this. */
    recheckIntervalMs: number;
    /** Minimum new rendered events a grown session needs before a delta extraction. */
    minDeltaEvents: number;
    /** Sessions older than this many days are marked no-op instead of extracted. */
    maxRolloutAgeDays: number;
    /** Hard cap on the rendered transcript sent to the extraction model. */
    maxTranscriptChars: number;
    /** Output token cap for one Phase 1 extraction call. */
    phase1MaxTokens: number;
    /** Cooldown between automatic Phase 2 consolidations. */
    consolidationCooldownMs: number;
    /** Hard cap on raw memories fed into one consolidation call. */
    maxRawChars: number;
    /**
     * Output token cap for one Phase 2 consolidation call. Defaults high
     * because the model rewrites MEMORY.md in full and reasoning models burn
     * budget inside this cap; raise it when consolidation keeps truncating.
     */
    phase2MaxTokens: number;
    /** Hard cap on the memory summary injected into the system prompt. */
    maxSummaryChars: number;
    /** Extraction attempts before a session is permanently failed. */
    retryLimit: number;
    /**
     * Forgetting threshold: rollout summaries whose last use (or creation, when
     * never used) is older than this many days become forgetting candidates in
     * Phase 2; the model may retire them into `rollout_summaries/.retired/`.
     * 0 disables the forgetting mechanism. Default 30 aligns with Codex.
     */
    maxUnusedDays: number;
}
export declare const DEFAULTS: Config;
export declare const Config: z<Config>;
/** Merge composition base and runtime overrides over schema defaults. */
export declare function resolveConfig(base?: Partial<Config>, overrides?: Partial<Config>): Config;
/** Whitelisted keys the settings page may override, with safe range clamps. */
export declare const OVERRIDABLE_KEYS: readonly ["enabled", "showVaultInSidebar", "provider", "model", "phase1ReasoningEffort", "phase2ReasoningEffort", "idleDebounceMs", "maxRolloutsPerRun", "extractionConcurrency", "minSessionEvents", "maxRolloutAgeDays", "maxTranscriptChars", "phase1MaxTokens", "consolidationCooldownMs", "maxRawChars", "phase2MaxTokens", "maxSummaryChars", "retryLimit", "maxUnusedDays"];
export type OverridableKey = (typeof OVERRIDABLE_KEYS)[number];
/** Validate and clamp one settings-page override patch. */
export declare function clampOverrides(patch: Record<string, unknown>): Partial<Config>;
//# sourceMappingURL=config.d.ts.map
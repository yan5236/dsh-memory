/** Phase 1: per-session extraction into rollout summaries and raw memories. */
import type { MemoryStateStore } from './bookkeeping.js';
import type { Config } from './config.js';
import type { MemoryFiles } from './files.js';
import type { LlmDirectoryRuntime, ModelRoute } from './llm.js';
import type { SessionReader } from './types.js';
export interface Phase1Summary {
    selected: number;
    done: number;
    noop: number;
    failed: number;
    unchanged: number;
    skippedNoRoute: boolean;
    skippedNoSessions: boolean;
}
export interface Phase1Deps {
    llm: LlmDirectoryRuntime;
    state: MemoryStateStore;
    files: MemoryFiles;
    /** Accessors so late-mounted services and runtime overrides are honored per run. */
    sessions: () => SessionReader | undefined;
    config: () => Config;
    route: () => ModelRoute | undefined;
    /** Injectable clock for tests. */
    now?: () => number;
}
/**
 * Which rung of the extraction ladder produced the fields, for run-log
 * diagnosis: `tool-call` is the healthy path; `-repair`/`-salvage` mean the
 * model emitted broken JSON that the tolerant chain recovered; `text-*` means
 * the tool route failed and the plain-text fallback carried the session.
 */
/** Wall-clock deadline for one extraction call; a stalled stream aborts here. */
export declare const EXTRACTION_DEADLINE_MS = 150000;
export type ExtractStrategy = 'tool-call' | 'tool-call-repair' | 'tool-call-salvage' | 'text-json' | 'text-json-repair' | 'text-sections' | 'none';
export declare class Phase1Runner {
    private readonly deps;
    private running;
    constructor(deps: Phase1Deps);
    /** Whether an extraction batch is currently in flight (single-flight promise alive). */
    get isRunning(): boolean;
    /** Single-flight entry point used by the scheduler and the settings page. */
    run(): Promise<Phase1Summary>;
    private execute;
    private extractOne;
    /**
     * Extraction ladder: ① structured tool call (with the tolerant JSON chain
     * inside) → ② plain-text sections with no tools at all. A truncated output
     * halves the transcript and replays the whole ladder.
     */
    private callExtract;
    private extractWithLadder;
    private meta;
    /** Strategy ①: memory_save tool call, tolerant JSON chain, text JSON as the ignored-tool fallback. */
    private extractWithTool;
    /** Strategy ②: no tools at all; ===SECTION=== blocks first, JSON as a courtesy. */
    private extractFromText;
    /**
     * Text JSON parse: balanced object first, then the repair chain. A truncated
     * response must still be structurally complete (otherwise the halved replay
     * is the better move).
     */
    private parseJsonText;
    private normalizeFields;
}
//# sourceMappingURL=phase1.d.ts.map
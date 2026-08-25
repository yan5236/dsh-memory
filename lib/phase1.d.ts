/** Phase 1: per-session extraction into rollout summaries and raw memories. */
import type { MemoryStateStore } from './bookkeeping.js';
import type { Config } from './config.js';
import type { MemoryFiles } from './files.js';
import type { LlmRuntime, ModelRoute } from './llm.js';
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
    llm: LlmRuntime;
    state: MemoryStateStore;
    files: MemoryFiles;
    /** Accessors so late-mounted services and runtime overrides are honored per run. */
    sessions: () => SessionReader | undefined;
    config: () => Config;
    route: () => ModelRoute | undefined;
    /** Injectable clock for tests. */
    now?: () => number;
}
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
     * One extraction call: structured tool call preferred, text-JSON fallback,
     * and a single halved-input retry when the output was truncated.
     */
    private callExtract;
    private normalizeFields;
}
//# sourceMappingURL=phase1.d.ts.map
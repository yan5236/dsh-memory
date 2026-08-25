/** Phase 2: global consolidation into MEMORY.md and memory_summary.md, plus skill promotion and forgetting. */
import type { MemoryStateStore } from './bookkeeping.js';
import type { Config } from './config.js';
import type { MemoryFiles } from './files.js';
import type { LlmDirectoryRuntime, ModelRoute } from './llm.js';
export type Phase2Outcome = {
    kind: 'consolidated';
    mode: 'init' | 'incremental';
} | {
    kind: 'skipped';
    reason: 'cooldown' | 'no-input' | 'no-route' | 'retry-paused';
} | {
    kind: 'error';
    error: string;
};
/** Automatic retries pause after this many consecutive failures (manual runs bypass). */
export declare const MAX_AUTO_PHASE2_RETRIES = 3;
export interface Phase2Deps {
    llm: LlmDirectoryRuntime;
    state: MemoryStateStore;
    files: MemoryFiles;
    config: () => Config;
    route: () => ModelRoute | undefined;
    /** Injectable clock for tests. */
    now?: () => number;
}
export declare class Phase2Runner {
    private readonly deps;
    private running;
    constructor(deps: Phase2Deps);
    /** Whether a consolidation is currently in flight (single-flight promise alive). */
    get isRunning(): boolean;
    /** Single-flight entry point; `force` bypasses the cooldown for manual runs. */
    run(force?: boolean): Promise<Phase2Outcome>;
    private execute;
}
//# sourceMappingURL=phase2.d.ts.map
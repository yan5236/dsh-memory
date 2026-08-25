/** Read-path tools: memory_list / memory_read / memory_search / memory_add. */
import type { MemoryStateStore } from './bookkeeping.js';
import type { MemoryFiles } from './files.js';
export interface ToolRegistryRuntime {
    register(definition: unknown): () => void;
}
/**
 * Canonical usage key for a user-supplied memory path: forward slashes,
 * dot segments collapsed (`./`, `a//b`, `a/./b` → `a/b`). Reads that succeed
 * against such variants must land on the same key as the canonical
 * `rollout_summaries/<slug>.md` form, or forgetting would judge a recently
 * read summary as unused.
 */
export declare function usageKey(input: string): string;
/** Register the four memory tools; returns a disposer that unregisters all of them. */
export declare function registerMemoryTools(registry: ToolRegistryRuntime, files: MemoryFiles, state: MemoryStateStore): () => void;
//# sourceMappingURL=tools.d.ts.map
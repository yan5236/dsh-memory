/** Host-side RPC for the settings page. */
import type { MemoryStateStore } from './bookkeeping.js';
import type { Config } from './config.js';
import type { MemoryFiles } from './files.js';
import type { LlmDirectoryRuntime, ModelRoute } from './llm.js';
import type { Phase1Runner } from './phase1.js';
import type { Phase2Runner } from './phase2.js';
export interface HttpRequestLike {
    method?: string;
    headers?: Record<string, string | string[] | undefined>;
    [Symbol.asyncIterator](): AsyncIterator<unknown>;
}
export interface HttpResponseLike {
    writeHead(status: number, headers?: Record<string, string>): void;
    end(body?: string): void;
}
export interface WebServerRuntime {
    register(route: {
        kind: string;
        path: string;
        handler: (req: HttpRequestLike, res: HttpResponseLike) => Promise<void> | void;
    }): () => void;
}
/** Structural view of the llm surface the RPC needs beyond streaming (alias). */
export type { LlmDirectoryRuntime } from './llm.js';
export interface RpcDeps {
    state: MemoryStateStore;
    files: MemoryFiles;
    llm: LlmDirectoryRuntime;
    config: () => Config;
    route: () => ModelRoute | undefined;
    phase1: Phase1Runner;
    phase2: Phase2Runner;
    runPipeline: () => Promise<void>;
}
export interface FailureEntry {
    session: string;
    error: string;
    at: number;
}
export interface ProviderEntry {
    id: string;
    name: string;
}
export interface ModelEntry {
    id: string;
    name: string;
}
/** One adapter-owned reasoning effort selectable for the current route. */
export interface ReasoningEffortEntry {
    id: string;
    name: string;
    description?: string;
}
export interface StatePayload {
    enabled: boolean;
    root: string;
    config: Config;
    storage: 'ok' | 'unavailable';
    storageError: string;
    route: ModelRoute | null;
    providers: ProviderEntry[];
    models: ModelEntry[];
    /** Adapter-owned reasoning efforts selectable on the current route (empty = unknown). */
    reasoningEfforts: ReasoningEffortEntry[];
    counts: {
        done: number;
        noop: number;
        failed: number;
        running: number;
        total: number;
    };
    recentFailures: FailureEntry[];
    stats: {
        summaryChars: number;
        memoryChars: number;
        rawChars: number;
        archiveChars: number;
        rollouts: number;
        skills: number;
        notes: number;
        retired: number;
        logCount: number;
    };
    pipeline: {
        pendingConsolidation: boolean;
        lastPhase1At: number;
        lastPhase2At: number;
        phase2Error?: string;
        cooldownRemainingMs: number;
        runningPhase1: boolean;
        runningPhase2: boolean;
        phase2Failures: number;
    };
}
/**
 * Same-origin guard for the RPC endpoint. The DSH webServer performs no
 * auth/CSRF checks of its own (pure route dispatch), so this plugin must:
 * - reject requests whose `Host` is not loopback → blocks DNS-rebinding;
 * - reject browser requests whose `Origin` is not loopback → blocks
 *   cross-origin POSTs from arbitrary pages (the JSON body is accepted
 *   regardless of content-type, so a `text/plain` fetch would otherwise slip
 *   through CORS preflight).
 * Requests without an `Origin` (curl, local tooling) are allowed: such
 * clients already hold full machine access, matching the localhost threat
 * model. Returns a short human-readable reason, or null when allowed.
 */
export declare function originGuard(headers: Record<string, string | string[] | undefined> | undefined): string | null;
/**
 * Reason a `delete-file` call is refused, or null when deletion is allowed.
 * Retro-archived summaries and core pipeline files are hard-refused; the
 * vault cannot permanently delete what forgetting only ever "retires".
 */
export declare function protectedDeleteReason(path: string): string | null;
/** Register the `/dsh-memory/rpc` route; returns the route disposer. */
export declare function registerRpc(webServer: WebServerRuntime, deps: RpcDeps): () => void;
//# sourceMappingURL=rpc.d.ts.map
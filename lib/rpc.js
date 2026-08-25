/** Host-side RPC for the settings page. */
import { clampOverrides } from './config.js';
import { messageOf } from './util.js';
/** Loopback hostnames the RPC accepts regardless of port. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
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
export function originGuard(headers) {
    const take = (name) => {
        const value = headers?.[name];
        const first = Array.isArray(value) ? value[0] : value;
        return typeof first === 'string' && first !== '' ? first : undefined;
    };
    const host = take('host');
    if (host === undefined)
        return 'missing Host header';
    let hostname;
    try {
        hostname = new URL(`http://${host}`).hostname;
    }
    catch {
        return 'malformed Host header';
    }
    if (!LOOPBACK_HOSTS.has(hostname))
        return 'non-loopback Host';
    const origin = take('origin');
    if (origin === undefined)
        return null;
    if (origin === 'null')
        return 'opaque Origin';
    try {
        const originHostname = new URL(origin).hostname;
        if (!LOOPBACK_HOSTS.has(originHostname))
            return 'cross-origin request';
    }
    catch {
        return 'malformed Origin';
    }
    return null;
}
/**
 * Core memory files overwritten by every consolidation; deleting them would
 * destroy the memory system.
 */
const CORE_FILES = new Set(['MEMORY.md', 'memory_summary.md', 'raw_memories.md', 'raw_memories.archive.md']);
/** Retired summaries live under this prefix; the design promises recoverable, never deleted. */
const RETIRED_PREFIX = 'rollout_summaries/.retired';
/**
 * Reason a `delete-file` call is refused, or null when deletion is allowed.
 * Retro-archived summaries and core pipeline files are hard-refused; the
 * vault cannot permanently delete what forgetting only ever "retires".
 */
export function protectedDeleteReason(path) {
    const normalized = path.replace(/\\/g, '/');
    if (CORE_FILES.has(normalized))
        return `delete-file refused: ${path} is a core memory file`;
    if (normalized === RETIRED_PREFIX || normalized.startsWith(`${RETIRED_PREFIX}/`)) {
        return `delete-file refused: ${path} is a retired summary (recoverable archive)`;
    }
    return null;
}
async function listProviders(deps) {
    try {
        const providers = deps.llm.listProviders?.() ?? [];
        return providers.map(provider => ({ id: provider.id, name: provider.name ?? provider.id }));
    }
    catch {
        return [];
    }
}
async function listModels(deps, provider) {
    if (provider === '')
        return [];
    try {
        const models = await deps.llm.listModels?.(provider) ?? [];
        return models.map(model => ({ id: model.id, name: model.name ?? model.id }));
    }
    catch {
        return [];
    }
}
/** Reasoning efforts the adapter exposes for one exact route (empty = unknown). */
async function listReasoningEfforts(deps, route) {
    if (route === undefined)
        return [];
    try {
        const info = await deps.llm.resolveModelInfo?.(route.provider, route.model);
        return (info?.reasoning?.efforts ?? []).map(effort => ({
            id: effort.id,
            name: effort.name,
            ...(effort.description === undefined ? {} : { description: effort.description }),
        }));
    }
    catch {
        return [];
    }
}
async function statePayload(deps) {
    const cfg = deps.config();
    const snapshot = deps.state.snapshot();
    const stats = await deps.files.stats();
    const counts = { done: 0, noop: 0, failed: 0, running: 0, total: 0 };
    const failures = [];
    for (const [id, claim] of Object.entries(snapshot.processed)) {
        counts[claim.status] += 1;
        counts.total += 1;
        if (claim.status === 'failed') {
            failures.push({ session: id, error: claim.error ?? '', at: claim.at });
        }
    }
    failures.sort((a, b) => b.at - a.at);
    const now = Date.now();
    return {
        enabled: cfg.enabled,
        root: deps.files.root,
        config: cfg,
        storage: deps.state.storageAvailable ? 'ok' : 'unavailable',
        storageError: deps.state.storageError,
        route: deps.route() ?? null,
        providers: await listProviders(deps),
        models: await listModels(deps, cfg.provider),
        reasoningEfforts: await listReasoningEfforts(deps, deps.route()),
        counts,
        recentFailures: failures.slice(0, 3),
        stats,
        pipeline: {
            pendingConsolidation: snapshot.pendingConsolidation,
            lastPhase1At: snapshot.lastPhase1At,
            lastPhase2At: snapshot.lastPhase2At,
            ...(snapshot.phase2Error === undefined ? {} : { phase2Error: snapshot.phase2Error }),
            // "When can the next automatic run happen": after the full cooldown,
            // or sooner when a failed run has scheduled a retry window.
            cooldownRemainingMs: Math.max(0, Math.max(snapshot.lastPhase2At + cfg.consolidationCooldownMs, snapshot.nextAutoRetryAt ?? 0) - now),
            runningPhase1: deps.phase1.isRunning,
            runningPhase2: deps.phase2.isRunning,
            phase2Failures: deps.state.phase2Failures,
        },
    };
}
/** Register the `/dsh-memory/rpc` route; returns the route disposer. */
export function registerRpc(webServer, deps) {
    return webServer.register({
        kind: 'exact',
        path: '/dsh-memory/rpc',
        handler: async (req, res) => {
            try {
                const denied = originGuard(req.headers);
                if (denied !== null) {
                    res.writeHead(403, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, message: `forbidden: ${denied}` }));
                    return;
                }
                if (req.method !== 'POST') {
                    res.writeHead(405, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, message: 'method not allowed' }));
                    return;
                }
                let body = '';
                for await (const chunk of req)
                    body += typeof chunk === 'string' ? chunk : String(chunk);
                let payload = {};
                try {
                    payload = JSON.parse(body || '{}');
                }
                catch {
                    res.writeHead(400, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, message: 'invalid json body' }));
                    return;
                }
                const method = payload.method;
                const args = (payload.args ?? {});
                let result;
                if (method === 'get-state') {
                    result = await statePayload(deps);
                }
                else if (method === 'set-config') {
                    deps.state.setOverrides(clampOverrides(args));
                    result = await statePayload(deps);
                }
                else if (method === 'run-phase1') {
                    const summary = await deps.phase1.run();
                    let phase2 = null;
                    if (summary.done > 0)
                        phase2 = await deps.phase2.run(false);
                    result = { phase1: summary, phase2, state: await statePayload(deps) };
                }
                else if (method === 'run-phase2') {
                    const outcome = await deps.phase2.run(true);
                    result = { phase2: outcome, state: await statePayload(deps) };
                }
                else if (method === 'run-pipeline') {
                    await deps.runPipeline();
                    result = { state: await statePayload(deps) };
                }
                else if (method === 'list-files') {
                    result = { files: await deps.files.listTree(typeof args.path === 'string' ? args.path : '') };
                }
                else if (method === 'get-logs') {
                    const limit = typeof args.limit === 'number' ? Math.max(1, Math.min(50, Math.floor(args.limit))) : 20;
                    result = { logs: await deps.files.listRunLogs(limit) };
                }
                else if (method === 'read-file') {
                    const path = typeof args.path === 'string' ? args.path : '';
                    const content = await deps.files.readIfExists(path, 300_000);
                    result = { path, content: content ?? null };
                }
                else if (method === 'write-file') {
                    const path = typeof args.path === 'string' ? args.path : '';
                    const content = typeof args.content === 'string' ? args.content : '';
                    if (path === '' || path.endsWith('/') || path.endsWith('\\')) {
                        result = { ok: false, message: 'write-file requires a non-empty file path' };
                    }
                    else if (content.length > 5_000_000) {
                        result = { ok: false, message: 'write-file content is too large (max 5MB)' };
                    }
                    else {
                        await deps.files.writeAtomic(path, content);
                        result = { ok: true, path };
                    }
                }
                else if (method === 'delete-file') {
                    const path = typeof args.path === 'string' ? args.path : '';
                    if (path === '' || path.endsWith('/') || path.endsWith('\\')) {
                        result = { ok: false, message: 'delete-file requires a non-empty file path' };
                    }
                    else {
                        const denied = protectedDeleteReason(path);
                        if (denied !== null) {
                            result = { ok: false, message: denied };
                        }
                        else {
                            const removed = await deps.files.removeFile(path);
                            result = { ok: removed, path };
                        }
                    }
                }
                else if (method === 'list-providers') {
                    result = { providers: await listProviders(deps) };
                }
                else if (method === 'list-models') {
                    result = { models: await listModels(deps, typeof args.provider === 'string' ? args.provider : '') };
                }
                else if (method === 'reset-failures') {
                    const reset = deps.state.resetFailedClaims();
                    await deps.runPipeline();
                    result = { reset, state: await statePayload(deps) };
                }
                else {
                    res.writeHead(404, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, message: `unknown method: ${String(method)}` }));
                    return;
                }
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify(result));
            }
            catch (error) {
                res.writeHead(500, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ ok: false, message: messageOf(error) }));
            }
        },
    });
}
//# sourceMappingURL=rpc.js.map
/** Host-side RPC for the settings page. */
import { clampOverrides } from './config.js';
import { messageOf } from './util.js';
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
        counts,
        recentFailures: failures.slice(0, 3),
        stats,
        pipeline: {
            pendingConsolidation: snapshot.pendingConsolidation,
            lastPhase1At: snapshot.lastPhase1At,
            lastPhase2At: snapshot.lastPhase2At,
            ...(snapshot.phase2Error === undefined ? {} : { phase2Error: snapshot.phase2Error }),
            cooldownRemainingMs: Math.max(0, snapshot.lastPhase2At + cfg.consolidationCooldownMs - now),
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
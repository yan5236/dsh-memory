/**
 * dsh-memory — long-term memory system for DeepSeek Harness.
 *
 * Two-phase pipeline adapted from Codex memories onto DSH primitives:
 * Phase 1 extracts durable memories from root session logs (sessionQuery /
 * sessionPersistence), Phase 2 consolidates them into MEMORY.md and
 * memory_summary.md. The summary is injected through systemPrompt, and four
 * memory tools serve on-demand retrieval. Bookkeeping (claims, cooldown,
 * pending flag, overrides) persists through the storage hub KV backend.
 */
import { MemoryStateStore } from './bookkeeping.js';
import { Config, resolveConfig } from './config.js';
import { MemoryFiles } from './files.js';
import { MemoryInjection } from './inject.js';
import { resolveRoute } from './llm.js';
import { resolveMemoryRoot } from './paths.js';
import { Phase1Runner } from './phase1.js';
import { Phase2Runner } from './phase2.js';
import { registerRpc } from './rpc.js';
import { registerMemoryTools } from './tools.js';
import { messageOf } from './util.js';
export const name = 'dsh-memory';
export const inject = ['llm', 'timer'];
export { Config, DEFAULTS, clampOverrides, OVERRIDABLE_KEYS, resolveConfig } from './config.js';
export { MemoryStateStore } from './bookkeeping.js';
export { MemoryFiles, ensureSummaryV1 } from './files.js';
export { MemoryInjection, buildSectionText, GUIDE_ORDER } from './inject.js';
export { collectResponse, collectText, collectTextDetails, effortLabel, extractJsonObject, generateOptions, LlmCallError, parseCallArguments, parseFencedBlocks, pickBlock, resolveReasoningEffort, resolveRoute, stripFences, } from './llm.js';
export { defaultMemoryRoot, isWithin, resolveMemoryRoot, sanitizeSlug } from './paths.js';
export { Phase1Runner } from './phase1.js';
export { Phase2Runner } from './phase2.js';
export { PHASE1_SYSTEM, PHASE1_TOOL, PHASE2_SYSTEM, PHASE2_TOOL, phase1User, phase2User } from './prompts.js';
export { redactSecrets, renderEvent, renderTranscript, selectCandidates } from './rollout.js';
export { registerRpc } from './rpc.js';
export { registerMemoryTools } from './tools.js';
export { headTail, messageOf } from './util.js';
export function apply(ctx, config = {}) {
    const base = resolveConfig(config);
    const llm = ctx.get('llm');
    if (llm === undefined)
        throw new Error('dsh-memory requires the llm service');
    const timer = ctx.get('timer');
    if (timer === undefined)
        throw new Error('dsh-memory requires the timer service');
    const getKv = () => {
        const storage = ctx.get('storage');
        const backend = storage?.backend?.get?.('json');
        return backend?.kv;
    };
    const state = new MemoryStateStore(getKv);
    const files = new MemoryFiles(resolveMemoryRoot(base.memoryRoot));
    const configNow = () => resolveConfig(base, state.snapshot().overrides);
    const sessionReader = () => {
        const query = ctx.get('sessionQuery');
        if (query?.listSessions !== undefined && query.readSession !== undefined) {
            return {
                listSessions: async () => (await query.listSessions()).map(record => record.header),
                readSession: async (id) => {
                    const snapshot = await query.readSession(id);
                    return { session: snapshot.session, events: snapshot.events };
                },
            };
        }
        const persistence = ctx.get('sessionPersistence');
        if (persistence?.list !== undefined && persistence.load !== undefined) {
            return {
                listSessions: async () => (await persistence.list()),
                readSession: async (id) => {
                    const inspection = await persistence.load(id);
                    return {
                        session: (inspection.header ?? { id }),
                        events: inspection.events ?? [],
                    };
                },
            };
        }
        return undefined;
    };
    const routeNow = () => {
        const selection = ctx.get('agentDefaultModel')?.currentSelection?.();
        return resolveRoute(configNow(), selection);
    };
    const phase1 = new Phase1Runner({ llm, state, files, sessions: sessionReader, config: configNow, route: routeNow });
    const phase2 = new Phase2Runner({ llm, state, files, config: configNow, route: routeNow });
    const injection = new MemoryInjection(files, configNow);
    const log = (text) => {
        console.error(`[dsh-memory] ${text}`);
    };
    const runPipeline = async () => {
        const cfg = configNow();
        if (!cfg.enabled)
            return;
        const summary = await phase1.run();
        if (summary.done > 0 || state.pendingConsolidation || await files.hasPendingNotes()) {
            await phase2.run(false);
        }
        await injection.reload();
        await state.flush();
    };
    let scheduled = false;
    const runSoon = () => {
        if (scheduled)
            return;
        scheduled = true;
        timer.timeout(() => {
            scheduled = false;
            void runPipeline().catch(error => log(`pipeline: ${messageOf(error)}`));
        }, 4_000);
    };
    const triggerFromTurn = () => {
        if (!configNow().enabled)
            return;
        const debounced = timer.debounce(runSoon, configNow().idleDebounceMs);
        debounced();
    };
    // Root-session lifecycle: Codex wakes the pipeline at root session start;
    // we additionally schedule after each root turn stops (debounced = idle guard).
    let lastSessionStartTrigger = 0;
    const isRoot = (payload) => payload.agent?.session?.header?.origin !== 'subagent';
    ctx.on('agent/turn-stopping', (payload) => {
        if (!isRoot(payload))
            return;
        triggerFromTurn();
    });
    ctx.on('agent/session-start', (payload) => {
        if (!isRoot(payload))
            return;
        const now = Date.now();
        if (now - lastSessionStartTrigger < 60_000)
            return;
        lastSessionStartTrigger = now;
        runSoon();
    });
    // Optional services: react to late mounting through the cordis service event.
    const whenService = (serviceName, use) => {
        const attempt = () => {
            const service = ctx.get(serviceName);
            if (service === undefined)
                return false;
            use(service);
            return true;
        };
        if (attempt())
            return;
        ctx.on('internal/service', (payload) => {
            const received = typeof payload === 'string' ? payload : payload?.name;
            if (received === serviceName)
                attempt();
        });
    };
    let toolsDisposer;
    ctx.effect(() => () => toolsDisposer?.());
    whenService('tools', registry => {
        if (toolsDisposer !== undefined)
            return;
        toolsDisposer = registerMemoryTools(registry, files, state);
    });
    whenService('systemPrompt', systemPrompt => injection.install(systemPrompt));
    whenService('webServer', webServer => {
        const disposeRpc = registerRpc(webServer, {
            state, files, llm, config: configNow, route: routeNow, phase1, phase2, runPipeline,
        });
        ctx.effect(() => disposeRpc);
    });
    ctx.effect(() => () => {
        injection.dispose();
        void state.dispose();
    });
    void (async () => {
        try {
            await state.init();
            await injection.reload();
            if (configNow().enabled)
                runSoon();
        }
        catch (error) {
            log(`init: ${messageOf(error)}`);
        }
    })();
}
//# sourceMappingURL=index.js.map
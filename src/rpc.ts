/** Host-side RPC for the settings page. */

import type { MemoryStateStore } from './bookkeeping.js'
import type { Config } from './config.js'
import { clampOverrides } from './config.js'
import type { MemoryFiles } from './files.js'
import type { LlmRuntime, ModelRoute } from './llm.js'
import type { Phase1Runner } from './phase1.js'
import type { Phase2Runner, Phase2Outcome } from './phase2.js'
import { messageOf } from './util.js'

export interface HttpRequestLike {
  method?: string
  [Symbol.asyncIterator](): AsyncIterator<unknown>
}

export interface HttpResponseLike {
  writeHead(status: number, headers?: Record<string, string>): void
  end(body?: string): void
}

export interface WebServerRuntime {
  register(route: {
    kind: string
    path: string
    handler: (req: HttpRequestLike, res: HttpResponseLike) => Promise<void> | void
  }): () => void
}

/** Structural view of the llm surface the RPC needs beyond streaming. */
export interface LlmDirectoryRuntime extends LlmRuntime {
  listProviders?: () => Array<{ id: string; name?: string }>
  listModels?: (provider: string) => Promise<Array<{ id: string; name?: string }>>
}

export interface RpcDeps {
  state: MemoryStateStore
  files: MemoryFiles
  llm: LlmDirectoryRuntime
  config: () => Config
  route: () => ModelRoute | undefined
  phase1: Phase1Runner
  phase2: Phase2Runner
  runPipeline: () => Promise<void>
}

export interface FailureEntry {
  session: string
  error: string
  at: number
}

export interface ProviderEntry {
  id: string
  name: string
}

export interface ModelEntry {
  id: string
  name: string
}

export interface StatePayload {
  enabled: boolean
  root: string
  config: Config
  storage: 'ok' | 'unavailable'
  storageError: string
  route: ModelRoute | null
  providers: ProviderEntry[]
  models: ModelEntry[]
  counts: { done: number; noop: number; failed: number; running: number; total: number }
  recentFailures: FailureEntry[]
  stats: {
    summaryChars: number
    memoryChars: number
    rawChars: number
    archiveChars: number
    rollouts: number
    skills: number
    notes: number
    retired: number
    logCount: number
  }
  pipeline: {
    pendingConsolidation: boolean
    lastPhase1At: number
    lastPhase2At: number
    phase2Error?: string
    cooldownRemainingMs: number
    runningPhase1: boolean
    runningPhase2: boolean
    phase2Failures: number
  }
}

async function listProviders(deps: RpcDeps): Promise<ProviderEntry[]> {
  try {
    const providers = deps.llm.listProviders?.() ?? []
    return providers.map(provider => ({ id: provider.id, name: provider.name ?? provider.id }))
  } catch {
    return []
  }
}

async function listModels(deps: RpcDeps, provider: string): Promise<ModelEntry[]> {
  if (provider === '') return []
  try {
    const models = await deps.llm.listModels?.(provider) ?? []
    return models.map(model => ({ id: model.id, name: model.name ?? model.id }))
  } catch {
    return []
  }
}

async function statePayload(deps: RpcDeps): Promise<StatePayload> {
  const cfg = deps.config()
  const snapshot = deps.state.snapshot()
  const stats = await deps.files.stats()
  const counts = { done: 0, noop: 0, failed: 0, running: 0, total: 0 }
  const failures: FailureEntry[] = []
  for (const [id, claim] of Object.entries(snapshot.processed)) {
    counts[claim.status] += 1
    counts.total += 1
    if (claim.status === 'failed') {
      failures.push({ session: id, error: claim.error ?? '', at: claim.at })
    }
  }
  failures.sort((a, b) => b.at - a.at)
  const now = Date.now()
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
  }
}

/** Register the `/dsh-memory/rpc` route; returns the route disposer. */
export function registerRpc(webServer: WebServerRuntime, deps: RpcDeps): () => void {
  return webServer.register({
    kind: 'exact',
    path: '/dsh-memory/rpc',
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') {
          res.writeHead(405, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: false, message: 'method not allowed' }))
          return
        }
        let body = ''
        for await (const chunk of req) body += typeof chunk === 'string' ? chunk : String(chunk)
        let payload: { method?: unknown; args?: unknown } = {}
        try {
          payload = JSON.parse(body || '{}') as { method?: unknown; args?: unknown }
        } catch {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: false, message: 'invalid json body' }))
          return
        }
        const method = payload.method
        const args = (payload.args ?? {}) as Record<string, unknown>
        let result: unknown
        if (method === 'get-state') {
          result = await statePayload(deps)
        } else if (method === 'set-config') {
          deps.state.setOverrides(clampOverrides(args))
          result = await statePayload(deps)
        } else if (method === 'run-phase1') {
          const summary = await deps.phase1.run()
          let phase2: Phase2Outcome | null = null
          if (summary.done > 0) phase2 = await deps.phase2.run(false)
          result = { phase1: summary, phase2, state: await statePayload(deps) }
        } else if (method === 'run-phase2') {
          const outcome = await deps.phase2.run(true)
          result = { phase2: outcome, state: await statePayload(deps) }
        } else if (method === 'run-pipeline') {
          await deps.runPipeline()
          result = { state: await statePayload(deps) }
        } else if (method === 'list-files') {
          result = { files: await deps.files.listTree(typeof args.path === 'string' ? args.path : '') }
        } else if (method === 'get-logs') {
          const limit = typeof args.limit === 'number' ? Math.max(1, Math.min(50, Math.floor(args.limit))) : 20
          result = { logs: await deps.files.listRunLogs(limit) }
        } else if (method === 'read-file') {
          const path = typeof args.path === 'string' ? args.path : ''
          const content = await deps.files.readIfExists(path, 300_000)
          result = { path, content: content ?? null }
        } else if (method === 'list-providers') {
          result = { providers: await listProviders(deps) }
        } else if (method === 'list-models') {
          result = { models: await listModels(deps, typeof args.provider === 'string' ? args.provider : '') }
        } else if (method === 'reset-failures') {
          const reset = deps.state.resetFailedClaims()
          await deps.runPipeline()
          result = { reset, state: await statePayload(deps) }
        } else {
          res.writeHead(404, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: false, message: `unknown method: ${String(method)}` }))
          return
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(result))
      } catch (error: unknown) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, message: messageOf(error) }))
      }
    },
  })
}

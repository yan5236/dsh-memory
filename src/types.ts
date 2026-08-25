/** Shared structural types for the memory plugin. */

import type { Config } from './config.js'

/** One durable extraction claim for a session (Codex stage-1 job parity). */
export interface SessionClaim {
  status: 'done' | 'noop' | 'failed' | 'running'
  /** Epoch milliseconds of the last state transition. */
  at: number
  /** Extraction attempts so far; drives retry eligibility. */
  attempts: number
  /** Rollout slug produced by a successful extraction. */
  slug?: string
  /** Last failure message for diagnosis. */
  error?: string
  /** Highest event seq already captured; later growth becomes a delta extraction. */
  lastSeq?: number
  /** Number of rollout parts already written for this session. */
  parts?: number
}

/** Read-path usage recorded for one memory file (Codex usage_count/last_usage parity). */
export interface UsageRecord {
  count: number
  lastAt: number
}

/**
 * Durable plugin state persisted through the storage hub KV backend.
 *
 * `usage` and `retiredAt` are optional at load time so archives written by
 * older plugin versions keep loading (v stays 1; missing fields default to
 * empty maps).
 */
export interface MemoryState {
  v: 1
  processed: Record<string, SessionClaim>
  lastPhase1At: number
  lastPhase2At: number
  phase2Error?: string
  pendingConsolidation: boolean
  overrides: Partial<Config>
  /** Per-file read-path usage: relative memory path → usage record. */
  usage?: Record<string, UsageRecord>
  /** Retired rollout summary slug → epoch ms when it was retired. */
  retiredAt?: Record<string, number>
  /** Consecutive Phase 2 failures; pauses automatic retries at the cap. */
  phase2Failures?: number
  /**
   * Earliest epoch ms at which an automatic Phase 2 retry is allowed after a
   * failure (0 = no retry window pending; the full cooldown applies). Kept
   * separate from `lastPhase2At` so that timestamp stays the real last
   * attempt time.
   */
  nextAutoRetryAt?: number
}

/** Minimal structural view of a DSH session header. */
export interface SessionHeaderLite {
  id: string
  createdAt?: number
  cwd?: string
  origin?: 'subagent'
  parentSession?: string
}

/** Minimal structural view of one session log observation. */
export interface SessionLogLite {
  session: SessionHeaderLite
  events: unknown[]
}

/** Session-log read surface the pipeline depends on. */
export interface SessionReader {
  listSessions(): Promise<SessionHeaderLite[]>
  readSession(id: string): Promise<SessionLogLite>
}

/** File entry surfaced by `memory_list` and the settings page. */
export interface FileEntry {
  path: string
  kind: 'file' | 'dir'
  size: number
  modifiedAt: number
}

/**
 * One pipeline run persisted under `logs/<stamp>-<stage>.json`.
 *
 * `detail` carries stage-specific payloads (per-session extraction results,
 * the full Phase 2 model output); listRunLogs returns only the summary
 * fields, the settings page reads the full file through read-file.
 */
export interface RunLogEntry {
  at: number
  stage: 'phase1' | 'phase2'
  /** `provider/model` route actually used. */
  route?: string
  /** Reasoning effort actually applied (`default` when unset/invalid). */
  effort?: string
  /** Short human-readable outcome, e.g. "done 2/3" or "skipped:no-route". */
  outcome: string
  detail: Record<string, unknown>
}

/** Summary view of one run log, as returned by listRunLogs. */
export interface RunLogSummary {
  name: string
  at: number
  stage: 'phase1' | 'phase2'
  route?: string
  effort?: string
  outcome: string
  size: number
}

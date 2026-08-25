/** Durable bookkeeping through the storage hub KV backend: claims, cooldowns, pending flags. */

import type { Config } from './config.js'
import type { MemoryState, SessionClaim } from './types.js'
import { messageOf } from './util.js'

/** Structural slice of the storage hub KV unit the plugin needs. */
export interface KvUnitLike {
  loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>; global: unknown }>
  putRecord(table: string, key: string, value: unknown): Promise<void>
  close(): Promise<void>
}

export interface KvFacilityLike {
  open(descriptor: {
    name: string
    version: number
    tables: readonly string[]
    hasGlobal: boolean
  }): Promise<KvUnitLike>
}

const UNIT = { name: 'dsh_memory', version: 1, tables: ['state'], hasGlobal: false } as const
const KEY = 'main'
const ORPHAN_RUNNING_MS = 30 * 60_000

/** Automatic retry window after a failed consolidation (before the full cooldown). */
export const PHASE2_RETRY_MS = 15 * 60_000

function freshState(): MemoryState {
  return {
    v: 1,
    processed: {},
    lastPhase1At: 0,
    lastPhase2At: 0,
    pendingConsolidation: false,
    overrides: {},
    usage: {},
    retiredAt: {},
    nextAutoRetryAt: 0,
  }
}

function isMemoryState(value: unknown): value is MemoryState {
  if (typeof value !== 'object' || value === null) return false
  const state = value as Partial<MemoryState>
  return state.v === 1
    && typeof state.processed === 'object' && state.processed !== null
    && typeof state.lastPhase1At === 'number'
    && typeof state.lastPhase2At === 'number'
    && typeof state.pendingConsolidation === 'boolean'
    && typeof state.overrides === 'object' && state.overrides !== null
}

/**
 * Owns the plugin's durable state: per-session extraction claims, Phase 2
 * cooldown, the pending-consolidation flag, and settings-page overrides.
 * Writes are serialized through a promise chain; reads come from an in-memory
 * snapshot. When the KV backend is unavailable the store degrades to
 * process-local state (claims still prevent duplicate work within this run).
 */
export class MemoryStateStore {
  private state: MemoryState = freshState()
  private unit: KvUnitLike | undefined
  private openPromise: Promise<KvUnitLike | undefined> | undefined
  private saveChain: Promise<void> = Promise.resolve()
  storageAvailable = false
  storageError = ''

  constructor(
    private readonly getKv: () => KvFacilityLike | undefined,
    private readonly now: () => number = Date.now,
  ) {}

  async init(): Promise<void> {
    this.unit = await this.openUnit()
    if (this.unit === undefined) return
    try {
      const snapshot = await this.unit.loadAll()
      const record = snapshot.tables.state?.[KEY]
      if (isMemoryState(record)) {
        this.state = {
          ...freshState(),
          ...record,
          processed: { ...record.processed },
          overrides: { ...record.overrides },
          // Older archives lack these fields; keep the maps defined.
          usage: record.usage ?? {},
          retiredAt: record.retiredAt ?? {},
          nextAutoRetryAt: record.nextAutoRetryAt ?? 0,
        }
        this.recoverOrphans()
      }
    } catch (error: unknown) {
      this.storageError = messageOf(error)
    }
  }

  /** Recover claims interrupted by a restart, mirroring Codex lease expiry. */
  private recoverOrphans(): void {
    const horizon = this.now() - ORPHAN_RUNNING_MS
    for (const [id, claim] of Object.entries(this.state.processed)) {
      if (claim.status === 'running' && claim.at < horizon) {
        this.state.processed[id] = {
          status: 'failed',
          at: this.now(),
          attempts: claim.attempts,
          error: 'interrupted by restart',
        }
      }
    }
    if (this.unit !== undefined) this.queueSave()
  }

  private async openUnit(): Promise<KvUnitLike | undefined> {
    if (this.openPromise !== undefined) return this.openPromise
    this.openPromise = (async () => {
      const kv = this.getKv()
      if (kv === undefined) {
        this.storageAvailable = false
        this.storageError = 'storage json KV backend unavailable'
        return undefined
      }
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          this.storageAvailable = true
          this.storageError = ''
          return await kv.open(UNIT)
        } catch (error: unknown) {
          const text = messageOf(error)
          if (text.includes('already open') && attempt < 3) {
            await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)))
            continue
          }
          this.storageAvailable = false
          this.storageError = text
          return undefined
        }
      }
      return undefined
    })()
    return this.openPromise
  }

  private queueSave(): void {
    this.saveChain = this.saveChain.then(async () => {
      if (this.unit === undefined) return
      try {
        await this.unit.putRecord(UNIT.tables[0]!, KEY, this.snapshot())
      } catch (error: unknown) {
        this.storageError = messageOf(error)
      }
    }).catch(() => {})
  }

  snapshot(): MemoryState {
    return {
      ...this.state,
      processed: { ...this.state.processed },
      overrides: { ...this.state.overrides },
      usage: { ...(this.state.usage ?? {}) },
      retiredAt: { ...(this.state.retiredAt ?? {}) },
    }
  }

  processedOf(id: string): SessionClaim | undefined {
    return this.state.processed[id]
  }

  claimRunning(id: string): void {
    const previous = this.state.processed[id]
    this.state.processed[id] = {
      status: 'running',
      at: this.now(),
      attempts: (previous?.attempts ?? 0) + 1,
      ...(previous?.slug === undefined ? {} : { slug: previous.slug }),
      ...(previous?.lastSeq === undefined ? {} : { lastSeq: previous.lastSeq }),
      ...(previous?.parts === undefined ? {} : { parts: previous.parts }),
    }
    this.queueSave()
  }

  claimDone(id: string, slug?: string, lastSeq?: number, parts?: number): void {
    const previous = this.state.processed[id]
    this.state.processed[id] = {
      status: 'done',
      at: this.now(),
      attempts: previous?.attempts ?? 0,
      ...(slug === undefined ? {} : { slug }),
      ...(previous?.slug !== undefined && slug === undefined ? { slug: previous.slug } : {}),
      ...(lastSeq === undefined ? {} : { lastSeq }),
      ...(parts === undefined ? {} : { parts }),
    }
    this.queueSave()
  }

  /** Re-check touched a claim but nothing new was worth extracting. */
  claimUnchanged(id: string, lastSeq: number): void {
    const previous = this.state.processed[id]
    if (previous === undefined) return
    this.state.processed[id] = {
      status: previous.status === 'failed' ? 'failed' : previous.status === 'noop' ? 'noop' : 'done',
      at: this.now(),
      attempts: previous.attempts,
      ...(previous.slug === undefined ? {} : { slug: previous.slug }),
      ...(previous.parts === undefined ? {} : { parts: previous.parts }),
      lastSeq,
    }
    this.queueSave()
  }

  claimNoop(id: string): void {
    this.state.processed[id] = {
      status: 'noop',
      at: this.now(),
      attempts: this.state.processed[id]?.attempts ?? 0,
    }
    this.queueSave()
  }

  claimFailed(id: string, error: string): void {
    this.state.processed[id] = {
      status: 'failed',
      at: this.now(),
      attempts: this.state.processed[id]?.attempts ?? 0,
      error: error.slice(0, 500),
    }
    this.queueSave()
  }

  get pendingConsolidation(): boolean {
    return this.state.pendingConsolidation
  }

  setPendingConsolidation(value: boolean): void {
    if (this.state.pendingConsolidation === value) return
    this.state.pendingConsolidation = value
    this.queueSave()
  }

  get lastPhase2At(): number {
    return this.state.lastPhase2At
  }

  get phase2Error(): string | undefined {
    return this.state.phase2Error
  }

  recordPhase1(at: number): void {
    this.state.lastPhase1At = at
    this.queueSave()
  }

  recordPhase2(at: number, error?: string): void {
    this.state.lastPhase2At = at
    if (error === undefined) {
      delete this.state.phase2Error
      // A successful consolidation resets the consecutive-failure counter and
      // clears any pending retry window.
      this.state.phase2Failures = 0
      this.state.nextAutoRetryAt = 0
    } else {
      this.state.phase2Error = error.slice(0, 500)
    }
    this.queueSave()
  }

  /**
   * Record a failed consolidation: keeps `lastPhase2At` at the real attempt
   * time, schedules the automatic retry window (`at + retryAfterMs`), and
   * bumps the consecutive-failure counter so automatic retries pause at the
   * cap. Returns the new counter value.
   */
  recordPhase2Failure(at: number, error: string, retryAfterMs = PHASE2_RETRY_MS): number {
    this.state.lastPhase2At = at
    this.state.phase2Error = error.slice(0, 500)
    this.state.phase2Failures = (this.state.phase2Failures ?? 0) + 1
    this.state.nextAutoRetryAt = at + retryAfterMs
    this.queueSave()
    return this.state.phase2Failures
  }

  get phase2Failures(): number {
    return this.state.phase2Failures ?? 0
  }

  /** Earliest epoch ms an automatic Phase 2 retry may run (0 = no window pending). */
  get nextAutoRetryAt(): number {
    return this.state.nextAutoRetryAt ?? 0
  }

  /** Reset the consecutive-failure counter (new extraction input arrives). */
  resetPhase2Failures(): void {
    if ((this.state.phase2Failures ?? 0) === 0) return
    this.state.phase2Failures = 0
    this.queueSave()
  }

  /**
   * Record one read-path usage event for a memory file (Codex
   * `record_stage1_output_usage` parity, keyed by relative path instead of
   * thread id because forgetting executes on files).
   */
  recordUsage(path: string, at: number): void {
    const usage = this.state.usage ?? {}
    const previous = usage[path]
    usage[path] = { count: (previous?.count ?? 0) + 1, lastAt: at }
    this.state.usage = usage
    this.queueSave()
  }

  usageOf(path: string): { count: number; lastAt: number } | undefined {
    return this.state.usage?.[path]
  }

  usageSnapshot(): Record<string, { count: number; lastAt: number }> {
    return { ...this.state.usage }
  }

  get usageCount(): number {
    return Object.keys(this.state.usage ?? {}).length
  }

  /** Mark a rollout summary slug as retired (moved to `.retired/`). */
  recordRetired(slug: string, at: number): void {
    const retiredAt = this.state.retiredAt ?? {}
    retiredAt[slug] = at
    this.state.retiredAt = retiredAt
    this.queueSave()
  }

  retiredAtOf(slug: string): number | undefined {
    return this.state.retiredAt?.[slug]
  }

  setOverrides(overrides: Partial<Config>): void {
    this.state.overrides = { ...this.state.overrides, ...overrides }
    this.queueSave()
  }

  /** Re-queue every failed claim so the next pipeline run retries them. */
  resetFailedClaims(): number {
    let count = 0
    for (const [id, claim] of Object.entries(this.state.processed)) {
      if (claim.status === 'failed') {
        delete this.state.processed[id]
        count += 1
      }
    }
    if (count > 0) this.queueSave()
    return count
  }

  async flush(): Promise<void> {
    await this.saveChain
  }

  async dispose(): Promise<void> {
    await this.flush()
    const unit = this.unit
    this.unit = undefined
    if (unit !== undefined) {
      try {
        await unit.close()
      } catch {
        // The unit may already be closed by the storage backend.
      }
    }
  }
}

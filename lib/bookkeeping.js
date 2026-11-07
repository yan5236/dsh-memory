/** Durable bookkeeping through the storage hub KV backend: claims, cooldowns, pending flags. */
import { EXTRACTOR_VERSION } from './types.js';
import { messageOf } from './util.js';
const UNIT = { name: 'dsh_memory', version: 1, tables: ['state'], hasGlobal: false };
const KEY = 'main';
const ORPHAN_RUNNING_MS = 30 * 60_000;
/** Automatic retry window after a failed consolidation (before the full cooldown). */
export const PHASE2_RETRY_MS = 15 * 60_000;
function freshState() {
    return {
        v: 1,
        processed: {},
        lastPhase1At: 0,
        lastPhase2At: 0,
        pendingConsolidation: false,
        overrides: {},
        extractorVersion: EXTRACTOR_VERSION,
        usage: {},
        retiredAt: {},
        nextAutoRetryAt: 0,
    };
}
function isMemoryState(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const state = value;
    return state.v === 1
        && typeof state.processed === 'object' && state.processed !== null
        && typeof state.lastPhase1At === 'number'
        && typeof state.lastPhase2At === 'number'
        && typeof state.pendingConsolidation === 'boolean'
        && typeof state.overrides === 'object' && state.overrides !== null;
}
/**
 * Owns the plugin's durable state: per-session extraction claims, Phase 2
 * cooldown, the pending-consolidation flag, and settings-page overrides.
 * Writes are serialized through a promise chain; reads come from an in-memory
 * snapshot. When the KV backend is unavailable the store degrades to
 * process-local state (claims still prevent duplicate work within this run).
 */
export class MemoryStateStore {
    getKv;
    now;
    state = freshState();
    unit;
    openPromise;
    saveChain = Promise.resolve();
    storageAvailable = false;
    storageError = '';
    constructor(getKv, now = Date.now) {
        this.getKv = getKv;
        this.now = now;
    }
    async init() {
        this.unit = await this.openUnit();
        if (this.unit === undefined)
            return;
        try {
            const snapshot = await this.unit.loadAll();
            const record = snapshot.tables.state?.[KEY];
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
                    // `freshState()` would otherwise hide the legacy absence behind the
                    // current version; an archive without the field is version 0.
                    extractorVersion: record.extractorVersion ?? 0,
                };
                // Release historical failures left by a less tolerant parser first:
                // restart-orphan recovery below then handles this run's own leases.
                this.upgradeExtractorVersion();
                this.recoverOrphans();
            }
        }
        catch (error) {
            this.storageError = messageOf(error);
        }
    }
    /**
     * Re-queue every claim that failed under an older extractor version so the
     * improved parser gets another chance, then stamp the current version.
     * Returns the number of released claims (0 when already up to date).
     */
    upgradeExtractorVersion(version = EXTRACTOR_VERSION) {
        const stored = this.state.extractorVersion ?? 0;
        if (stored >= version)
            return 0;
        const released = this.resetFailedClaims();
        this.state.extractorVersion = version;
        if (this.unit !== undefined)
            this.queueSave();
        return released;
    }
    /** Extractor version the current claims were produced with. */
    get extractorVersion() {
        return this.state.extractorVersion ?? 0;
    }
    /** Recover claims interrupted by a restart, mirroring Codex lease expiry. */
    recoverOrphans() {
        const horizon = this.now() - ORPHAN_RUNNING_MS;
        for (const [id, claim] of Object.entries(this.state.processed)) {
            if (claim.status === 'running' && claim.at < horizon) {
                this.state.processed[id] = {
                    status: 'failed',
                    at: this.now(),
                    attempts: claim.attempts,
                    error: 'interrupted by restart',
                };
            }
        }
        if (this.unit !== undefined)
            this.queueSave();
    }
    async openUnit() {
        if (this.openPromise !== undefined)
            return this.openPromise;
        this.openPromise = (async () => {
            const kv = this.getKv();
            if (kv === undefined) {
                this.storageAvailable = false;
                this.storageError = 'storage json KV backend unavailable';
                return undefined;
            }
            for (let attempt = 0; attempt < 4; attempt += 1) {
                try {
                    this.storageAvailable = true;
                    this.storageError = '';
                    return await kv.open(UNIT);
                }
                catch (error) {
                    const text = messageOf(error);
                    if (text.includes('already open') && attempt < 3) {
                        await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
                        continue;
                    }
                    this.storageAvailable = false;
                    this.storageError = text;
                    return undefined;
                }
            }
            return undefined;
        })();
        return this.openPromise;
    }
    queueSave() {
        this.saveChain = this.saveChain.then(async () => {
            if (this.unit === undefined)
                return;
            try {
                await this.unit.putRecord(UNIT.tables[0], KEY, this.snapshot());
            }
            catch (error) {
                this.storageError = messageOf(error);
            }
        }).catch(() => { });
    }
    snapshot() {
        return {
            ...this.state,
            processed: { ...this.state.processed },
            overrides: { ...this.state.overrides },
            usage: { ...(this.state.usage ?? {}) },
            retiredAt: { ...(this.state.retiredAt ?? {}) },
        };
    }
    processedOf(id) {
        return this.state.processed[id];
    }
    claimRunning(id) {
        const previous = this.state.processed[id];
        this.state.processed[id] = {
            status: 'running',
            at: this.now(),
            attempts: (previous?.attempts ?? 0) + 1,
            ...(previous?.slug === undefined ? {} : { slug: previous.slug }),
            ...(previous?.lastSeq === undefined ? {} : { lastSeq: previous.lastSeq }),
            ...(previous?.parts === undefined ? {} : { parts: previous.parts }),
        };
        this.queueSave();
    }
    claimDone(id, slug, lastSeq, parts) {
        const previous = this.state.processed[id];
        this.state.processed[id] = {
            status: 'done',
            at: this.now(),
            attempts: previous?.attempts ?? 0,
            ...(slug === undefined ? {} : { slug }),
            ...(previous?.slug !== undefined && slug === undefined ? { slug: previous.slug } : {}),
            ...(lastSeq === undefined ? {} : { lastSeq }),
            ...(parts === undefined ? {} : { parts }),
        };
        this.queueSave();
    }
    /** Re-check touched a claim but nothing new was worth extracting. */
    claimUnchanged(id, lastSeq) {
        const previous = this.state.processed[id];
        if (previous === undefined)
            return;
        this.state.processed[id] = {
            status: previous.status === 'failed' ? 'failed' : previous.status === 'noop' ? 'noop' : 'done',
            at: this.now(),
            attempts: previous.attempts,
            ...(previous.slug === undefined ? {} : { slug: previous.slug }),
            ...(previous.parts === undefined ? {} : { parts: previous.parts }),
            lastSeq,
        };
        this.queueSave();
    }
    claimNoop(id) {
        this.state.processed[id] = {
            status: 'noop',
            at: this.now(),
            attempts: this.state.processed[id]?.attempts ?? 0,
        };
        this.queueSave();
    }
    claimFailed(id, error) {
        this.state.processed[id] = {
            status: 'failed',
            at: this.now(),
            attempts: this.state.processed[id]?.attempts ?? 0,
            error: error.slice(0, 500),
        };
        this.queueSave();
    }
    get pendingConsolidation() {
        return this.state.pendingConsolidation;
    }
    setPendingConsolidation(value) {
        if (this.state.pendingConsolidation === value)
            return;
        this.state.pendingConsolidation = value;
        this.queueSave();
    }
    get lastPhase2At() {
        return this.state.lastPhase2At;
    }
    get phase2Error() {
        return this.state.phase2Error;
    }
    recordPhase1(at) {
        this.state.lastPhase1At = at;
        this.queueSave();
    }
    recordPhase2(at, error) {
        this.state.lastPhase2At = at;
        if (error === undefined) {
            delete this.state.phase2Error;
            // A successful consolidation resets the consecutive-failure counter and
            // clears any pending retry window.
            this.state.phase2Failures = 0;
            this.state.nextAutoRetryAt = 0;
        }
        else {
            this.state.phase2Error = error.slice(0, 500);
        }
        this.queueSave();
    }
    /**
     * Record a failed consolidation: keeps `lastPhase2At` at the real attempt
     * time, schedules the automatic retry window (`at + retryAfterMs`), and
     * bumps the consecutive-failure counter so automatic retries pause at the
     * cap. Returns the new counter value.
     */
    recordPhase2Failure(at, error, retryAfterMs = PHASE2_RETRY_MS) {
        this.state.lastPhase2At = at;
        this.state.phase2Error = error.slice(0, 500);
        this.state.phase2Failures = (this.state.phase2Failures ?? 0) + 1;
        this.state.nextAutoRetryAt = at + retryAfterMs;
        this.queueSave();
        return this.state.phase2Failures;
    }
    get phase2Failures() {
        return this.state.phase2Failures ?? 0;
    }
    /** Earliest epoch ms an automatic Phase 2 retry may run (0 = no window pending). */
    get nextAutoRetryAt() {
        return this.state.nextAutoRetryAt ?? 0;
    }
    /** Reset the consecutive-failure counter (new extraction input arrives). */
    resetPhase2Failures() {
        if ((this.state.phase2Failures ?? 0) === 0)
            return;
        this.state.phase2Failures = 0;
        this.queueSave();
    }
    /**
     * Record one read-path usage event for a memory file (Codex
     * `record_stage1_output_usage` parity, keyed by relative path instead of
     * thread id because forgetting executes on files).
     */
    recordUsage(path, at) {
        const usage = this.state.usage ?? {};
        const previous = usage[path];
        usage[path] = { count: (previous?.count ?? 0) + 1, lastAt: at };
        this.state.usage = usage;
        this.queueSave();
    }
    usageOf(path) {
        return this.state.usage?.[path];
    }
    usageSnapshot() {
        return { ...this.state.usage };
    }
    get usageCount() {
        return Object.keys(this.state.usage ?? {}).length;
    }
    /** Mark a rollout summary slug as retired (moved to `.retired/`). */
    recordRetired(slug, at) {
        const retiredAt = this.state.retiredAt ?? {};
        retiredAt[slug] = at;
        this.state.retiredAt = retiredAt;
        this.queueSave();
    }
    retiredAtOf(slug) {
        return this.state.retiredAt?.[slug];
    }
    setOverrides(overrides) {
        this.state.overrides = { ...this.state.overrides, ...overrides };
        this.queueSave();
    }
    /** Re-queue every failed claim so the next pipeline run retries them. */
    resetFailedClaims() {
        let count = 0;
        for (const [id, claim] of Object.entries(this.state.processed)) {
            if (claim.status === 'failed') {
                delete this.state.processed[id];
                count += 1;
            }
        }
        if (count > 0)
            this.queueSave();
        return count;
    }
    async flush() {
        await this.saveChain;
    }
    async dispose() {
        await this.flush();
        const unit = this.unit;
        this.unit = undefined;
        if (unit !== undefined) {
            try {
                await unit.close();
            }
            catch {
                // The unit may already be closed by the storage backend.
            }
        }
    }
}
//# sourceMappingURL=bookkeeping.js.map
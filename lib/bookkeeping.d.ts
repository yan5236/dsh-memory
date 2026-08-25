/** Durable bookkeeping through the storage hub KV backend: claims, cooldowns, pending flags. */
import type { Config } from './config.js';
import type { MemoryState, SessionClaim } from './types.js';
/** Structural slice of the storage hub KV unit the plugin needs. */
export interface KvUnitLike {
    loadAll(): Promise<{
        tables: Record<string, Record<string, unknown>>;
        global: unknown;
    }>;
    putRecord(table: string, key: string, value: unknown): Promise<void>;
    close(): Promise<void>;
}
export interface KvFacilityLike {
    open(descriptor: {
        name: string;
        version: number;
        tables: readonly string[];
        hasGlobal: boolean;
    }): Promise<KvUnitLike>;
}
/**
 * Owns the plugin's durable state: per-session extraction claims, Phase 2
 * cooldown, the pending-consolidation flag, and settings-page overrides.
 * Writes are serialized through a promise chain; reads come from an in-memory
 * snapshot. When the KV backend is unavailable the store degrades to
 * process-local state (claims still prevent duplicate work within this run).
 */
export declare class MemoryStateStore {
    private readonly getKv;
    private readonly now;
    private state;
    private unit;
    private openPromise;
    private saveChain;
    storageAvailable: boolean;
    storageError: string;
    constructor(getKv: () => KvFacilityLike | undefined, now?: () => number);
    init(): Promise<void>;
    /** Recover claims interrupted by a restart, mirroring Codex lease expiry. */
    private recoverOrphans;
    private openUnit;
    private queueSave;
    snapshot(): MemoryState;
    processedOf(id: string): SessionClaim | undefined;
    claimRunning(id: string): void;
    claimDone(id: string, slug?: string, lastSeq?: number, parts?: number): void;
    /** Re-check touched a claim but nothing new was worth extracting. */
    claimUnchanged(id: string, lastSeq: number): void;
    claimNoop(id: string): void;
    claimFailed(id: string, error: string): void;
    get pendingConsolidation(): boolean;
    setPendingConsolidation(value: boolean): void;
    get lastPhase2At(): number;
    get phase2Error(): string | undefined;
    recordPhase1(at: number): void;
    recordPhase2(at: number, error?: string): void;
    /**
     * Record a failed consolidation: schedules the retry window and bumps the
     * consecutive-failure counter so automatic retries pause at the cap.
     * Returns the new counter value.
     */
    recordPhase2Failure(at: number, error: string): number;
    get phase2Failures(): number;
    /** Reset the consecutive-failure counter (new extraction input arrives). */
    resetPhase2Failures(): void;
    /**
     * Record one read-path usage event for a memory file (Codex
     * `record_stage1_output_usage` parity, keyed by relative path instead of
     * thread id because forgetting executes on files).
     */
    recordUsage(path: string, at: number): void;
    usageOf(path: string): {
        count: number;
        lastAt: number;
    } | undefined;
    usageSnapshot(): Record<string, {
        count: number;
        lastAt: number;
    }>;
    get usageCount(): number;
    /** Mark a rollout summary slug as retired (moved to `.retired/`). */
    recordRetired(slug: string, at: number): void;
    retiredAtOf(slug: string): number | undefined;
    setOverrides(overrides: Partial<Config>): void;
    /** Re-queue every failed claim so the next pipeline run retries them. */
    resetFailedClaims(): number;
    flush(): Promise<void>;
    dispose(): Promise<void>;
}
//# sourceMappingURL=bookkeeping.d.ts.map
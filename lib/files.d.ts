/** Memory folder layout and file operations (Codex artifact parity, DSH-root adapted). */
import { sep } from 'node:path';
import type { FileEntry, RunLogEntry, RunLogSummary } from './types.js';
/** Upper bound on retained run-log files; oldest are pruned beyond this. */
export declare const MAX_RUN_LOGS = 50;
/**
 * Owns the memory directory:
 *
 * - memory_summary.md    dense, always-injected navigation layer
 * - MEMORY.md            grep-friendly handbook of consolidated memory
 * - raw_memories.md      Phase 1 output awaiting Phase 2 consolidation
 * - raw_memories.archive.md  rotated history of consolidated raw blocks
 * - rollout_summaries/   per-session recaps (evidence layer)
 * - skills/              reusable procedures promoted by consolidation
 * - extensions/ad_hoc/notes/  user-requested ad hoc notes
 */
export declare class MemoryFiles {
    readonly root: string;
    constructor(root: string);
    ensureLayout(): Promise<void>;
    /** Resolve a memory-relative path; rejects anything escaping the root. */
    rel(relPath: string): string;
    readIfExists(relPath: string, cap?: number): Promise<string | undefined>;
    writeAtomic(relPath: string, content: string): Promise<void>;
    appendText(relPath: string, content: string): Promise<void>;
    /** Move raw_memories.md into the archive and reset it for the next batch. */
    rotateRaw(): Promise<void>;
    /** Pick a unique rollout summary filename inside rollout_summaries/. */
    uniqueRolloutSlug(slug: string, sessionId: string): Promise<string>;
    listTree(subPath?: string): Promise<FileEntry[]>;
    rolloutIndex(limit?: number): Promise<string[]>;
    /** Unconsumed ad hoc notes awaiting the next consolidation. */
    pendingNotes(): Promise<Array<{
        path: string;
        content: string;
    }>>;
    /** Whether any unconsumed ad hoc note is waiting. */
    hasPendingNotes(): Promise<boolean>;
    /** Move a consumed note into the ad hoc archive (successful consolidation only). */
    archiveNote(path: string): Promise<void>;
    /** Persist one pipeline run under `logs/`; prunes oldest logs beyond MAX_RUN_LOGS. */
    writeRunLog(stage: 'phase1' | 'phase2', entry: Omit<RunLogEntry, 'at' | 'stage'>, at?: number): Promise<string>;
    /** Keep at most MAX_RUN_LOGS log files, deleting the oldest by timestamp name. */
    pruneRunLogs(): Promise<void>;
    /** Summaries of the most recent run logs, newest first. */
    listRunLogs(limit?: number): Promise<RunLogSummary[]>;
    /**
     * Move a rollout summary into `rollout_summaries/.retired/` (recoverable,
     * never deleted). Returns the new relative path, or undefined when the
     * source file does not exist.
     */
    retireRolloutSummary(slug: string, at?: number): Promise<string | undefined>;
    /** Whether a path inside the rollout summaries tree refers to the retired area. */
    static isRetiredPath(path: string): boolean;
    /** Validate a skill directory name (lowercase alphanumerics and hyphens). */
    static assertSkillName(name: string): void;
    /**
     * Write a skill entrypoint `skills/<name>/SKILL.md`. Model-supplied names
     * are validated before any filesystem call.
     */
    writeSkill(name: string, skillMd: string): Promise<void>;
    /**
     * Write an auxiliary skill file under `skills/<name>/`. Only scripts/,
     * templates/, and examples/ subdirectories are allowed; traversal and
     * absolute paths are rejected.
     */
    writeSkillFile(name: string, relPath: string, content: string): Promise<void>;
    /** Remove a whole skill directory after name validation. */
    removeSkill(name: string): Promise<void>;
    /** Inventory of existing skills: relative path and first meaningful line. */
    skillsIndex(limit?: number): Promise<string[]>;
    stats(): Promise<{
        summaryChars: number;
        memoryChars: number;
        rawChars: number;
        archiveChars: number;
        rollouts: number;
        skills: number;
        notes: number;
        retired: number;
        logCount: number;
    }>;
    /** Join a sub-path with a platform-agnostic separator for display. */
    static joinDisplay(...parts: string[]): string;
}
/** Whether a filename belongs to the memory summary artifacts. */
export declare function isMemoryFilename(name: string): boolean;
/** Validate that a candidate summary begins with the exact `v1` first line. */
export declare function ensureSummaryV1(content: string): string;
/** Convenience re-export so tests can reach the separator without a platform guess. */
export { sep as memoryPathSep };
//# sourceMappingURL=files.d.ts.map
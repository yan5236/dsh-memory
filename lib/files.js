/** Memory folder layout and file operations (Codex artifact parity, DSH-root adapted). */
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { isWithin } from './paths.js';
const DIRS = ['rollout_summaries', 'rollout_summaries/.retired', 'skills', 'extensions/ad_hoc/notes', 'logs'];
/** Upper bound on retained run-log files; oldest are pruned beyond this. */
export const MAX_RUN_LOGS = 50;
/** Hard cap on one log file read for listing (defensive; outputs are smaller). */
const RUN_LOG_LIST_CAP = 400_000;
/** Slug shape accepted by retire/unretire operations (matches sanitizeSlug output). */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;
/** Allowed auxiliary subdirectories inside a skill folder. */
const SKILL_SUBDIRS = ['scripts', 'templates', 'examples'];
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
export class MemoryFiles {
    root;
    constructor(root) {
        this.root = root;
    }
    async ensureLayout() {
        await mkdir(this.root, { recursive: true });
        for (const dir of DIRS)
            await mkdir(join(this.root, dir), { recursive: true });
    }
    /** Resolve a memory-relative path; rejects anything escaping the root. */
    rel(relPath) {
        if (relPath === '' || relPath.startsWith('/') || relPath.startsWith('\\') || /^[A-Za-z]:/.test(relPath)) {
            throw new Error(`memory path must be relative: ${relPath}`);
        }
        const resolved = resolve(this.root, relPath);
        if (!isWithin(this.root, resolved)) {
            throw new Error(`memory path escapes the memory root: ${relPath}`);
        }
        return resolved;
    }
    async readIfExists(relPath, cap = 2_000_000) {
        try {
            const text = await readFile(this.rel(relPath), 'utf8');
            return text.length > cap ? text.slice(0, cap) : text;
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return undefined;
            throw error;
        }
    }
    async writeAtomic(relPath, content) {
        const target = this.rel(relPath);
        await mkdir(dirname(target), { recursive: true });
        const temp = `${target}.${randomUUID()}.tmp`;
        await writeFile(temp, content, 'utf8');
        try {
            await rename(temp, target);
        }
        catch (error) {
            await writeFile(temp, '', 'utf8').catch(() => { });
            throw error;
        }
    }
    async appendText(relPath, content) {
        const target = this.rel(relPath);
        await mkdir(dirname(target), { recursive: true });
        await appendFile(target, content, 'utf8');
    }
    /** Move raw_memories.md into the archive and reset it for the next batch. */
    async rotateRaw() {
        const raw = await this.readIfExists('raw_memories.md');
        if (raw === undefined || raw.trim() === '')
            return;
        const stamp = new Date().toISOString();
        await this.appendText('raw_memories.archive.md', `\n<!-- archived at ${stamp} -->\n${raw.trimEnd()}\n`);
        await this.writeAtomic('raw_memories.md', `<!-- archived at ${stamp}; full history in raw_memories.archive.md -->\n`);
    }
    /** Pick a unique rollout summary filename inside rollout_summaries/. */
    async uniqueRolloutSlug(slug, sessionId) {
        const base = slug.slice(0, 80);
        const existing = await this.readIfExists(`rollout_summaries/${base}.md`, 1);
        if (existing === undefined)
            return base;
        return `${base.slice(0, 72)}-${sessionId.slice(-8)}`;
    }
    async listTree(subPath = '') {
        const entries = [];
        const base = subPath === '' ? this.root : this.rel(subPath);
        const walk = async (dir, relDir, depth) => {
            if (depth > 4 || entries.length >= 600)
                return;
            let names;
            try {
                names = await readdir(dir, { withFileTypes: true });
            }
            catch {
                return;
            }
            for (const item of names) {
                if (item.name.endsWith('.tmp'))
                    continue;
                const abs = join(dir, item.name);
                const rel = relDir === '' ? item.name : `${relDir}/${item.name}`;
                if (item.isDirectory()) {
                    entries.push({ path: rel, kind: 'dir', size: 0, modifiedAt: 0 });
                    await walk(abs, rel, depth + 1);
                }
                else {
                    const info = await stat(abs).catch(() => undefined);
                    entries.push({
                        path: rel,
                        kind: 'file',
                        size: info?.size ?? 0,
                        modifiedAt: info?.mtimeMs ?? 0,
                    });
                }
            }
        };
        await walk(base, '', 0);
        return entries.sort((a, b) => (a.kind === b.kind ? a.path.localeCompare(b.path) : a.kind === 'dir' ? -1 : 1));
    }
    async rolloutIndex(limit = 120) {
        const entries = await this.listTree('rollout_summaries');
        const lines = [];
        for (const entry of entries) {
            if (entry.kind !== 'file' || !entry.path.endsWith('.md'))
                continue;
            if (MemoryFiles.isRetiredPath(entry.path))
                continue;
            const content = await this.readIfExists(`rollout_summaries/${entry.path.split('/').pop() ?? ''}`, 4_000);
            const firstLine = content?.split(/\r?\n/).map(line => line.trim()).find(line => line !== '' && !line.startsWith('<!--'));
            lines.push(`- ${entry.path}${firstLine === undefined ? '' : ` — ${firstLine.slice(0, 120)}`}`);
            if (lines.length >= limit)
                break;
        }
        return lines;
    }
    /** Unconsumed ad hoc notes awaiting the next consolidation. */
    async pendingNotes() {
        const entries = await this.listTree('extensions/ad_hoc/notes');
        const notes = [];
        for (const entry of entries) {
            if (entry.kind !== 'file' || !entry.path.endsWith('.md'))
                continue;
            const rel = `extensions/ad_hoc/notes/${entry.path.split('/').pop() ?? ''}`;
            const content = await this.readIfExists(rel, 60_000);
            if (content !== undefined && content.trim() !== '')
                notes.push({ path: rel, content: content.trim() });
        }
        return notes;
    }
    /** Whether any unconsumed ad hoc note is waiting. */
    async hasPendingNotes() {
        const entries = await this.listTree('extensions/ad_hoc/notes');
        return entries.some(entry => entry.kind === 'file' && entry.path.endsWith('.md'));
    }
    /** Move a consumed note into the ad hoc archive (successful consolidation only). */
    async archiveNote(path) {
        const source = this.rel(path);
        const base = path.split('/').pop() ?? path;
        const target = this.rel(`extensions/ad_hoc/archive/${base}`);
        await mkdir(dirname(target), { recursive: true });
        await rename(source, target);
    }
    /** Persist one pipeline run under `logs/`; prunes oldest logs beyond MAX_RUN_LOGS. */
    async writeRunLog(stage, entry, at = Date.now()) {
        const stamp = new Date(at).toISOString().replace(/[:.]/g, '-');
        const log = { at, stage, ...entry };
        const name = `${stamp}-${stage}.json`;
        await this.writeAtomic(`logs/${name}`, `${JSON.stringify(log, null, 2)}\n`);
        await this.pruneRunLogs();
        return name;
    }
    /** Keep at most MAX_RUN_LOGS log files, deleting the oldest by timestamp name. */
    async pruneRunLogs() {
        const entries = await this.listTree('logs');
        const files = entries
            .filter(entry => entry.kind === 'file' && entry.path.endsWith('.json'))
            .sort((a, b) => a.path.localeCompare(b.path));
        const excess = files.length - MAX_RUN_LOGS;
        for (const entry of files.slice(0, Math.max(0, excess))) {
            await unlink(this.rel(`logs/${entry.path}`)).catch(() => { });
        }
    }
    /** Summaries of the most recent run logs, newest first. */
    async listRunLogs(limit = 20) {
        const entries = await this.listTree('logs');
        const files = entries
            .filter(entry => entry.kind === 'file' && entry.path.endsWith('.json'))
            .sort((a, b) => b.path.localeCompare(a.path));
        const summaries = [];
        for (const file of files) {
            if (summaries.length >= limit)
                break;
            const text = await this.readIfExists(`logs/${file.path}`, RUN_LOG_LIST_CAP);
            if (text === undefined)
                continue;
            try {
                const parsed = JSON.parse(text);
                if (typeof parsed.at !== 'number' || (parsed.stage !== 'phase1' && parsed.stage !== 'phase2'))
                    continue;
                summaries.push({
                    name: file.path.split('/').pop() ?? file.path,
                    at: parsed.at,
                    stage: parsed.stage,
                    ...(typeof parsed.route === 'string' ? { route: parsed.route } : {}),
                    outcome: typeof parsed.outcome === 'string' ? parsed.outcome : 'unknown',
                    size: file.size,
                });
            }
            catch {
                // Corrupt/partial log files are skipped for listing; the file itself stays.
            }
        }
        return summaries;
    }
    /**
     * Move a rollout summary into `rollout_summaries/.retired/` (recoverable,
     * never deleted). Returns the new relative path, or undefined when the
     * source file does not exist.
     */
    async retireRolloutSummary(slug, at = Date.now()) {
        if (!SLUG_PATTERN.test(slug))
            throw new Error(`invalid rollout summary slug: ${slug}`);
        let target = `rollout_summaries/.retired/${slug}.md`;
        const existing = await this.readIfExists(target, 1);
        if (existing !== undefined) {
            target = `rollout_summaries/.retired/${slug}-${at}.md`;
        }
        const source = this.rel(`rollout_summaries/${slug}.md`);
        const destination = this.rel(target);
        await mkdir(dirname(destination), { recursive: true });
        try {
            await rename(source, destination);
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return undefined;
            throw error;
        }
        return target;
    }
    /** Whether a path inside the rollout summaries tree refers to the retired area. */
    static isRetiredPath(path) {
        return path.startsWith('.retired/') || path === '.retired';
    }
    /** Validate a skill directory name (lowercase alphanumerics and hyphens). */
    static assertSkillName(name) {
        if (!SLUG_PATTERN.test(name)) {
            throw new Error(`invalid skill name: ${name}（仅允许小写字母、数字与连字符）`);
        }
    }
    /**
     * Write a skill entrypoint `skills/<name>/SKILL.md`. Model-supplied names
     * are validated before any filesystem call.
     */
    async writeSkill(name, skillMd) {
        MemoryFiles.assertSkillName(name);
        await this.writeAtomic(`skills/${name}/SKILL.md`, skillMd);
    }
    /**
     * Write an auxiliary skill file under `skills/<name>/`. Only scripts/,
     * templates/, and examples/ subdirectories are allowed; traversal and
     * absolute paths are rejected.
     */
    async writeSkillFile(name, relPath, content) {
        MemoryFiles.assertSkillName(name);
        const parts = relPath.split('/');
        if (parts.length < 2 || !SKILL_SUBDIRS.includes(parts[0] ?? '')) {
            throw new Error(`skill file must live under scripts/ templates/ or examples/: ${relPath}`);
        }
        if (parts.some(part => part === '' || part === '..' || part.includes('\\') || /^[A-Za-z]:/.test(part))) {
            throw new Error(`invalid skill file path: ${relPath}`);
        }
        await this.writeAtomic(`skills/${name}/${relPath}`, content);
    }
    /** Remove a whole skill directory after name validation. */
    async removeSkill(name) {
        MemoryFiles.assertSkillName(name);
        const target = this.rel(`skills/${name}`);
        await rm(target, { recursive: true, force: true }).catch((error) => {
            if (error.code !== 'ENOENT')
                throw error;
        });
    }
    /** Inventory of existing skills: relative path and first meaningful line. */
    async skillsIndex(limit = 40) {
        const entries = await this.listTree('skills');
        const lines = [];
        for (const entry of entries) {
            if (entry.kind !== 'file' || !entry.path.endsWith('.md'))
                continue;
            const content = await this.readIfExists(`skills/${entry.path}`, 2_000);
            const firstLine = content?.split(/\r?\n/).map(line => line.trim()).find(line => line !== '' && !line.startsWith('---') && !line.startsWith('<!--'));
            lines.push(`- ${entry.path}${firstLine === undefined ? '' : ` — ${firstLine.slice(0, 100)}`}`);
            if (lines.length >= limit)
                break;
        }
        return lines;
    }
    async stats() {
        const [summary, memory, raw, archive] = await Promise.all([
            this.readIfExists('memory_summary.md', 10_000_000),
            this.readIfExists('MEMORY.md', 10_000_000),
            this.readIfExists('raw_memories.md', 10_000_000),
            this.readIfExists('raw_memories.archive.md', 10_000_000),
        ]);
        const [rollouts, skills, notes, retired, logs] = await Promise.all([
            this.listTree('rollout_summaries'),
            this.listTree('skills'),
            this.listTree('extensions/ad_hoc/notes'),
            this.listTree('rollout_summaries/.retired'),
            this.listTree('logs'),
        ]);
        const fileCount = (entries, excludeRetired = false) => entries.filter(entry => entry.kind === 'file'
            && (!excludeRetired || !MemoryFiles.isRetiredPath(entry.path))).length;
        return {
            summaryChars: summary?.length ?? 0,
            memoryChars: memory?.length ?? 0,
            rawChars: raw?.length ?? 0,
            archiveChars: archive?.length ?? 0,
            rollouts: fileCount(rollouts, true),
            skills: fileCount(skills),
            notes: fileCount(notes),
            retired: fileCount(retired),
            logCount: fileCount(logs),
        };
    }
    /** Join a sub-path with a platform-agnostic separator for display. */
    static joinDisplay(...parts) {
        return parts.filter(part => part !== '').join('/');
    }
}
/** Whether a filename belongs to the memory summary artifacts. */
export function isMemoryFilename(name) {
    return name === 'memory_summary.md' || name === 'MEMORY.md';
}
/** Validate that a candidate summary begins with the exact `v1` first line. */
export function ensureSummaryV1(content) {
    const firstLine = content.trimStart().split(/\r?\n/, 1)[0] ?? '';
    if (firstLine === 'v1')
        return content;
    return `v1\n${content.trimStart()}`;
}
/** Convenience re-export so tests can reach the separator without a platform guess. */
export { sep as memoryPathSep };
//# sourceMappingURL=files.js.map
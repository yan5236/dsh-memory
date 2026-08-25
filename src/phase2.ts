/** Phase 2: global consolidation into MEMORY.md and memory_summary.md, plus skill promotion and forgetting. */

import type { MemoryStateStore } from './bookkeeping.js'
import type { Config } from './config.js'
import type { MemoryFiles } from './files.js'
import { ensureSummaryV1 } from './files.js'
import type { LlmDirectoryRuntime, ModelRoute } from './llm.js'
import { collectResponse, effortLabel, extractJsonObject, generateOptions, parseCallArguments, parseFencedBlocks, pickBlock, resolveReasoningEffort } from './llm.js'
import { PHASE2_SYSTEM, PHASE2_TOOL, phase2User } from './prompts.js'
import { redactSecrets } from './rollout.js'
import { messageOf } from './util.js'

export type Phase2Outcome =
  | { kind: 'consolidated'; mode: 'init' | 'incremental' }
  | { kind: 'skipped'; reason: 'cooldown' | 'no-input' | 'no-route' | 'retry-paused' }
  | { kind: 'error'; error: string }

/** Automatic retries pause after this many consecutive failures (manual runs bypass). */
export const MAX_AUTO_PHASE2_RETRIES = 3

export interface Phase2Deps {
  llm: LlmDirectoryRuntime
  state: MemoryStateStore
  files: MemoryFiles
  config: () => Config
  route: () => ModelRoute | undefined
  /** Injectable clock for tests. */
  now?: () => number
}

/** Model-supplied skill write request (validated before hitting the filesystem). */
interface SkillRequest {
  name: string
  skill_md: string
  files?: Array<{ path: string; content: string }>
}

function describeOutcome(outcome: Phase2Outcome): string {
  if (outcome.kind === 'consolidated') return `consolidated (${outcome.mode})`
  if (outcome.kind === 'skipped') return `skipped:${outcome.reason}`
  return `error`
}
export class Phase2Runner {
  private running: Promise<Phase2Outcome> | undefined

  constructor(private readonly deps: Phase2Deps) {}

  /** Whether a consolidation is currently in flight (single-flight promise alive). */
  get isRunning(): boolean {
    return this.running !== undefined
  }

  /** Single-flight entry point; `force` bypasses the cooldown for manual runs. */
  run(force = false): Promise<Phase2Outcome> {
    if (this.running !== undefined) return this.running
    const promise = this.execute(force).finally(() => {
      this.running = undefined
    })
    this.running = promise
    return promise
  }

  private async execute(force: boolean): Promise<Phase2Outcome> {
    const { state, files, config, llm, route } = this.deps
    const cfg = config()
    const clock = this.deps.now ?? Date.now
    const now = clock()
    const writeLog = async (outcome: Phase2Outcome, detail: Record<string, unknown> = {}, meta: { effort?: string } = {}): Promise<void> => {
      try {
        await files.writeRunLog('phase2', {
          ...(this.deps.route() === undefined ? {} : { route: `${this.deps.route()!.provider}/${this.deps.route()!.model}` }),
          ...(meta.effort === undefined ? {} : { effort: meta.effort }),
          outcome: describeOutcome(outcome),
          detail,
        }, now)
      } catch {
        // A log-write failure must never fail the run.
      }
    }
    if (!force) {
      // Consecutive failures pause automatic retries (pending flag is kept;
      // manual runs bypass the cap) so a misbehaving model route cannot burn
      // tokens on an endless retry loop.
      if (state.phase2Failures >= MAX_AUTO_PHASE2_RETRIES) {
        const outcome = { kind: 'skipped', reason: 'retry-paused' } as const
        await writeLog(outcome, { consecutiveFailures: state.phase2Failures })
        return outcome
      }
      // A failed run schedules a retry window (~15 min); inside it the
      // cooldown still applies, past it the run is allowed again.
      const autoRetryDue = state.nextAutoRetryAt > 0 && now >= state.nextAutoRetryAt
      if (now - state.lastPhase2At < cfg.consolidationCooldownMs && !autoRetryDue) {
        const outcome = { kind: 'skipped', reason: 'cooldown' } as const
        await writeLog(outcome)
        return outcome
      }
      // Ad hoc notes alone must also be able to wake consolidation, even when
      // an earlier run cleared the pending flag before the notes were merged.
      if (!state.pendingConsolidation && !(await files.hasPendingNotes())) {
        const outcome = { kind: 'skipped', reason: 'no-input' } as const
        await writeLog(outcome)
        return outcome
      }
    }
    const modelRoute = route()
    if (modelRoute === undefined) {
      const outcome = { kind: 'skipped', reason: 'no-route' } as const
      await writeLog(outcome)
      return outcome
    }
    const effort = await resolveReasoningEffort(llm, modelRoute, cfg.phase2ReasoningEffort)
    await files.ensureLayout()
    const raw = ((await files.readIfExists('raw_memories.md')) ?? '').trim()
    const noteEntries = await files.pendingNotes()
    const notes = noteEntries.map(entry => entry.content)
    if (!force && raw === '' && notes.length === 0) {
      state.setPendingConsolidation(false)
      const outcome = { kind: 'skipped', reason: 'no-input' } as const
      await writeLog(outcome)
      return outcome
    }
    const memory = (await files.readIfExists('MEMORY.md')) ?? ''
    const summary = (await files.readIfExists('memory_summary.md')) ?? ''
    const mode: 'init' | 'incremental' = memory.trim() === '' && summary.trim() === '' ? 'init' : 'incremental'
    const rolloutIndex = await files.rolloutIndex(120)
    // Active rollout files (excluding retired) with usage for the forgetting section.
    const rolloutTree = await files.listTree('rollout_summaries')
    const rolloutFiles = rolloutTree
      .filter(entry => entry.kind === 'file' && entry.path.endsWith('.md') && !entry.path.startsWith('.retired'))
      .map(entry => ({
        path: `rollout_summaries/${entry.path}`,
        name: entry.path.slice(0, -'.md'.length),
        modifiedAt: entry.modifiedAt,
      }))
    const usage = state.usageSnapshot()
    const retired = { ...(state.snapshot().retiredAt ?? {}) }
    const skillsIndex = await files.skillsIndex(40)
    const userText = phase2User({
      mode,
      memory,
      summary,
      raw: raw.slice(-cfg.maxRawChars),
      notes,
      rolloutIndex,
      usage,
      retired,
      maxUnusedDays: cfg.maxUnusedDays,
      skillsIndex,
      rolloutFiles,
      now,
    })
    // Hoisted so the error path can record exactly what the model produced.
    let response: Awaited<ReturnType<typeof collectResponse>> | undefined
    try {
      response = await collectResponse(
        llm,
        generateOptions(modelRoute, PHASE2_SYSTEM, userText, cfg.phase2MaxTokens, undefined, [PHASE2_TOOL], effort),
        800_000,
      )
      // Structured tool call first; fenced text blocks remain a fallback for
      // models that ignore the tool schema.
      let nextMemory: string | undefined
      let nextSummary: string | undefined
      let skillRequests: SkillRequest[] = []
      let removeSkills: string[] = []
      let retireSlugs: string[] = []
      const toolCall = response.calls.find(call => call.name === 'memory_write')
      if (toolCall !== undefined) {
        const args = parseCallArguments(toolCall)
        if (typeof args.memory_md === 'string' && args.memory_md.trim() !== '') nextMemory = args.memory_md
        if (typeof args.memory_summary_md === 'string' && args.memory_summary_md.trim() !== '') nextSummary = args.memory_summary_md
        if (Array.isArray(args.skills)) {
          skillRequests = args.skills.filter((item): item is SkillRequest =>
            typeof item === 'object' && item !== null
            && typeof item.name === 'string'
            && typeof item.skill_md === 'string')
        }
        if (Array.isArray(args.remove_skills)) {
          removeSkills = args.remove_skills.filter((item): item is string => typeof item === 'string')
        }
        if (Array.isArray(args.retire_summaries)) {
          retireSlugs = args.retire_summaries.filter((item): item is string => typeof item === 'string')
        }
      }
      if (nextMemory === undefined || nextSummary === undefined) {
        const blocks = parseFencedBlocks(response.text)
        nextMemory = pickBlock(blocks, ['memory.md', 'mem.md'])
        nextSummary = pickBlock(blocks, ['memory_summary.md', 'memory-summary.md', 'summary.md'])
      }
      if (nextMemory === undefined || nextSummary === undefined) {
        // Lenient fallback: unlabeled/oddly-labeled fenced blocks map to the
        // two artifacts in order (first → MEMORY.md, second → summary).
        // The handbook block is expected to be substantial; the summary block
        // may be short (a dense v1 navigation layer).
        const values = [...parseFencedBlocks(response.text).values()].filter(block => block.length >= 10)
        if (values.length >= 2 && values[0]!.length >= 50) {
          nextMemory = values[0]
          nextSummary = values[1]
        }
      }
      if (nextMemory === undefined || nextSummary === undefined) {
        // JSON fallback for models that answer in structured text instead of tools.
        try {
          const json = extractJsonObject(response.text)
          if (typeof json.memory_md === 'string' && typeof json.memory_summary_md === 'string') {
            nextMemory = json.memory_md
            nextSummary = json.memory_summary_md
          }
        } catch {
          // Not JSON; fall through to the friendly error below.
        }
      }
      if (nextMemory === undefined || nextSummary === undefined) {
        throw new Error('整合输出缺少 memory_write 工具调用或带标签的代码块（```MEMORY.md 与 ```memory_summary.md）')
      }

      // Redact model output before anything touches disk (DESIGN invariant:
      // redaction applies to model output on both phases).
      const safeMemory = redactSecrets(nextMemory)
      const safeSummary = redactSecrets(nextSummary)

      const skillErrors: string[] = []
      const writtenSkills: Array<{ name: string; files: string[] }> = []
      const removedSkills: string[] = []
      for (const request of skillRequests) {
        try {
          const name = request.name.trim().slice(0, 64)
          const skillMd = redactSecrets(request.skill_md)
          await files.writeSkill(name, skillMd)
          for (const file of request.files ?? []) {
            if (typeof file.path !== 'string' || typeof file.content !== 'string') continue
            await files.writeSkillFile(name, file.path, redactSecrets(file.content))
          }
          writtenSkills.push({ name, files: (request.files ?? []).map(file => file.path) })
        } catch (error: unknown) {
          skillErrors.push(`技能 ${request.name}: ${messageOf(error)}`)
        }
      }
      for (const name of removeSkills) {
        try {
          await files.removeSkill(name.slice(0, 64))
          removedSkills.push(name)
        } catch (error: unknown) {
          skillErrors.push(`删除技能 ${name}: ${messageOf(error)}`)
        }
      }
      const retiredMoved: string[] = []
      for (const slug of retireSlugs) {
        try {
          const moved = await files.retireRolloutSummary(slug.slice(0, 80), now)
          if (moved !== undefined) {
            retiredMoved.push(slug)
            state.recordRetired(slug, now)
          }
        } catch (error: unknown) {
          skillErrors.push(`退役回顾 ${slug}: ${messageOf(error)}`)
        }
      }

      await files.writeAtomic('MEMORY.md', safeMemory.trimEnd() + '\n')
      await files.writeAtomic('memory_summary.md', ensureSummaryV1(safeSummary).trimEnd() + '\n')
      await files.rotateRaw()
      for (const entry of noteEntries) {
        await files.archiveNote(entry.path).catch(() => {})
      }
      state.recordPhase2(now)
      state.setPendingConsolidation(false)
      const outcome = { kind: 'consolidated', mode } as const
      await writeLog(outcome, {
        mode,
        inputChars: {
          raw: raw.length,
          memory: memory.length,
          summary: summary.length,
          notes: notes.join('').length,
          rollouts: rolloutFiles.length,
        },
        outputs: {
          memory_md: safeMemory,
          memory_summary_md: ensureSummaryV1(safeSummary),
          skills: writtenSkills,
          removed_skills: removedSkills,
          retired_summaries: retiredMoved,
        },
        ...(skillErrors.length === 0 ? {} : { skillErrors }),
      }, { effort: effortLabel(effort) })
      return outcome
    } catch (error: unknown) {
      // Keep the pending flag and schedule an automatic retry in ~15 minutes
      // instead of freezing behind the full cooldown; manual runs stay
      // available. `lastPhase2At` keeps the real attempt time.
      const detail = `${messageOf(error)} (route=${modelRoute.provider}/${modelRoute.model})`
      const failures = state.recordPhase2Failure(now, detail)
      const outcome = { kind: 'error', error: detail } as const
      await writeLog(outcome, {
        error: detail,
        inputChars: { raw: raw.length },
        // Exactly what the model produced, redacted and bounded — the settings
        // page run log is the debugging surface for consolidation failures.
        modelResponse: response === undefined ? undefined : {
          text: redactSecrets(response.text).slice(0, 20_000),
          calls: response.calls.map(call => ({
            name: call.name,
            arguments: redactSecrets(call.arguments).slice(0, 10_000),
          })),
          truncated: response.truncated,
        },
        consecutiveFailures: failures,
      }, { effort: effortLabel(effort) })
      return outcome
    }
  }
}
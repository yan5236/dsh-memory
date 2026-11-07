/** Phase 1: per-session extraction into rollout summaries and raw memories. */

import type { MemoryStateStore } from './bookkeeping.js'
import type { Config } from './config.js'
import type { MemoryFiles } from './files.js'
import type { LlmDirectoryRuntime, ModelRoute } from './llm.js'
import {
  collectResponse, effortLabel, extractJsonObject, generateOptions, LlmCallError,
  parseCallArgumentsDetailed, parseSections, repairJson, resolveReasoningEffort,
} from './llm.js'
import { sanitizeSlug } from './paths.js'
import { PHASE1_SYSTEM, PHASE1_TEXT_SYSTEM, PHASE1_TOOL, phase1TextUser, phase1User } from './prompts.js'
import { redactSecrets, renderTranscript, selectCandidates } from './rollout.js'
import type { SessionHeaderLite, SessionReader } from './types.js'
import { headTail, messageOf } from './util.js'

export interface Phase1Summary {
  selected: number
  done: number
  noop: number
  failed: number
  unchanged: number
  skippedNoRoute: boolean
  skippedNoSessions: boolean
}

export interface Phase1Deps {
  llm: LlmDirectoryRuntime
  state: MemoryStateStore
  files: MemoryFiles
  /** Accessors so late-mounted services and runtime overrides are honored per run. */
  sessions: () => SessionReader | undefined
  config: () => Config
  route: () => ModelRoute | undefined
  /** Injectable clock for tests. */
  now?: () => number
}

interface ExtractFields {
  rawMemory: string
  rolloutSummary: string
  rolloutSlug: string
}

type ExtractOutcome = 'done' | 'noop' | 'failed' | 'unchanged'

/**
 * Which rung of the extraction ladder produced the fields, for run-log
 * diagnosis: `tool-call` is the healthy path; `-repair`/`-salvage` mean the
 * model emitted broken JSON that the tolerant chain recovered; `text-*` means
 * the tool route failed and the plain-text fallback carried the session.
 */
export type ExtractStrategy =
  | 'tool-call'
  | 'tool-call-repair'
  | 'tool-call-salvage'
  | 'text-json'
  | 'text-json-repair'
  | 'text-sections'
  | 'none'

interface ExtractAttempt {
  fields: ExtractFields
  strategy: ExtractStrategy
}

interface ExtractResult {
  outcome: ExtractOutcome
  strategy: ExtractStrategy
  error?: string
}

/** Only parse-level failures justify falling back to the next strategy. */
function isContentFailure(error: unknown): boolean {
  return error instanceof LlmCallError && error.kind === 'invalid-json'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface EventWithSeq {
  seq?: unknown
}

function rolloutFrontmatter(header: SessionHeaderLite, part?: number, baseSlug?: string): string {
  const lines = [
    '<!--',
    `  session: ${header.id}`,
    header.cwd === undefined ? '' : `  cwd: ${header.cwd}`,
    `  processed_at: ${new Date().toISOString()}`,
    part === undefined ? '' : `  part: ${part}`,
    baseSlug === undefined ? '' : `  part_of: ${baseSlug}`,
    '-->',
    '',
  ]
  return lines.filter(line => line !== '').join('\n')
}

function rawBlock(header: SessionHeaderLite, slug: string): string {
  return `<!-- dsh-memory raw: session=${header.id} slug=${slug} cwd=${header.cwd ?? ''} at=${new Date().toISOString()} -->\n`
}

export class Phase1Runner {
  private running: Promise<Phase1Summary> | undefined

  constructor(private readonly deps: Phase1Deps) {}

  /** Whether an extraction batch is currently in flight (single-flight promise alive). */
  get isRunning(): boolean {
    return this.running !== undefined
  }

  /** Single-flight entry point used by the scheduler and the settings page. */
  run(): Promise<Phase1Summary> {
    if (this.running !== undefined) return this.running
    const promise = this.execute().finally(() => {
      this.running = undefined
    })
    this.running = promise
    return promise
  }

  private async execute(): Promise<Phase1Summary> {
    const { state, files, config, llm } = this.deps
    await files.ensureLayout()
    const reader = this.deps.sessions()
    if (reader === undefined) {
      await files.writeRunLog('phase1', { outcome: 'skipped:no-sessions', detail: {} }).catch(() => {})
      return { selected: 0, done: 0, noop: 0, failed: 0, unchanged: 0, skippedNoRoute: false, skippedNoSessions: true }
    }
    const route = this.deps.route()
    if (route === undefined) {
      await files.writeRunLog('phase1', { outcome: 'skipped:no-route', detail: {} }).catch(() => {})
      return { selected: 0, done: 0, noop: 0, failed: 0, unchanged: 0, skippedNoRoute: true, skippedNoSessions: false }
    }
    const clock = this.deps.now ?? Date.now
    const cfg = config()
    const effort = await resolveReasoningEffort(llm, route, cfg.phase1ReasoningEffort)
    const headers = await reader.listSessions()
    const selection = selectCandidates(headers, id => state.processedOf(id), {
      now: clock,
      maxAgeDays: cfg.maxRolloutAgeDays,
      maxPerRun: cfg.maxRolloutsPerRun,
      retryLimit: cfg.retryLimit,
      recheckIntervalMs: cfg.recheckIntervalMs,
    })
    for (const header of selection.stale) state.claimNoop(header.id)
    let done = 0
    let noop = 0
    let failed = 0
    let unchanged = 0
    let index = 0
    const sessions: Array<{ id: string; outcome: ExtractOutcome; strategy: ExtractStrategy; error?: string }> = []
    const workers = Array.from({ length: Math.max(1, cfg.extractionConcurrency) }, async () => {
      while (index < selection.candidates.length) {
        const header = selection.candidates[index++]!
        const result = await this.extractOne(header, route, cfg, effort)
        sessions.push({
          id: header.id,
          outcome: result.outcome,
          strategy: result.strategy,
          ...(result.error === undefined ? {} : { error: result.error }),
        })
        if (result.outcome === 'done') done += 1
        else if (result.outcome === 'noop') noop += 1
        else if (result.outcome === 'unchanged') unchanged += 1
        else failed += 1
      }
    })
    await Promise.all(workers)
    if (done > 0) {
      state.setPendingConsolidation(true)
      // Fresh extraction input: lift the Phase 2 auto-retry pause.
      state.resetPhase2Failures()
    }
    state.recordPhase1(clock())
    const summary = {
      selected: selection.candidates.length,
      done,
      noop,
      failed,
      unchanged,
      skippedNoRoute: false,
      skippedNoSessions: false,
    }
    const outcomeText = `done ${done}/${summary.selected} (noop ${noop}, unchanged ${unchanged}, failed ${failed})`
    await files.writeRunLog('phase1', {
      route: `${route.provider}/${route.model}`,
      effort: effortLabel(effort),
      outcome: outcomeText,
      detail: { summary, sessions },
    }).catch(() => {})
    return summary
  }

  private async extractOne(
    header: SessionHeaderLite,
    route: ModelRoute,
    cfg: Config,
    effort: string | undefined,
  ): Promise<ExtractResult> {
    const { state, files } = this.deps
    const previous = state.processedOf(header.id)
    state.claimRunning(header.id)
    try {
      const reader = this.deps.sessions()
      if (reader === undefined) throw new Error('session reader unavailable')
      const log = await reader.readSession(header.id)
      const events = log.events as EventWithSeq[]
      const lastSeq = previous?.lastSeq
      const deltaEvents = lastSeq === undefined
        ? events
        : events.filter(event => typeof event.seq === 'number' && event.seq > lastSeq)
      const maxSeq = events.reduce((max, event) => (typeof event.seq === 'number' && event.seq > max ? event.seq : max), -1)
      const rendered = renderTranscript(deltaEvents, { maxTranscriptChars: cfg.maxTranscriptChars })

      if (previous !== undefined && previous.status !== 'failed') {
        // Incremental path: the session was already extracted before.
        if (previous.status === 'done' && lastSeq === undefined) {
          // Legacy done claim from before watermarks: baseline only, no duplicate extraction.
          state.claimUnchanged(header.id, maxSeq)
          return { outcome: 'unchanged', strategy: 'none' }
        }
        if (rendered.eventCount < cfg.minDeltaEvents || rendered.text.trim() === '') {
          state.claimUnchanged(header.id, Math.max(lastSeq ?? -1, maxSeq))
          return { outcome: 'unchanged', strategy: 'none' }
        }
        const attempt = await this.callExtract(header, route, cfg, rendered.text, true, effort)
        const fields = attempt.fields
        if (fields.rawMemory === '' && fields.rolloutSummary === '') {
          state.claimUnchanged(header.id, maxSeq)
          return { outcome: 'unchanged', strategy: attempt.strategy }
        }
        const base = previous.slug ?? sanitizeSlug(fields.rolloutSlug, `session-${header.id.slice(-8)}`)
        const part = previous.slug === undefined ? 1 : (previous.parts ?? 0) + 1
        const slugBase = previous.slug === undefined ? base : `${base}-part${part}`
        const slug = await files.uniqueRolloutSlug(slugBase, header.id)
        await files.writeAtomic(`rollout_summaries/${slug}.md`, rolloutFrontmatter(header, part, base) + fields.rolloutSummary.trimEnd() + '\n')
        await files.appendText('raw_memories.md', rawBlock(header, slug) + fields.rawMemory.trimEnd() + '\n\n')
        state.claimDone(header.id, slug, maxSeq, part)
        return { outcome: 'done', strategy: attempt.strategy }
      }

      // First extraction (new session or a failed claim being retried).
      if (rendered.eventCount < cfg.minSessionEvents || rendered.text.trim() === '') {
        state.claimNoop(header.id)
        return { outcome: 'noop', strategy: 'none' }
      }
      const attempt = await this.callExtract(header, route, cfg, rendered.text, false, effort)
      const fields = attempt.fields
      if (fields.rawMemory === '' && fields.rolloutSummary === '') {
        state.claimNoop(header.id)
        return { outcome: 'noop', strategy: attempt.strategy }
      }
      const slug = await files.uniqueRolloutSlug(
        sanitizeSlug(fields.rolloutSlug, `session-${header.id.slice(-8)}`),
        header.id,
      )
      await files.writeAtomic(`rollout_summaries/${slug}.md`, rolloutFrontmatter(header) + fields.rolloutSummary.trimEnd() + '\n')
      await files.appendText('raw_memories.md', rawBlock(header, slug) + fields.rawMemory.trimEnd() + '\n\n')
      state.claimDone(header.id, slug, maxSeq, 1)
      return { outcome: 'done', strategy: attempt.strategy }
    } catch (error: unknown) {
      const detail = `${messageOf(error)} (route=${route.provider}/${route.model})`
      state.claimFailed(header.id, detail)
      return { outcome: 'failed', strategy: 'none', error: detail.slice(0, 300) }
    }
  }

  /**
   * Extraction ladder: ① structured tool call (with the tolerant JSON chain
   * inside) → ② plain-text sections with no tools at all. A truncated output
   * halves the transcript and replays the whole ladder.
   */
  private async callExtract(
    header: SessionHeaderLite,
    route: ModelRoute,
    cfg: Config,
    transcript: string,
    delta: boolean,
    effort: string | undefined,
  ): Promise<ExtractAttempt> {
    const attempt = async (text: string): Promise<ExtractAttempt> => this.extractWithLadder(header, route, cfg, text, delta, effort)
    try {
      return await attempt(transcript)
    } catch (error: unknown) {
      if (messageOf(error).includes('truncated') && transcript.length > 15_000) {
        return await attempt(headTail(transcript, Math.floor(transcript.length / 2)))
      }
      throw error
    }
  }

  private async extractWithLadder(
    header: SessionHeaderLite,
    route: ModelRoute,
    cfg: Config,
    transcript: string,
    delta: boolean,
    effort: string | undefined,
  ): Promise<ExtractAttempt> {
    try {
      return await this.extractWithTool(header, route, cfg, transcript, delta, effort)
    } catch (error: unknown) {
      // Transport problems (aborts, provider errors) must not burn a second call.
      if (!isContentFailure(error)) throw error
      try {
        return await this.extractFromText(header, route, cfg, transcript, delta, effort)
      } catch (fallbackError: unknown) {
        throw new Error(`tool-call extraction failed (${messageOf(error)}); text-mode extraction failed (${messageOf(fallbackError)})`)
      }
    }
  }

  private meta(header: SessionHeaderLite): { sessionId: string; cwd?: string; createdAt?: number } {
    return {
      sessionId: header.id,
      ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
      ...(header.createdAt === undefined ? {} : { createdAt: header.createdAt }),
    }
  }

  /** Strategy ①: memory_save tool call, tolerant JSON chain, text JSON as the ignored-tool fallback. */
  private async extractWithTool(
    header: SessionHeaderLite,
    route: ModelRoute,
    cfg: Config,
    transcript: string,
    delta: boolean,
    effort: string | undefined,
  ): Promise<ExtractAttempt> {
    const response = await collectResponse(
      this.deps.llm,
      generateOptions(route, PHASE1_SYSTEM, phase1User(this.meta(header), transcript, delta), cfg.phase1MaxTokens, undefined, [PHASE1_TOOL], effort),
      80_000,
    )
    const toolCall = response.calls.find(call => call.name === 'memory_save')
    if (toolCall !== undefined) {
      const parsed = parseCallArgumentsDetailed(toolCall)
      // A truncated tool call may be repairable, but its content is cut: replay halved.
      if (response.truncated && parsed.strategy !== 'strict') {
        throw new Error('output truncated and tool arguments incomplete')
      }
      const strategy: ExtractStrategy = parsed.strategy === 'strict'
        ? 'tool-call'
        : parsed.strategy === 'repair' ? 'tool-call-repair' : 'tool-call-salvage'
      return { fields: this.normalizeFields(parsed.value), strategy }
    }
    // Fallback: a model that ignored the tool still gets its text parsed.
    const json = this.parseJsonText(response.text, response.truncated)
    return { fields: this.normalizeFields(json.value), strategy: json.strategy }
  }

  /** Strategy ②: no tools at all; ===SECTION=== blocks first, JSON as a courtesy. */
  private async extractFromText(
    header: SessionHeaderLite,
    route: ModelRoute,
    cfg: Config,
    transcript: string,
    delta: boolean,
    effort: string | undefined,
  ): Promise<ExtractAttempt> {
    const response = await collectResponse(
      this.deps.llm,
      generateOptions(route, PHASE1_TEXT_SYSTEM, phase1TextUser(this.meta(header), transcript, delta), cfg.phase1MaxTokens, undefined, undefined, effort),
      80_000,
    )
    const sections = parseSections(response.text)
    if (sections.matched > 0) {
      if (response.truncated) throw new Error('output truncated and result incomplete: text sections were cut off')
      const fields = this.normalizeFields({
        raw_memory: sections.rawMemory,
        rollout_summary: sections.rolloutSummary,
        rollout_slug: sections.rolloutSlug,
      })
      return { fields, strategy: 'text-sections' }
    }
    const json = this.parseJsonText(response.text, response.truncated)
    return { fields: this.normalizeFields(json.value), strategy: json.strategy }
  }

  /**
   * Text JSON parse: balanced object first, then the repair chain. A truncated
   * response must still be structurally complete (otherwise the halved replay
   * is the better move).
   */
  private parseJsonText(text: string, truncated: boolean): { value: Record<string, unknown>; strategy: 'text-json' | 'text-json-repair' } {
    try {
      return { value: extractJsonObject(text), strategy: 'text-json' }
    } catch (error: unknown) {
      if (!isContentFailure(error)) throw error
      if (truncated) throw new Error(`output truncated and result incomplete: ${messageOf(error)}`)
    }
    const repaired: unknown = JSON.parse(repairJson(text))
    if (!isRecord(repaired)) throw new LlmCallError('invalid-json', 'JSON root is not an object')
    return { value: repaired, strategy: 'text-json-repair' }
  }

  private normalizeFields(raw: Record<string, unknown>): ExtractFields {
    const read = (key: string): string => {
      const value = raw[key]
      return typeof value === 'string' ? value.trim() : ''
    }
    return {
      rawMemory: redactSecrets(read('raw_memory')).slice(0, 24_000),
      rolloutSummary: redactSecrets(read('rollout_summary')).slice(0, 40_000),
      rolloutSlug: read('rollout_slug').slice(0, 120),
    }
  }
}

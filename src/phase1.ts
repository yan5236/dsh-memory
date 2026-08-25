/** Phase 1: per-session extraction into rollout summaries and raw memories. */

import type { MemoryStateStore } from './bookkeeping.js'
import type { Config } from './config.js'
import type { MemoryFiles } from './files.js'
import type { LlmRuntime, ModelRoute } from './llm.js'
import { collectResponse, extractJsonObject, generateOptions, parseCallArguments } from './llm.js'
import { sanitizeSlug } from './paths.js'
import { PHASE1_SYSTEM, PHASE1_TOOL, phase1User } from './prompts.js'
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
  llm: LlmRuntime
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
    const { state, files, config } = this.deps
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
    const sessions: Array<{ id: string; outcome: ExtractOutcome }> = []
    const workers = Array.from({ length: Math.max(1, cfg.extractionConcurrency) }, async () => {
      while (index < selection.candidates.length) {
        const header = selection.candidates[index++]!
        const outcome = await this.extractOne(header, route, cfg)
        sessions.push({ id: header.id, outcome })
        if (outcome === 'done') done += 1
        else if (outcome === 'noop') noop += 1
        else if (outcome === 'unchanged') unchanged += 1
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
      outcome: outcomeText,
      detail: { summary, sessions },
    }).catch(() => {})
    return summary
  }

  private async extractOne(
    header: SessionHeaderLite,
    route: ModelRoute,
    cfg: Config,
  ): Promise<ExtractOutcome> {
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
          return 'unchanged'
        }
        if (rendered.eventCount < cfg.minDeltaEvents || rendered.text.trim() === '') {
          state.claimUnchanged(header.id, Math.max(lastSeq ?? -1, maxSeq))
          return 'unchanged'
        }
        const fields = await this.callExtract(header, route, cfg, rendered.text, true)
        if (fields.rawMemory === '' && fields.rolloutSummary === '') {
          state.claimUnchanged(header.id, maxSeq)
          return 'unchanged'
        }
        const base = previous.slug ?? sanitizeSlug(fields.rolloutSlug, `session-${header.id.slice(-8)}`)
        const part = previous.slug === undefined ? 1 : (previous.parts ?? 0) + 1
        const slugBase = previous.slug === undefined ? base : `${base}-part${part}`
        const slug = await files.uniqueRolloutSlug(slugBase, header.id)
        await files.writeAtomic(`rollout_summaries/${slug}.md`, rolloutFrontmatter(header, part, base) + fields.rolloutSummary.trimEnd() + '\n')
        await files.appendText('raw_memories.md', rawBlock(header, slug) + fields.rawMemory.trimEnd() + '\n\n')
        state.claimDone(header.id, slug, maxSeq, part)
        return 'done'
      }

      // First extraction (new session or a failed claim being retried).
      if (rendered.eventCount < cfg.minSessionEvents || rendered.text.trim() === '') {
        state.claimNoop(header.id)
        return 'noop'
      }
      const fields = await this.callExtract(header, route, cfg, rendered.text, false)
      if (fields.rawMemory === '' && fields.rolloutSummary === '') {
        state.claimNoop(header.id)
        return 'noop'
      }
      const slug = await files.uniqueRolloutSlug(
        sanitizeSlug(fields.rolloutSlug, `session-${header.id.slice(-8)}`),
        header.id,
      )
      await files.writeAtomic(`rollout_summaries/${slug}.md`, rolloutFrontmatter(header) + fields.rolloutSummary.trimEnd() + '\n')
      await files.appendText('raw_memories.md', rawBlock(header, slug) + fields.rawMemory.trimEnd() + '\n\n')
      state.claimDone(header.id, slug, maxSeq, 1)
      return 'done'
    } catch (error: unknown) {
      state.claimFailed(header.id, `${messageOf(error)} (route=${route.provider}/${route.model})`)
      return 'failed'
    }
  }

  /**
   * One extraction call: structured tool call preferred, text-JSON fallback,
   * and a single halved-input retry when the output was truncated.
   */
  private async callExtract(
    header: SessionHeaderLite,
    route: ModelRoute,
    cfg: Config,
    transcript: string,
    delta: boolean,
  ): Promise<ExtractFields> {
    const { llm } = this.deps
    const meta = {
      sessionId: header.id,
      ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
      ...(header.createdAt === undefined ? {} : { createdAt: header.createdAt }),
    }
    const extract = async (text: string): Promise<ExtractFields> => {
      const response = await collectResponse(
        llm,
        generateOptions(route, PHASE1_SYSTEM, phase1User(meta, text, delta), cfg.phase1MaxTokens, undefined, [PHASE1_TOOL]),
        80_000,
      )
      let raw: Record<string, unknown>
      const toolCall = response.calls.find(call => call.name === 'memory_save')
      if (toolCall !== undefined) {
        raw = parseCallArguments(toolCall)
      } else {
        try {
          // Fallback: a model that ignored the tool still gets its text parsed.
          raw = extractJsonObject(response.text)
        } catch (jsonError: unknown) {
          if (response.truncated) {
            throw new Error(`output truncated and result incomplete: ${messageOf(jsonError)}`)
          }
          throw jsonError
        }
      }
      return this.normalizeFields(raw)
    }
    try {
      return await extract(transcript)
    } catch (error: unknown) {
      if (messageOf(error).includes('truncated') && transcript.length > 15_000) {
        return await extract(headTail(transcript, Math.floor(transcript.length / 2)))
      }
      throw error
    }
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

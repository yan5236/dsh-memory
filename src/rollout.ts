/** Session-log reading: filtering, rendering, secret redaction, candidate selection. */

import type { SessionClaim, SessionHeaderLite } from './types.js'
import { headTail } from './util.js'

/** Conservative secret patterns; replaced before any text reaches the model or disk. */
const SECRET_PATTERNS: ReadonlyArray<readonly [RegExp, string | ((match: string) => string)]> = [
  [/\b(?:sk|pk)-(?:live-|test-)?[A-Za-z0-9_-]{16,}\b/g, '[REDACTED_KEY]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED_KEY]'],
  [/\bghp_[A-Za-z0-9]{20,}\b/g, '[REDACTED_TOKEN]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[REDACTED_TOKEN]'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, '[REDACTED_TOKEN]'],
  [/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_JWT]'],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/g, 'Bearer [REDACTED_TOKEN]'],
  [/-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)? PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]'],
  [/(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)\s*[:=]\s*["']?[^\s"'`,;]{12,}["']?/gi,
    match => match.replace(/[:=]\s*.+$/, ': [REDACTED_SECRET]')],
]

export function redactSecrets(text: string): string {
  let result = text
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    result = result.replace(pattern, replacement as string)
  }
  return result
}

interface TextBlock {
  type?: unknown
  text?: unknown
  name?: unknown
}

function blocksToText(blocks: unknown, cap: number): string {
  if (!Array.isArray(blocks)) return ''
  const parts: string[] = []
  let budget = cap
  const walk = (items: unknown[]): void => {
    for (const block of items) {
      if (budget <= 0) return
      if (typeof block !== 'object' || block === null) continue
      const record = block as TextBlock & { content?: unknown }
      if (record.type === 'text' && typeof record.text === 'string') {
        const text = record.text.trim()
        if (text !== '') {
          const slice = text.slice(0, budget)
          parts.push(slice)
          budget -= slice.length
        }
      } else if (record.type === 'image' && typeof record.name === 'string') {
        parts.push(`[图片:${record.name.slice(0, 80)}]`)
      } else if ((record.type === 'file' || record.type === 'attachment') && typeof record.name === 'string') {
        parts.push(`[文件:${record.name.slice(0, 80)}]`)
      } else if (Array.isArray(record.content)) {
        walk(record.content)
      }
    }
  }
  walk(blocks)
  return parts.join('\n').trim()
}

function safeJsonString(value: unknown, cap: number): string {
  if (typeof value === 'string') return value.slice(0, cap)
  try {
    return JSON.stringify(value).slice(0, cap)
  } catch {
    return ''
  }
}

/** Render one session event into a transcript line, or skip it. */
export function renderEvent(event: unknown): string | undefined {
  if (typeof event !== 'object' || event === null) return undefined
  const record = event as { type?: unknown; data?: unknown }
  if (typeof record.type !== 'string') return undefined
  const data = record.data
  try {
    switch (record.type) {
      case 'user/message': {
        const message = data as { content?: unknown; source?: { kind?: unknown; plugin?: unknown } } | undefined
        const text = blocksToText(message?.content, 4_000)
        if (text === '') return undefined
        const label = message?.source?.kind === 'plugin'
          ? `[插件消息${typeof message.source.plugin === 'string' ? `·${message.source.plugin}` : ''}]`
          : '[用户]'
        return `${label} ${text}`
      }
      case 'assistant/message': {
        const message = data as { content?: unknown } | undefined
        const text = blocksToText(message?.content, 6_000)
        return text === '' ? undefined : `[助手] ${text}`
      }
      case 'tool/call': {
        const call = data as { name?: unknown; arguments?: unknown } | undefined
        const args = safeJsonString(call?.arguments, 800)
        return `[工具调用] ${String(call?.name ?? '?')}${args === '' ? '' : ` ${args}`}`
      }
      case 'tool/result': {
        const result = data as { name?: unknown; isError?: unknown; content?: unknown } | undefined
        const text = blocksToText(result?.content, 2_000)
        if (text === '') return undefined
        const flag = result?.isError === true ? '·失败' : ''
        return `[工具结果${flag}] ${text}`
      }
      default:
        return undefined
    }
  } catch {
    return undefined
  }
}

export interface TranscriptOptions {
  maxTranscriptChars: number
}

/** Render a session event log into a bounded, redacted transcript. */
export function renderTranscript(events: readonly unknown[], options: TranscriptOptions): { text: string; eventCount: number } {
  const lines: string[] = []
  let eventCount = 0
  let budget = options.maxTranscriptChars * 2
  for (const event of events) {
    const line = renderEvent(event)
    if (line === undefined) continue
    eventCount += 1
    lines.push(line)
    budget -= line.length + 1
    if (budget <= 0) break
  }
  const joined = lines.join('\n')
  const text = redactSecrets(headTail(joined, options.maxTranscriptChars))
  return { text, eventCount }
}

export interface SelectionOptions {
  now: () => number
  maxAgeDays: number
  maxPerRun: number
  retryLimit: number
  recheckIntervalMs: number
}

export interface SelectionResult {
  candidates: SessionHeaderLite[]
  /** Sessions beyond the age window that were never processed; mark them no-op. */
  stale: SessionHeaderLite[]
}

function backoffMs(attempts: number): number {
  return Math.min(30 * 60_000, 60_000 * 2 ** attempts)
}

/**
 * Choose which sessions Phase 1 should extract next:
 * root sessions only, skip processed ones, age out old ones,
 * honor retry backoff, and cap the batch.
 */
export function selectCandidates(
  headers: readonly SessionHeaderLite[],
  claimOf: (id: string) => SessionClaim | undefined,
  options: SelectionOptions,
): SelectionResult {
  const now = options.now()
  const ageLimit = options.maxAgeDays * 86_400_000
  const candidates: SessionHeaderLite[] = []
  const rechecks: SessionHeaderLite[] = []
  const stale: SessionHeaderLite[] = []
  for (const header of headers) {
    if (header.origin === 'subagent') continue
    const claim = claimOf(header.id)
    if (claim !== undefined) {
      if (claim.status === 'done' || claim.status === 'noop') {
        // Already processed: revisit only after the recheck interval so a
        // session that kept working gets its growth extracted as a delta.
        if (claim.at === undefined || now - claim.at < options.recheckIntervalMs) continue
        const createdAt = header.createdAt ?? 0
        if (createdAt > 0 && now - createdAt > ageLimit) continue
        rechecks.push(header)
        continue
      }
      if (claim.status === 'running') continue
      if (claim.status === 'failed') {
        if (claim.transient === true) {
          // Environment blip (provider 5xx, dropped stream, timeout): the
          // attempt budget was not spent, so retry forever on a capped backoff.
          const wait = Math.min(5 * 60_000, 30_000 * 2 ** Math.min(claim.attempts, 4))
          if (now - claim.at < wait) continue
        } else if (claim.attempts >= options.retryLimit || now - claim.at < backoffMs(claim.attempts)) {
          continue
        }
      }
    }
    const createdAt = header.createdAt ?? 0
    if (createdAt > 0 && now - createdAt > ageLimit) {
      if (claim === undefined) stale.push(header)
      continue
    }
    candidates.push(header)
  }
  // New sessions first, then the longest-unrechecked sessions.
  candidates.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  rechecks.sort((a, b) => (claimOf(a.id)?.at ?? 0) - (claimOf(b.id)?.at ?? 0))
  return { candidates: [...candidates, ...rechecks].slice(0, options.maxPerRun), stale }
}

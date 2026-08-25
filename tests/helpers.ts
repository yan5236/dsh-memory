/** Shared test fakes: KV facility and programmable LLM. */

import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { KvFacilityLike, KvUnitLike } from '../src/bookkeeping.js'
import type { LlmDirectoryRuntime, LlmRuntime } from '../src/llm.js'

export function fakeKv(): { facility: KvFacilityLike; records: Map<string, unknown> } {
  const records = new Map<string, unknown>()
  const facility: KvFacilityLike = {
    async open(): Promise<KvUnitLike> {
      return {
        async loadAll() {
          const main = records.get('main')
          return {
            tables: { state: main === undefined ? {} : { main } },
            global: null,
          }
        },
        async putRecord(_table, key, value) {
          records.set(key, value)
        },
        async close() {},
      }
    },
  }
  return { facility, records }
}

export type FakeResponse = string | Error | {
  text?: string
  calls?: Array<{ name: string; arguments: string }>
  truncated?: boolean
}

/**
 * Build a programmable LLM fake. `efforts` (optional) makes the fake expose
 * an adapter-owned reasoning-effort list via resolveModelInfo, so effort
 * resolution can be tested end to end. `resolveCalls` records every
 * resolveModelInfo call.
 */
export function fakeLlm(
  responses: Array<FakeResponse> = [],
  efforts: string[] = [],
): { llm: LlmRuntime; calls: GenerateOptions[]; resolveCalls: () => number } {
  const calls: GenerateOptions[] = []
  let resolveCalls = 0
  const llm: LlmRuntime = {
    stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      calls.push(options)
      const response = responses.shift()
      return (async function* () {
        if (response instanceof Error) throw response
        if (response === undefined) {
          yield { type: 'finish', reason: { kind: 'stop' } } as const
          return
        }
        const truncated = typeof response !== 'string' && response.truncated === true
        if (typeof response !== 'string' && response.calls !== undefined) {
          for (const [index, call] of response.calls.entries()) {
            yield { type: 'tool-call-delta', index, id: `call-${index}` as never, name: call.name, argumentsDelta: call.arguments } as const
            yield { type: 'block-end', index, block: { type: 'tool-call', id: `call-${index}` as never, name: call.name, arguments: call.arguments } } as const
          }
          yield { type: 'finish', reason: { kind: truncated ? 'max-tokens' : 'tool-calls' } } as const
          return
        }
        const text = typeof response === 'string' ? response : (response.text ?? '')
        yield { type: 'text-delta', index: 0, text } as const
        yield { type: 'finish', reason: { kind: truncated ? 'max-tokens' : 'stop' } } as const
      })()
    },
  }
  if (efforts.length > 0) {
    ;(llm as LlmDirectoryRuntime).resolveModelInfo = async () => {
      resolveCalls += 1
      return {
        provider: 'mock',
        model: 'mock',
        reasoning: {
          efforts: efforts.map(id => ({ id: id as never, name: id })),
          defaultEffort: efforts[0] as never,
        },
      } as never
    }
  }
  return { llm, calls, resolveCalls: () => resolveCalls }
}

export function userMessage(text: string, kind: 'user' | 'plugin' = 'user'): unknown {
  return {
    type: 'user/message',
    data: {
      id: `m-${text.slice(0, 8)}`,
      role: 'user',
      content: [{ type: 'text', text }],
      source: kind === 'plugin' ? { kind, plugin: 'vision-bridge' } : { kind },
    },
  }
}

export function assistantMessage(text: string): unknown {
  return { type: 'assistant/message', data: { id: 'a1', role: 'assistant', content: [{ type: 'text', text }] } }
}

export function toolCall(name: string, args: unknown): unknown {
  return { type: 'tool/call', data: { id: 'c1', name, arguments: args } }
}

export function toolResult(text: string, isError = false): unknown {
  return { type: 'tool/result', data: { id: 'r1', name: 'bash', isError, content: [{ type: 'text', text }] } }
}

export const PHASE1_JSON = (slug: string): string => JSON.stringify({
  raw_memory: 'description: demo session\ncwd: /work\nkeywords: demo, pipeline\n\n### Task 1: demo\n\ntask_outcome: success\n\nReusable knowledge:\n- validated fact\n',
  rollout_summary: `# demo summary\n\n## Task 1: demo\n\nOutcome: success\n\nKey steps:\n- ran the pipeline\n`,
  rollout_slug: slug,
})

export const PHASE2_BLOCKS = (memory: string, summary: string): string =>
  `\`\`\`MEMORY.md\n${memory}\n\`\`\`\n\`\`\`memory_summary.md\n${summary}\n\`\`\`\n`

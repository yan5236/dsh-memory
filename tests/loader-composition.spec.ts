import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as Memory from '../src/index.js'
import { fakeKv } from './helpers.js'

let context: Context | undefined
let root: string | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('real Cordis Loader composition', () => {
  it('mounts the plugin and contributes tools, prompt section, and RPC', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-memory-loader-'))
    const memoryRoot = join(root, 'memories')
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: '@nanmicoder/dsh-memory'",
      '  config:',
      `    memoryRoot: ${JSON.stringify(memoryRoot)}`,
      '    provider: mock-provider',
      '    model: mock-model',
      '',
    ].join('\n'))

    context = new Context()
    context.provide('llm', {
      stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
        return (async function* () {
          yield { type: 'finish', reason: { kind: 'stop' } } as const
        })()
      },
    })
    context.provide('timer', {
      timeout: () => () => {},
      debounce: (callback: () => void) => Object.assign(() => {}, { dispose: () => {}, callback }),
    })
    context.provide('storage', {
      backend: {
        get: (form: string) => (form === 'json' ? { kv: fakeKv().facility } : undefined),
      },
    })
    context.provide('sessionQuery', {
      async listSessions() {
        return []
      },
      async readSession(id: string) {
        return { session: { id }, events: [] }
      },
    })
    context.provide('agentDefaultModel', {
      currentSelection: () => ({ provider: 'mock-provider', model: 'mock-model' }),
    })
    const routes: Array<{ path: string; handler: (req: unknown, res: unknown) => Promise<void> | void }> = []
    context.provide('webServer', {
      register(route: { path: string; handler: (req: unknown, res: unknown) => Promise<void> | void }) {
        routes.push(route)
        return () => {}
      },
    })

    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['@nanmicoder/dsh-memory', Memory],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await context.loader.await()

    // Memory tools are registered on the host tool registry.
    for (const tool of ['memory_list', 'memory_read', 'memory_search', 'memory_add']) {
      expect(context.tools.get(tool), `tool ${tool} should be registered`).toBeDefined()
    }

    // The injected prompt section participates in assembly.
    const assembly = await context.systemPrompt.assemble()
    expect(JSON.stringify(assembly)).toContain('dsh-memory:guide')
    expect(JSON.stringify(assembly)).toContain('长期记忆')

    // The RPC route is registered and answers get-state.
    const route = routes.find(entry => entry.path === '/dsh-memory/rpc')
    expect(route).toBeDefined()
    let ended = ''
    const res = {
      writeHead: () => {},
      end: (body?: string) => {
        ended = body ?? ''
      },
    }
    const req = {
      method: 'POST',
      headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' },
      async *[Symbol.asyncIterator](): AsyncIterator<string> {
        yield JSON.stringify({ method: 'get-state', args: {} })
      },
    }
    await route!.handler(req, res)
    const payload = JSON.parse(ended) as { root?: string; enabled?: boolean }
    expect(payload.root).toBe(memoryRoot)
    expect(payload.enabled).toBe(true)
  })
})

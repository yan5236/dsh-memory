import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryStateStore } from '../src/bookkeeping.js'
import { resolveConfig } from '../src/config.js'
import { MemoryFiles } from '../src/files.js'
import { originGuard, protectedDeleteReason, registerRpc, type HttpRequestLike, type HttpResponseLike, type RpcDeps, type WebServerRuntime } from '../src/rpc.js'
import { fakeKv } from './helpers.js'

let root: string | undefined

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

function fakeRequest(method: string, headers: Record<string, string | undefined>, body = ''): HttpRequestLike {
  return {
    method,
    headers,
    async *[Symbol.asyncIterator]() {
      if (body !== '') yield body
    },
  }
}

interface CapturedHttp {
  status: number
  headers: Record<string, string>
  body: string
}

function captureWebServer(): { webServer: WebServerRuntime; dispatch: (req: HttpRequestLike) => Promise<CapturedHttp> } {
  let routeHandler: ((req: HttpRequestLike, res: HttpResponseLike) => Promise<void> | void) | undefined
  const webServer: WebServerRuntime = {
    register(route): () => void {
      routeHandler = route.handler
      return () => { routeHandler = undefined }
    },
  }
  const dispatch = async (req: HttpRequestLike): Promise<CapturedHttp> => {
    const captured: CapturedHttp = { status: 0, headers: {}, body: '' }
    const res: HttpResponseLike = {
      writeHead(status, headers) {
        captured.status = status
        captured.headers = headers ?? {}
      },
      end(body) {
        captured.body = body ?? ''
      },
    }
    if (routeHandler === undefined) throw new Error('no route handler registered')
    await routeHandler(req, res)
    return captured
  }
  return { webServer, dispatch }
}

async function harness(): Promise<{ files: MemoryFiles; dispatch: (req: HttpRequestLike) => Promise<CapturedHttp> }> {
  root = await mkdtemp(join(tmpdir(), 'dsh-memory-rpc-'))
  const { facility } = fakeKv()
  const state = new MemoryStateStore(() => facility)
  await state.init()
  const files = new MemoryFiles(root)
  await files.ensureLayout()
  const deps = {
    state,
    files,
    llm: {
      stream: async function* () {},
    },
    config: () => resolveConfig({}),
    route: () => ({ provider: 'mock', model: 'mock' }),
    phase1: { isRunning: false },
    phase2: { isRunning: false },
    runPipeline: async () => {},
  } as unknown as RpcDeps
  const { webServer, dispatch } = captureWebServer()
  registerRpc(webServer, deps)
  return { files, dispatch }
}

const SAME_ORIGIN: Record<string, string | undefined> = { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }

describe('originGuard', () => {
  it('allows loopback requests without an Origin (curl/local tooling)', () => {
    expect(originGuard({ host: '127.0.0.1:3080' })).toBeNull()
    expect(originGuard({ host: 'localhost:3080' })).toBeNull()
    expect(originGuard({ host: '[::1]:3080' })).toBeNull()
  })

  it('allows requests whose Origin is loopback (the DSH settings page)', () => {
    expect(originGuard({ host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' })).toBeNull()
    expect(originGuard({ host: '127.0.0.1:3080', origin: 'http://localhost:3080' })).toBeNull()
  })

  it('rejects cross-origin browser requests (CSRF from arbitrary pages)', () => {
    expect(originGuard({ host: '127.0.0.1:3080', origin: 'http://evil.example' }))
      .toBe('cross-origin request')
    expect(originGuard({ host: '127.0.0.1:3080', origin: 'null' }))
      .toBe('opaque Origin')
  })

  it('rejects non-loopback Host headers (DNS rebinding)', () => {
    expect(originGuard({ host: 'evil.example:3080', origin: 'http://evil.example:3080' }))
      .toBe('non-loopback Host')
    expect(originGuard({ host: 'evil.example:3080' })).toBe('non-loopback Host')
  })

  it('rejects missing or malformed headers', () => {
    expect(originGuard(undefined)).toBe('missing Host header')
    expect(originGuard({})).toBe('missing Host header')
    expect(originGuard({ host: '' })).toBe('missing Host header')
    expect(originGuard({ host: 'not a host' })).toBe('malformed Host header')
    expect(originGuard({ host: '127.0.0.1:3080', origin: 'not a url' })).toBe('malformed Origin')
  })
})

describe('protectedDeleteReason', () => {
  it('refuses core pipeline files', () => {
    for (const path of ['MEMORY.md', 'memory_summary.md', 'raw_memories.md', 'raw_memories.archive.md']) {
      expect(protectedDeleteReason(path)).toContain('core memory file')
    }
  })

  it('refuses retired archives (recoverable-by-design)', () => {
    expect(protectedDeleteReason('rollout_summaries/.retired/old.md')).toContain('retired summary')
    expect(protectedDeleteReason('rollout_summaries/.retired')).toContain('retired summary')
    // Backslash spelling is normalized too.
    expect(protectedDeleteReason('rollout_summaries\\.retired\\old.md')).toContain('retired summary')
  })

  it('allows ordinary memory files', () => {
    expect(protectedDeleteReason('rollout_summaries/a.md')).toBeNull()
    expect(protectedDeleteReason('logs/2026-08-25-phase2.json')).toBeNull()
    expect(protectedDeleteReason('extensions/ad_hoc/notes/x.md')).toBeNull()
  })
})

describe('registerRpc endpoint', () => {
  it('rejects cross-origin POSTs with 403 before handling any method', async () => {
    const { dispatch } = await harness()
    const res = await dispatch(fakeRequest('POST', {
      host: '127.0.0.1:3080',
      origin: 'http://evil.example',
    }, JSON.stringify({ method: 'delete-file', args: { path: 'MEMORY.md' } })))
    expect(res.status).toBe(403)
    expect(res.body).toContain('forbidden')
  })

  it('rejects non-POST requests with 405', async () => {
    const { dispatch } = await harness()
    const res = await dispatch(fakeRequest('GET', SAME_ORIGIN))
    expect(res.status).toBe(405)
  })

  it('allows same-origin get-state', async () => {
    const { dispatch } = await harness()
    const res = await dispatch(fakeRequest('POST', SAME_ORIGIN, JSON.stringify({ method: 'get-state' })))
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ root: root })
  })

  it('writes a file for same-origin requests', async () => {
    const { files, dispatch } = await harness()
    const res = await dispatch(fakeRequest('POST', SAME_ORIGIN, JSON.stringify({
      method: 'write-file',
      args: { path: 'notes/test.md', content: '# 你好\n' },
    })))
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true, path: 'notes/test.md' })
    expect(await files.readIfExists('notes/test.md')).toBe('# 你好\n')
  })

  it('refuses deleting core files and retired archives', async () => {
    const { files, dispatch } = await harness()
    await files.writeAtomic('MEMORY.md', '# x\n')
    await files.writeAtomic('rollout_summaries/.retired/old.md', 'old\n')

    const core = await dispatch(fakeRequest('POST', SAME_ORIGIN, JSON.stringify({
      method: 'delete-file', args: { path: 'MEMORY.md' },
    })))
    expect(JSON.parse(core.body)).toMatchObject({ ok: false })
    expect(JSON.parse(core.body).message).toContain('core memory file')
    expect(await files.readIfExists('MEMORY.md')).toBe('# x\n')

    const retired = await dispatch(fakeRequest('POST', SAME_ORIGIN, JSON.stringify({
      method: 'delete-file', args: { path: 'rollout_summaries/.retired/old.md' },
    })))
    expect(JSON.parse(retired.body)).toMatchObject({ ok: false })
    expect(await files.readIfExists('rollout_summaries/.retired/old.md')).toBe('old\n')
  })

  it('deletes an ordinary file', async () => {
    const { files, dispatch } = await harness()
    await files.writeAtomic('rollout_summaries/junk.md', 'junk\n')
    const res = await dispatch(fakeRequest('POST', SAME_ORIGIN, JSON.stringify({
      method: 'delete-file', args: { path: 'rollout_summaries/junk.md' },
    })))
    expect(JSON.parse(res.body)).toEqual({ ok: true, path: 'rollout_summaries/junk.md' })
    expect(await files.readIfExists('rollout_summaries/junk.md')).toBeUndefined()
  })

  it('rejects traversal paths and oversized content', async () => {
    const { dispatch } = await harness()
    const traversal = await dispatch(fakeRequest('POST', SAME_ORIGIN, JSON.stringify({
      method: 'read-file', args: { path: '../outside.md' },
    })))
    expect(traversal.status).toBe(500)

    const huge = await dispatch(fakeRequest('POST', SAME_ORIGIN, JSON.stringify({
      method: 'write-file', args: { path: 'notes/huge.md', content: 'x'.repeat(5_000_001) },
    })))
    expect(JSON.parse(huge.body)).toMatchObject({ ok: false })
    expect(JSON.parse(huge.body).message).toContain('too large')
  })

  it('reports unknown methods as 404', async () => {
    const { dispatch } = await harness()
    const res = await dispatch(fakeRequest('POST', SAME_ORIGIN, JSON.stringify({ method: 'frobnicate' })))
    expect(res.status).toBe(404)
  })
})
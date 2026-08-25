import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryStateStore } from '../src/bookkeeping.js'
import { resolveConfig } from '../src/config.js'
import { MemoryFiles } from '../src/files.js'
import { Phase2Runner } from '../src/phase2.js'
import { fakeKv, fakeLlm, PHASE2_BLOCKS } from './helpers.js'

let root: string | undefined

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

interface Harness {
  runner: Phase2Runner
  state: MemoryStateStore
  files: MemoryFiles
  clock: { value: number }
}

async function harness(responses: Array<string | Error>, cooldownMs = 6 * 60 * 60_000): Promise<Harness> {
  root = await mkdtemp(join(tmpdir(), 'dsh-memory-phase2-'))
  const { facility } = fakeKv()
  const state = new MemoryStateStore(() => facility)
  await state.init()
  const files = new MemoryFiles(root)
  await files.ensureLayout()
  const { llm } = fakeLlm(responses)
  const cfg = resolveConfig({ provider: 'mock', model: 'mock', consolidationCooldownMs: cooldownMs })
  const clock = { value: Date.now() }
  const runner = new Phase2Runner({
    llm,
    state,
    files,
    config: () => cfg,
    route: () => ({ provider: 'mock', model: 'mock' }),
    now: () => clock.value,
  })
  return { runner, state, files, clock }
}

describe('Phase2Runner', () => {
  it('creates both files in INIT mode and rotates raw memories', async () => {
    const h = await harness([PHASE2_BLOCKS('# Memory\n\n## User preferences\n\n- 用户偏好中文回答', 'v1\n- 记忆主题：中文回答偏好')])
    await h.files.appendText('raw_memories.md', '<!-- dsh-memory raw -->\nraw block\n')
    h.state.setPendingConsolidation(true)

    const outcome = await h.runner.run(false)
    expect(outcome).toEqual({ kind: 'consolidated', mode: 'init' })

    const memory = await h.files.readIfExists('MEMORY.md')
    expect(memory).toContain('# Memory')
    expect(memory).toContain('用户偏好中文回答')
    const summary = await h.files.readIfExists('memory_summary.md')
    expect(summary?.startsWith('v1\n')).toBe(true)

    const raw = await h.files.readIfExists('raw_memories.md')
    expect(raw).toContain('archived at')
    expect(raw).not.toContain('raw block')
    const archive = await h.files.readIfExists('raw_memories.archive.md')
    expect(archive).toContain('raw block')

    expect(h.state.pendingConsolidation).toBe(false)
    expect(h.state.lastPhase2At).toBeGreaterThan(0)
    expect(h.state.phase2Error).toBeUndefined()
  })

  it('enforces the v1 first line when the model omits it', async () => {
    const h = await harness([PHASE2_BLOCKS('# Memory', '没有 v1 的摘要内容')])
    await h.files.appendText('raw_memories.md', 'raw\n')
    h.state.setPendingConsolidation(true)

    const outcome = await h.runner.run(false)
    expect(outcome.kind).toBe('consolidated')
    const summary = await h.files.readIfExists('memory_summary.md')
    expect(summary?.startsWith('v1\n')).toBe(true)
  })

  it('accepts a structured memory_write tool call', async () => {
    const h = await harness([{
      calls: [{ name: 'memory_write', arguments: JSON.stringify({
        memory_md: '# Memory\n\n## User preferences\n\n- 工具路径偏好',
        memory_summary_md: 'v1\n- 主题：工具路径',
      }) }],
    }])
    await h.files.appendText('raw_memories.md', 'raw\n')
    h.state.setPendingConsolidation(true)

    const outcome = await h.runner.run(false)
    expect(outcome).toEqual({ kind: 'consolidated', mode: 'init' })
    expect(await h.files.readIfExists('MEMORY.md')).toContain('工具路径偏好')
    expect((await h.files.readIfExists('memory_summary.md'))?.startsWith('v1\n')).toBe(true)
    expect(h.state.pendingConsolidation).toBe(false)
  })

  it('merges in INCREMENTAL mode when files already exist', async () => {
    const h = await harness([PHASE2_BLOCKS('# Memory\n\n- old entry\n- merged entry', 'v1\n- topic one\n- topic two')])
    await h.files.writeAtomic('MEMORY.md', '# Memory\n\n- old entry\n')
    await h.files.writeAtomic('memory_summary.md', 'v1\n- topic one\n')
    await h.files.appendText('raw_memories.md', 'new raw\n')
    h.state.setPendingConsolidation(true)

    const outcome = await h.runner.run(false)
    expect(outcome).toEqual({ kind: 'consolidated', mode: 'incremental' })
    const memory = await h.files.readIfExists('MEMORY.md')
    expect(memory).toContain('merged entry')
  })

  it('feeds ad hoc notes into consolidation and archives them on success', async () => {
    const { llm, calls } = fakeLlm([PHASE2_BLOCKS('# Memory\n\n- note merged', 'v1\n- note merged')])
    root = await mkdtemp(join(tmpdir(), 'dsh-memory-phase2-'))
    const { facility } = fakeKv()
    const state = new MemoryStateStore(() => facility)
    await state.init()
    const files = new MemoryFiles(root)
    await files.ensureLayout()
    const cfg = resolveConfig({ provider: 'mock', model: 'mock' })
    const runner = new Phase2Runner({ llm, state, files, config: () => cfg, route: () => ({ provider: 'mock', model: 'mock' }) })

    await files.writeAtomic('extensions/ad_hoc/notes/note-1.md', '<!-- ad-hoc note -->\n用户自述：交流必须使用中文，解释要口语化。\n')
    // raw empty + note present: must still consolidate, not skip.
    const outcome = await runner.run(false)
    expect(outcome.kind).toBe('consolidated')

    const userText = String(calls[0]?.messages[0]?.content[0]?.type === 'text' ? calls[0].messages[0].content[0].text : '')
    expect(userText).toContain('用户自述：交流必须使用中文')
    // The consumed note moved to the archive.
    expect(await files.readIfExists('extensions/ad_hoc/notes/note-1.md')).toBeUndefined()
    expect(await files.readIfExists('extensions/ad_hoc/archive/note-1.md')).toContain('用户自述')
    expect(await files.hasPendingNotes()).toBe(false)
  })

  it('honors the cooldown and skips with no pending input', async () => {
    const h = await harness([])
    expect(await h.runner.run(false)).toEqual({ kind: 'skipped', reason: 'no-input' })

    await h.files.appendText('raw_memories.md', 'raw\n')
    h.state.setPendingConsolidation(true)
    h.state.recordPhase2(Date.now())
    expect(await h.runner.run(false)).toEqual({ kind: 'skipped', reason: 'cooldown' })
    // pending flag survives a cooldown skip
    expect(h.state.pendingConsolidation).toBe(true)
  })

  it('bypasses the cooldown on forced runs', async () => {
    const h = await harness([PHASE2_BLOCKS('# Memory', 'v1\n- x')])
    await h.files.appendText('raw_memories.md', 'raw\n')
    h.state.setPendingConsolidation(true)
    h.state.recordPhase2(Date.now())
    const outcome = await h.runner.run(true)
    expect(outcome.kind).toBe('consolidated')
  })

  it('clears the pending flag when raw input drained without force', async () => {
    const h = await harness([])
    h.state.setPendingConsolidation(true)
    expect(await h.runner.run(false)).toEqual({ kind: 'skipped', reason: 'no-input' })
    expect(h.state.pendingConsolidation).toBe(false)
  })

  it('records the error and keeps the pending flag on malformed output', async () => {
    const h = await harness(['没有代码块的自由文本'])
    await h.files.appendText('raw_memories.md', 'raw\n')
    h.state.setPendingConsolidation(true)

    const outcome = await h.runner.run(false)
    expect(outcome.kind).toBe('error')
    if (outcome.kind === 'error') expect(outcome.error).toContain('代码块')
    expect(h.state.pendingConsolidation).toBe(true)
    expect(h.state.phase2Error).toContain('代码块')
    // raw memories are preserved for the retry
    expect((await h.files.readIfExists('raw_memories.md'))).toContain('raw')
  })

  it('rejects output missing the summary block', async () => {
    const h = await harness(['```MEMORY.md\n# Memory\n```'])
    await h.files.appendText('raw_memories.md', 'raw\n')
    h.state.setPendingConsolidation(true)
    const outcome = await h.runner.run(false)
    expect(outcome.kind).toBe('error')
    expect(h.state.pendingConsolidation).toBe(true)
  })

  it('retries automatically about 15 minutes after a failure instead of waiting the full cooldown', async () => {
    const h = await harness(['没有代码块的自由文本', PHASE2_BLOCKS('# Memory', 'v1\n- x')])
    await h.files.appendText('raw_memories.md', 'raw\n')
    h.state.setPendingConsolidation(true)

    const failed = await h.runner.run(false)
    expect(failed.kind).toBe('error')
    expect(h.state.pendingConsolidation).toBe(true)
    // `lastPhase2At` keeps the real attempt time; the retry window lives in
    // its own field, ~15 minutes out from the failure clock.
    expect(h.state.lastPhase2At).toBe(h.clock.value)
    const retryIn = h.state.nextAutoRetryAt - h.clock.value
    expect(h.state.nextAutoRetryAt).toBeGreaterThan(0)
    expect(retryIn).toBeGreaterThan(14 * 60_000)
    expect(retryIn).toBeLessThanOrEqual(15 * 60_000)

    // Still inside the retry window: skipped.
    h.clock.value += 10 * 60_000
    expect(await h.runner.run(false)).toEqual({ kind: 'skipped', reason: 'cooldown' })
    expect(h.state.lastPhase2At).toBe(h.clock.value - 10 * 60_000)

    // Past the retry window: runs again and succeeds.
    h.clock.value += 6 * 60_000
    const retried = await h.runner.run(false)
    expect(retried.kind).toBe('consolidated')
    expect(h.state.pendingConsolidation).toBe(false)
    // Success clears the retry window.
    expect(h.state.nextAutoRetryAt).toBe(0)
  })

  it('promotes skills from the memory_write tool call into skills/', async () => {
    const h = await harness([{
      calls: [{ name: 'memory_write', arguments: JSON.stringify({
        memory_md: '# Memory\n\n- 技能已固化',
        memory_summary_md: 'v1\n- 技能已固化',
        skills: [{
          name: 'verify-dsh-plugin',
          skill_md: '---\nname: verify-dsh-plugin\n---\n\nWhen to use: 打包 DSH 插件前\nProcedure:\n1. pnpm verify\n',
          files: [{ path: 'scripts/verify.sh', content: '#!/bin/sh\npnpm verify\n' }],
        }],
      }) }],
    }])
    await h.files.appendText('raw_memories.md', 'raw\n')
    h.state.setPendingConsolidation(true)

    const outcome = await h.runner.run(false)
    expect(outcome.kind).toBe('consolidated')
    expect(await h.files.readIfExists('skills/verify-dsh-plugin/SKILL.md')).toContain('When to use')
    expect(await h.files.readIfExists('skills/verify-dsh-plugin/scripts/verify.sh')).toContain('pnpm verify')
    expect((await h.files.stats()).skills).toBe(2)
  })

  it('rejects invalid skill names and traversal paths without failing the consolidation', async () => {
    const h = await harness([{
      calls: [{ name: 'memory_write', arguments: JSON.stringify({
        memory_md: '# Memory\n\n- 主体整合仍成功',
        memory_summary_md: 'v1\n- 主体整合仍成功',
        skills: [{
          name: '../escape',
          skill_md: 'bad',
        }, {
          name: 'ok-skill',
          skill_md: 'ok content',
          files: [{ path: '../../outside.md', content: 'evil' }],
        }, {
          name: 'bad-file',
          skill_md: 'ok',
          files: [{ path: 'scripts/../x.md', content: 'walk' }],
        }],
        remove_skills: ['../nope'],
      }) }],
    }])
    await h.files.appendText('raw_memories.md', 'raw\n')
    h.state.setPendingConsolidation(true)

    const outcome = await h.runner.run(false)
    expect(outcome.kind).toBe('consolidated')
    // Valid pieces landed; invalid ones were skipped without failing the run.
    expect(await h.files.readIfExists('skills/ok-skill/SKILL.md')).toBe('ok content')
    expect(await h.files.readIfExists('skills/../escape/SKILL.md')).toBeUndefined()
    expect(await h.files.readIfExists('skills/bad-file/SKILL.md')).toBe('ok')
    expect(await h.files.readIfExists('skills/bad-file/scripts/x.md')).toBeUndefined()
    expect(await h.files.readIfExists('MEMORY.md')).toContain('主体整合仍成功')
    // Errors are visible in the run log, not silently dropped.
    const logs = await h.files.listRunLogs()
    expect(logs).toHaveLength(1)
    const full = await h.files.readIfExists(`logs/${logs[0]!.name}`)
    expect(full).toContain('skillErrors')
  })

  it('removes skills via remove_skills and retires candidate summaries via retire_summaries', async () => {
    const h = await harness([{
      calls: [{ name: 'memory_write', arguments: JSON.stringify({
        memory_md: '# Memory\n\n- 遗忘已执行',
        memory_summary_md: 'v1\n- 遗忘已执行',
        remove_skills: ['obsolete-skill'],
        retire_summaries: ['stale-session-1'],
      }) }],
    }])
    await h.files.writeAtomic('skills/obsolete-skill/SKILL.md', 'old')
    await h.files.writeAtomic('rollout_summaries/stale-session-1.md', 'stale recap')
    await h.files.appendText('raw_memories.md', 'raw\n')
    h.state.setPendingConsolidation(true)

    const outcome = await h.runner.run(false)
    expect(outcome.kind).toBe('consolidated')
    expect(await h.files.readIfExists('skills/obsolete-skill/SKILL.md')).toBeUndefined()
    expect(await h.files.readIfExists('rollout_summaries/stale-session-1.md')).toBeUndefined()
    expect(await h.files.readIfExists('rollout_summaries/.retired/stale-session-1.md')).toContain('stale recap')
    expect(h.state.retiredAtOf('stale-session-1')).toBe(h.clock.value)
    const stats = await h.files.stats()
    expect(stats.retired).toBe(1)
    expect(stats.rollouts).toBe(0)
  })

  it('redacts secrets from model output before writing files and run logs', async () => {
    const h = await harness([{
      calls: [{ name: 'memory_write', arguments: JSON.stringify({
        memory_md: '# Memory\n\n- 密钥 api_key=sk-test-1234567890abcdefghij\n',
        memory_summary_md: 'v1\n- Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature',
        skills: [{ name: 'sensitive', skill_md: 'ghp_abcdefghijklmnopqrstuvwxyz123456' }],
      }) }],
    }])
    await h.files.appendText('raw_memories.md', 'raw\n')
    h.state.setPendingConsolidation(true)

    await h.runner.run(false)
    const memory = await h.files.readIfExists('MEMORY.md')
    expect(memory).not.toContain('sk-test-1234567890abcdefghij')
    expect(memory).toContain('[REDACTED_SECRET]')
    const summary = await h.files.readIfExists('memory_summary.md')
    expect(summary).not.toContain('eyJhbGciOiJIUzI1NiJ9')
    expect(summary).toContain('[REDACTED_TOKEN]')
    const skill = await h.files.readIfExists('skills/sensitive/SKILL.md')
    expect(skill).not.toContain('ghp_')
    expect(skill).toContain('[REDACTED_TOKEN]')
    // Run log stores the redacted versions too.
    const logs = await h.files.listRunLogs()
    const full = await h.files.readIfExists(`logs/${logs[0]!.name}`)
    expect(full).not.toContain('sk-test-1234567890abcdefghij')
  })

  it('keeps working when the model ignores the extended schema', async () => {
    const h = await harness([{
      calls: [{ name: 'memory_write', arguments: JSON.stringify({
        memory_md: '# Memory\n\n- 只有必填字段',
        memory_summary_md: 'v1\n- 只有必填字段',
      }) }],
    }])
    await h.files.appendText('raw_memories.md', 'raw\n')
    h.state.setPendingConsolidation(true)

    const outcome = await h.runner.run(false)
    expect(outcome).toEqual({ kind: 'consolidated', mode: 'init' })
    expect(await h.files.readIfExists('MEMORY.md')).toContain('只有必填字段')
    const stats = await h.files.stats()
    expect(stats.skills).toBe(0)
    expect(stats.retired).toBe(0)
  })

  it('surfaces usage and forgetting candidates in the model input', async () => {
    const { llm, calls } = fakeLlm([PHASE2_BLOCKS('# Memory', 'v1\n- x')])
    root = await mkdtemp(join(tmpdir(), 'dsh-memory-phase2-'))
    const { facility } = fakeKv()
    const state = new MemoryStateStore(() => facility)
    await state.init()
    const files = new MemoryFiles(root)
    await files.ensureLayout()
    const cfg = resolveConfig({ provider: 'mock', model: 'mock', maxUnusedDays: 30 })
    const clock = { value: Date.now() }
    const runner = new Phase2Runner({ llm, state, files, config: () => cfg, route: () => ({ provider: 'mock', model: 'mock' }), now: () => clock.value })

    // Old never-used rollout (40 days old): forgetting candidate.
    // Recent used rollouts (3 days old, read 2 days ago): active.
    await files.writeAtomic('rollout_summaries/stale-1.md', 'old recap')
    await files.writeAtomic('rollout_summaries/fresh-1.md', 'new recap')
    await files.appendText('raw_memories.md', 'raw\n')
    state.setPendingConsolidation(true)
    state.recordUsage('rollout_summaries/fresh-1.md', clock.value - 2 * 86400_000)
    const { utimes } = await import('node:fs/promises')
    const day = 86400_000
    await utimes(join(root, 'rollout_summaries/stale-1.md'), new Date(clock.value - 40 * day), new Date(clock.value - 40 * day))
    await utimes(join(root, 'rollout_summaries/fresh-1.md'), new Date(clock.value - 3 * day), new Date(clock.value - 3 * day))

    const outcome = await runner.run(false)
    expect(outcome.kind).toBe('consolidated')
    const userText = String(calls[0]?.messages[0]?.content[0]?.type === 'text' ? calls[0].messages[0].content[0].text : '')
    expect(userText).toContain('## 使用情况与遗忘依据')
    expect(userText).toContain('【候选遗忘】')
    expect(userText).toContain('fresh-1')
    expect(userText).toContain('被查阅 1 次')
    expect(userText).toContain('skills/ 清单')
  })

  it('disables the forgetting section when maxUnusedDays is 0', async () => {
    const { llm, calls } = fakeLlm([PHASE2_BLOCKS('# Memory', 'v1\n- x')])
    root = await mkdtemp(join(tmpdir(), 'dsh-memory-phase2-'))
    const { facility } = fakeKv()
    const state = new MemoryStateStore(() => facility)
    await state.init()
    const files = new MemoryFiles(root)
    await files.ensureLayout()
    const cfg = resolveConfig({ provider: 'mock', model: 'mock', maxUnusedDays: 0 })
    const runner = new Phase2Runner({ llm, state, files, config: () => cfg, route: () => ({ provider: 'mock', model: 'mock' }) })

    await files.writeAtomic('rollout_summaries/old-1.md', 'old recap')
    await files.appendText('raw_memories.md', 'raw\n')
    state.setPendingConsolidation(true)

    await runner.run(false)
    const userText = String(calls[0]?.messages[0]?.content[0]?.type === 'text' ? calls[0].messages[0].content[0].text : '')
    expect(userText).toContain('遗忘机制已关闭')
    expect(userText).not.toContain('【候选遗忘】')
  })

  it('records a run log with the full consolidated output and tracks isRunning', async () => {
    const h = await harness([PHASE2_BLOCKS('# Memory\n\n- 详情可见', 'v1\n- 详情可见')])
    await h.files.appendText('raw_memories.md', 'raw\n')
    h.state.setPendingConsolidation(true)

    expect(h.runner.isRunning).toBe(false)
    const pending = h.runner.run(false)
    expect(h.runner.isRunning).toBe(true)
    const outcome = await pending
    expect(h.runner.isRunning).toBe(false)
    expect(outcome.kind).toBe('consolidated')

    const logs = await h.files.listRunLogs()
    expect(logs).toHaveLength(1)
    expect(logs[0]?.stage).toBe('phase2')
    expect(logs[0]?.route).toBe('mock/mock')
    expect(logs[0]?.outcome).toBe('consolidated (init)')
    const full = await h.files.readIfExists(`logs/${logs[0]!.name}`)
    expect(full).toContain('# Memory')
    expect(full).toContain('memory_summary_md')
    expect(full).toContain('inputChars')
  })

  it('falls back to unlabeled fenced blocks in order', async () => {
    const memoryBlock = '# Memory A\n\n## User preferences\n\n- 内容甲：用户偏好中文交流与口语化解释，重要结论放在最前面\n- 内容乙：避免一次给出太多信息'
    const summaryBlock = 'v1\n- 摘要乙：中文交流、口语化、结论在前'
    const h = await harness([`\`\`\`markdown\n${memoryBlock}\n\`\`\`\n\n\`\`\`md\n${summaryBlock}\n\`\`\``])
    await h.files.appendText('raw_memories.md', 'raw\n')
    h.state.setPendingConsolidation(true)

    const outcome = await h.runner.run(false)
    expect(outcome).toEqual({ kind: 'consolidated', mode: 'init' })
    expect(await h.files.readIfExists('MEMORY.md')).toContain('内容甲')
    expect((await h.files.readIfExists('memory_summary.md'))?.startsWith('v1\n')).toBe(true)
  })

  it('falls back to JSON text output', async () => {
    const h = await harness([JSON.stringify({
      memory_md: '# Memory\n\n- JSON 回退成功',
      memory_summary_md: 'v1\n- JSON 回退成功',
    })])
    await h.files.appendText('raw_memories.md', 'raw\n')
    h.state.setPendingConsolidation(true)

    const outcome = await h.runner.run(false)
    expect(outcome.kind).toBe('consolidated')
    expect(await h.files.readIfExists('MEMORY.md')).toContain('JSON 回退成功')
  })

  it('records the raw model response in the error run log for diagnosis', async () => {
    const h = await harness(['这是一个完全没有结构化的回复，既没有工具调用也没有代码块。'])
    await h.files.appendText('raw_memories.md', 'raw\n')
    h.state.setPendingConsolidation(true)

    const outcome = await h.runner.run(false)
    expect(outcome.kind).toBe('error')
    const logs = await h.files.listRunLogs()
    expect(logs).toHaveLength(1)
    const full = await h.files.readIfExists(`logs/${logs[0]!.name}`)
    expect(full).toContain('modelResponse')
    expect(full).toContain('完全没有结构化的回复')
    expect(full).toContain('consecutiveFailures')
  })

  it('pauses automatic retries after three consecutive failures and resumes on force or fresh input', async () => {
    const h = await harness(['坏输出 1', '坏输出 2', '坏输出 3', PHASE2_BLOCKS('# Memory', 'v1\n- 恢复')])
    await h.files.appendText('raw_memories.md', 'raw\n')
    h.state.setPendingConsolidation(true)
    const stepPastRetry = (): void => { h.clock.value += 15 * 60_000 + 1 }

    // Three consecutive failures (each past the 15-minute retry window).
    expect((await h.runner.run(false)).kind).toBe('error')
    stepPastRetry()
    expect((await h.runner.run(false)).kind).toBe('error')
    stepPastRetry()
    expect((await h.runner.run(false)).kind).toBe('error')
    expect(h.state.phase2Failures).toBe(3)

    // Fourth automatic attempt is paused, not retried.
    stepPastRetry()
    const paused = await h.runner.run(false)
    expect(paused).toEqual({ kind: 'skipped', reason: 'retry-paused' })
    expect(h.state.phase2Failures).toBe(3)

    // Manual forced run bypasses the pause and succeeds; counter resets.
    const forced = await h.runner.run(true)
    expect(forced.kind).toBe('consolidated')
    expect(h.state.phase2Failures).toBe(0)
  })

  it('fresh phase1 extraction resets the retry pause so automatic runs resume', async () => {
    const h = await harness(['坏输出', '坏输出', '坏输出', PHASE2_BLOCKS('# Memory', 'v1\n- 自动恢复')])
    await h.files.appendText('raw_memories.md', 'raw\n')
    h.state.setPendingConsolidation(true)
    const stepPastRetry = (): void => { h.clock.value += 15 * 60_000 + 1 }

    expect((await h.runner.run(false)).kind).toBe('error')
    stepPastRetry()
    expect((await h.runner.run(false)).kind).toBe('error')
    stepPastRetry()
    expect((await h.runner.run(false)).kind).toBe('error')
    expect(h.state.phase2Failures).toBe(3)
    stepPastRetry()
    expect(await h.runner.run(false)).toEqual({ kind: 'skipped', reason: 'retry-paused' })

    // A new extraction run (done > 0) resets the counter.
    h.state.resetPhase2Failures()
    const resumed = await h.runner.run(false)
    expect(resumed.kind).toBe('consolidated')
    expect(h.state.phase2Failures).toBe(0)
  })

  it('applies the configured Phase 2 reasoning effort when the route supports it', async () => {
    const { llm, calls, resolveCalls } = fakeLlm([PHASE2_BLOCKS('# Memory\n\n## 高等级整合', 'v1\n- 主题：高等级')], ['off', 'low', 'high', 'max'])
    root = await mkdtemp(join(tmpdir(), 'dsh-memory-phase2-'))
    const { facility } = fakeKv()
    const state = new MemoryStateStore(() => facility)
    await state.init()
    const files = new MemoryFiles(root)
    await files.ensureLayout()
    await files.appendText('raw_memories.md', 'raw\n')
    state.setPendingConsolidation(true)
    const runner = new Phase2Runner({
      llm,
      state,
      files,
      config: () => resolveConfig({ provider: 'mock', model: 'mock', phase2ReasoningEffort: 'max' }),
      route: () => ({ provider: 'mock', model: 'mock' }),
    })

    const outcome = await runner.run(false)
    expect(outcome.kind).toBe('consolidated')
    expect(resolveCalls()).toBe(1)
    expect(calls[0]?.reasoningEffort).toBe('max')
    const logs = await files.listRunLogs()
    expect(logs[0]?.effort).toBe('max')
  })

  it('leaves reasoningEffort unset when the configured value is invalid', async () => {
    const { llm, calls } = fakeLlm([PHASE2_BLOCKS('# Memory\n\n## 默认等级整合', 'v1\n- 主题：默认')], ['off', 'low', 'high', 'max'])
    root = await mkdtemp(join(tmpdir(), 'dsh-memory-phase2-'))
    const { facility } = fakeKv()
    const state = new MemoryStateStore(() => facility)
    await state.init()
    const files = new MemoryFiles(root)
    await files.ensureLayout()
    await files.appendText('raw_memories.md', 'raw\n')
    state.setPendingConsolidation(true)
    const runner = new Phase2Runner({
      llm,
      state,
      files,
      config: () => resolveConfig({ provider: 'mock', model: 'mock', phase2ReasoningEffort: 'bogus' }),
      route: () => ({ provider: 'mock', model: 'mock' }),
    })

    const outcome = await runner.run(false)
    expect(outcome.kind).toBe('consolidated')
    expect(calls[0]?.reasoningEffort).toBeUndefined()
    const logs = await files.listRunLogs()
    expect(logs[0]?.effort).toBe('default')
  })
})

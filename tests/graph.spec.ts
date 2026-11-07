/** Memory graph derivation: topics, citations, affinity, and budget behaviour. */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryFiles } from '../src/files.js'
import { buildMemoryGraph, parseTopics, pathOfNode, tokenize } from '../src/graph.js'

const roots: string[] = []

async function vault(): Promise<MemoryFiles> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-memory-graph-'))
  roots.push(root)
  const files = new MemoryFiles(root)
  await files.ensureLayout()
  return files
}

async function put(files: MemoryFiles, relPath: string, content: string): Promise<void> {
  const absolute = join(files.root, relPath)
  await mkdir(join(absolute, '..'), { recursive: true })
  await writeFile(absolute, content, 'utf8')
}

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop()
    if (root !== undefined) await rm(root, { recursive: true, force: true })
  }
})

describe('tokenize', () => {
  it('keeps distinctive ASCII words and drops stopwords', () => {
    const tokens = tokenize('The navigation map plugin uses Gradle and NeoForge')
    expect(tokens).toContain('navigation')
    expect(tokens).toContain('neoForge'.toLowerCase())
    expect(tokens).not.toContain('the')
    expect(tokens).not.toContain('plugin')
  })

  it('emits CJK bigrams and skips filler bigrams', () => {
    const tokens = tokenize('交通信号灯的多相位切换时序')
    expect(tokens).toContain('交通')
    expect(tokens).toContain('信号')
    expect(tokens).not.toContain('我们')
  })
})

describe('parseTopics', () => {
  it('splits level 2 and 3 headings with their bodies', () => {
    const topics = parseTopics('# Title\n\n## 用户偏好\n- 中文\n\n### 教学\n用动画\n\n## 项目\n- pawiki')
    expect(topics.map(topic => topic.label)).toEqual(['用户偏好', '教学', '项目'])
    expect(topics[0]?.body).toContain('中文')
    expect(topics[1]?.body).toContain('用动画')
  })

  it('returns nothing for an empty handbook', () => {
    expect(parseTopics('')).toEqual([])
  })
})

describe('buildMemoryGraph', () => {
  it('links MEMORY.md topics to the summaries they cite', async () => {
    const files = await vault()
    await put(files, 'rollout_summaries/slc-traffic-lights.md', '# Traffic lights\n\n## Task\n\nOutcome: success\n')
    await put(files, 'MEMORY.md', [
      '# MEMORY',
      '',
      '## 交通信号灯',
      '细节见 rollout_summaries/slc-traffic-lights.md。',
      '',
    ].join('\n'))

    const payload = await buildMemoryGraph(files, { now: () => 7 })
    const topic = payload.nodes.find(node => node.kind === 'topic')
    const summary = payload.nodes.find(node => node.kind === 'summary')
    expect(topic?.label).toBe('交通信号灯')
    expect(summary?.path).toBe('rollout_summaries/slc-traffic-lights.md')
    expect(payload.edges).toContainEqual({
      from: topic?.id,
      to: summary?.id,
      kind: 'cite',
      weight: 2,
    })
    expect(topic?.degree).toBe(1)
    expect(payload.stats.generatedAt).toBe(7)
    expect(pathOfNode(payload, topic?.id ?? '')).toBe('MEMORY.md')
  })

  it('adds affinity edges between artifacts sharing distinctive keywords', async () => {
    const files = await vault()
    await put(files, 'rollout_summaries/gpui-launcher.md', 'GPUI window launcher renderer pipeline\n')
    await put(files, 'rollout_summaries/gpui-docs.md', 'GPUI window launcher renderer pipeline deeper notes\n')
    await put(files, 'rollout_summaries/unrelated.md', 'smtp mail relay dns record verification\n')

    const payload = await buildMemoryGraph(files)
    const relate = payload.edges.filter(edge => edge.kind === 'relate')
    const ids = new Set([...relate.flatMap(edge => [edge.from, edge.to])])
    expect(ids.has('summary:gpui-launcher')).toBe(true)
    expect(ids.has('summary:gpui-docs')).toBe(true)
    expect(ids.has('summary:unrelated')).toBe(false)
  })

  it('indexes skills, notes and archives as their own node kinds', async () => {
    const files = await vault()
    await put(files, 'skills/dsh-deploy/SKILL.md', '# DSH deploy\n\nUse pnpm -w --prod.\n')
    await put(files, 'extensions/ad_hoc/notes/unlimited-budget.md', 'token budget unlimited note\n')
    await put(files, 'extensions/ad_hoc/archive/older-note.md', 'archived opinion\n')
    await put(files, 'rollout_summaries/.retired/old-session.md', 'retired recap\n')

    const payload = await buildMemoryGraph(files)
    const kinds = new Map(payload.nodes.map(node => [node.id, node.kind]))
    expect(kinds.get('skill:dsh-deploy')).toBe('skill')
    expect(kinds.get('note:unlimited-budget')).toBe('note')
    expect(kinds.get('archive:older-note')).toBe('archive')
    expect(kinds.get('archive:old-session')).toBe('archive')
  })

  it('honours the node budget and reports truncation', async () => {
    const files = await vault()
    await put(files, 'MEMORY.md', '## 主题\n- 内容\n')
    for (let index = 0; index < 12; index += 1) {
      await put(files, `rollout_summaries/session-${index}.md`, `# Session ${index}\n\nbody ${index}\n`)
    }
    const payload = await buildMemoryGraph(files, { maxNodes: 5 })
    expect(payload.nodes).toHaveLength(5)
    expect(payload.stats.truncated).toBe(true)
    // Topics outrank summaries when the budget is tight.
    expect(payload.nodes.some(node => node.kind === 'topic')).toBe(true)
  })

  it('returns an empty graph for an empty vault', async () => {
    const files = await vault()
    const payload = await buildMemoryGraph(files)
    expect(payload.nodes).toEqual([])
    expect(payload.edges).toEqual([])
    expect(payload.stats.truncated).toBe(false)
  })

  it('is deterministic for the same vault', async () => {
    const files = await vault()
    await put(files, 'rollout_summaries/a.md', 'alpha beta gamma delta\n')
    await put(files, 'rollout_summaries/b.md', 'alpha beta gamma delta epsilon\n')
    const first = await buildMemoryGraph(files, { now: () => 1 })
    const second = await buildMemoryGraph(files, { now: () => 1 })
    expect(second).toEqual(first)
  })
})

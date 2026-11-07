/**
 * Memory graph: the relationship model behind the vault page's 3D cloud.
 *
 * Nodes are memory artifacts (MEMORY.md topics, rollout summaries, skills,
 * ad-hoc notes, retired archives). Edges are either explicit citations
 * (`cite`: a topic that names a summary file) or topical affinity (`relate`:
 * two artifacts that share distinctive keywords). Everything here is derived
 * from files on disk, so the graph never drifts from what the pipeline wrote.
 */

import type { MemoryFiles } from './files.js'

export type GraphNodeKind = 'topic' | 'summary' | 'skill' | 'note' | 'archive'

export interface GraphNode {
  id: string
  label: string
  kind: GraphNodeKind
  /** Memory-relative path of the artifact this node stands for. */
  path: string
  chars: number
  /** Epoch ms of the artifact's last modification (0 when unknown). */
  at: number
  degree: number
  /** Short plain-text excerpt so the inspector needs no extra read. */
  preview: string
}

export interface GraphEdge {
  from: string
  to: string
  kind: 'cite' | 'relate'
  weight: number
}

export interface MemoryGraphPayload {
  nodes: GraphNode[]
  edges: GraphEdge[]
  stats: { nodes: number; edges: number; truncated: boolean; generatedAt: number }
}

export interface GraphOptions {
  /** Upper bound on returned nodes (keeps the canvas readable). */
  maxNodes?: number
  /** Upper bound on summary artifacts read for keyword extraction. */
  maxSummaries?: number
  /** Bytes read per artifact for keyword extraction. */
  readCap?: number
  /** Related edges kept per node. */
  relatedPerNode?: number
  /** Total relate-edge budget; the strongest pairs win. */
  maxRelatedEdges?: number
  /** Injectable clock for deterministic tests. */
  now?: () => number
}

const DEFAULTS = {
  maxNodes: 320,
  maxSummaries: 220,
  readCap: 2_500,
  relatedPerNode: 3,
  maxRelatedEdges: 900,
} as const

/** Keywords kept per artifact; more than this dilutes affinity scoring. */
const TOKENS_PER_NODE = 28

/** Tokens shared by more than this many artifacts carry no signal, so pairs are not scored. */
const MAX_TOKEN_FANOUT = 48

/** Minimum shared-token weight before two artifacts are linked as related. */
const MIN_RELATE_SCORE = 3

/** ASCII words too common to distinguish memories. */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'when', 'then', 'than', 'them', 'they',
  'have', 'has', 'had', 'was', 'were', 'are', 'but', 'not', 'you', 'your', 'our', 'its', 'their',
  'can', 'will', 'would', 'should', 'could', 'may', 'might', 'must', 'also', 'more', 'most', 'some',
  'any', 'all', 'one', 'two', 'out', 'use', 'used', 'using', 'via', 'per', 'after', 'before',
  'over', 'under', 'about', 'only', 'just', 'like', 'make', 'made', 'get', 'got', 'set', 'run',
  'ran', 'new', 'old', 'now', 'here', 'there', 'what', 'which', 'who', 'why', 'how', 'yes',
  'session', 'summary', 'memory', 'memories', 'task', 'tasks', 'note', 'notes', 'file', 'files',
  'line', 'lines', 'text', 'true', 'false', 'null', 'undefined', 'http', 'https', 'www', 'com',
  'html', 'json', 'yaml', 'markdown', 'md', 'raw', 'demo', 'step', 'steps', 'result', 'results',
  'key', 'keys', 'value', 'values', 'user', 'users', 'agent', 'dsh', 'code', 'case', 'part',
  'plugin', 'plugins', 'project', 'projects', 'config', 'setup', 'install', 'test', 'tests',
])

/** CJK bigrams that carry no distinguishing power. */
const CJK_STOP = new Set([
  '我们', '你们', '他们', '这个', '那个', '一个', '可以', '没有', '就是', '因为', '所以', '如果',
  '已经', '还是', '但是', '然后', '现在', '什么', '怎么', '这样', '那样', '一下', '这些', '那些',
  '用户', '需要', '问题', '时候', '不是', '进行', '通过', '使用', '以及', '并且', '或者', '而且',
  '记忆', '任务', '文件', '会话', '总结', '插件', '功能', '配置', '修改', '检查', '完成', '内容',
])

interface ExtractableNode extends GraphNode {
  /** Distinctive keywords with their occurrence counts. */
  tokens: Map<string, number>
  /** Raw body text used for citation scanning (topics only). */
  body: string
}

function slugToken(text: string): string {
  const cleaned = text
    .toLowerCase()
    .replace(/[`*_#>[\]()]/g, ' ')
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned.slice(0, 60) === '' ? 'untitled' : cleaned.slice(0, 60)
}

/** Tokenize one artifact body into distinctive ASCII words and CJK bigrams. */
export function tokenize(text: string): string[] {
  const lower = text.toLowerCase()
  const tokens: string[] = []
  for (const match of lower.matchAll(/[a-z0-9][a-z0-9_+.-]{2,}/g)) {
    const word = match[0].replace(/[.-]+$/, '')
    if (word.length >= 3 && !STOPWORDS.has(word)) tokens.push(word)
  }
  for (const match of lower.matchAll(/[\u4e00-\u9fff]{2,}/g)) {
    const run = match[0]
    for (let index = 0; index + 1 < run.length; index += 1) {
      const bigram = run.slice(index, index + 2)
      if (!CJK_STOP.has(bigram)) tokens.push(bigram)
    }
  }
  return tokens
}

/** Keep the strongest keywords for one artifact. */
function topTokens(text: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const token of tokenize(text)) counts.set(token, (counts.get(token) ?? 0) + 1)
  const ranked = [...counts.entries()]
    .sort((left, right) => (right[1] - left[1]) || left[0].localeCompare(right[0]))
    .slice(0, TOKENS_PER_NODE)
  return new Map(ranked)
}

/**
 * First line worth showing as a node label: HTML comment frontmatter is
 * skipped entirely, and a markdown heading wins over loose prose.
 */
export function firstMeaningfulLine(content: string | undefined, fallback: string): string {
  if (content === undefined) return fallback
  let inComment = false
  let firstProse = ''
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (inComment) {
      if (line.includes('-->')) inComment = false
      continue
    }
    if (line.startsWith('<!--')) {
      if (!line.includes('-->')) inComment = true
      continue
    }
    if (line === '' || line.startsWith('-->') || line.startsWith('```')) continue
    const heading = /^#{1,3}\s+(.*)$/.exec(line)
    if (heading !== null) {
      const text = (heading[1] ?? '').replace(/[`*_]/g, '').trim()
      if (text !== '') return text.slice(0, 64)
      continue
    }
    if (firstProse === '') firstProse = line.replace(/[`*_]/g, '').trim()
  }
  return (firstProse === '' ? fallback : firstProse).slice(0, 64)
}

/** Split MEMORY.md into `##`/`###` topics with their bodies. */
export function parseTopics(memory: string): Array<{ label: string; body: string }> {
  const topics: Array<{ label: string; body: string }> = []
  let label: string | undefined
  let lines: string[] = []
  const flush = (): void => {
    if (label !== undefined) topics.push({ label, body: lines.join('\n') })
    lines = []
  }
  for (const line of memory.split(/\r?\n/)) {
    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    if (heading !== null && (heading[1]?.length ?? 0) >= 2) {
      flush()
      label = (heading[2] ?? '').replace(/[`*_]/g, '').trim().slice(0, 80)
      continue
    }
    if (label !== undefined) lines.push(line)
  }
  flush()
  return topics.filter(topic => topic.label !== '')
}

/** Every rollout summary slug cited inside one topic body. */
function citedSlugs(body: string): string[] {
  const slugs = new Set<string>()
  for (const match of body.matchAll(/rollout_summaries\/([A-Za-z0-9][A-Za-z0-9._-]*)/g)) {
    const raw = match[1]
    if (raw === undefined) continue
    const slug = raw.replace(/\.md$/i, '').replace(/[.-]+$/, '')
    if (slug !== '') slugs.add(slug)
  }
  return [...slugs]
}

async function readBounded(files: MemoryFiles, path: string, cap: number): Promise<string | undefined> {
  try {
    return await files.readIfExists(path, cap)
  } catch {
    return undefined
  }
}

/** Read bodies in bounded-parallel batches so a large vault stays responsive. */
async function readMany(
  files: MemoryFiles,
  paths: readonly string[],
  cap: number,
  concurrency = 8,
): Promise<Map<string, string | undefined>> {
  const out = new Map<string, string | undefined>()
  let index = 0
  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, paths.length)) }, async () => {
    while (index < paths.length) {
      const path = paths[index]
      index += 1
      if (path === undefined) continue
      out.set(path, await readBounded(files, path, cap))
    }
  })
  await Promise.all(workers)
  return out
}

function basename(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] ?? path
}

function fileOf(path: string): string {
  return path.replace(/\.md$/i, '')
}

/** Build the node/edge payload consumed by the vault page's 3D cloud. */
export async function buildMemoryGraph(files: MemoryFiles, options: GraphOptions = {}): Promise<MemoryGraphPayload> {
  const maxNodes = options.maxNodes ?? DEFAULTS.maxNodes
  const maxSummaries = options.maxSummaries ?? DEFAULTS.maxSummaries
  const readCap = options.readCap ?? DEFAULTS.readCap
  const relatedPerNode = options.relatedPerNode ?? DEFAULTS.relatedPerNode
  const maxRelatedEdges = options.maxRelatedEdges ?? DEFAULTS.maxRelatedEdges
  const now = options.now ?? Date.now

  const entries = await files.listTree('')
  const fileEntries = entries.filter(entry => entry.kind === 'file')
  const byPath = new Map(fileEntries.map(entry => [entry.path, entry]))
  let truncated = false

  const nodes: ExtractableNode[] = []
  const push = (node: ExtractableNode): void => {
    nodes.push(node)
  }

  // 1. MEMORY.md topics — the skeleton of the graph.
  const memoryText = await readBounded(files, 'MEMORY.md', 400_000)
  const memoryEntry = byPath.get('MEMORY.md')
  const topicIds = new Set<string>()
  if (memoryText !== undefined) {
    let ordinal = 0
    for (const topic of parseTopics(memoryText)) {
      ordinal += 1
      const id = `topic:${ordinal}:${slugToken(topic.label)}`
      if (topicIds.has(id)) continue
      topicIds.add(id)
      push({
        id,
        label: topic.label,
        kind: 'topic',
        path: 'MEMORY.md',
        chars: topic.body.length,
        at: memoryEntry?.modifiedAt ?? 0,
        degree: 0,
        preview: previewOf(topic.body),
        tokens: topTokens(`${topic.label}\n${topic.body}`),
        body: topic.body,
      })
    }
  }

  // 2. Rollout summaries (retired ones become archive nodes).
  const summaryPaths = fileEntries
    .filter(entry => entry.path.startsWith('rollout_summaries/') && entry.path.endsWith('.md'))
    .filter(entry => !entry.path.startsWith('rollout_summaries/.retired/'))
    .sort((left, right) => (right.modifiedAt - left.modifiedAt) || left.path.localeCompare(right.path))
  const keptSummaries = summaryPaths.slice(0, maxSummaries)
  if (summaryPaths.length > keptSummaries.length) truncated = true
  const summaryBodies = await readMany(files, keptSummaries.map(entry => entry.path), readCap)
  for (const entry of keptSummaries) {
    const name = fileOf(basename(entry.path))
    const content = summaryBodies.get(entry.path)
    push({
      id: `summary:${name}`,
      label: firstMeaningfulLine(content, name),
      kind: 'summary',
      path: entry.path,
      chars: entry.size,
      at: entry.modifiedAt,
      degree: 0,
      preview: previewOf(content),
      tokens: topTokens(`${name}\n${content ?? ''}`),
      body: '',
    })
  }

  // 3. Skills, ad-hoc notes, archives.
  const skillPaths = fileEntries
    .filter(entry => /^skills\/[^/]+\/SKILL\.md$/.test(entry.path))
    .sort((left, right) => left.path.localeCompare(right.path))
  const notePaths = fileEntries
    .filter(entry => entry.path.startsWith('extensions/ad_hoc/notes/') && entry.path.endsWith('.md'))
    .sort((left, right) => (right.modifiedAt - left.modifiedAt) || left.path.localeCompare(right.path))
  const archivePaths = fileEntries
    .filter(entry => entry.path.startsWith('extensions/ad_hoc/archive/') && entry.path.endsWith('.md'))
    .sort((left, right) => (right.modifiedAt - left.modifiedAt) || left.path.localeCompare(right.path))
  const retiredPaths = fileEntries
    .filter(entry => entry.path.startsWith('rollout_summaries/.retired/') && entry.path.endsWith('.md'))
    .sort((left, right) => (right.modifiedAt - left.modifiedAt) || left.path.localeCompare(right.path))

  const auxBodies = await readMany(
    files,
    [...skillPaths, ...notePaths, ...archivePaths, ...retiredPaths.slice(0, 60)].map(entry => entry.path),
    readCap,
  )
  for (const entry of skillPaths) {
    const segments = entry.path.split('/')
    const name = segments[1] ?? fileOf(basename(entry.path))
    const content = auxBodies.get(entry.path)
    push({
      id: `skill:${name}`,
      label: name,
      kind: 'skill',
      path: entry.path,
      chars: entry.size,
      at: entry.modifiedAt,
      degree: 0,
      preview: previewOf(content),
      tokens: topTokens(`${name}\n${content ?? ''}`),
      body: '',
    })
  }
  for (const entry of notePaths) {
    const name = fileOf(basename(entry.path))
    push({
      id: `note:${name}`,
      label: firstMeaningfulLine(auxBodies.get(entry.path), name),
      kind: 'note',
      path: entry.path,
      chars: entry.size,
      at: entry.modifiedAt,
      degree: 0,
      preview: previewOf(auxBodies.get(entry.path)),
      tokens: topTokens(`${name}\n${auxBodies.get(entry.path) ?? ''}`),
      body: '',
    })
  }
  for (const entry of [...archivePaths, ...retiredPaths.slice(0, 60)]) {
    const name = fileOf(basename(entry.path))
    push({
      id: `archive:${name}`,
      label: name,
      kind: 'archive',
      path: entry.path,
      chars: entry.size,
      at: entry.modifiedAt,
      degree: 0,
      preview: previewOf(auxBodies.get(entry.path)),
      tokens: topTokens(`${name}\n${auxBodies.get(entry.path) ?? ''}`),
      body: '',
    })
  }

  // Budget: archives first to go, then the oldest summaries.
  let selected = nodes
  if (nodes.length > maxNodes) {
    truncated = true
    const rank: Record<GraphNodeKind, number> = { topic: 0, skill: 1, note: 2, summary: 3, archive: 4 }
    selected = [...nodes]
      .sort((left, right) => (rank[left.kind] - rank[right.kind])
        || ((left.kind === 'summary' ? right.at - left.at : 0))
        || left.label.localeCompare(right.label))
      .slice(0, maxNodes)
  }
  const kept = new Set(selected.map(node => node.id))

  // 4. Explicit citations from MEMORY.md topics.
  const edges: GraphEdge[] = []
  const edgeKeys = new Set<string>()
  const addEdge = (from: string, to: string, kind: 'cite' | 'relate', weight: number): void => {
    if (from === to || !kept.has(from) || !kept.has(to)) return
    const key = kind === 'cite' ? `cite|${from}|${to}` : `relate|${[from, to].sort().join('|')}`
    if (edgeKeys.has(key)) return
    edgeKeys.add(key)
    edges.push({ from, to, kind, weight })
  }

  const summaryIdBySlug = new Map<string, string>()
  for (const node of selected) {
    if (node.kind !== 'summary') continue
    const slug = fileOf(basename(node.path))
    summaryIdBySlug.set(slug, node.id)
  }
  for (const node of selected) {
    if (node.kind !== 'topic') continue
    for (const slug of citedSlugs(node.body)) {
      const target = summaryIdBySlug.get(slug)
      if (target === undefined) continue
      addEdge(node.id, target, 'cite', 2)
    }
  }

  // 5. Topical affinity through shared distinctive keywords.
  //
  // Archived artifacts stay out of affinity scoring: they are numerous, hidden
  // by default in the cloud, and would soak up every node's relate budget while
  // drawing no visible line.
  const postings = new Map<string, Array<{ id: string; count: number }>>()
  for (const node of selected) {
    if (node.kind === 'archive') continue
    for (const [token, count] of node.tokens) {
      const bucket = postings.get(token)
      if (bucket === undefined) postings.set(token, [{ id: node.id, count }])
      else bucket.push({ id: node.id, count })
    }
  }
  const scores = new Map<string, number>()
  for (const bucket of postings.values()) {
    if (bucket.length < 2 || bucket.length > MAX_TOKEN_FANOUT) continue
    for (let left = 0; left < bucket.length; left += 1) {
      const a = bucket[left]
      if (a === undefined) continue
      for (let right = left + 1; right < bucket.length; right += 1) {
        const b = bucket[right]
        if (b === undefined) continue
        const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`
        scores.set(key, (scores.get(key) ?? 0) + Math.min(a.count, b.count))
      }
    }
  }

  const rankedPairs = [...scores.entries()]
    .filter(([, score]) => score >= MIN_RELATE_SCORE)
    .sort((left, right) => (right[1] - left[1]) || left[0].localeCompare(right[0]))
  const perNode = new Map<string, number>()
  let relateCount = 0
  for (const [key, score] of rankedPairs) {
    if (relateCount >= maxRelatedEdges) break
    const [leftId, rightId] = key.split('|')
    if (leftId === undefined || rightId === undefined) continue
    // A citation already states the relationship; don't double-draw it.
    if (edgeKeys.has(`cite|${leftId}|${rightId}`) || edgeKeys.has(`cite|${rightId}|${leftId}`)) continue
    if ((perNode.get(leftId) ?? 0) >= relatedPerNode || (perNode.get(rightId) ?? 0) >= relatedPerNode) continue
    perNode.set(leftId, (perNode.get(leftId) ?? 0) + 1)
    perNode.set(rightId, (perNode.get(rightId) ?? 0) + 1)
    addEdge(leftId, rightId, 'relate', Math.min(6, score))
    relateCount += 1
  }

  // 6. Final payload: degree counts, stable ordering.
  const degree = new Map<string, number>()
  for (const edge of edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1)
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1)
  }
  const outNodes: GraphNode[] = selected.map(node => ({
    id: node.id,
    label: node.label,
    kind: node.kind,
    path: node.path,
    chars: node.chars,
    at: node.at,
    degree: degree.get(node.id) ?? 0,
    preview: node.preview,
  }))
  outNodes.sort((left, right) => (right.degree - left.degree) || left.label.localeCompare(right.label))
  edges.sort((left, right) => (right.weight - left.weight) || left.from.localeCompare(right.from))

  return {
    nodes: outNodes,
    edges,
    stats: { nodes: outNodes.length, edges: edges.length, truncated, generatedAt: now() },
  }
}

/** One-line plain-text excerpt for the inspector (comments/markdown stripped). */
export function previewOf(content: string | undefined, cap = 220): string {
  if (content === undefined) return ''
  const withoutComments = content.replace(/<!--[\s\S]*?-->/g, ' ')
  const cleaned = withoutComments
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/[`*_>|]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.slice(0, cap)
}

/** Resolve one graph node back to its artifact path (guarded against unknown ids). */
export function pathOfNode(payload: MemoryGraphPayload, id: string): string | undefined {
  return payload.nodes.find(node => node.id === id)?.path
}

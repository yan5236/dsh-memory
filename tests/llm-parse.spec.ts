import { describe, expect, it } from 'vitest'
import {
  EXTRACTION_KEYS,
  LlmCallError,
  parseCallArguments,
  parseCallArgumentsDetailed,
  parseObjectLoose,
  parseSections,
  repairJson,
  salvageFields,
  unescapeJsonString,
} from '../src/llm.js'

const RAW_MEMORY = 'description: 记忆管道修复\ncwd: /work/repo\nkeywords: memory, json\n\n### Task 1: 修复解析\n\ntask_outcome: partial\n\nReusable knowledge:\n- 裸换行会破坏 tool 参数\n'
const ROLLOUT_SUMMARY = '# 记忆管道修复\n\n## Task 1: 修复解析\n\nOutcome: partial\n\nKey steps:\n- 写容错解析\n\nReferences:\n1. src/llm.ts\n'

describe('tolerant JSON parsing (real malformed payloads)', () => {
  it('accepts a well-formed object through the strict stage', () => {
    const strict = JSON.stringify({ raw_memory: RAW_MEMORY, rollout_summary: ROLLOUT_SUMMARY, rollout_slug: 'memory-reliability' })
    const parsed = parseObjectLoose(strict)
    expect(parsed.strategy).toBe('strict')
    expect(parsed.value.raw_memory).toBe(RAW_MEMORY)
    expect(parsed.value.rollout_slug).toBe('memory-reliability')
  })

  it('repairs raw newlines inside a JSON string (the dominant field failure)', () => {
    // The model emitted real line breaks inside the string value instead of \n.
    const broken = `{"raw_memory":"${RAW_MEMORY}","rollout_summary":"${ROLLOUT_SUMMARY}","rollout_slug":"memory-reliability"}`
    expect(() => JSON.parse(broken)).toThrow()
    const parsed = parseObjectLoose(broken)
    expect(parsed.strategy).toBe('repair')
    expect(parsed.value.raw_memory).toBe(RAW_MEMORY)
    expect(parsed.value.rollout_summary).toBe(ROLLOUT_SUMMARY)
    expect(parsed.value.rollout_slug).toBe('memory-reliability')
  })

  it('repairs unescaped quotes inside markdown content', () => {
    const broken = '{"raw_memory":"用户说 "把这句话删掉"，照字面执行","rollout_summary":"# 标题\\n\\n引用 "README" 原文","rollout_slug":"quote-fix"}'
    expect(() => JSON.parse(broken)).toThrow()
    const parsed = parseObjectLoose(broken)
    expect(parsed.strategy).toBe('repair')
    expect(parsed.value.raw_memory).toBe('用户说 "把这句话删掉"，照字面执行')
    expect(parsed.value.rollout_summary).toBe('# 标题\n\n引用 "README" 原文')
    expect(parsed.value.rollout_slug).toBe('quote-fix')
  })

  it('drops trailing commas before closing structures', () => {
    const broken = '{"raw_memory":"a","rollout_summary":"b","rollout_slug":"c",}'
    const parsed = parseObjectLoose(broken)
    expect(parsed.strategy).toBe('repair')
    expect(parsed.value.rollout_slug).toBe('c')
  })

  it('closes a tail-truncated object so the leading fields survive', () => {
    const truncated = `{"raw_memory":"${RAW_MEMORY}","rollout_summary":"# 被截断的回顾`
    const repaired = repairJson(truncated)
    expect(() => JSON.parse(repaired)).not.toThrow()
    const parsed = parseObjectLoose(truncated)
    expect(parsed.strategy).toBe('repair')
    expect(parsed.value.raw_memory).toBe(RAW_MEMORY)
    expect(parsed.value.rollout_summary).toBe('# 被截断的回顾')
    expect(parsed.value.rollout_slug).toBeUndefined()
  })

  it('drops a dangling key with no value instead of failing the whole payload', () => {
    const dangling = '{"raw_memory":"kept","rollout_summary":'
    expect(parseObjectLoose(dangling).value).toEqual({ raw_memory: 'kept' })
  })

  it('salvages the only field that is still anchored when repair is impossible', () => {
    const broken = '"raw_memory": "只有这个字段活下来"'
    expect(() => repairJson(broken)).toThrow(LlmCallError)
    const parsed = parseObjectLoose(broken)
    expect(parsed.strategy).toBe('salvage')
    expect(parsed.value).toEqual({ raw_memory: '只有这个字段活下来' })
    const salvaged = salvageFields(broken)
    expect(Object.keys(salvaged)).toEqual(['raw_memory'])
    expect(salvaged.rollout_summary).toBeUndefined()
  })

  it('unescapes \\n, \\u and \\" in salvaged fragments', () => {
    const broken = '"raw_memory": "a\\nb\\u4e2d\\"c"'
    expect(salvageFields(broken).raw_memory).toBe('a\nb中"c')
    expect(unescapeJsonString('x\\ty\\r\\n')).toBe('x\ty\r\n')
  })

  it('salvages multiple anchored fields in order', () => {
    const broken = `"rollout_summary": "${ROLLOUT_SUMMARY.replace(/\n/g, '\\n')}", "raw_memory": "${RAW_MEMORY.replace(/\n/g, '\\n')}", "rollout_slug": "salvaged"`
    const parsed = parseObjectLoose(broken)
    expect(parsed.strategy).toBe('salvage')
    expect(parsed.value.raw_memory).toBe(RAW_MEMORY)
    expect(parsed.value.rollout_summary).toBe(ROLLOUT_SUMMARY)
    expect(parsed.value.rollout_slug).toBe('salvaged')
  })

  it('throws invalid-json only when every stage fails', () => {
    expect(() => parseObjectLoose('抱歉，我无法提取这个会话。')).toThrow(LlmCallError)
    expect(() => parseObjectLoose('抱歉，我无法提取这个会话。')).toThrow(/not valid JSON/)
    expect(() => repairJson('no braces here')).toThrow(LlmCallError)
  })

  it('parses tool-call arguments through the same chain', () => {
    const call = { name: 'memory_save', arguments: '{"raw_memory":"line1\nline2","rollout_slug":"tool-fix"}' }
    expect(parseCallArguments(call)).toMatchObject({ rollout_slug: 'tool-fix' })
    expect(parseCallArgumentsDetailed(call).strategy).toBe('repair')
    expect(() => parseCallArguments({ name: 'memory_save', arguments: '   ' })).toThrow(LlmCallError)
  })

  it('keeps the extraction key list in sync with the salvage anchors', () => {
    expect(EXTRACTION_KEYS).toEqual(['raw_memory', 'rollout_summary', 'rollout_slug'])
  })
})

describe('parseSections (plain-text Phase 1 contract)', () => {
  const text = `===ROLLOUT_SLUG===
sections-session

===ROLLOUT_SUMMARY===
${ROLLOUT_SUMMARY}
===RAW_MEMORY===
${RAW_MEMORY}`

  it('reads the three ===SECTION=== blocks', () => {
    const sections = parseSections(text)
    expect(sections.matched).toBe(3)
    expect(sections.rolloutSlug).toBe('sections-session')
    expect(sections.rolloutSummary).toBe(ROLLOUT_SUMMARY.trim())
    expect(sections.rawMemory).toBe(RAW_MEMORY.trim())
  })

  it('accepts an inline value on the marker line', () => {
    const sections = parseSections('===ROLLOUT_SLUG=== inline-slug\n===ROLLOUT_SUMMARY===\n# 摘要\n===RAW_MEMORY===\n记忆')
    expect(sections.matched).toBe(3)
    expect(sections.rolloutSlug).toBe('inline-slug')
    expect(sections.rolloutSummary).toBe('# 摘要')
  })

  it('accepts fenced labels as a compatibility path', () => {
    const sections = parseSections('```rollout_summary\n# Fenced 摘要\n```\n```raw_memory\ndescription: fenced\n```\n```rollout_slug\nfenced-slug\n```')
    expect(sections.matched).toBe(3)
    expect(sections.rolloutSummary).toBe('# Fenced 摘要')
    expect(sections.rawMemory).toBe('description: fenced')
    expect(sections.rolloutSlug).toBe('fenced-slug')
  })

  it('tolerates markers wrapped in a markdown fence', () => {
    const sections = parseSections('```markdown\n===ROLLOUT_SLUG===\nwrapped\n===ROLLOUT_SUMMARY===\n# W\n===RAW_MEMORY===\nM\n```')
    expect(sections.rolloutSlug).toBe('wrapped')
    expect(sections.rolloutSummary).toBe('# W')
    expect(sections.rawMemory).toBe('M')
  })

  it('reports no match for prose that is not section-shaped', () => {
    const sections = parseSections('这个会话没什么值得记的。')
    expect(sections.matched).toBe(0)
    expect(sections.rolloutSummary).toBe('')
  })

  it('keeps an intentionally empty section empty', () => {
    const sections = parseSections('===ROLLOUT_SLUG===\n\n===ROLLOUT_SUMMARY===\n\n===RAW_MEMORY===\n')
    expect(sections.matched).toBe(3)
    expect(sections.rolloutSlug).toBe('')
    expect(sections.rolloutSummary).toBe('')
  })
})

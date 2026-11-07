/**
 * dsh-memory — long-term memory system for DeepSeek Harness.
 *
 * Two-phase pipeline adapted from Codex memories onto DSH primitives:
 * Phase 1 extracts durable memories from root session logs (sessionQuery /
 * sessionPersistence), Phase 2 consolidates them into MEMORY.md and
 * memory_summary.md. The summary is injected through systemPrompt, and four
 * memory tools serve on-demand retrieval. Bookkeeping (claims, cooldown,
 * pending flag, overrides) persists through the storage hub KV backend.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Config as ConfigShape } from './config.js';
export declare const name = "dsh-memory";
export declare const inject: string[];
export { Config, DEFAULTS, clampOverrides, OVERRIDABLE_KEYS, resolveConfig } from './config.js';
export type { Config as MemoryConfig, OverridableKey } from './config.js';
export { MemoryStateStore, type KvFacilityLike, type KvUnitLike } from './bookkeeping.js';
export { MemoryFiles, ensureSummaryV1 } from './files.js';
export { buildMemoryGraph, parseTopics, pathOfNode, tokenize } from './graph.js';
export type { GraphEdge, GraphNode, GraphNodeKind, GraphOptions, MemoryGraphPayload } from './graph.js';
export { MemoryInjection, buildSectionText, GUIDE_ORDER, type SystemPromptRuntime } from './inject.js';
export { collectResponse, collectText, collectTextDetails, effortLabel, EXTRACTION_KEYS, extractJsonObject, generateOptions, LlmCallError, parseCallArguments, parseCallArgumentsDetailed, parseFencedBlocks, parseObjectLoose, parseSections, pickBlock, repairJson, resolveReasoningEffort, resolveRoute, salvageFields, stripFences, unescapeJsonString, } from './llm.js';
export type { CollectedCall, CollectedResponse, CollectedText, LlmDirectoryRuntime, LlmRuntime, ModelRoute, ParsedObject, ParsedSections, } from './llm.js';
export { defaultMemoryRoot, isWithin, resolveMemoryRoot, sanitizeSlug } from './paths.js';
export { Phase1Runner, type Phase1Deps, type Phase1Summary } from './phase1.js';
export { Phase2Runner, type Phase2Deps, type Phase2Outcome } from './phase2.js';
export { PHASE1_SYSTEM, PHASE1_TOOL, PHASE2_SYSTEM, PHASE2_TOOL, phase1User, phase2User } from './prompts.js';
export type { Phase1InputMeta, Phase2Input } from './prompts.js';
export { redactSecrets, renderEvent, renderTranscript, selectCandidates } from './rollout.js';
export type { SelectionOptions, SelectionResult, TranscriptOptions } from './rollout.js';
export { registerRpc, type RpcDeps, type StatePayload, type WebServerRuntime } from './rpc.js';
export { registerMemoryTools, type ToolRegistryRuntime } from './tools.js';
export type { FileEntry, MemoryState, SessionClaim, SessionHeaderLite, SessionLogLite, SessionReader } from './types.js';
export { headTail, messageOf } from './util.js';
export declare function apply(ctx: Context, config?: Partial<ConfigShape>): void;
//# sourceMappingURL=index.d.ts.map
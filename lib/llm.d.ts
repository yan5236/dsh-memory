/** LLM call helpers: streaming text collection, JSON/fence parsing, route resolution. */
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm';
import type { Config } from './config.js';
export interface LlmRuntime {
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}
/**
 * The llm surface the plugin actually uses: stream plus the optional directory
 * metadata methods (present on the registered dsh-llm service). The directory
 * is optional so tests and degraded hosts still work with a bare stream.
 */
export interface LlmDirectoryRuntime extends LlmRuntime {
    listProviders?: () => Array<{
        id: string;
        name?: string;
    }>;
    listModels?: (provider: string) => Promise<Array<{
        id: string;
        name?: string;
    }>>;
    resolveModelInfo?: (provider: string, model: string, signal?: AbortSignal) => Promise<LlmResolvedModelInfo>;
}
export interface ModelRoute {
    provider: string;
    model: string;
}
export declare class LlmCallError extends Error {
    readonly kind: 'error' | 'aborted' | 'max-tokens' | 'empty' | 'oversize' | 'tool-calls' | 'invalid-json';
    constructor(kind: 'error' | 'aborted' | 'max-tokens' | 'empty' | 'oversize' | 'tool-calls' | 'invalid-json', message: string);
}
export interface CollectedText {
    text: string;
    /** True when the finish reason was max-tokens: the response may be truncated. */
    truncated: boolean;
}
/** One tool call produced by the model, with raw JSON arguments. */
export interface CollectedCall {
    name: string;
    arguments: string;
}
export interface CollectedResponse extends CollectedText {
    /** Tool calls produced by the model (tool-call blocks plus deltas). */
    calls: CollectedCall[];
}
/**
 * Collect a full streaming response: text plus tool calls.
 * Truncation (max-tokens) is reported rather than thrown.
 */
export declare function collectResponse(runtime: LlmRuntime, options: GenerateOptions, maxChars?: number): Promise<CollectedResponse>;
/** Collect a full text response; reports max-tokens truncation instead of throwing. */
export declare function collectTextDetails(runtime: LlmRuntime, options: GenerateOptions, maxChars?: number): Promise<CollectedText>;
/** Collect a full text response, failing on any abnormal finish including truncation. */
export declare function collectText(runtime: LlmRuntime, options: GenerateOptions, maxChars?: number): Promise<string>;
/** Field names the Phase 1 extractor fills; also the anchors of the salvage parser. */
export declare const EXTRACTION_KEYS: readonly ["raw_memory", "rollout_summary", "rollout_slug"];
/** Which stage of the tolerant parse chain accepted a payload. */
export type ParseStrategy = 'strict' | 'repair' | 'salvage';
export interface ParsedObject {
    value: Record<string, unknown>;
    strategy: ParseStrategy;
}
/**
 * Repair a structurally broken JSON object emitted by a model: escape raw
 * control characters and stray quotes inside strings, drop trailing commas,
 * drop a dangling `"key":` tail, and close unterminated structures.
 * Throws `invalid-json` when the text cannot be made parseable.
 */
export declare function repairJson(text: string): string;
/** Undo JSON string escapes (`\n`, `\"`, `\uXXXX`, …) for a salvaged fragment. */
export declare function unescapeJsonString(value: string): string;
/**
 * Last-resort recovery: slice the payload at known key anchors and unescape
 * each fragment, so one broken region does not lose the other fields.
 * Throws `invalid-json` when no anchor is present.
 */
export declare function salvageFields(text: string, keys?: readonly string[]): Record<string, unknown>;
/**
 * Tolerant object parse: strict `JSON.parse` → `repairJson` → `salvageFields`.
 * Only throws `invalid-json` when every stage fails.
 */
export declare function parseObjectLoose(text: string, label?: string, keys?: readonly string[]): ParsedObject;
/** Parse the raw JSON arguments of one collected tool call (tolerant chain). */
export declare function parseCallArguments(call: CollectedCall | undefined): Record<string, unknown>;
/** Like `parseCallArguments` but also reports which stage accepted the payload. */
export declare function parseCallArgumentsDetailed(call: CollectedCall | undefined): ParsedObject;
/** Strip a ```json fence when present. */
export declare function stripFences(text: string): string;
/** Extract the first balanced top-level JSON object from model output. */
export declare function extractJsonObject(text: string): Record<string, unknown>;
/** Parse labeled fenced blocks into a label → body map. */
export declare function parseFencedBlocks(text: string): Map<string, string>;
/** Pick the block whose label matches one of the given names. */
export declare function pickBlock(blocks: ReadonlyMap<string, string>, labels: readonly string[]): string | undefined;
/** Sections of the pure-text Phase 1 contract. */
export interface ParsedSections {
    rolloutSlug: string;
    rolloutSummary: string;
    rawMemory: string;
    /** Number of distinct sections found (0 = the text is not section-shaped). */
    matched: number;
}
/**
 * Lenient reader for the plain-text Phase 1 output: accepts
 * `===ROLLOUT_SLUG===` style section markers (with an optional inline value on
 * the marker line) and ```` ```rollout_summary ```` labeled fences.
 */
export declare function parseSections(text: string): ParsedSections;
/** Resolve the pipeline's model route: explicit config first, then the deployment default. */
export declare function resolveRoute(config: Config, defaultSelection: unknown): ModelRoute | undefined;
/**
 * Validate one configured reasoning effort against the adapter-owned metadata
 * for the exact route. Returns the effort id only when the model actually
 * supports it; unknown/unsupported values degrade to the provider default
 * instead of failing the call (DSH rejects unsupported efforts before I/O).
 */
export declare function resolveReasoningEffort(llm: LlmDirectoryRuntime | undefined, route: ModelRoute, configured: string): Promise<string | undefined>;
/** Human/run-log label for the effort actually applied. */
export declare function effortLabel(effort: string | undefined): string;
/** Build a plugin-owned GenerateOptions for one pipeline call. */
export declare function generateOptions(route: ModelRoute, system: string, userText: string, maxTokens: number, signal?: AbortSignal, tools?: ReadonlyArray<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}>, reasoningEffort?: string): GenerateOptions;
//# sourceMappingURL=llm.d.ts.map
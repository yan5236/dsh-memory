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
/** Parse the raw JSON arguments of one collected tool call. */
export declare function parseCallArguments(call: CollectedCall | undefined): Record<string, unknown>;
/** Strip a ```json fence when present. */
export declare function stripFences(text: string): string;
/** Extract the first balanced top-level JSON object from model output. */
export declare function extractJsonObject(text: string): Record<string, unknown>;
/** Parse labeled fenced blocks into a label → body map. */
export declare function parseFencedBlocks(text: string): Map<string, string>;
/** Pick the block whose label matches one of the given names. */
export declare function pickBlock(blocks: ReadonlyMap<string, string>, labels: readonly string[]): string | undefined;
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
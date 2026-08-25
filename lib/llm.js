/** LLM call helpers: streaming text collection, JSON/fence parsing, route resolution. */
import { randomUUID } from 'node:crypto';
export class LlmCallError extends Error {
    kind;
    constructor(kind, message) {
        super(message);
        this.kind = kind;
        this.name = 'LlmCallError';
    }
}
/**
 * Collect a full streaming response: text plus tool calls.
 * Truncation (max-tokens) is reported rather than thrown.
 */
export async function collectResponse(runtime, options, maxChars = 400_000) {
    const textByIndex = new Map();
    const callByName = new Map();
    const callIndex = new Map();
    let finish;
    let size = 0;
    const accumulate = (amount) => {
        size += amount;
        if (size > maxChars)
            throw new LlmCallError('oversize', `model response exceeded ${maxChars} characters`);
    };
    for await (const chunk of runtime.stream(options)) {
        if (chunk.type === 'text-delta') {
            textByIndex.set(chunk.index, (textByIndex.get(chunk.index) ?? '') + chunk.text);
            accumulate(chunk.text.length);
        }
        else if (chunk.type === 'tool-call-delta') {
            const name = chunk.name ?? callIndex.get(chunk.index);
            if (name !== undefined)
                callIndex.set(chunk.index, name);
            const existing = name === undefined ? undefined : callByName.get(name);
            if (existing !== undefined) {
                existing.arguments += chunk.argumentsDelta;
            }
            else if (name !== undefined) {
                callByName.set(name, { name, arguments: chunk.argumentsDelta });
            }
            accumulate(chunk.argumentsDelta.length);
        }
        else if (chunk.type === 'block-end') {
            if (chunk.block.type === 'text') {
                textByIndex.set(chunk.index, chunk.block.text);
                size = [...textByIndex.values()].reduce((total, text) => total + text.length, 0);
                if (size > maxChars)
                    throw new LlmCallError('oversize', `model response exceeded ${maxChars} characters`);
            }
            else if (chunk.block.type === 'tool-call') {
                callByName.set(chunk.block.name, { name: chunk.block.name, arguments: chunk.block.arguments });
            }
        }
        else if (chunk.type === 'finish') {
            finish = chunk.reason;
        }
    }
    if (finish === undefined)
        throw new LlmCallError('empty', 'model response has no finish reason');
    if (finish.kind === 'error' || finish.kind === 'aborted')
        throw new LlmCallError(finish.kind, finish.failure.message);
    const text = [...textByIndex.entries()].sort(([left], [right]) => left - right).map(([, value]) => value).join('');
    return { text, calls: [...callByName.values()], truncated: finish.kind === 'max-tokens' };
}
/** Collect a full text response; reports max-tokens truncation instead of throwing. */
export async function collectTextDetails(runtime, options, maxChars = 400_000) {
    const { text, truncated } = await collectResponse(runtime, options, maxChars);
    return { text, truncated };
}
/** Collect a full text response, failing on any abnormal finish including truncation. */
export async function collectText(runtime, options, maxChars = 400_000) {
    const { text, truncated } = await collectTextDetails(runtime, options, maxChars);
    if (truncated)
        throw new LlmCallError('max-tokens', 'model response reached its output limit');
    return text;
}
/** Parse the raw JSON arguments of one collected tool call. */
export function parseCallArguments(call) {
    if (call === undefined || call.arguments.trim() === '')
        throw new LlmCallError('invalid-json', 'tool call has empty arguments');
    let parsed;
    try {
        parsed = JSON.parse(call.arguments);
    }
    catch {
        throw new LlmCallError('invalid-json', `tool call "${call.name}" arguments are not valid JSON`);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new LlmCallError('invalid-json', `tool call "${call.name}" arguments are not a JSON object`);
    }
    return parsed;
}
/** Strip a ```json fence when present. */
export function stripFences(text) {
    const trimmed = text.trim();
    const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
    return fenced?.[1]?.trim() ?? trimmed;
}
/** Extract the first balanced top-level JSON object from model output. */
export function extractJsonObject(text) {
    const cleaned = stripFences(text).trim();
    const start = cleaned.indexOf('{');
    if (start < 0)
        throw new LlmCallError('invalid-json', 'model output contains no JSON object');
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < cleaned.length; i += 1) {
        const char = cleaned[i];
        if (inString) {
            if (escaped)
                escaped = false;
            else if (char === '\\')
                escaped = true;
            else if (char === '"')
                inString = false;
            continue;
        }
        if (char === '"')
            inString = true;
        else if (char === '{')
            depth += 1;
        else if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                const parsed = JSON.parse(cleaned.slice(start, i + 1));
                if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                    throw new LlmCallError('invalid-json', 'JSON root is not an object');
                }
                return parsed;
            }
        }
    }
    throw new LlmCallError('invalid-json', 'unbalanced JSON in model output');
}
/** Parse labeled fenced blocks into a label → body map. */
export function parseFencedBlocks(text) {
    const blocks = new Map();
    const pattern = /```([^\n`]*)\n([\s\S]*?)```/g;
    let match;
    while ((match = pattern.exec(text)) !== null) {
        const label = (match[1] ?? '').trim().toLowerCase();
        const body = (match[2] ?? '').trim();
        if (body === '')
            continue;
        blocks.set(label === '' ? `unnamed-${blocks.size}` : label, body);
    }
    return blocks;
}
/** Pick the block whose label matches one of the given names. */
export function pickBlock(blocks, labels) {
    for (const label of labels) {
        const body = blocks.get(label);
        if (body !== undefined)
            return body;
    }
    return undefined;
}
/** Resolve the pipeline's model route: explicit config first, then the deployment default. */
export function resolveRoute(config, defaultSelection) {
    if (config.provider.trim() !== '' && config.model.trim() !== '') {
        return { provider: config.provider, model: config.model };
    }
    const selection = defaultSelection;
    if (typeof selection?.provider === 'string' && selection.provider !== ''
        && typeof selection.model === 'string' && selection.model !== '') {
        return { provider: selection.provider, model: selection.model };
    }
    return undefined;
}
/**
 * Validate one configured reasoning effort against the adapter-owned metadata
 * for the exact route. Returns the effort id only when the model actually
 * supports it; unknown/unsupported values degrade to the provider default
 * instead of failing the call (DSH rejects unsupported efforts before I/O).
 */
export async function resolveReasoningEffort(llm, route, configured) {
    const wanted = configured.trim();
    if (wanted === '' || llm === undefined)
        return undefined;
    try {
        const info = await llm.resolveModelInfo?.(route.provider, route.model);
        const efforts = info?.reasoning?.efforts ?? [];
        if (efforts.some(effort => effort.id === wanted))
            return wanted;
    }
    catch {
        // Metadata failures (unknown route, dead adapter) degrade to the default.
    }
    return undefined;
}
/** Human/run-log label for the effort actually applied. */
export function effortLabel(effort) {
    return effort === undefined || effort.trim() === '' ? 'default' : effort;
}
/** Build a plugin-owned GenerateOptions for one pipeline call. */
export function generateOptions(route, system, userText, maxTokens, signal, tools, reasoningEffort) {
    const effort = reasoningEffort?.trim();
    return {
        provider: route.provider,
        model: route.model,
        ...(effort === undefined || effort === '' ? {} : { reasoningEffort: effort }),
        system,
        temperature: 0,
        maxTokens,
        ...(signal === undefined ? {} : { signal }),
        ...(tools === undefined ? {} : { tools: tools.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters })) }),
        messages: [{
                id: `dsh-memory-${randomUUID()}`,
                role: 'user',
                source: { kind: 'plugin', plugin: '@nanmicoder/dsh-memory' },
                content: [{ type: 'text', text: userText }],
            }],
    };
}
//# sourceMappingURL=llm.js.map
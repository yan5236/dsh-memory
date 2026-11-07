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
/**
 * Provider/transport failures worth retrying later: they say nothing about the
 * session being extracted, so they must never consume a session's retry budget.
 */
const TRANSIENT_PATTERNS = [
    /stream ended before/i,
    /internal server error/i,
    /\b(?:429|500|502|503|504)\b/,
    /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|EPIPE|socket hang up|network error/i,
    /\baborted\b|\btimeout\b|timed out/i,
    /overloaded|temporarily unavailable|service unavailable|try again later|rate limit/i,
];
/** Whether an error is an environment/provider blip rather than bad content. */
export function isTransientError(error) {
    if (error instanceof LlmCallError && (error.kind === 'aborted'))
        return true;
    const message = error instanceof Error ? error.message : String(error);
    return TRANSIENT_PATTERNS.some(pattern => pattern.test(message));
}
/**
 * Collect a response under a hard wall-clock deadline. A provider that stalls
 * mid-stream would otherwise wedge the whole pipeline, so the deadline aborts
 * the request and reports a transient failure.
 */
export async function collectResponseWithDeadline(runtime, options, timeoutMs, maxChars = 400_000) {
    const controller = new AbortController();
    let expired = false;
    const timer = setTimeout(() => {
        expired = true;
        controller.abort();
    }, timeoutMs);
    try {
        return await collectResponse(runtime, { ...options, signal: controller.signal }, maxChars);
    }
    catch (error) {
        if (expired)
            throw new LlmCallError('aborted', `model call exceeded ${Math.round(timeoutMs / 1000)}s`);
        throw error;
    }
    finally {
        clearTimeout(timer);
    }
}
/** Field names the Phase 1 extractor fills; also the anchors of the salvage parser. */
export const EXTRACTION_KEYS = ['raw_memory', 'rollout_summary', 'rollout_slug'];
function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/**
 * Repair a structurally broken JSON object emitted by a model: escape raw
 * control characters and stray quotes inside strings, drop trailing commas,
 * drop a dangling `"key":` tail, and close unterminated structures.
 * Throws `invalid-json` when the text cannot be made parseable.
 */
export function repairJson(text) {
    const source = stripFences(text).trim();
    const start = source.indexOf('{');
    if (start < 0)
        throw new LlmCallError('invalid-json', 'model output contains no JSON object');
    const out = [];
    const closers = [];
    let inString = false;
    for (let index = start; index < source.length; index += 1) {
        const char = source[index];
        if (inString) {
            if (char === '\\') {
                const next = source[index + 1];
                if (next === undefined)
                    break;
                out.push(char, next);
                index += 1;
                continue;
            }
            if (char === '"') {
                // A closing quote must be followed by a structural character; anything
                // else is a literal quote the model forgot to escape.
                const rest = source.slice(index + 1);
                const structural = /^\s*[,:}\]]/.test(rest) || /^\s*$/.test(rest);
                if (structural) {
                    inString = false;
                    out.push('"');
                }
                else {
                    out.push('\\"');
                }
                continue;
            }
            if (char === '\n') {
                out.push('\\n');
                continue;
            }
            if (char === '\r') {
                out.push('\\r');
                continue;
            }
            if (char === '\t') {
                out.push('\\t');
                continue;
            }
            const code = char.codePointAt(0) ?? 0;
            if (code < 0x20) {
                out.push(`\\u${code.toString(16).padStart(4, '0')}`);
                continue;
            }
            out.push(char);
            continue;
        }
        if (char === '"') {
            inString = true;
            out.push('"');
            continue;
        }
        if (char === ',') {
            if (/^\s*[}\]]/.test(source.slice(index + 1)))
                continue;
            out.push(',');
            continue;
        }
        if (char === '{') {
            closers.push('}');
            out.push('{');
            continue;
        }
        if (char === '[') {
            closers.push(']');
            out.push('[');
            continue;
        }
        if (char === '}' || char === ']') {
            const expected = closers.pop();
            if (expected === undefined)
                continue;
            out.push(expected);
            if (closers.length === 0)
                break;
            continue;
        }
        out.push(char);
    }
    if (inString)
        out.push('"');
    let body = out.join('').trimEnd().replace(/[\s,]+$/, '');
    // A dangling key with no value (`{"a":1,"b":`) makes the appended closers invalid.
    body = body.replace(/"(?:[^"\\]|\\.)*"\s*:\s*$/, '').replace(/[\s,]+$/, '');
    const repaired = `${body}${closers.reverse().join('')}`;
    try {
        const parsed = JSON.parse(repaired);
        if (!isPlainObject(parsed))
            throw new LlmCallError('invalid-json', 'JSON root is not an object');
    }
    catch (error) {
        if (error instanceof LlmCallError)
            throw error;
        throw new LlmCallError('invalid-json', `model output could not be repaired: ${String(error).slice(0, 120)}`);
    }
    return repaired;
}
/** Undo JSON string escapes (`\n`, `\"`, `\uXXXX`, …) for a salvaged fragment. */
export function unescapeJsonString(value) {
    let out = '';
    for (let index = 0; index < value.length; index += 1) {
        const char = value[index];
        if (char !== '\\') {
            out += char;
            continue;
        }
        const next = value[index + 1];
        if (next === undefined) {
            out += char;
            continue;
        }
        index += 1;
        if (next === 'u') {
            const hex = value.slice(index + 1, index + 5);
            if (/^[0-9a-fA-F]{4}$/.test(hex)) {
                out += String.fromCharCode(Number.parseInt(hex, 16));
                index += 4;
            }
            else {
                out += next;
            }
            continue;
        }
        switch (next) {
            case 'n':
                out += '\n';
                break;
            case 'r':
                out += '\r';
                break;
            case 't':
                out += '\t';
                break;
            case 'b':
                out += '\b';
                break;
            case 'f':
                out += '\f';
                break;
            case '"':
                out += '"';
                break;
            case '\\':
                out += '\\';
                break;
            case '/':
                out += '/';
                break;
            default: out += next;
        }
    }
    return out;
}
function trimSalvageTail(chunk) {
    return chunk
        .replace(/[\s,]+$/, '')
        .replace(/[}\]]+$/, '')
        .replace(/[",\s]+$/, '');
}
/**
 * Last-resort recovery: slice the payload at known key anchors and unescape
 * each fragment, so one broken region does not lose the other fields.
 * Throws `invalid-json` when no anchor is present.
 */
export function salvageFields(text, keys = EXTRACTION_KEYS) {
    const source = stripFences(text);
    const anchors = [];
    for (const key of keys) {
        const pattern = new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*"?`, 'g');
        let match;
        while ((match = pattern.exec(source)) !== null) {
            anchors.push({ key, start: match.index, valueStart: match.index + match[0].length });
        }
    }
    if (anchors.length === 0)
        throw new LlmCallError('invalid-json', 'model output contains no salvageable fields');
    anchors.sort((left, right) => left.start - right.start);
    const salvaged = {};
    for (const [index, anchor] of anchors.entries()) {
        if (salvaged[anchor.key] !== undefined)
            continue;
        const next = anchors.slice(index + 1).find(candidate => candidate.start >= anchor.valueStart);
        const end = next === undefined ? source.length : next.start;
        salvaged[anchor.key] = unescapeJsonString(trimSalvageTail(source.slice(anchor.valueStart, end)));
    }
    return salvaged;
}
/**
 * Tolerant object parse: strict `JSON.parse` → `repairJson` → `salvageFields`.
 * Only throws `invalid-json` when every stage fails.
 */
export function parseObjectLoose(text, label = 'model output', keys = EXTRACTION_KEYS) {
    const trimmed = text.trim();
    if (trimmed !== '') {
        try {
            const parsed = JSON.parse(trimmed);
            if (isPlainObject(parsed))
                return { value: parsed, strategy: 'strict' };
        }
        catch {
            // Fall through to the repair stage.
        }
        try {
            const repaired = JSON.parse(repairJson(trimmed));
            if (isPlainObject(repaired))
                return { value: repaired, strategy: 'repair' };
        }
        catch {
            // Fall through to the salvage stage.
        }
    }
    try {
        return { value: salvageFields(trimmed === '' ? text : trimmed, keys), strategy: 'salvage' };
    }
    catch {
        throw new LlmCallError('invalid-json', `${label} are not valid JSON`);
    }
}
/** Parse the raw JSON arguments of one collected tool call (tolerant chain). */
export function parseCallArguments(call) {
    return parseCallArgumentsDetailed(call).value;
}
/** Like `parseCallArguments` but also reports which stage accepted the payload. */
export function parseCallArgumentsDetailed(call) {
    if (call === undefined || call.arguments.trim() === '')
        throw new LlmCallError('invalid-json', 'tool call has empty arguments');
    return parseObjectLoose(call.arguments, `tool call "${call.name}" arguments`);
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
const SECTION_KEYS = {
    rollout_slug: 'rolloutSlug',
    'rollout-slug': 'rolloutSlug',
    rolloutslug: 'rolloutSlug',
    slug: 'rolloutSlug',
    rollout_summary: 'rolloutSummary',
    'rollout-summary': 'rolloutSummary',
    rolloutsummary: 'rolloutSummary',
    raw_memory: 'rawMemory',
    'raw-memory': 'rawMemory',
    rawmemory: 'rawMemory',
};
/**
 * Lenient reader for the plain-text Phase 1 output: accepts
 * `===ROLLOUT_SLUG===` style section markers (with an optional inline value on
 * the marker line) and ```` ```rollout_summary ```` labeled fences.
 */
export function parseSections(text) {
    const source = text.replace(/\r\n/g, '\n');
    const result = { rolloutSlug: '', rolloutSummary: '', rawMemory: '', matched: 0 };
    const found = [];
    const pattern = /^[ \t]*={2,}[ \t]*([A-Za-z0-9_-]+)[ \t]*={2,}[ \t]*(.*)$/gm;
    let match;
    while ((match = pattern.exec(source)) !== null) {
        const key = SECTION_KEYS[(match[1] ?? '').trim().toLowerCase()];
        if (key === undefined)
            continue;
        found.push({
            key,
            inline: (match[2] ?? '').trim(),
            markerStart: match.index,
            bodyStart: match.index + match[0].length,
        });
    }
    const seen = new Set();
    for (const [index, section] of found.entries()) {
        if (seen.has(section.key))
            continue;
        seen.add(section.key);
        const next = found[index + 1];
        const rawBody = source.slice(section.bodyStart, next === undefined ? source.length : next.markerStart).trim();
        // The whole answer may be wrapped in one markdown fence: drop that fence.
        const trimmedBody = rawBody.replace(/\n?```\s*$/, '').trim();
        const body = trimmedBody.startsWith('```') ? stripFences(trimmedBody) : trimmedBody;
        result[section.key] = (section.inline === '' ? body : `${section.inline}\n${body}`).trim();
    }
    // Fenced-label compatibility: ```rollout_summary … ```
    const blocks = parseFencedBlocks(source);
    const fill = (key, labels) => {
        if (seen.has(key))
            return;
        const body = pickBlock(blocks, labels);
        if (body === undefined)
            return;
        seen.add(key);
        result[key] = body;
    };
    fill('rolloutSummary', ['rollout_summary', 'rollout-summary', 'rolloutsummary']);
    fill('rawMemory', ['raw_memory', 'raw-memory', 'rawmemory']);
    fill('rolloutSlug', ['rollout_slug', 'rollout-slug', 'rolloutslug']);
    result.matched = seen.size;
    return result;
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
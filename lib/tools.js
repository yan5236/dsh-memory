/** Read-path tools: memory_list / memory_read / memory_search / memory_add. */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { sanitizeSlug } from './paths.js';
const MAX_READ_CHARS = 300_000;
const MAX_SEARCH_FILES = 80;
const MAX_SEARCH_FILE_BYTES = 2_000_000;
function sizeLabel(bytes) {
    if (bytes < 1_024)
        return `${bytes} B`;
    if (bytes < 1_024 * 1_024)
        return `${(bytes / 1_024).toFixed(1)} KB`;
    return `${(bytes / 1_024 / 1_024).toFixed(1)} MB`;
}
function timestampLabel(ms) {
    if (ms <= 0)
        return '-';
    return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}
/** Register the four memory tools; returns a disposer that unregisters all of them. */
export function registerMemoryTools(registry, files, state) {
    const list = defineTool({
        name: 'memory_list',
        description: '列出长期记忆库的文件与目录（分页上限内）。用于浏览记忆库结构，配合 memory_read / memory_search 使用。参数 path 缺省为记忆库根目录。',
        parameters: {
            path: { type: 'string', description: '记忆库内的相对子目录，默认根目录' },
            maxResults: { type: 'number', description: '返回条目上限，默认 200' },
        },
        output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: String(value) }],
        },
        async execute(args) {
            const entries = await files.listTree(typeof args.path === 'string' ? args.path : '');
            const max = typeof args.maxResults === 'number' ? Math.max(1, Math.min(500, Math.floor(args.maxResults))) : 200;
            if (entries.length === 0)
                return `记忆库（${files.root}）为空。`;
            const lines = entries.slice(0, max).map(entry => entry.kind === 'dir'
                ? `d  ${entry.path}/`
                : `f  ${entry.path}  ${sizeLabel(entry.size)}  ${timestampLabel(entry.modifiedAt)}`);
            if (entries.length > max)
                lines.push(`…（共 ${entries.length} 项，已截断；可用 path 参数缩小范围）`);
            return [`记忆库: ${files.root}`, ...lines].join('\n');
        },
    });
    const read = defineTool({
        name: 'memory_read',
        description: '读取长期记忆库中的一个文件（限制在记忆库目录内）。用于查看 MEMORY.md、rollout_summaries/ 下的会话回顾、skills/ 流程或 memory_summary.md 全文。',
        parameters: {
            path: { type: 'string', required: true, description: '相对记忆库根目录的文件路径，如 MEMORY.md 或 rollout_summaries/<slug>.md' },
        },
        output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: String(value) }],
        },
        async execute(args) {
            const content = await files.readIfExists(args.path, MAX_READ_CHARS);
            if (content === undefined)
                return `记忆库中不存在该文件：${args.path}（可用 memory_list 查看现有文件）`;
            // Read-path usage: a successful read counts as "this memory was used".
            state.recordUsage(args.path, Date.now());
            if (content.length >= MAX_READ_CHARS) {
                return `${content}\n…（文件过大已截断至 ${MAX_READ_CHARS} 字符）`;
            }
            return content;
        },
    });
    const search = defineTool({
        name: 'memory_search',
        description: '在长期记忆库的 Markdown 文件里按关键词逐行搜索（大小写不敏感），返回命中行及其所在文件。用于快速定位 MEMORY.md、memory_summary.md 与历史会话回顾中的相关内容。',
        parameters: {
            query: { type: 'string', required: true, description: '搜索关键词（子串匹配，大小写不敏感）' },
            maxResults: { type: 'number', description: '返回命中上限，默认 15' },
        },
        output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: String(value) }],
        },
        async execute(args) {
            const query = args.query.toLowerCase();
            if (query === '')
                return 'query 不能为空';
            const max = typeof args.maxResults === 'number' ? Math.max(1, Math.min(100, Math.floor(args.maxResults))) : 15;
            const entries = await files.listTree();
            const filesToScan = entries.filter(entry => entry.kind === 'file' && entry.path.endsWith('.md') && entry.size <= MAX_SEARCH_FILE_BYTES);
            const hits = [];
            // Read-path usage: files the search actually surfaced count as used (deduped).
            const used = new Set();
            outer: for (const entry of filesToScan.slice(0, MAX_SEARCH_FILES)) {
                const content = await files.readIfExists(entry.path, MAX_SEARCH_FILE_BYTES);
                if (content === undefined)
                    continue;
                const lines = content.split(/\r?\n/);
                for (let index = 0; index < lines.length; index += 1) {
                    const line = lines[index] ?? '';
                    if (!line.toLowerCase().includes(query))
                        continue;
                    used.add(entry.path);
                    hits.push(`${entry.path}:${index + 1}  ${line.trim().slice(0, 200)}`);
                    if (hits.length >= max)
                        break outer;
                }
            }
            const now = Date.now();
            for (const path of used)
                state.recordUsage(path, now);
            if (hits.length === 0)
                return `在记忆库中未找到与 "${args.query}" 匹配的内容。`;
            return hits.join('\n');
        },
    });
    const add = defineTool({
        name: 'memory_add',
        description: '在用户明确要求更新长期记忆时，写入一条 ad hoc 记忆笔记（保存到记忆库 extensions/ad_hoc/notes/，将在下次整合时并入 MEMORY.md）。仅在用户直接要求记忆/记住某件事时调用。',
        parameters: {
            note: { type: 'string', required: true, description: '要记住的内容（Markdown 文本）' },
            slug: { type: 'string', description: '可选短名（小写字母数字与连字符），用于文件名' },
        },
        output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: String(value) }],
        },
        async execute(args) {
            if (args.note.trim() === '')
                return 'note 不能为空';
            const stamp = new Date();
            const date = stamp.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
            const slug = sanitizeSlug(typeof args.slug === 'string' ? args.slug : '', `note-${date}`);
            const rel = `extensions/ad_hoc/notes/${date}-${slug}.md`;
            const content = `<!-- ad-hoc note: created_at=${stamp.toISOString()} source=user-request -->\n\n${args.note.trimEnd()}\n`;
            await files.writeAtomic(rel, content);
            state.setPendingConsolidation(true);
            return `已记录到 ${rel}。该笔记将在下一次记忆整合时并入 MEMORY.md / memory_summary.md。`;
        },
    });
    const disposers = [
        registry.register(list),
        registry.register(read),
        registry.register(search),
        registry.register(add),
    ];
    return () => disposers.forEach(dispose => dispose());
}
//# sourceMappingURL=tools.js.map
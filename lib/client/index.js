/** Web settings page for the long-term memory plugin. */
import * as React from 'react';
const CSS = [
    '.dm-section{box-sizing:border-box;max-width:760px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:12px;display:flex}',
    '.dm-title{color:var(--dsw-alias-label-primary);margin:0;font-size:16px;font-weight:500;line-height:24px}',
    '.dm-intro{color:var(--dsw-alias-label-tertiary);margin:0;font-size:14px;line-height:22px}',
    '.dm-dimmed{color:var(--dsw-alias-label-dimmed);margin:0;font-size:12px;line-height:18px}',
    '.dm-error{color:var(--dsw-alias-state-error-primary);margin:0;font-size:12px;line-height:18px}',
    '.dm-ok{color:var(--dsw-alias-state-success-primary);margin:0;font-size:12px;line-height:18px}',
    '.dm-warn{color:var(--dsw-alias-state-warn-label);margin:0;font-size:12px;line-height:18px}',
    '.dm-card{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;flex-direction:column;gap:10px;padding:12px 14px;display:flex}',
    '.dm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}',
    '.dm-stat{flex-direction:column;gap:2px;display:flex}',
    '.dm-stat b{font-size:14px;line-height:20px;font-weight:600}',
    '.dm-stat span{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}',
    '.dm-row{align-items:center;gap:10px;display:flex;flex-wrap:wrap}',
    '.dm-field{flex-direction:column;gap:4px;display:flex}',
    '.dm-label{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;line-height:18px}',
    '.dm-input{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);height:32px;font:inherit;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 10px;font-size:14px;line-height:22px;width:100%}',
    '.dm-input.num{max-width:140px}',
    '.dm-input:focus{border-color:var(--dsw-alias-brand-primary);outline:none}',
    '.dm-input:disabled{opacity:.6}',
    'select.dm-input{cursor:pointer}',
    '.dm-check{align-items:center;gap:8px;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px;display:flex;cursor:pointer}',
    '.dm-check input{accent-color:var(--dsw-alias-brand-primary);margin:0}',
    '.dm-btn{box-sizing:border-box;height:34px;font:inherit;cursor:pointer;border:none;border-radius:17px;justify-content:center;align-items:center;gap:4px;padding:0 14px;font-size:14px;line-height:22px;display:inline-flex}',
    '.dm-btn.primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}',
    '.dm-btn.primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-fill-hover)}',
    '.dm-btn.secondary{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);background:transparent}',
    '.dm-btn.secondary:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
    '.dm-btn:disabled{opacity:.5;cursor:default}',
    '.dm-fail{border-left:2px solid var(--dsw-alias-state-warn-primary);flex-direction:column;gap:2px;padding-left:10px;display:flex}',
    '.dm-logline{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 10px;gap:6px;flex-direction:column;display:flex}',
    '.dm-pre{box-sizing:border-box;max-height:320px;overflow:auto;margin:0;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px 10px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-all;background:var(--dsw-alias-bg-layer-1)}',
    '.dm-tree{max-height:220px;overflow-y:auto;flex-direction:column;gap:2px;display:flex}',
].join('');
const rpc = async (method, args = {}) => {
    const response = await fetch('/dsh-memory/rpc', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method, args }),
    });
    return response.json();
};
function fmtTime(ms) {
    if (ms <= 0)
        return '—';
    return new Date(ms).toLocaleString();
}
function fmtChars(n) {
    if (n < 1_024)
        return `${n} 字符`;
    if (n < 1_024 * 1_024)
        return `${(n / 1_024).toFixed(1)} K`;
    return `${(n / 1_024 / 1_024).toFixed(1)} M`;
}
function shortId(id) {
    return id.length > 16 ? `${id.slice(0, 13)}…` : id;
}
function MemorySettings() {
    const el = React.createElement;
    const [payload, setPayload] = React.useState(null);
    const [form, setForm] = React.useState(null);
    const [busy, setBusy] = React.useState(false);
    const [notice, setNotice] = React.useState(null);
    const [logs, setLogs] = React.useState(null);
    const [logDetail, setLogDetail] = React.useState(null);
    const [tree, setTree] = React.useState(null);
    const [fileDetail, setFileDetail] = React.useState(null);
    const applyState = (state) => {
        setPayload(state);
        const cfg = state.config;
        setForm(prev => ({
            enabled: state.enabled === true,
            idleDebounceMinutes: Math.round(Number(cfg.idleDebounceMs ?? 180000) / 60_000),
            cooldownHours: Math.round(Number(cfg.consolidationCooldownMs ?? 21600000) / 3_600_000),
            maxRolloutsPerRun: Number(cfg.maxRolloutsPerRun ?? 3),
            maxSummaryChars: Number(cfg.maxSummaryChars ?? 8000),
            provider: String(cfg.provider ?? ''),
            model: String(cfg.model ?? ''),
            phase2MaxTokens: Number(cfg.phase2MaxTokens ?? 12000),
            maxUnusedDays: Number(cfg.maxUnusedDays ?? 30),
            manualModel: prev?.manualModel === true,
        }));
    };
    const refresh = React.useCallback(async () => {
        const result = await rpc('get-state');
        applyState(result);
    }, []);
    React.useEffect(() => {
        let alive = true;
        rpc('get-state').then(result => {
            if (!alive)
                return;
            applyState(result);
        }).catch(error => {
            if (!alive)
                return;
            setNotice({ kind: 'err', text: `读取状态失败：${error instanceof Error ? error.message : String(error)}` });
        });
        return () => {
            alive = false;
        };
    }, []);
    // While the backend pipeline is running (single-flight), keep the page
    // truthfully disabled and refresh automatically so a reopened settings page
    // reflects the in-flight run instead of showing unlocked buttons.
    const pipelineRunning = payload !== null
        && (payload.pipeline.runningPhase1 === true || payload.pipeline.runningPhase2 === true);
    React.useEffect(() => {
        if (!pipelineRunning)
            return;
        const timer = setInterval(() => {
            void refresh().catch(() => { });
        }, 4_000);
        return () => clearInterval(timer);
    }, [pipelineRunning, refresh]);
    const loadLogs = async () => {
        try {
            const result = await rpc('get-logs', { limit: 20 });
            setLogs((result.logs ?? []));
        }
        catch {
            setLogs([]);
        }
    };
    const openLog = async (entry) => {
        try {
            const result = await rpc('read-file', { path: `logs/${entry.name}` });
            const content = result.content ?? '（读取失败）';
            setLogDetail({ name: entry.name, content });
        }
        catch (error) {
            setLogDetail({ name: entry.name, content: `读取失败：${error instanceof Error ? error.message : String(error)}` });
        }
    };
    const loadTree = async () => {
        try {
            const result = await rpc('list-files', { path: '' });
            setTree((result.files ?? []));
        }
        catch {
            setTree([]);
        }
    };
    const openFile = async (path) => {
        try {
            const result = await rpc('read-file', { path });
            const content = result.content ?? '（读取失败）';
            setFileDetail({ path, content });
        }
        catch (error) {
            setFileDetail({ path, content: `读取失败：${error instanceof Error ? error.message : String(error)}` });
        }
    };
    if (payload === null || form === null) {
        return el('div', { className: 'dm-section' }, el('p', { className: 'dm-intro' }, notice !== null ? notice.text : '加载中…'));
    }
    const set = (key, value) => {
        setForm({ ...form, [key]: value });
    };
    const pickProvider = (id) => {
        setForm({ ...form, provider: id, model: '' });
        setNotice(null);
        if (id === '') {
            setPayload({ ...payload, models: [] });
            return;
        }
        rpc('list-models', { provider: id }).then(result => {
            const models = (result.models ?? []);
            setPayload(current => (current === null ? current : { ...current, models }));
        }).catch(() => { });
    };
    const call = async (method, args = {}, okText) => {
        setBusy(true);
        setNotice(null);
        try {
            await rpc(method, args);
            await refresh();
            setNotice({ kind: 'ok', text: okText ?? '操作完成。' });
        }
        catch (error) {
            setNotice({ kind: 'err', text: `操作失败：${error instanceof Error ? error.message : String(error)}` });
        }
        finally {
            setBusy(false);
        }
    };
    /** 立即提取：把本轮实际处理结果如实展示出来，而不是一句笼统的"完成"。 */
    const runPhase1 = async () => {
        setBusy(true);
        setNotice(null);
        try {
            const result = await rpc('run-phase1');
            const summary = (result.phase1 ?? {});
            const phase2 = result.phase2;
            await refresh();
            const selected = Number(summary.selected ?? 0);
            const done = Number(summary.done ?? 0);
            const noop = Number(summary.noop ?? 0);
            const failed = Number(summary.failed ?? 0);
            const unchanged = Number(summary.unchanged ?? 0);
            let text;
            if (selected === 0) {
                text = `本轮没有待提取的会话：所有历史会话都已有处理记录（成功、跳过或待重试）。如需重试失败的会话，用「重试失败会话」按钮。`;
            }
            else {
                text = `本轮处理 ${selected} 个会话：${done} 新提取、${noop} 跳过、${unchanged} 无新增内容、${failed} 失败。`;
            }
            if (phase2 !== null && phase2 !== undefined) {
                const reasonText = {
                    cooldown: '冷却中',
                    'no-input': '没有待整合的新记忆',
                    'no-route': '没有可用的模型路由',
                    'retry-paused': '连续失败已暂停自动重试（请用「立即整合」手动重试）',
                };
                text += phase2.kind === 'consolidated'
                    ? ` 随后整合已执行（${phase2.mode === 'init' ? '初次创建' : '增量合并'}）。`
                    : phase2.kind === 'error'
                        ? ' 随后整合失败（自动重试，连续 3 次失败后暂停）。'
                        : phase2.kind === 'skipped'
                            ? ` 随后整合未执行（${reasonText[phase2.reason ?? ''] ?? phase2.reason}）。`
                            : '';
            }
            setNotice({ kind: 'ok', text });
        }
        catch (error) {
            setNotice({ kind: 'err', text: `操作失败：${error instanceof Error ? error.message : String(error)}` });
        }
        finally {
            setBusy(false);
        }
    };
    const save = () => {
        void call('set-config', {
            enabled: form.enabled === true,
            idleDebounceMs: Math.max(1, Number(form.idleDebounceMinutes ?? 3)) * 60_000,
            consolidationCooldownMs: Math.max(1, Number(form.cooldownHours ?? 6)) * 3_600_000,
            maxRolloutsPerRun: Number(form.maxRolloutsPerRun ?? 3),
            maxSummaryChars: Number(form.maxSummaryChars ?? 8000),
            provider: String(form.provider ?? ''),
            model: String(form.model ?? ''),
            phase2MaxTokens: Number(form.phase2MaxTokens ?? 12000),
            maxUnusedDays: Number(form.maxUnusedDays ?? 30),
        }, '配置已保存，并持久化到 DSH 存储。');
    };
    const num = (label, key, hint) => el('div', { className: 'dm-field' }, el('div', { className: 'dm-label' }, label), el('input', {
        className: 'dm-input num', type: 'number', value: String(form[key] ?? ''), disabled: busy,
        onChange: (event) => set(key, Number(event.target.value)),
    }), hint === undefined ? null : el('p', { className: 'dm-dimmed' }, hint));
    const stat = (label, value) => el('div', { className: 'dm-stat' }, el('b', null, value), el('span', null, label));
    const pipeline = payload.pipeline;
    const routeLabel = payload.route === null ? '部署默认模型' : `${payload.route.provider} / ${payload.route.model}`;
    const provider = String(form.provider ?? '');
    const knownProviders = Array.isArray(payload.providers) ? payload.providers : [];
    const knownModels = Array.isArray(payload.models) ? payload.models : [];
    const providerKnown = provider === '' || knownProviders.some(entry => entry.id === provider);
    // Buttons stay disabled while the backend pipeline is in flight, so closing
    // and reopening the page no longer "unlocks" a run that is still running.
    const controlsDisabled = busy || pipelineRunning;
    const providerSelect = el('select', {
        className: 'dm-input', value: providerKnown ? provider : '__custom__', disabled: busy,
        onChange: (event) => pickProvider(event.target.value === '__custom__' ? provider : event.target.value),
    }, el('option', { value: '' }, '— 使用部署默认模型 —'), knownProviders.map(entry => el('option', { key: entry.id, value: entry.id }, entry.name || entry.id)), providerKnown ? null : el('option', { value: '__custom__' }, `${provider}（自定义）`));
    const manualModel = form.manualModel === true;
    const modelControl = provider === ''
        ? el('input', { className: 'dm-input', value: '部署默认模型', disabled: true })
        : knownModels.length > 0 && !manualModel
            ? el('select', {
                className: 'dm-input', value: String(form.model ?? ''), disabled: busy,
                onChange: (event) => set('model', event.target.value),
            }, el('option', { value: '' }, '— 请选择 —'), knownModels.map(entry => el('option', { key: entry.id, value: entry.id }, entry.name || entry.id)))
            : el('input', {
                className: 'dm-input', value: String(form.model ?? ''), disabled: busy,
                placeholder: '手动输入模型 ID',
                onChange: event => set('model', event.target.value),
            });
    const failureLines = (Array.isArray(payload.recentFailures) ? payload.recentFailures : []).map(failure => el('div', { className: 'dm-fail', key: failure.session }, el('p', { className: 'dm-dimmed' }, `${shortId(failure.session)} · ${fmtTime(failure.at)}`), el('p', { className: 'dm-warn' }, failure.error || '未知错误')));
    const logLines = (logs ?? []).map(entry => el('div', { className: 'dm-logline', key: entry.name }, el('div', { className: 'dm-row' }, el('span', { className: 'dm-label' }, entry.stage === 'phase1' ? '提取' : '整合'), el('span', { className: 'dm-dimmed' }, fmtTime(entry.at)), el('span', { className: 'dm-dimmed' }, entry.route ?? ''), el('span', { className: 'dm-dimmed' }, entry.outcome), el('button', {
        className: 'dm-btn secondary', disabled: busy,
        onClick: () => {
            if (logDetail?.name === entry.name) {
                setLogDetail(null);
            }
            else {
                void openLog(entry);
            }
        },
    }, logDetail?.name === entry.name ? '收起' : '查看 AI 干了啥')), logDetail?.name === entry.name
        ? el('pre', { className: 'dm-pre' }, logDetail.content.slice(0, 60_000))
        : null));
    const treeRows = (tree ?? [])
        .filter(entry => entry.kind === 'file')
        .slice(0, 300)
        .map(entry => el('button', {
        key: entry.path,
        className: 'dm-btn secondary',
        style: { height: 26, borderRadius: 6, fontSize: 12, justifyContent: 'flex-start' },
        onClick: () => {
            if (fileDetail?.path === entry.path) {
                setFileDetail(null);
            }
            else {
                void openFile(entry.path);
            }
        },
    }, `${entry.path}  ${fmtChars(entry.size)}`));
    return el('div', { className: 'dm-section' }, el('p', { className: 'dm-title' }, '长期记忆'), el('p', { className: 'dm-intro' }, '把会话历史自动提炼为长期记忆：Phase 1 逐会话提取（产出回顾与原始记忆），Phase 2 全局整合进 MEMORY.md 与 memory_summary.md；摘要常驻注入新会话，工具 memory_list/read/search/add 按需检索。'), el('div', { className: 'dm-card' }, el('div', { className: 'dm-row' }, el('span', { className: 'dm-label' }, '记忆库：'), el('span', { className: 'dm-dimmed', style: { wordBreak: 'break-all' } }, payload.root)), el('div', { className: 'dm-grid' }, stat('已处理会话', `${payload.counts.done} 条记忆 / ${payload.counts.noop} 跳过 / ${payload.counts.failed} 失败`), stat('会话回顾', `${payload.stats.rollouts} 份`), stat('固化的 skills', `${payload.stats.skills} 个`), stat('ad hoc 笔记', `${payload.stats.notes} 条`), stat('已退役回顾', `${payload.stats.retired} 份`), stat('MEMORY.md', fmtChars(payload.stats.memoryChars)), stat('memory_summary.md', fmtChars(payload.stats.summaryChars)), stat('待整合 raw', fmtChars(payload.stats.rawChars)), stat('整合冷却', pipeline.cooldownRemainingMs > 0 ? `剩余 ${Math.ceil(pipeline.cooldownRemainingMs / 3_600_000)} 小时` : '已就绪')), el('p', { className: 'dm-dimmed' }, `Phase 1：${fmtTime(pipeline.lastPhase1At)} · Phase 2：${fmtTime(pipeline.lastPhase2At)}`), pipeline.phase2Error === undefined
        ? null
        : el('p', { className: 'dm-warn' }, `上次整合失败：${pipeline.phase2Error}`), pipeline.phase2Failures > 0 && pipeline.phase2Error !== undefined
        ? el('p', { className: 'dm-warn' }, `已连续失败 ${pipeline.phase2Failures} 次：自动重试${pipeline.phase2Failures >= 3 ? '已暂停' : '仍会进行'}；失败详情可在下方「运行记录」中展开查看模型实际输出。`)
        : null, pipelineRunning
        ? el('p', { className: 'dm-warn' }, '管道正在运行中（提取/整合尚未结束）——按钮保持禁用直到运行完成，页面会自动刷新。')
        : null, el('div', { className: 'dm-row' }, el('button', { className: 'dm-btn primary', disabled: controlsDisabled, onClick: () => { void runPhase1(); } }, '立即提取'), el('button', { className: 'dm-btn primary', disabled: controlsDisabled, onClick: () => { void call('run-phase2', {}, '整合完成。'); } }, '立即整合'), payload.counts.failed > 0
        ? el('button', { className: 'dm-btn secondary', disabled: controlsDisabled, onClick: () => { void call('reset-failures', {}, '失败会话已重新入队并触发重试。'); } }, `重试失败会话（${payload.counts.failed}）`)
        : null, el('button', { className: 'dm-btn secondary', disabled: controlsDisabled, onClick: () => { void call('get-state').then(() => setNotice({ kind: 'ok', text: '已刷新。' })).catch(() => { }); } }, '刷新'), el('span', { className: 'dm-dimmed' }, `当前路由：${routeLabel}`))), failureLines.length > 0
        ? el('div', { className: 'dm-card' }, el('div', { className: 'dm-label' }, '最近失败的会话（按退避自动重试；错误含实际使用的模型路由）'), ...failureLines)
        : null, el('div', { className: 'dm-card' }, el('div', { className: 'dm-row' }, el('span', { className: 'dm-label' }, '运行记录（最近 20 次管道活动；展开可查看每次运行中 AI 的完整产出）'), el('button', { className: 'dm-btn secondary', disabled: busy, onClick: () => { void loadLogs(); } }, '加载')), logs === null
        ? el('p', { className: 'dm-dimmed' }, '点击「加载」查看运行记录。')
        : logs.length === 0
            ? el('p', { className: 'dm-dimmed' }, '暂无运行记录（插件运行后会持久化到记忆库 logs/ 目录）。')
            : el('div', { style: { flexDirection: 'column', gap: 8, display: 'flex' } }, ...logLines)), el('div', { className: 'dm-card' }, el('div', { className: 'dm-row' }, el('span', { className: 'dm-label' }, '浏览记忆库（文件树；点击文件查看原文）'), el('button', { className: 'dm-btn secondary', disabled: busy, onClick: () => { void loadTree(); } }, '加载')), el('div', { className: 'dm-tree' }, tree === null
        ? el('p', { className: 'dm-dimmed' }, '点击「加载」列出记忆库文件。')
        : tree.length === 0
            ? el('p', { className: 'dm-dimmed' }, '（空）')
            : el('div', { style: { flexDirection: 'column', gap: 2, display: 'flex' } }, ...treeRows)), fileDetail === null ? null : el('pre', { className: 'dm-pre' }, fileDetail.content.slice(0, 100_000))), el('div', { className: 'dm-card' }, el('label', { className: 'dm-check' }, el('input', {
        type: 'checkbox', checked: form.enabled === true, disabled: busy,
        onChange: event => set('enabled', event.target.checked),
    }), '启用长期记忆管道（提取、整合与摘要注入）'), el('div', { className: 'dm-grid' }, num('会话结束后防抖（分钟）', 'idleDebounceMinutes', '轮次结束后的静默时长，默认 3 分钟'), num('整合冷却（小时）', 'cooldownHours', '两次自动整合的最小间隔，默认 6 小时'), num('每轮处理会话数', 'maxRolloutsPerRun', '每次管道运行提取的会话数上限'), num('注入摘要上限（字符）', 'maxSummaryChars', 'memory_summary.md 注入 system prompt 的截断上限'), num('整合输出 token 上限', 'phase2MaxTokens', '整合需全量重写 MEMORY.md，输出大时容易截断；当前上限可调至 131072，建议 65536'), num('遗忘阈值（天）', 'maxUnusedDays', '超过该天数未被查阅的回顾会被标注为候选遗忘，可在整合时退役到 .retired/；0 = 关闭遗忘机制，默认 30 天')), el('div', { className: 'dm-grid' }, el('div', { className: 'dm-field' }, el('div', { className: 'dm-label' }, '记忆管道模型提供方（可选）'), providerSelect, el('p', { className: 'dm-dimmed' }, '留空使用部署默认模型；列表来自 设置 → 模型 中已注册的提供方')), el('div', { className: 'dm-field' }, el('div', { className: 'dm-label' }, '记忆管道模型（可选）'), modelControl, provider !== ''
        ? el('label', { className: 'dm-check' }, el('input', {
            type: 'checkbox', checked: manualModel, disabled: busy,
            onChange: event => set('manualModel', event.target.checked),
        }), el('span', { className: 'dm-dimmed' }, '手动输入模型 ID'))
        : el('p', { className: 'dm-dimmed' }, '选择提供方后可下拉选择模型'))), el('div', { className: 'dm-row' }, el('button', { className: 'dm-btn primary', disabled: controlsDisabled, onClick: save }, '保存配置'))), notice === null ? null : el('p', { className: notice.kind === 'ok' ? 'dm-ok' : 'dm-error' }, notice.text), payload.storage === 'ok'
        ? el('p', { className: 'dm-dimmed' }, '配置与处理进度已持久化到 DSH 存储（storage: json），重启后自动恢复。')
        : el('p', { className: 'dm-warn' }, `持久化不可用（${payload.storageError || 'storage json 后端缺失'}）：进度与配置仅在本次运行期间有效。`), el('p', { className: 'dm-dimmed' }, '会话内用法：助手可调用 memory_list / memory_read / memory_search / memory_add（仅在用户明确要求时）工具查阅与更新记忆；工具查阅行为会作为使用记录，供遗忘机制判断哪些回顾已失效。'), el('p', { className: 'dm-dimmed' }, '固化技能存放于记忆库 skills/ 目录；若要被 DSH 会话加载，需在 agent 预设的 customSkillDirs 中引用该目录（本插件不修改预设）。'));
}
export const inject = [];
export function apply(ctx) {
    const slots = ctx.get('slots');
    if (slots === undefined)
        return;
    const style = document.createElement('style');
    style.dataset.plugin = '@nanmicoder/dsh-memory';
    style.dataset.pluginCss = '@nanmicoder/dsh-memory/MemorySettings.css';
    style.textContent = CSS;
    document.head.appendChild(style);
    slots.inject('settings.section', () => slots.register({ name: 'settings.section', id: 'dsh-memory', order: 30, label: '长期记忆' }, () => React.createElement(MemorySettings)));
    ctx.effect(() => () => {
        style.remove();
    });
}
//# sourceMappingURL=index.js.map
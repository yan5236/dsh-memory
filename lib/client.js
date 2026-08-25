window.__ModuleLoader__.load({
	id: "@nanmicoder/dsh-memory",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		//#endregion
		let react = require("react");
		react = __toESM(react, 1);
		//#region lib/client/index.js
		/** Web settings page for the long-term memory plugin. */
		const CSS = [
			".dm-section{box-sizing:border-box;max-width:760px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:12px;display:flex}",
			".dm-title{color:var(--dsw-alias-label-primary);margin:0;font-size:16px;font-weight:500;line-height:24px}",
			".dm-intro{color:var(--dsw-alias-label-tertiary);margin:0;font-size:14px;line-height:22px}",
			".dm-dimmed{color:var(--dsw-alias-label-dimmed);margin:0;font-size:12px;line-height:18px}",
			".dm-error{color:var(--dsw-alias-state-error-primary);margin:0;font-size:12px;line-height:18px}",
			".dm-ok{color:var(--dsw-alias-state-success-primary);margin:0;font-size:12px;line-height:18px}",
			".dm-warn{color:var(--dsw-alias-state-warn-label);margin:0;font-size:12px;line-height:18px}",
			".dm-card{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;flex-direction:column;gap:10px;padding:12px 14px;display:flex}",
			".dm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}",
			".dm-stat{flex-direction:column;gap:2px;display:flex}",
			".dm-stat b{font-size:14px;line-height:20px;font-weight:600}",
			".dm-stat span{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}",
			".dm-row{align-items:center;gap:10px;display:flex;flex-wrap:wrap}",
			".dm-field{flex-direction:column;gap:4px;display:flex}",
			".dm-label{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;line-height:18px}",
			".dm-input{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);height:32px;font:inherit;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 10px;font-size:14px;line-height:22px;width:100%}",
			".dm-input.num{max-width:140px}",
			".dm-input:focus{border-color:var(--dsw-alias-brand-primary);outline:none}",
			".dm-input:disabled{opacity:.6}",
			"select.dm-input{cursor:pointer}",
			".dm-check{align-items:center;gap:8px;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px;display:flex;cursor:pointer}",
			".dm-check input{accent-color:var(--dsw-alias-brand-primary);margin:0}",
			".dm-btn{box-sizing:border-box;height:34px;font:inherit;cursor:pointer;border:none;border-radius:17px;justify-content:center;align-items:center;gap:4px;padding:0 14px;font-size:14px;line-height:22px;display:inline-flex}",
			".dm-btn.primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}",
			".dm-btn.primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-fill-hover)}",
			".dm-btn.secondary{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);background:transparent}",
			".dm-btn.secondary:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}",
			".dm-btn:disabled{opacity:.5;cursor:default}",
			".dm-fail{border-left:2px solid var(--dsw-alias-state-warn-primary);flex-direction:column;gap:2px;padding-left:10px;display:flex}",
			".dm-logline{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 10px;gap:6px;flex-direction:column;display:flex}",
			".dm-pre{box-sizing:border-box;max-height:320px;overflow:auto;margin:0;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px 10px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-all;background:var(--dsw-alias-bg-layer-1)}",
			".dm-tree{max-height:220px;overflow-y:auto;flex-direction:column;gap:2px;display:flex}",
			".dm-overlay{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:24px}",
			".dm-modal{box-sizing:border-box;width:min(960px,100%);height:min(720px,100%);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;display:flex;flex-direction:column;overflow:hidden}",
			".dm-modal-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l1)}",
			".dm-modal-title{color:var(--dsw-alias-label-primary);margin:0;font-size:15px;font-weight:500;line-height:22px}",
			".dm-modal-close{cursor:pointer;border:none;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:20px;line-height:20px;padding:4px 8px;border-radius:8px}",
			".dm-modal-close:hover{background:var(--dsw-alias-interactive-bg-hover)}",
			".dm-warnbar{border:1px solid var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 10%,transparent);color:var(--dsw-alias-state-warn-label);border-radius:10px;padding:8px 12px;font-size:12px;line-height:18px;margin:12px 16px 0}",
			".dm-modal-body{flex:1;display:flex;min-height:0}",
			".dm-filecol{width:320px;min-width:220px;border-right:1px solid var(--dsw-alias-border-l1);overflow-y:auto;padding:6px;display:flex;flex-direction:column;gap:1px}",
			".dm-fileitem{border:none;background:transparent;color:var(--dsw-alias-label-primary);text-align:left;font-size:12px;line-height:18px;padding:4px 6px;border-radius:6px;cursor:pointer;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;box-sizing:border-box;width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
			".dm-fileitem:hover{background:var(--dsw-alias-interactive-bg-hover)}",
			".dm-fileitem.sel{background:var(--dsw-alias-interactive-bg-hover);font-weight:600}",
			".dm-dirrow{display:flex;flex-direction:column;gap:1px}",
			".dm-dirlabel{display:flex;align-items:center;gap:6px;width:100%;box-sizing:border-box;border:none;background:transparent;color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;padding:4px 6px;border-radius:6px;cursor:pointer;text-align:left;white-space:nowrap}",
			".dm-dirlabel:hover{background:var(--dsw-alias-interactive-bg-hover)}",
			".dm-caret{color:var(--dsw-alias-label-tertiary);width:12px;flex:none;display:inline-block;font-size:9px;line-height:18px}",
			".dm-filecount{color:var(--dsw-alias-label-tertiary);font-size:11px;flex:none}",
			".dm-editcol{flex:1;display:flex;flex-direction:column;min-width:0}",
			".dm-editor{box-sizing:border-box;flex:1;min-height:0;margin:12px 16px 0;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;line-height:18px;padding:10px;resize:none;white-space:pre}",
			".dm-editor:focus{border-color:var(--dsw-alias-brand-primary);outline:none}",
			".dm-editfoot{display:flex;align-items:center;gap:10px;padding:12px 16px;flex-wrap:wrap}",
			".dm-btn.danger{border:1px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);background:transparent}",
			".dm-btn.danger:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent)}",
			".dm-btn.armed{border:1px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary-foreground);background:var(--dsw-alias-state-error-primary)}"
		].join("");
		const rpc = async (method, args = {}) => {
			return (await fetch("/dsh-memory/rpc", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					method,
					args
				})
			})).json();
		};
		function fmtTime(ms) {
			if (ms <= 0) return "—";
			return new Date(ms).toLocaleString();
		}
		function fmtChars(n) {
			if (n < 1024) return `${n} 字符`;
			if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} K`;
			return `${(n / 1024 / 1024).toFixed(1)} M`;
		}
		function shortId(id) {
			return id.length > 16 ? `${id.slice(0, 13)}…` : id;
		}
		/** 已知等级的中文标签；未知 id 沿用适配器提供的名称。 */
		const EFFORT_LABELS = {
			off: "无（关闭思考）",
			low: "低",
			high: "高",
			max: "最大"
		};
		/** 模型未暴露推理元数据时的兜底等级列表（DeepSeek 官方等级）。 */
		const FALLBACK_EFFORTS = [
			{
				id: "off",
				name: "off"
			},
			{
				id: "low",
				name: "low"
			},
			{
				id: "high",
				name: "high"
			},
			{
				id: "max",
				name: "max"
			}
		];
		function effortOptions(payload) {
			const raw = payload?.reasoningEfforts;
			return (Array.isArray(raw) && raw.length > 0 ? raw : FALLBACK_EFFORTS).map((effort) => ({
				id: effort.id,
				label: EFFORT_LABELS[effort.id] ?? effort.name ?? effort.id
			}));
		}
		/** 系统自动生成/维护的核心文件：管道每次整合都会全量重写，手工改动风险最高。 */
		const CORE_FILES = [
			"MEMORY.md",
			"memory_summary.md",
			"raw_memories.md",
			"raw_memories.archive.md"
		];
		/** 把扁平文件清单（list-files 返回）组织成层级树，目录在前、字母序。 */
		function buildTree(entries) {
			const root = [];
			const insert = (path, kind, size) => {
				const parts = path.split("/");
				let level = root;
				for (let index = 0; index < parts.length; index += 1) {
					const part = parts[index] ?? "";
					const full = parts.slice(0, index + 1).join("/");
					const last = index === parts.length - 1;
					let node = level.find((item) => item.path === full);
					if (node === void 0) {
						node = {
							name: part,
							path: full,
							kind: last ? kind : "dir",
							size: last ? size : 0
						};
						if (!last) node.children = [];
						level.push(node);
					}
					if (!last) {
						if (node.children === void 0) node.children = [];
						level = node.children;
					}
				}
			};
			for (const dir of entries.filter((entry) => entry.kind === "dir")) insert(dir.path, "dir", dir.size);
			for (const file of entries.filter((entry) => entry.kind === "file")) insert(file.path, "file", file.size);
			const sortLevel = (list) => {
				list.sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1);
				for (const node of list) if (node.children !== void 0) sortLevel(node.children);
			};
			sortLevel(root);
			return root;
		}
		/** 默认展开顶层目录（收纳更深层，让根文件 + 一级文件夹立即可见）。 */
		function defaultExpanded(tree) {
			const map = {};
			const visit = (nodes, depth) => {
				for (const node of nodes) if (node.kind === "dir" && node.children !== void 0 && node.children.length > 0) {
					if (depth === 0) map[node.path] = true;
					visit(node.children, depth + 1);
				}
			};
			visit(tree, 0);
			return map;
		}
		function MemorySettings() {
			const el = react.createElement;
			const [payload, setPayload] = react.useState(null);
			const [form, setForm] = react.useState(null);
			const [busy, setBusy] = react.useState(false);
			const [notice, setNotice] = react.useState(null);
			const [logs, setLogs] = react.useState(null);
			const [logDetail, setLogDetail] = react.useState(null);
			const [tree, setTree] = react.useState(null);
			const [expanded, setExpanded] = react.useState({});
			const [editorOpen, setEditorOpen] = react.useState(false);
			const [selectedPath, setSelectedPath] = react.useState(null);
			const [draft, setDraft] = react.useState("");
			const [deleteArmed, setDeleteArmed] = react.useState(false);
			const [editorBusy, setEditorBusy] = react.useState(false);
			const [editorNotice, setEditorNotice] = react.useState(null);
			const applyState = (state) => {
				setPayload(state);
				const cfg = state.config;
				setForm((prev) => ({
					enabled: state.enabled === true,
					idleDebounceMinutes: Math.round(Number(cfg.idleDebounceMs ?? 18e4) / 6e4),
					cooldownHours: Math.round(Number(cfg.consolidationCooldownMs ?? 216e5) / 36e5),
					maxRolloutsPerRun: Number(cfg.maxRolloutsPerRun ?? 3),
					maxSummaryChars: Number(cfg.maxSummaryChars ?? 8e3),
					provider: String(cfg.provider ?? ""),
					model: String(cfg.model ?? ""),
					phase1ReasoningEffort: String(cfg.phase1ReasoningEffort ?? ""),
					phase2ReasoningEffort: String(cfg.phase2ReasoningEffort ?? ""),
					phase2MaxTokens: Number(cfg.phase2MaxTokens ?? 12e3),
					maxUnusedDays: Number(cfg.maxUnusedDays ?? 30),
					manualModel: prev?.manualModel === true
				}));
			};
			const refresh = react.useCallback(async () => {
				const result = await rpc("get-state");
				applyState(result);
			}, []);
			react.useEffect(() => {
				let alive = true;
				rpc("get-state").then((result) => {
					if (!alive) return;
					applyState(result);
				}).catch((error) => {
					if (!alive) return;
					setNotice({
						kind: "err",
						text: `读取状态失败：${error instanceof Error ? error.message : String(error)}`
					});
				});
				return () => {
					alive = false;
				};
			}, []);
			const pipelineRunning = payload !== null && (payload.pipeline.runningPhase1 === true || payload.pipeline.runningPhase2 === true);
			react.useEffect(() => {
				if (!pipelineRunning) return;
				const timer = setInterval(() => {
					refresh().catch(() => {});
				}, 4e3);
				return () => clearInterval(timer);
			}, [pipelineRunning, refresh]);
			const loadLogs = async () => {
				try {
					const result = await rpc("get-logs", { limit: 20 });
					setLogs(result.logs ?? []);
				} catch {
					setLogs([]);
				}
			};
			const openLog = async (entry) => {
				try {
					const content = (await rpc("read-file", { path: `logs/${entry.name}` })).content ?? "（读取失败）";
					setLogDetail({
						name: entry.name,
						content
					});
				} catch (error) {
					setLogDetail({
						name: entry.name,
						content: `读取失败：${error instanceof Error ? error.message : String(error)}`
					});
				}
			};
			const loadTree = async () => {
				try {
					const list = (await rpc("list-files", { path: "" })).files ?? [];
					setTree(list);
					setExpanded((prev) => Object.keys(prev).length === 0 && list.length > 0 ? defaultExpanded(buildTree(list)) : prev);
				} catch {
					setTree([]);
				}
			};
			const toggleDir = (path) => {
				setExpanded((prev) => ({
					...prev,
					[path]: !(prev[path] === true)
				}));
			};
			/** VS Code 风格递归渲染文件树：目录可折叠，文件缩进显示。 */
			const renderTree = (nodes, depth) => nodes.map((node) => {
				const indent = { paddingLeft: 8 + depth * 16 };
				if (node.kind === "dir") {
					const open = expanded[node.path] === true;
					return el("div", {
						key: node.path,
						className: "dm-dirrow"
					}, el("button", {
						className: "dm-dirlabel",
						style: indent,
						title: node.path,
						onClick: () => toggleDir(node.path)
					}, el("span", { className: "dm-caret" }, open ? "▾" : "▸"), el("span", { style: {
						overflow: "hidden",
						textOverflow: "ellipsis"
					} }, node.name), el("span", { style: { flex: 1 } }), el("span", { className: "dm-filecount" }, String(node.children?.length ?? 0))), open && node.children !== void 0 ? el("div", { style: {
						flexDirection: "column",
						display: "flex"
					} }, ...renderTree(node.children, depth + 1)) : null);
				}
				return el("button", {
					key: node.path,
					className: `dm-fileitem${selectedPath === node.path ? " sel" : ""}`,
					style: indent,
					disabled: editorBusy,
					onClick: () => {
						selectFile(node.path);
					}
				}, node.name);
			});
			/** 打开记忆库弹窗：Top 的位置由按钮触发，打开时自动列出一份文件树。 */
			const openEditor = async () => {
				setEditorOpen(true);
				setEditorNotice(null);
				setSelectedPath(null);
				setDraft("");
				setDeleteArmed(false);
				await loadTree();
			};
			const closeEditor = () => {
				setEditorOpen(false);
				setTree(null);
				setSelectedPath(null);
				setDraft("");
				setDeleteArmed(false);
				setEditorNotice(null);
			};
			const selectFile = async (path) => {
				setSelectedPath(path);
				setDeleteArmed(false);
				setEditorNotice(null);
				try {
					const result = await rpc("read-file", { path });
					setDraft(result.content ?? "");
				} catch (error) {
					setEditorNotice({
						kind: "err",
						text: `读取失败：${error instanceof Error ? error.message : String(error)}`
					});
					setDraft("");
				}
			};
			const saveDraft = async () => {
				if (selectedPath === null) return;
				setEditorBusy(true);
				setEditorNotice(null);
				try {
					const result = await rpc("write-file", {
						path: selectedPath,
						content: draft
					});
					if (result.ok !== true) throw new Error(String(result.message ?? "保存失败"));
					setDeleteArmed(false);
					setEditorNotice({
						kind: "ok",
						text: `已保存 ${selectedPath}`
					});
					await loadTree();
				} catch (error) {
					setEditorNotice({
						kind: "err",
						text: `保存失败：${error instanceof Error ? error.message : String(error)}`
					});
				} finally {
					setEditorBusy(false);
				}
			};
			const deleteSelected = async () => {
				if (selectedPath === null) return;
				if (!deleteArmed) {
					setDeleteArmed(true);
					return;
				}
				setEditorBusy(true);
				setEditorNotice(null);
				try {
					const result = await rpc("delete-file", { path: selectedPath });
					if (result.ok !== true) throw new Error(String(result.message ?? "删除失败"));
					const removedPath = selectedPath;
					setSelectedPath(null);
					setDraft("");
					setDeleteArmed(false);
					setEditorNotice({
						kind: "ok",
						text: `已删除 ${removedPath}`
					});
					await loadTree();
				} catch (error) {
					setEditorNotice({
						kind: "err",
						text: `删除失败：${error instanceof Error ? error.message : String(error)}`
					});
					setDeleteArmed(false);
				} finally {
					setEditorBusy(false);
				}
			};
			if (payload === null || form === null) return el("div", { className: "dm-section" }, el("p", { className: "dm-intro" }, notice !== null ? notice.text : "加载中…"));
			const set = (key, value) => {
				setForm({
					...form,
					[key]: value
				});
			};
			const pickProvider = (id) => {
				setForm({
					...form,
					provider: id,
					model: ""
				});
				setNotice(null);
				if (id === "") {
					setPayload({
						...payload,
						models: []
					});
					return;
				}
				rpc("list-models", { provider: id }).then((result) => {
					const models = result.models ?? [];
					setPayload((current) => current === null ? current : {
						...current,
						models
					});
				}).catch(() => {});
			};
			const call = async (method, args = {}, okText) => {
				setBusy(true);
				setNotice(null);
				try {
					await rpc(method, args);
					await refresh();
					setNotice({
						kind: "ok",
						text: okText ?? "操作完成。"
					});
				} catch (error) {
					setNotice({
						kind: "err",
						text: `操作失败：${error instanceof Error ? error.message : String(error)}`
					});
				} finally {
					setBusy(false);
				}
			};
			/** 立即提取：把本轮实际处理结果如实展示出来，而不是一句笼统的"完成"。 */
			const runPhase1 = async () => {
				setBusy(true);
				setNotice(null);
				try {
					const result = await rpc("run-phase1");
					const summary = result.phase1 ?? {};
					const phase2 = result.phase2;
					await refresh();
					const selected = Number(summary.selected ?? 0);
					const done = Number(summary.done ?? 0);
					const noop = Number(summary.noop ?? 0);
					const failed = Number(summary.failed ?? 0);
					const unchanged = Number(summary.unchanged ?? 0);
					let text;
					if (selected === 0) text = `本轮没有待提取的会话：所有历史会话都已有处理记录（成功、跳过或待重试）。如需重试失败的会话，用「重试失败会话」按钮。`;
					else text = `本轮处理 ${selected} 个会话：${done} 新提取、${noop} 跳过、${unchanged} 无新增内容、${failed} 失败。`;
					if (phase2 !== null && phase2 !== void 0) text += phase2.kind === "consolidated" ? ` 随后整合已执行（${phase2.mode === "init" ? "初次创建" : "增量合并"}）。` : phase2.kind === "error" ? " 随后整合失败（自动重试，连续 3 次失败后暂停）。" : phase2.kind === "skipped" ? ` 随后整合未执行（${{
						cooldown: "冷却中",
						"no-input": "没有待整合的新记忆",
						"no-route": "没有可用的模型路由",
						"retry-paused": "连续失败已暂停自动重试（请用「立即整合」手动重试）"
					}[phase2.reason ?? ""] ?? phase2.reason}）。` : "";
					setNotice({
						kind: "ok",
						text
					});
				} catch (error) {
					setNotice({
						kind: "err",
						text: `操作失败：${error instanceof Error ? error.message : String(error)}`
					});
				} finally {
					setBusy(false);
				}
			};
			const save = () => {
				call("set-config", {
					enabled: form.enabled === true,
					idleDebounceMs: Math.max(1, Number(form.idleDebounceMinutes ?? 3)) * 6e4,
					consolidationCooldownMs: Math.max(1, Number(form.cooldownHours ?? 6)) * 36e5,
					maxRolloutsPerRun: Number(form.maxRolloutsPerRun ?? 3),
					maxSummaryChars: Number(form.maxSummaryChars ?? 8e3),
					provider: String(form.provider ?? ""),
					model: String(form.model ?? ""),
					phase1ReasoningEffort: String(form.phase1ReasoningEffort ?? ""),
					phase2ReasoningEffort: String(form.phase2ReasoningEffort ?? ""),
					phase2MaxTokens: Number(form.phase2MaxTokens ?? 12e3),
					maxUnusedDays: Number(form.maxUnusedDays ?? 30)
				}, "配置已保存，并持久化到 DSH 存储。");
			};
			const num = (label, key, hint) => el("div", { className: "dm-field" }, el("div", { className: "dm-label" }, label), el("input", {
				className: "dm-input num",
				type: "number",
				value: String(form[key] ?? ""),
				disabled: busy,
				onChange: (event) => set(key, Number(event.target.value))
			}), hint === void 0 ? null : el("p", { className: "dm-dimmed" }, hint));
			/** 推理等级下拉：留空 = 跟随模型默认，其余选项来自适配器暴露的等级。 */
			const effortSelect = (key, label, hint) => el("div", { className: "dm-field" }, el("div", { className: "dm-label" }, label), el("select", {
				className: "dm-input",
				value: String(form[key] ?? ""),
				disabled: busy,
				onChange: (event) => set(key, event.target.value)
			}, el("option", { value: "" }, "默认（跟随模型）"), effortOptions(payload).map((option) => el("option", {
				key: option.id,
				value: option.id
			}, option.label))), el("p", { className: "dm-dimmed" }, hint));
			const stat = (label, value) => el("div", { className: "dm-stat" }, el("b", null, value), el("span", null, label));
			const pipeline = payload.pipeline;
			const routeLabel = payload.route === null ? "部署默认模型" : `${payload.route.provider} / ${payload.route.model}`;
			const provider = String(form.provider ?? "");
			const knownProviders = Array.isArray(payload.providers) ? payload.providers : [];
			const knownModels = Array.isArray(payload.models) ? payload.models : [];
			const providerKnown = provider === "" || knownProviders.some((entry) => entry.id === provider);
			const controlsDisabled = busy || pipelineRunning;
			const providerSelect = el("select", {
				className: "dm-input",
				value: providerKnown ? provider : "__custom__",
				disabled: busy,
				onChange: (event) => pickProvider(event.target.value === "__custom__" ? provider : event.target.value)
			}, el("option", { value: "" }, "— 使用部署默认模型 —"), knownProviders.map((entry) => el("option", {
				key: entry.id,
				value: entry.id
			}, entry.name || entry.id)), providerKnown ? null : el("option", { value: "__custom__" }, `${provider}（自定义）`));
			const manualModel = form.manualModel === true;
			const modelControl = provider === "" ? el("input", {
				className: "dm-input",
				value: "部署默认模型",
				disabled: true
			}) : knownModels.length > 0 && !manualModel ? el("select", {
				className: "dm-input",
				value: String(form.model ?? ""),
				disabled: busy,
				onChange: (event) => set("model", event.target.value)
			}, el("option", { value: "" }, "— 请选择 —"), knownModels.map((entry) => el("option", {
				key: entry.id,
				value: entry.id
			}, entry.name || entry.id))) : el("input", {
				className: "dm-input",
				value: String(form.model ?? ""),
				disabled: busy,
				placeholder: "手动输入模型 ID",
				onChange: (event) => set("model", event.target.value)
			});
			const failureLines = (Array.isArray(payload.recentFailures) ? payload.recentFailures : []).map((failure) => el("div", {
				className: "dm-fail",
				key: failure.session
			}, el("p", { className: "dm-dimmed" }, `${shortId(failure.session)} · ${fmtTime(failure.at)}`), el("p", { className: "dm-warn" }, failure.error || "未知错误")));
			const logLines = (logs ?? []).map((entry) => el("div", {
				className: "dm-logline",
				key: entry.name
			}, el("div", { className: "dm-row" }, el("span", { className: "dm-label" }, entry.stage === "phase1" ? "提取" : "整合"), el("span", { className: "dm-dimmed" }, fmtTime(entry.at)), el("span", { className: "dm-dimmed" }, entry.route ?? ""), entry.effort === void 0 || entry.effort === "default" ? null : el("span", { className: "dm-dimmed" }, `推理：${EFFORT_LABELS[entry.effort] ?? entry.effort}`), el("span", { className: "dm-dimmed" }, entry.outcome), el("button", {
				className: "dm-btn secondary",
				disabled: busy,
				onClick: () => {
					if (logDetail?.name === entry.name) setLogDetail(null);
					else openLog(entry);
				}
			}, logDetail?.name === entry.name ? "收起" : "查看 AI 干了啥")), logDetail?.name === entry.name ? el("pre", { className: "dm-pre" }, logDetail.content.slice(0, 6e4)) : null));
			const treeNodes = tree === null ? [] : buildTree(tree);
			const guardNotice = selectedPath !== null && CORE_FILES.includes(selectedPath) ? el("div", { style: { padding: "12px 16px 0" } }, el("p", { className: "dm-warn" }, "这是系统自动生成/维护的核心记忆文件（每次管道整合都会全量重写），手工改动很可能被覆盖或破坏插件行为。除非你非常清楚要做什么，否则不要修改。")) : null;
			const editorView = selectedPath === null ? el("div", { className: "dm-editcol" }, el("p", {
				className: "dm-dimmed",
				style: { padding: "16px" }
			}, "在左侧选择一个记忆文件开始查看 / 编辑。")) : el("div", { className: "dm-editcol" }, el("textarea", {
				className: "dm-editor",
				value: draft,
				disabled: editorBusy,
				spellCheck: false,
				onChange: (event) => setDraft(event.target.value)
			}), guardNotice, el("div", { className: "dm-editfoot" }, el("span", {
				className: "dm-label",
				style: { wordBreak: "break-all" }
			}, selectedPath), el("span", { style: { flex: 1 } }), editorNotice === null ? null : el("p", {
				className: editorNotice.kind === "ok" ? "dm-ok" : "dm-error",
				style: { margin: 0 }
			}, editorNotice.text), el("button", {
				className: `dm-btn ${deleteArmed ? "armed" : "danger"}`,
				disabled: editorBusy,
				onClick: () => {
					deleteSelected();
				}
			}, deleteArmed ? "再次点击确认删除" : "删除"), el("button", {
				className: "dm-btn primary",
				disabled: editorBusy,
				onClick: () => {
					saveDraft();
				}
			}, "保存")));
			const editorModal = editorOpen ? el("div", {
				className: "dm-overlay",
				onClick: closeEditor
			}, el("div", {
				className: "dm-modal",
				onClick: (event) => event.stopPropagation()
			}, el("div", { className: "dm-modal-head" }, el("p", { className: "dm-modal-title" }, "记忆库文件"), el("button", {
				className: "dm-modal-close",
				onClick: closeEditor,
				title: "关闭",
				"aria-label": "关闭"
			}, "✕")), el("div", { className: "dm-warnbar" }, "⚠ 记忆文件一般无需人工更改，除非你知道自己在做什么。修改后点「保存」，删除需二次确认；删除会直接从磁盘移除，不可恢复。"), el("div", { className: "dm-modal-body" }, el("div", { className: "dm-filecol" }, tree === null ? el("p", { className: "dm-dimmed" }, "加载中…") : tree.length === 0 ? el("p", { className: "dm-dimmed" }, "（空）") : el("div", { style: {
				flexDirection: "column",
				gap: 1,
				display: "flex"
			} }, ...renderTree(treeNodes, 0))), editorView))) : null;
			return el("div", { className: "dm-section" }, el("p", { className: "dm-title" }, "长期记忆"), el("p", { className: "dm-intro" }, "把会话历史自动提炼为长期记忆：Phase 1 逐会话提取（产出回顾与原始记忆），Phase 2 全局整合进 MEMORY.md 与 memory_summary.md；摘要常驻注入新会话，工具 memory_list/read/search/add 按需检索。"), el("div", { className: "dm-card" }, el("div", { className: "dm-row" }, el("span", { className: "dm-label" }, "记忆库："), el("span", {
				className: "dm-dimmed",
				style: { wordBreak: "break-all" }
			}, payload.root)), el("div", { className: "dm-grid" }, stat("已处理会话", `${payload.counts.done} 条记忆 / ${payload.counts.noop} 跳过 / ${payload.counts.failed} 失败`), stat("会话回顾", `${payload.stats.rollouts} 份`), stat("固化的 skills", `${payload.stats.skills} 个`), stat("ad hoc 笔记", `${payload.stats.notes} 条`), stat("已退役回顾", `${payload.stats.retired} 份`), stat("MEMORY.md", fmtChars(payload.stats.memoryChars)), stat("memory_summary.md", fmtChars(payload.stats.summaryChars)), stat("待整合 raw", fmtChars(payload.stats.rawChars)), stat("整合冷却", pipeline.cooldownRemainingMs > 0 ? `剩余 ${Math.ceil(pipeline.cooldownRemainingMs / 36e5)} 小时` : "已就绪")), el("p", { className: "dm-dimmed" }, `Phase 1：${fmtTime(pipeline.lastPhase1At)} · Phase 2：${fmtTime(pipeline.lastPhase2At)}`), pipeline.phase2Error === void 0 ? null : el("p", { className: "dm-warn" }, `上次整合失败：${pipeline.phase2Error}`), pipeline.phase2Failures > 0 && pipeline.phase2Error !== void 0 ? el("p", { className: "dm-warn" }, `已连续失败 ${pipeline.phase2Failures} 次：自动重试${pipeline.phase2Failures >= 3 ? "已暂停" : "仍会进行"}；失败详情可在下方「运行记录」中展开查看模型实际输出。`) : null, pipelineRunning ? el("p", { className: "dm-warn" }, "管道正在运行中（提取/整合尚未结束）——按钮保持禁用直到运行完成，页面会自动刷新。") : null, el("div", { className: "dm-row" }, el("button", {
				className: "dm-btn primary",
				disabled: controlsDisabled,
				onClick: () => {
					runPhase1();
				}
			}, "立即提取"), el("button", {
				className: "dm-btn primary",
				disabled: controlsDisabled,
				onClick: () => {
					call("run-phase2", {}, "整合完成。");
				}
			}, "立即整合"), payload.counts.failed > 0 ? el("button", {
				className: "dm-btn secondary",
				disabled: controlsDisabled,
				onClick: () => {
					call("reset-failures", {}, "失败会话已重新入队并触发重试。");
				}
			}, `重试失败会话（${payload.counts.failed}）`) : null, el("button", {
				className: "dm-btn secondary",
				disabled: controlsDisabled,
				onClick: () => {
					call("get-state").then(() => setNotice({
						kind: "ok",
						text: "已刷新。"
					})).catch(() => {});
				}
			}, "刷新"), el("span", { className: "dm-dimmed" }, `当前路由：${routeLabel}`))), failureLines.length > 0 ? el("div", { className: "dm-card" }, el("div", { className: "dm-label" }, "最近失败的会话（按退避自动重试；错误含实际使用的模型路由）"), ...failureLines) : null, el("div", { className: "dm-card" }, el("div", { className: "dm-row" }, el("span", { className: "dm-label" }, "运行记录（最近 20 次管道活动；展开可查看每次运行中 AI 的完整产出）"), el("button", {
				className: "dm-btn secondary",
				disabled: busy,
				onClick: () => {
					loadLogs();
				}
			}, "加载")), logs === null ? el("p", { className: "dm-dimmed" }, "点击「加载」查看运行记录。") : logs.length === 0 ? el("p", { className: "dm-dimmed" }, "暂无运行记录（插件运行后会持久化到记忆库 logs/ 目录）。") : el("div", { style: {
				flexDirection: "column",
				gap: 8,
				display: "flex"
			} }, ...logLines)), el("div", { className: "dm-card" }, el("div", { className: "dm-row" }, el("span", { className: "dm-label" }, "记忆库管理"), el("span", { style: { flex: 1 } }), el("button", {
				className: "dm-btn primary",
				disabled: busy,
				onClick: () => {
					openEditor();
				}
			}, "打开记忆库")), el("p", { className: "dm-dimmed" }, "查看、编辑或删除记忆库文件（MEMORY.md、会话回顾、ad hoc 笔记等）。编辑记忆文件属于高级操作，正常交由管道的自动提取与整合即可。")), el("div", { className: "dm-card" }, el("label", { className: "dm-check" }, el("input", {
				type: "checkbox",
				checked: form.enabled === true,
				disabled: busy,
				onChange: (event) => set("enabled", event.target.checked)
			}), "启用长期记忆管道（提取、整合与摘要注入）"), el("div", { className: "dm-grid" }, num("会话结束后防抖（分钟）", "idleDebounceMinutes", "轮次结束后的静默时长，默认 3 分钟"), num("整合冷却（小时）", "cooldownHours", "两次自动整合的最小间隔，默认 6 小时"), num("每轮处理会话数", "maxRolloutsPerRun", "每次管道运行提取的会话数上限"), num("注入摘要上限（字符）", "maxSummaryChars", "memory_summary.md 注入 system prompt 的截断上限"), num("整合输出 token 上限", "phase2MaxTokens", "整合需全量重写 MEMORY.md，输出大时容易截断；当前上限可调至 131072，建议 65536"), num("遗忘阈值（天）", "maxUnusedDays", "超过该天数未被查阅的回顾会被标注为候选遗忘，可在整合时退役到 .retired/；0 = 关闭遗忘机制，默认 30 天")), el("div", { className: "dm-grid" }, el("div", { className: "dm-field" }, el("div", { className: "dm-label" }, "记忆管道模型提供方（可选）"), providerSelect, el("p", { className: "dm-dimmed" }, "留空使用部署默认模型；列表来自 设置 → 模型 中已注册的提供方")), el("div", { className: "dm-field" }, el("div", { className: "dm-label" }, "记忆管道模型（可选）"), modelControl, provider !== "" ? el("label", { className: "dm-check" }, el("input", {
				type: "checkbox",
				checked: manualModel,
				disabled: busy,
				onChange: (event) => set("manualModel", event.target.checked)
			}), el("span", { className: "dm-dimmed" }, "手动输入模型 ID")) : el("p", { className: "dm-dimmed" }, "选择提供方后可下拉选择模型"))), el("div", { className: "dm-grid" }, effortSelect("phase1ReasoningEffort", "Phase 1 提取 · 推理等级", "Phase 1（逐会话提取）的思考等级：无 = 关闭思考最快，最大 = 推理最深；留空使用该模型的默认等级。"), effortSelect("phase2ReasoningEffort", "Phase 2 整合 · 推理等级", "Phase 2（全局整合进 MEMORY.md）的思考等级；整合适用于更高质量的记忆合并，可单独调高。")), el("div", { className: "dm-row" }, el("button", {
				className: "dm-btn primary",
				disabled: controlsDisabled,
				onClick: save
			}, "保存配置"))), notice === null ? null : el("p", { className: notice.kind === "ok" ? "dm-ok" : "dm-error" }, notice.text), payload.storage === "ok" ? el("p", { className: "dm-dimmed" }, "配置与处理进度已持久化到 DSH 存储（storage: json），重启后自动恢复。") : el("p", { className: "dm-warn" }, `持久化不可用（${payload.storageError || "storage json 后端缺失"}）：进度与配置仅在本次运行期间有效。`), el("p", { className: "dm-dimmed" }, "会话内用法：助手可调用 memory_list / memory_read / memory_search / memory_add（仅在用户明确要求时）工具查阅与更新记忆；工具查阅行为会作为使用记录，供遗忘机制判断哪些回顾已失效。"), el("p", { className: "dm-dimmed" }, "固化技能存放于记忆库 skills/ 目录；若要被 DSH 会话加载，需在 agent 预设的 customSkillDirs 中引用该目录（本插件不修改预设）。"), editorModal);
		}
		const inject = [];
		function apply(ctx) {
			const slots = ctx.get("slots");
			if (slots === void 0) return;
			const style = document.createElement("style");
			style.dataset.plugin = "@nanmicoder/dsh-memory";
			style.dataset.pluginCss = "@nanmicoder/dsh-memory/MemorySettings.css";
			style.textContent = CSS;
			document.head.appendChild(style);
			slots.inject("settings.section", () => slots.register({
				name: "settings.section",
				id: "dsh-memory",
				order: 30,
				label: "长期记忆"
			}, () => react.createElement(MemorySettings)));
			ctx.effect(() => () => {
				style.remove();
			});
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map
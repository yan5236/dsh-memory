/**
 * 记忆库 — the vault page: a 3D memory cloud plus an in-place editor.
 *
 * Opened from the sidebar's 记忆库 entry (slot `sidebar.panellist` renders the
 * icon, slot `main` with key `dsh-memory-vault` renders this page). All data
 * comes from the plugin's own RPC route, so the page never reads files
 * directly and the memory root stays owned by the host side.
 */

import * as React from 'react'
import {
  KIND_COLOR,
  KIND_LABEL,
  MemoryGraph,
  type CloudData,
  type CloudEdge,
  type CloudKind,
  type CloudNode,
} from './graph-canvas.js'

const h = React.createElement

const PANEL_ID = 'dsh-memory-vault'

interface GraphPayload extends CloudData {
  stats: { nodes: number; edges: number; truncated: boolean; generatedAt: number }
}

interface VaultState {
  counts?: { done: number; noop: number; failed: number; running: number; total: number }
  stats?: { rollouts: number; skills: number; notes: number; retired: number; summaryChars: number; memoryChars: number }
  pipeline?: { lastPhase1At: number; lastPhase2At: number; runningPhase1: boolean; runningPhase2: boolean; cooldownRemainingMs: number }
  root?: string
}

const CORE_FILES = new Set(['MEMORY.md', 'memory_summary.md', 'raw_memories.md', 'raw_memories.archive.md'])
const KINDS: CloudKind[] = ['topic', 'summary', 'skill', 'note', 'archive']

const CSS = [
  '.mv{display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);overflow:hidden}',
  '.mv *{box-sizing:border-box}',
  '.mv-head{display:flex;align-items:center;gap:12px;padding:9px 16px;min-height:58px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:0 0 auto}',
  '.mv-brand{display:flex;flex-direction:column;gap:1px;min-width:0;flex:0 0 auto}',
  '.mv-brand b{font-size:14px;font-weight:600;letter-spacing:.3px;line-height:19px}',
  '.mv-brand span{font-size:10.5px;line-height:15px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;max-width:190px;overflow:hidden;text-overflow:ellipsis}',
  '.mv-chips{display:flex;align-items:center;gap:6px;flex-wrap:nowrap;min-width:0;overflow:hidden}',
  '.mv-chip{display:inline-flex;align-items:center;gap:6px;height:25px;padding:0 9px;border-radius:13px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:1;cursor:pointer;white-space:nowrap;transition:background .16s,color .16s,border-color .16s}',
  '.mv-chip:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
  '.mv-chip.on{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent)}',
  '.mv-chip.off{opacity:.55}',
  '.mv-chip i{width:6px;height:6px;border-radius:50%;display:inline-block;flex:0 0 auto}',
  '.mv-chip b{font-weight:600;font-variant-numeric:tabular-nums;font-size:10.5px;color:var(--dsw-alias-label-tertiary)}',
  '.mv-chip.on b{color:var(--dsw-alias-label-secondary)}',
  '.mv-search{position:relative;display:flex;align-items:center;flex:0 1 210px;min-width:110px}',
  '.mv-search input{width:100%;height:28px;border-radius:14px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:0 10px 0 28px;outline:none}',
  '.mv-search input:focus{border-color:var(--dsw-alias-brand-primary)}',
  '.mv-search input::placeholder{color:var(--dsw-alias-label-tertiary)}',
  '.mv-search svg{position:absolute;left:9px;color:var(--dsw-alias-label-tertiary);pointer-events:none}',
  '.mv-actions{margin-left:auto;display:flex;align-items:center;gap:8px;flex:0 0 auto}',
  '.mv-seg{display:inline-flex;align-items:center;height:26px;padding:2px;border-radius:13px;border:1px solid var(--dsw-alias-border-l1);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 70%,#000 6%)}',
  '.mv-seg button{height:22px;min-width:34px;padding:0 9px;border:none;border-radius:11px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:11px;cursor:pointer;font-variant-numeric:tabular-nums;transition:background .16s,color .16s}',
  '.mv-seg button:hover{color:var(--dsw-alias-label-primary)}',
  '.mv-seg button.on{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 30%,transparent);color:var(--dsw-alias-label-primary);font-weight:500}',
  '.mv-btn{height:28px;padding:0 12px;border-radius:14px;font:inherit;font-size:12px;display:inline-flex;align-items:center;justify-content:center;gap:6px;cursor:pointer;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);transition:background .16s,color .16s,border-color .16s;white-space:nowrap}',
  '.mv-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
  '.mv-btn:disabled{opacity:.4;cursor:default}',
  '.mv-btn.primary{background:#4f7cff;border-color:transparent;color:#ffffff;font-weight:500}',
  '.mv-btn.primary:hover:not(:disabled){background:#5f89ff;color:#ffffff}',
  '.mv-btn.icon{width:28px;padding:0}',
  '.mv-btn.full{width:100%;height:34px;border-radius:17px;font-size:13px}',
  '.mv-body{flex:1 1 auto;display:flex;min-height:0;position:relative}',
  '.mv-cloud{position:relative;flex:1 1 auto;min-width:0;overflow:hidden;background:radial-gradient(120% 100% at 50% -12%,rgba(98,124,255,.14),transparent 62%),radial-gradient(90% 80% at 88% 110%,rgba(140,90,255,.10),transparent 58%),var(--dsw-alias-bg-layer-1)}',
  '.mv-cloud canvas{display:block;width:100%;height:100%;cursor:grab}',
  '.mv-cloud canvas:active{cursor:grabbing}',
  '.mv-hint{position:absolute;left:16px;bottom:11px;font-size:10.5px;color:var(--dsw-alias-label-tertiary);pointer-events:none;letter-spacing:.2px}',
  '.mv-count{position:absolute;right:14px;bottom:11px;font-size:10.5px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;pointer-events:none}',
  '.mv-overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;pointer-events:none}',
  '.mv-overlay.card{pointer-events:auto}',
  '.mv-card{max-width:340px;display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center;padding:22px 24px;border-radius:14px;border:1px solid var(--dsw-alias-border-l1);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 88%,transparent);backdrop-filter:blur(6px)}',
  '.mv-card b{font-size:13px;font-weight:600}',
  '.mv-card p{margin:0;font-size:12px;line-height:19px;color:var(--dsw-alias-label-tertiary)}',
  '.mv-skel{width:180px;display:flex;flex-direction:column;gap:8px}',
  '.mv-skel i{height:8px;border-radius:4px;background:var(--dsw-alias-interactive-bg-hover);animation:mvpulse 1.4s ease-in-out infinite}',
  '.mv-skel i:nth-child(2){width:72%;animation-delay:.15s}',
  '.mv-skel i:nth-child(3){width:46%;animation-delay:.3s}',
  '@keyframes mvpulse{0%,100%{opacity:.35}50%{opacity:.85}}',
  '.mv-side{flex:0 0 356px;width:356px;display:flex;flex-direction:column;min-height:0;overflow:hidden;border-left:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}',
  '.mv-side.fold{flex-basis:0;width:0;border-left:none;overflow:hidden}',
  '.mv-side-head{display:flex;align-items:flex-start;gap:8px;padding:16px 16px 10px;flex:0 0 auto}',
  '.mv-badge{display:inline-flex;align-items:center;height:19px;padding:0 8px;border-radius:10px;font-size:10.5px;letter-spacing:.3px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary);white-space:nowrap}',
  '.mv-close{margin-left:auto;width:24px;height:24px;border-radius:12px;border:none;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;display:inline-flex;align-items:center;justify-content:center}',
  '.mv-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
  '.mv-side-body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:0 16px 12px;display:flex;flex-direction:column;gap:14px}',
  '.mv-title{margin:0;font-size:14.5px;line-height:22px;font-weight:600;word-break:break-word}',
  '.mv-cap{font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}',
  '.mv-path{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;line-height:17px;color:var(--dsw-alias-label-tertiary);word-break:break-all;padding:7px 9px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 60%,#000 8%)}',
  '.mv-meta{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}',
  '.mv-meta div{display:flex;flex-direction:column;gap:1px}',
  '.mv-meta b{font-size:13px;font-weight:600;font-variant-numeric:tabular-nums}',
  '.mv-meta span{font-size:10px;color:var(--dsw-alias-label-tertiary)}',
  '.mv-preview{margin:0;font-size:12.5px;line-height:20px;color:var(--dsw-alias-label-secondary);max-height:120px;overflow:hidden;-webkit-mask-image:linear-gradient(180deg,#000 70%,transparent);mask-image:linear-gradient(180deg,#000 70%,transparent)}',
  '.mv-rel{display:flex;flex-direction:column;gap:3px}',
  '.mv-relrow{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;border:1px solid transparent;background:transparent;width:100%;text-align:left;font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer}',
  '.mv-relrow:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary)}',
  '.mv-relrow i{width:6px;height:6px;border-radius:50%;flex:0 0 auto}',
  '.mv-relrow span{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1 1 auto}',
  '.mv-relrow em{font-style:normal;font-size:9.5px;color:var(--dsw-alias-label-tertiary);flex:0 0 auto}',
  '.mv-side-foot{flex:0 0 auto;padding:12px 16px 14px;border-top:1px solid var(--dsw-alias-border-l1);display:flex;flex-direction:column;gap:8px}',
  '.mv-status{font-size:10.5px;line-height:16px;color:var(--dsw-alias-label-tertiary);display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
  '.mv-status button{border:none;background:transparent;color:var(--dsw-alias-state-warn-label);cursor:pointer;font:inherit;font-size:10.5px;text-decoration:underline;padding:0}',
  '.mv-editor{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;overflow:hidden}',
  '.mv-editor-head{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:0 0 auto}',
  '.mv-editor-path{flex:1 1 auto;min-width:0;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.mv-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-warn-primary);flex:0 0 auto}',
  '.mv-textarea{flex:1 1 auto;min-height:0;width:100%;border:none;outline:none;resize:none;background:transparent;color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;line-height:20px;padding:12px 14px;tab-size:2}',
  '.mv-editor-foot{display:flex;align-items:center;gap:8px;padding:9px 12px;border-top:1px solid var(--dsw-alias-border-l1);flex:0 0 auto}',
  '.mv-editor-foot span{font-size:10.5px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}',
  '.mv-warn{margin:0 12px;padding:7px 10px;border-radius:8px;font-size:11px;line-height:17px;color:var(--dsw-alias-state-warn-label);border:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 9%,transparent)}',
  '.mv-err{color:var(--dsw-alias-state-error-primary)}',
  '.mv-toast{position:absolute;left:50%;bottom:26px;transform:translateX(-50%);display:flex;align-items:center;gap:8px;padding:8px 15px;border-radius:999px;font-size:12px;color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 82%,#000 18%);box-shadow:0 10px 28px rgba(0,0,0,.34);animation:mvrise .18s ease-out}',
  '.mv-toast.bad{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 55%,transparent)}',
  '@keyframes mvrise{from{opacity:0;transform:translateX(-50%) translateY(6px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}',
  '@media (max-width:1180px){.mv-side{flex-basis:320px;width:320px}.mv-chips{display:none}}',
  '@media (max-width:900px){.mv-side{flex-basis:290px;width:290px}.mv-brand span{display:none}}',
].join('')

const MODE_KEY = 'dsh-memory-vault-mode'

function storedMode(): '3d' | '2d' {
  try {
    return window.localStorage.getItem(MODE_KEY) === '2d' ? '2d' : '3d'
  } catch {
    return '3d'
  }
}

function ensureStyle(): void {
  if (document.head.querySelector('style[data-dsh-memory-vault]') !== null) return
  const style = document.createElement('style')
  style.dataset.dshMemoryVault = 'true'
  style.textContent = CSS
  document.head.appendChild(style)
}

interface RpcResult {
  ok?: boolean
  message?: string
}

async function rpc(method: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const response = await fetch('/dsh-memory/rpc', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, args }),
  })
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) {
    const message = typeof payload.message === 'string' ? payload.message : `请求失败（HTTP ${response.status}）`
    throw new Error(message)
  }
  return payload
}

function fmtChars(count: number): string {
  if (count < 1024) return `${count} 字`
  if (count < 1024 * 1024) return `${(count / 1024).toFixed(1)}K`
  return `${(count / 1024 / 1024).toFixed(1)}M`
}

function fmtWhen(ms: number): string {
  if (ms <= 0) return '从未'
  const delta = Date.now() - ms
  if (delta < 60_000) return '刚刚'
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)} 分钟前`
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)} 小时前`
  return `${Math.round(delta / 86_400_000)} 天前`
}

function shortPath(path: string): string {
  return path.replace(/^rollout_summaries\//, '回顾/').replace(/^skills\//, '技能/')
}

function iconSearch(): React.ReactNode {
  return h('svg', { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
    h('circle', { cx: 7, cy: 7, r: 4.6, stroke: 'currentColor', strokeWidth: 1.4 }),
    h('path', { d: 'M10.6 10.6 14 14', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }))
}

function iconRefresh(): React.ReactNode {
  return h('svg', { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
    h('path', { d: 'M13 8a5 5 0 1 1-1.6-3.7', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
    h('path', { d: 'M13 2.6V5.4h-2.8', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }))
}

function iconClose(): React.ReactNode {
  return h('svg', { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
    h('path', { d: 'm4 4 8 8M12 4l-8 8', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }))
}

function iconShuffle(): React.ReactNode {
  return h('svg', { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
    h('path', { d: 'M2 4h3.2c1 0 1.6.4 2.2 1.2l1.2 1.6c.6.8 1.2 1.2 2.2 1.2H14', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
    h('path', { d: 'M12 6.4 14 8l-2 1.6', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    h('path', { d: 'M2 12h3.2c1 0 1.6-.4 2.2-1.2l.5-.7', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }))
}

/** Sidebar icon: a small constellation, drawn as inline SVG (no host imports). */
export function VaultPanelIcon(props: { size?: number; active?: boolean }): React.ReactNode {
  const size = typeof props.size === 'number' ? props.size : 18
  const color = props.active === true ? 'var(--dsw-alias-brand-primary)' : 'currentColor'
  return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true, style: { color } },
    h('path', {
      d: 'M7 8.5 12 5l5 3.5v7L12 19l-5-3.5z',
      stroke: 'currentColor',
      strokeWidth: 1.3,
      strokeLinejoin: 'round',
      opacity: 0.85,
    }),
    h('circle', { cx: 7, cy: 8.5, r: 1.9, fill: 'currentColor' }),
    h('circle', { cx: 17, cy: 8.5, r: 1.5, fill: 'currentColor', opacity: 0.7 }),
    h('circle', { cx: 12, cy: 19, r: 1.6, fill: 'currentColor', opacity: 0.8 }),
    h('circle', { cx: 12, cy: 5, r: 1.2, fill: 'currentColor', opacity: 0.55 }))
}

interface Neighbour {
  node: CloudNode
  kind: 'cite' | 'relate'
}

export function MemoryVaultPage(): React.ReactNode {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const graphRef = React.useRef<MemoryGraph | null>(null)
  const [payload, setPayload] = React.useState<GraphPayload | null>(null)
  const [vault, setVault] = React.useState<VaultState>({})
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [selected, setSelected] = React.useState<string | null>(null)
  const [enabled, setEnabled] = React.useState<Set<CloudKind>>(new Set<CloudKind>(['topic', 'summary', 'skill', 'note']))
  const [query, setQuery] = React.useState('')
  const [folded, setFolded] = React.useState(false)
  const [mode, setMode] = React.useState<'3d' | '2d'>(() => storedMode())
  const [busy, setBusy] = React.useState(false)
  const [editing, setEditing] = React.useState<{ path: string; content: string; original: string } | null>(null)
  const [editorBusy, setEditorBusy] = React.useState(false)
  const [toast, setToast] = React.useState<{ text: string; bad?: boolean } | null>(null)
  const [warned, setWarned] = React.useState(false)

  const nodes = payload?.nodes ?? []
  const edges = payload?.edges ?? []
  const byId = React.useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes])
  const selectedNode = selected === null ? undefined : byId.get(selected)
  const neighbours = React.useMemo<Neighbour[]>(() => {
    if (selected === null) return []
    const out: Neighbour[] = []
    for (const edge of edges) {
      if (edge.from === selected) {
        const node = byId.get(edge.to)
        if (node !== undefined) out.push({ node, kind: edge.kind })
      } else if (edge.to === selected) {
        const node = byId.get(edge.from)
        if (node !== undefined) out.push({ node, kind: edge.kind })
      }
    }
    return out.sort((left, right) => (left.kind === right.kind ? right.node.degree - left.node.degree : left.kind === 'cite' ? -1 : 1))
  }, [edges, selected, byId])
  const kindCounts = React.useMemo(() => {
    const counts = new Map<CloudKind, number>()
    for (const node of nodes) counts.set(node.kind, (counts.get(node.kind) ?? 0) + 1)
    return counts
  }, [nodes])

  const showToast = React.useCallback((text: string, bad = false): void => {
    setToast({ text, bad })
    window.setTimeout(() => setToast(null), 2200)
  }, [])

  const load = React.useCallback(async (quiet = false): Promise<void> => {
    if (!quiet) setLoading(true)
    setError(null)
    try {
      const [graph, state] = await Promise.all([
        rpc('get-graph'),
        rpc('get-state').catch(() => ({})),
      ])
      const next = graph as unknown as GraphPayload
      setPayload(next)
      setVault(state as VaultState)
      if (selected !== null && !next.nodes.some(node => node.id === selected)) setSelected(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  React.useEffect(() => { ensureStyle() }, [])
  React.useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return undefined
    const graph = new MemoryGraph(canvas, {
      onSelect: (id) => { setSelected(id) },
    })
    graphRef.current = graph
    return () => {
      graph.dispose()
      graphRef.current = null
    }
  }, [])

  React.useEffect(() => {
    const graph = graphRef.current
    if (graph === null || payload === null) return
    graph.setData({ nodes: payload.nodes, edges: payload.edges })
    graph.setVisibleKinds(enabled)
  }, [payload, enabled])

  React.useEffect(() => {
    graphRef.current?.setSearch(query)
  }, [query])

  React.useEffect(() => {
    graphRef.current?.setSelected(selected)
  }, [selected])

  React.useEffect(() => {
    graphRef.current?.setMode(mode)
    try {
      window.localStorage.setItem(MODE_KEY, mode)
    } catch {
      // Private mode / storage disabled: the choice simply doesn't persist.
    }
  }, [mode])

  const focusNode = React.useCallback((id: string | null): void => {
    setSelected(id)
    setFolded(false)
  }, [])

  const openEditor = React.useCallback(async (node: CloudNode): Promise<void> => {
    setEditorBusy(true)
    try {
      const result = await rpc('read-file', { path: node.path })
      const content = typeof result.content === 'string' ? result.content : ''
      setEditing({ path: node.path, content, original: content })
      setFolded(false)
    } catch (readError) {
      showToast(readError instanceof Error ? readError.message : String(readError), true)
    } finally {
      setEditorBusy(false)
    }
  }, [showToast])

  const save = React.useCallback(async (): Promise<void> => {
    if (editing === null) return
    setEditorBusy(true)
    try {
      const result = await rpc('write-file', { path: editing.path, content: editing.content }) as RpcResult
      if (result.ok === false) throw new Error(result.message ?? '写入失败')
      setEditing({ path: editing.path, content: editing.content, original: editing.content })
      showToast(`已保存 · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`)
      await load(true)
    } catch (writeError) {
      showToast(writeError instanceof Error ? writeError.message : String(writeError), true)
    } finally {
      setEditorBusy(false)
    }
  }, [editing, load, showToast])

  const runPipeline = React.useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      await rpc('run-pipeline')
      await load(true)
      showToast('整理已触发')
    } catch (runError) {
      showToast(runError instanceof Error ? runError.message : String(runError), true)
    } finally {
      setBusy(false)
    }
  }, [load, showToast])

  const retryFailures = React.useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await rpc('reset-failures')
      const reset = typeof result.reset === 'number' ? result.reset : 0
      await load(true)
      showToast(reset > 0 ? `已重新排队 ${reset} 个会话` : '没有需要重试的会话')
    } catch (retryError) {
      showToast(retryError instanceof Error ? retryError.message : String(retryError), true)
    } finally {
      setBusy(false)
    }
  }, [load, showToast])

  const toggleKind = (kind: CloudKind): void => {
    setEnabled(previous => {
      const next = new Set(previous)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }

  const failedCount = vault.counts?.failed ?? 0
  const lastRun = vault.pipeline?.lastPhase1At ?? 0

  return h('div', { className: 'mv' },
    h('div', { className: 'mv-head' },
      h('div', { className: 'mv-brand' },
        h('b', null, '记忆库'),
        h('span', null, `${nodes.length} 个节点 · ${edges.length} 条关联`)),
      h('div', { className: 'mv-chips' },
        KINDS.map(kind => {
          const count = kindCounts.get(kind) ?? 0
          if (count === 0 && kind === 'archive') return null
          const on = enabled.has(kind)
          return h('button', {
            key: kind,
            type: 'button',
            className: `mv-chip ${on ? 'on' : 'off'}`,
            title: `${on ? '隐藏' : '显示'}${KIND_LABEL[kind]}`,
            onClick: () => toggleKind(kind),
          },
            h('i', { style: { background: KIND_COLOR[kind] } }),
            KIND_LABEL[kind],
            h('b', null, String(count)))
        })),
      h('label', { className: 'mv-search' },
        iconSearch(),
        h('input', {
          value: query,
          placeholder: '搜索记忆…',
          spellCheck: false,
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value),
        })),
      h('div', { className: 'mv-actions' },
        h('div', { className: 'mv-seg', role: 'group', title: '切换 3D 云图 / 2D 关联图' },
          h('button', {
            type: 'button',
            className: mode === '3d' ? 'on' : '',
            title: '3D 云图：拖动旋转、滚轮缩放',
            onClick: () => setMode('3d'),
          }, '3D'),
          h('button', {
            type: 'button',
            className: mode === '2d' ? 'on' : '',
            title: '2D 关联图：拖动平移、滚轮缩放',
            onClick: () => setMode('2d'),
          }, '2D')),
        h('button', {
          type: 'button',
          className: 'mv-btn',
          disabled: busy,
          title: '重新读取记忆库',
          onClick: () => { void load() },
        }, iconRefresh(), '刷新'),
        h('button', {
          type: 'button',
          className: 'mv-btn icon',
          title: '重新布局',
          onClick: () => graphRef.current?.relayout(),
        }, iconShuffle()),
        h('button', {
          type: 'button',
          className: 'mv-btn icon',
          title: folded ? '展开详情' : '收起详情',
          onClick: () => setFolded(value => !value),
        }, h('svg', { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
          h('rect', { x: 2, y: 3, width: 12, height: 10, rx: 2, stroke: 'currentColor', strokeWidth: 1.3 }),
          h('path', { d: 'M10 3v10', stroke: 'currentColor', strokeWidth: 1.3 }))))),

    h('div', { className: 'mv-body' },
      h('div', { className: 'mv-cloud' },
        h('canvas', { ref: canvasRef }),
        loading && payload === null
          ? h('div', { className: 'mv-overlay' }, h('div', { className: 'mv-skel' }, h('i'), h('i'), h('i')))
          : null,
        error !== null
          ? h('div', { className: 'mv-overlay card' },
            h('div', { className: 'mv-card' },
              h('b', { className: 'mv-err' }, '记忆库读取失败'),
              h('p', null, error),
              h('button', { type: 'button', className: 'mv-btn', onClick: () => { void load() } }, '重试')))
          : null,
        error === null && payload !== null && payload.nodes.length === 0
          ? h('div', { className: 'mv-overlay card' },
            h('div', { className: 'mv-card' },
              h('b', null, '记忆库还是空的'),
              h('p', null, '还没有可展示的记忆。跑一次整理，插件会把近期会话提炼成回顾与手册，这里就会长出第一张网。'),
              h('button', {
                type: 'button',
                className: 'mv-btn primary',
                disabled: busy,
                onClick: () => { void runPipeline() },
              }, busy ? '正在整理…' : '运行一次整理')))
          : null,
        h('div', { className: 'mv-hint' },
          mode === '3d' ? '拖动旋转 · 滚轮缩放 · 单击查看 · 双击复位' : '拖动平移 · 滚轮缩放 · 单击查看 · 双击复位'),
        h('div', { className: 'mv-count' },
          `${enabled.size} 类 · ${nodes.filter(node => enabled.has(node.kind)).length} 节点`),
        toast === null ? null : h('div', { className: `mv-toast ${toast.bad === true ? 'bad' : ''}` }, toast.text)),

      h('div', { className: `mv-side ${folded ? 'fold' : ''}` },
        editing === null
          ? h(Inspector, {
            node: selectedNode,
            neighbours,
            busy,
            failedCount,
            lastRun,
            onClose: () => setSelected(null),
            onPick: (id: string) => focusNode(id),
            onEdit: (node: CloudNode) => { void openEditor(node) },
            onRetryFailures: () => { void retryFailures() },
          })
          : h('div', { className: 'mv-editor' },
            h('div', { className: 'mv-editor-head' },
              h('button', {
                type: 'button',
                className: 'mv-btn icon',
                title: '返回详情',
                onClick: () => setEditing(null),
              }, h('svg', { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
                h('path', { d: 'M10 3 5 8l5 5', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }))),
              editing.content !== editing.original ? h('i', { className: 'mv-dot', title: '有未保存修改' }) : null,
              h('div', { className: 'mv-editor-path', title: editing.path }, shortPath(editing.path))),
            CORE_FILES.has(editing.path) && !warned
              ? h('p', { className: 'mv-warn' },
                '这是管道自动维护的核心文件：下次整合会整体重写它的部分内容，手工修改可能被覆盖。',
                h('button', {
                  type: 'button',
                  className: 'mv-btn',
                  style: { marginLeft: 8, height: 22, padding: '0 8px', fontSize: 11 },
                  onClick: () => setWarned(true),
                }, '知道了'))
              : null,
            h('textarea', {
              className: 'mv-textarea',
              value: editing.content,
              spellCheck: false,
              onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => setEditing({
                path: editing.path,
                content: event.target.value,
                original: editing.original,
              }),
              onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
                if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                  event.preventDefault()
                  void save()
                }
              },
            }),
            h('div', { className: 'mv-editor-foot' },
              h('button', {
                type: 'button',
                className: 'mv-btn primary',
                disabled: editorBusy || editing.content === editing.original,
                onClick: () => { void save() },
              }, editorBusy ? '保存中…' : '保存'),
              h('button', {
                type: 'button',
                className: 'mv-btn',
                disabled: editorBusy || editing.content === editing.original,
                onClick: () => setEditing({ path: editing.path, content: editing.original, original: editing.original }),
              }, '还原'),
              h('span', { style: { marginLeft: 'auto' } }, `${editing.content.length} 字 · Ctrl+S 保存`)))))
  )
}

interface InspectorProps {
  node: CloudNode | undefined
  neighbours: Neighbour[]
  busy: boolean
  failedCount: number
  lastRun: number
  onClose: () => void
  onPick: (id: string) => void
  onEdit: (node: CloudNode) => void
  onRetryFailures: () => void
}

function Inspector(props: InspectorProps): React.ReactNode {
  const { node, neighbours } = props
  if (node === undefined) {
    return h(React.Fragment, null,
      h('div', { className: 'mv-side-head' },
        h('span', { className: 'mv-badge' }, '记忆库'),
        h('div', { style: { marginLeft: 'auto' }, className: 'mv-cap' }, `${neighbours.length} 条关联`)),
      h('div', { className: 'mv-side-body' },
        h('p', { className: 'mv-title', style: { fontSize: 13, fontWeight: 500 } }, '点击云图里的节点'),
        h('p', { className: 'mv-preview' },
          '节点之间实线是手册里明确引用的证据，虚线是关键词相近的联想。选一个节点，就能看到它连着谁，并直接修改对应的记忆文件。'),
        h('div', { className: 'mv-meta' },
          h('div', null, h('b', null, '3D'), h('span', null, '关联云图')),
          h('div', null, h('b', null, '就地'), h('span', null, '编辑记忆')),
          h('div', null, h('b', null, '自动'), h('span', null, '引用追踪')))),
      h('div', { className: 'mv-side-foot' },
        h('div', { className: 'mv-status' },
          h('span', null, `上次整理：${fmtWhen(props.lastRun)}`),
          props.failedCount > 0
            ? h('button', { type: 'button', disabled: props.busy, onClick: props.onRetryFailures }, `${props.failedCount} 个会话失败 · 重试`)
            : null)))
  }
  return h(React.Fragment, null,
    h('div', { className: 'mv-side-head' },
      h('span', {
        className: 'mv-badge',
        style: { color: KIND_COLOR[node.kind], borderColor: `color-mix(in srgb,${KIND_COLOR[node.kind]} 45%,transparent)` },
      }, KIND_LABEL[node.kind]),
      h('button', { type: 'button', className: 'mv-close', title: '取消选择', onClick: props.onClose }, iconClose())),
    h('div', { className: 'mv-side-body' },
      h('h2', { className: 'mv-title' }, node.label),
      h('div', null,
        h('div', { className: 'mv-cap', style: { marginBottom: 5 } }, '文件'),
        h('div', { className: 'mv-path' }, node.path)),
      h('div', { className: 'mv-meta' },
        h('div', null, h('b', null, fmtChars(node.chars)), h('span', null, '体积')),
        h('div', null, h('b', null, fmtWhen(node.at)), h('span', null, '更新')),
        h('div', null, h('b', null, String(node.degree)), h('span', null, '关联'))),
      node.preview === undefined || node.preview === ''
        ? null
        : h('div', null,
          h('div', { className: 'mv-cap', style: { marginBottom: 5 } }, '摘要'),
          h('p', { className: 'mv-preview' }, node.preview)),
      h('div', null,
        h('div', { className: 'mv-cap', style: { marginBottom: 6 } }, `关联 · ${neighbours.length}`),
        h('div', { className: 'mv-rel' },
          neighbours.length === 0
            ? h('p', { className: 'mv-preview', style: { maxHeight: 'none' } }, '这个节点还没连上别人，整理几次后会自动长出关联。')
            : neighbours.slice(0, 14).map(entry => h('button', {
              key: entry.node.id,
              type: 'button',
              className: 'mv-relrow',
              title: entry.node.path,
              onClick: () => props.onPick(entry.node.id),
            },
              h('i', { style: { background: KIND_COLOR[entry.node.kind] } }),
              h('span', null, entry.node.label),
              h('em', null, entry.kind === 'cite' ? '引用' : '相近')))))),
    h('div', { className: 'mv-side-foot' },
      h('button', {
        type: 'button',
        className: 'mv-btn primary full',
        onClick: () => props.onEdit(node),
      }, '编辑这份记忆'),
      h('div', { className: 'mv-status' },
        h('span', null, `上次整理：${fmtWhen(props.lastRun)}`),
        props.failedCount > 0
          ? h('button', { type: 'button', disabled: props.busy, onClick: props.onRetryFailures }, `${props.failedCount} 个会话失败 · 重试`)
          : null)))
}

export { PANEL_ID }

/**
 * 3D memory cloud renderer.
 *
 * Framework-free on purpose: the vault page owns React, this module owns the
 * canvas, the force layout and the pointer maths. Nothing here imports React
 * or any host package, so it can also run from a standalone preview page.
 */
export type CloudKind = 'topic' | 'summary' | 'skill' | 'note' | 'archive';
export interface CloudNode {
    id: string;
    label: string;
    kind: CloudKind;
    path: string;
    chars: number;
    at: number;
    degree: number;
    preview?: string;
}
export interface CloudEdge {
    from: string;
    to: string;
    kind: 'cite' | 'relate';
    weight: number;
}
export interface CloudData {
    nodes: CloudNode[];
    edges: CloudEdge[];
}
export interface CloudOptions {
    onSelect?: (id: string | null) => void;
    onHover?: (id: string | null) => void;
}
export declare const KIND_COLOR: Record<CloudKind, string>;
export declare const KIND_LABEL: Record<CloudKind, string>;
/** The 3D cloud canvas: layout, projection, painting and pointer handling. */
export declare class MemoryGraph {
    private readonly canvas;
    private readonly ctx;
    private readonly options;
    private bodies;
    private links;
    private index;
    private projected;
    private visible;
    private selected;
    private hovered;
    private query;
    private yaw;
    private pitch;
    private zoom;
    private spin;
    private spinVelocity;
    /** Presentation mode: orbiting 3D cloud or a flat 2D relation map. */
    private mode;
    /** Screen-space pan, used by the 2D map. */
    private panX;
    private panY;
    private dragging;
    private dragMoved;
    private lastX;
    private lastY;
    private pointerX;
    private pointerY;
    private inside;
    private raf;
    private frame;
    private disposed;
    private width;
    private height;
    private dpr;
    private readonly resizeObserver;
    private readonly onPointerDown;
    private readonly onPointerMove;
    private readonly onPointerUp;
    private readonly onPointerLeave;
    private readonly onWheel;
    private readonly onDoubleClick;
    private readonly onVisibility;
    constructor(canvas: HTMLCanvasElement, options?: CloudOptions);
    /** Replace the graph and seed a deterministic spherical layout. */
    setData(data: CloudData): void;
    /** Restrict the cloud to the given artifact kinds. */
    setVisibleKinds(kinds: Iterable<CloudKind>): void;
    setSearch(query: string): void;
    getSelected(): string | null;
    /**
     * Set the selected node. The page is notified only when the value actually
     * changes, so an in-canvas click reaches the inspector while the page's own
     * sync call (same value) stays silent.
     */
    setSelected(id: string | null): void;
    /** Bring one node into focus without changing the selection source of truth. */
    focus(id: string): void;
    /** Switch between the orbiting 3D cloud and the flat 2D relation map. */
    setMode(mode: '3d' | '2d'): void;
    getMode(): '3d' | '2d';
    resetView(): void;
    /** Re-seed the spherical layout (used by the page's "重新布局" action). */
    relayout(): void;
    resize(): void;
    dispose(): void;
    private isVisible;
    private loop;
    private needsFrame;
    private stopLoop;
    private tick;
    /** One force-layout integration step over the visible subgraph. */
    private step;
    private project;
    private paint;
    private paintTooltip;
    private hitTest;
    private updateHover;
}
//# sourceMappingURL=graph-canvas.d.ts.map
/**
 * 3D memory cloud renderer.
 *
 * Framework-free on purpose: the vault page owns React, this module owns the
 * canvas, the force layout and the pointer maths. Nothing here imports React
 * or any host package, so it can also run from a standalone preview page.
 */
export const KIND_COLOR = {
    topic: '#7ea6ff',
    summary: '#9b8cff',
    skill: '#45d6c4',
    note: '#f2c078',
    archive: '#7c8598',
};
export const KIND_LABEL = {
    topic: '主题',
    summary: '回顾',
    skill: '技能',
    note: '笔记',
    archive: '归档',
};
/** Repulsion strength between every node pair. */
const REPULSION = 175;
/** Spring stiffness and natural length for linked nodes. */
const SPRING = 0.035;
const SPRING_LEN = 38;
/** Weak pull towards the origin keeps the cloud compact. */
const CENTER_PULL = 0.0055;
/** Velocity damping per step. */
const DAMPING = 0.86;
/** Hard clamp so a bad frame can never explode the layout. */
const MAX_SPEED = 3.2;
const MAX_NODES = 420;
/** Perspective focal length in world units. */
const FOCAL = 300;
function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
}
function mixColor(hex, alpha) {
    const value = hex.replace('#', '');
    const r = Number.parseInt(value.slice(0, 2), 16);
    const g = Number.parseInt(value.slice(2, 4), 16);
    const b = Number.parseInt(value.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
function radiusFor(node) {
    const size = Math.log2(Math.max(8, node.chars) + 8) * 0.78;
    return clamp(3.4 + size + Math.min(3, node.degree * 0.55), 4, 13);
}
/** The 3D cloud canvas: layout, projection, painting and pointer handling. */
export class MemoryGraph {
    canvas;
    ctx;
    options;
    bodies = [];
    links = [];
    index = new Map();
    projected = [];
    visible = new Set(['topic', 'summary', 'skill', 'note']);
    selected = null;
    hovered = null;
    query = '';
    yaw = -0.32;
    pitch = 0.26;
    zoom = 1;
    spin = 0;
    spinVelocity = 0.0009;
    /** Presentation mode: orbiting 3D cloud or a flat 2D relation map. */
    mode = '3d';
    /** Screen-space pan, used by the 2D map. */
    panX = 0;
    panY = 0;
    dragging = false;
    dragMoved = 0;
    lastX = 0;
    lastY = 0;
    pointerX = 0;
    pointerY = 0;
    inside = false;
    raf = 0;
    frame = 0;
    disposed = false;
    width = 0;
    height = 0;
    dpr = 1;
    resizeObserver;
    onPointerDown;
    onPointerMove;
    onPointerUp;
    onPointerLeave;
    onWheel;
    onDoubleClick;
    onVisibility;
    constructor(canvas, options = {}) {
        const ctx = canvas.getContext('2d');
        if (ctx === null)
            throw new Error('memory cloud: 2d canvas context unavailable');
        this.canvas = canvas;
        this.ctx = ctx;
        this.options = options;
        this.canvas.style.touchAction = 'none';
        this.onPointerDown = (event) => {
            if (event.button !== 0)
                return;
            this.dragging = true;
            this.dragMoved = 0;
            this.lastX = event.clientX;
            this.lastY = event.clientY;
            // Track the press point too: a click without a preceding move still selects.
            const rect = this.canvas.getBoundingClientRect();
            this.pointerX = event.clientX - rect.left;
            this.pointerY = event.clientY - rect.top;
            this.canvas.setPointerCapture(event.pointerId);
            this.loop(true);
        };
        this.onPointerMove = (event) => {
            const rect = this.canvas.getBoundingClientRect();
            this.pointerX = event.clientX - rect.left;
            this.pointerY = event.clientY - rect.top;
            this.inside = true;
            if (this.dragging) {
                const dx = event.clientX - this.lastX;
                const dy = event.clientY - this.lastY;
                this.dragMoved += Math.abs(dx) + Math.abs(dy);
                this.lastX = event.clientX;
                this.lastY = event.clientY;
                if (this.mode === '2d') {
                    this.panX += dx;
                    this.panY += dy;
                }
                else {
                    this.yaw += dx * 0.007;
                    this.pitch = clamp(this.pitch + dy * 0.006, -1.32, 1.32);
                    this.spinVelocity = clamp(dx * 0.00045, -0.012, 0.012);
                    this.spin = 0;
                }
                return;
            }
            this.updateHover();
        };
        this.onPointerUp = (event) => {
            if (!this.dragging)
                return;
            this.dragging = false;
            if (this.canvas.hasPointerCapture(event.pointerId))
                this.canvas.releasePointerCapture(event.pointerId);
            if (this.dragMoved < 5) {
                const hit = this.hitTest(this.pointerX, this.pointerY);
                this.setSelected(hit);
            }
        };
        this.onPointerLeave = () => {
            this.inside = false;
            this.hovered = null;
            this.options.onHover?.(null);
        };
        this.onWheel = (event) => {
            event.preventDefault();
            this.zoom = clamp(this.zoom * (event.deltaY > 0 ? 0.92 : 1.08), 0.45, 2.6);
        };
        this.onDoubleClick = () => {
            this.resetView();
        };
        this.onVisibility = () => {
            if (document.hidden)
                this.stopLoop();
            else
                this.loop(false);
        };
        canvas.addEventListener('pointerdown', this.onPointerDown);
        canvas.addEventListener('pointermove', this.onPointerMove);
        canvas.addEventListener('pointerup', this.onPointerUp);
        canvas.addEventListener('pointercancel', this.onPointerUp);
        canvas.addEventListener('pointerleave', this.onPointerLeave);
        canvas.addEventListener('wheel', this.onWheel, { passive: false });
        canvas.addEventListener('dblclick', this.onDoubleClick);
        document.addEventListener('visibilitychange', this.onVisibility);
        if (typeof ResizeObserver === 'function') {
            this.resizeObserver = new ResizeObserver(() => this.resize());
            this.resizeObserver.observe(canvas);
        }
        else {
            this.resizeObserver = undefined;
        }
        this.resize();
        this.loop(false);
    }
    /** Replace the graph and seed a deterministic spherical layout. */
    setData(data) {
        const nodes = data.nodes.slice(0, MAX_NODES);
        const count = nodes.length;
        this.bodies = new Array(count);
        this.index = new Map();
        for (let position = 0; position < count; position += 1) {
            const node = nodes[position];
            if (node === undefined)
                continue;
            this.index.set(node.id, position);
            // Fibonacci sphere keeps the seed evenly spread instead of a random clump.
            const phi = Math.acos(1 - (2 * (position + 0.5)) / Math.max(1, count));
            const theta = Math.PI * (1 + Math.sqrt(5)) * (position + 0.5);
            const shell = 90 + ((position * 37) % 40);
            this.bodies[position] = {
                node,
                x: Math.cos(theta) * Math.sin(phi) * shell,
                y: Math.cos(phi) * shell,
                z: Math.sin(theta) * Math.sin(phi) * shell,
                vx: 0,
                vy: 0,
                vz: 0,
                fx: 0,
                fy: 0,
                fz: 0,
                radius: radiusFor(node),
            };
        }
        const links = [];
        for (const edge of data.edges) {
            const a = this.index.get(edge.from);
            const b = this.index.get(edge.to);
            if (a === undefined || b === undefined || a === b)
                continue;
            links.push({ a, b, kind: edge.kind, weight: clamp(edge.weight, 0.5, 6) });
        }
        this.links = links;
        if (this.selected !== null && !this.index.has(this.selected))
            this.setSelected(null);
        this.loop(true);
    }
    /** Restrict the cloud to the given artifact kinds. */
    setVisibleKinds(kinds) {
        this.visible = new Set(kinds);
        if (this.selected !== null) {
            const position = this.index.get(this.selected);
            const node = position === undefined ? undefined : this.bodies[position]?.node;
            if (node === undefined || !this.visible.has(node.kind))
                this.setSelected(null);
        }
        this.loop(true);
    }
    setSearch(query) {
        this.query = query.trim().toLowerCase();
        this.loop(true);
    }
    getSelected() {
        return this.selected;
    }
    /**
     * Set the selected node. The page is notified only when the value actually
     * changes, so an in-canvas click reaches the inspector while the page's own
     * sync call (same value) stays silent.
     */
    setSelected(id) {
        const next = id !== null && this.index.has(id) ? id : null;
        if (next === this.selected)
            return;
        this.selected = next;
        this.loop(true);
        this.options.onSelect?.(next);
    }
    /** Bring one node into focus without changing the selection source of truth. */
    focus(id) {
        const position = this.index.get(id);
        if (position === undefined)
            return;
        this.setSelected(this.bodies[position]?.node.id ?? null);
    }
    /** Switch between the orbiting 3D cloud and the flat 2D relation map. */
    setMode(mode) {
        if (mode === this.mode)
            return;
        this.mode = mode;
        this.panX = 0;
        this.panY = 0;
        this.spinVelocity = 0.0009;
        if (mode === '2d') {
            this.yaw = 0;
            this.pitch = 0;
            for (const body of this.bodies) {
                body.vz = 0;
            }
        }
        else {
            this.yaw = -0.32;
            this.pitch = 0.26;
        }
        this.loop(true);
    }
    getMode() {
        return this.mode;
    }
    resetView() {
        this.yaw = -0.32;
        this.pitch = 0.26;
        this.zoom = 1;
        this.panX = 0;
        this.panY = 0;
        this.spinVelocity = 0.0009;
        this.loop(true);
    }
    /** Re-seed the spherical layout (used by the page's "重新布局" action). */
    relayout() {
        const count = this.bodies.length;
        for (let position = 0; position < count; position += 1) {
            const body = this.bodies[position];
            if (body === undefined)
                continue;
            const phi = Math.acos(1 - (2 * (position + 0.5)) / Math.max(1, count));
            const theta = Math.PI * (1 + Math.sqrt(5)) * (position + 0.5);
            const shell = 90 + ((position * 37) % 40);
            body.x = Math.cos(theta) * Math.sin(phi) * shell;
            body.y = Math.cos(phi) * shell;
            body.z = Math.sin(theta) * Math.sin(phi) * shell;
            body.vx = 0;
            body.vy = 0;
            body.vz = 0;
        }
        this.loop(true);
    }
    resize() {
        const rect = this.canvas.getBoundingClientRect();
        const dpr = Math.min(2.5, window.devicePixelRatio || 1);
        const width = Math.max(1, Math.round(rect.width));
        const height = Math.max(1, Math.round(rect.height));
        if (width === this.width && height === this.height && dpr === this.dpr)
            return;
        this.width = width;
        this.height = height;
        this.dpr = dpr;
        this.canvas.width = Math.round(width * dpr);
        this.canvas.height = Math.round(height * dpr);
        this.loop(true);
    }
    dispose() {
        this.disposed = true;
        this.stopLoop();
        this.resizeObserver?.disconnect();
        this.canvas.removeEventListener('pointerdown', this.onPointerDown);
        this.canvas.removeEventListener('pointermove', this.onPointerMove);
        this.canvas.removeEventListener('pointerup', this.onPointerUp);
        this.canvas.removeEventListener('pointercancel', this.onPointerUp);
        this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
        this.canvas.removeEventListener('wheel', this.onWheel);
        this.canvas.removeEventListener('dblclick', this.onDoubleClick);
        document.removeEventListener('visibilitychange', this.onVisibility);
    }
    isVisible(body) {
        return this.visible.has(body.node.kind);
    }
    loop(forceFrame) {
        if (this.disposed)
            return;
        if (forceFrame)
            this.needsFrame = true;
        if (this.raf !== 0)
            return;
        this.raf = window.requestAnimationFrame(() => this.tick());
    }
    needsFrame = false;
    stopLoop() {
        if (this.raf !== 0) {
            window.cancelAnimationFrame(this.raf);
            this.raf = 0;
        }
    }
    tick() {
        this.raf = 0;
        if (this.disposed)
            return;
        this.frame += 1;
        if (!document.hidden) {
            // Idle spin: only in 3D, and only when the user is not steering the camera.
            if (!this.dragging && this.mode === '3d') {
                if (this.selected === null && this.hovered === null) {
                    this.spinVelocity += (0.0009 - this.spinVelocity) * 0.01;
                }
                this.yaw += this.spinVelocity;
                this.spinVelocity *= 0.994;
            }
            const settled = this.frame > 120 && !this.needsFrame && !this.dragging;
            const focused = this.selected !== null || this.hovered !== null || this.inside;
            // Idle: paint every fourth frame so the slow drift stays cheap.
            if (!settled || focused || this.frame % 4 === 0) {
                this.step();
                this.paint();
            }
        }
        this.needsFrame = false;
        this.raf = window.requestAnimationFrame(() => this.tick());
    }
    /** One force-layout integration step over the visible subgraph. */
    step() {
        const bodies = this.bodies;
        const count = bodies.length;
        for (let i = 0; i < count; i += 1) {
            const a = bodies[i];
            if (a === undefined || !this.isVisible(a))
                continue;
            a.fx = -a.x * CENTER_PULL;
            a.fy = -a.y * CENTER_PULL;
            a.fz = -a.z * CENTER_PULL;
        }
        for (let i = 0; i < count; i += 1) {
            const a = bodies[i];
            if (a === undefined || !this.isVisible(a))
                continue;
            for (let j = i + 1; j < count; j += 1) {
                const b = bodies[j];
                if (b === undefined || !this.isVisible(b))
                    continue;
                let dx = a.x - b.x;
                let dy = a.y - b.y;
                let dz = a.z - b.z;
                let distanceSquared = dx * dx + dy * dy + dz * dz;
                if (distanceSquared < 1) {
                    dx = (i % 7) - 3 + 0.5;
                    dy = (j % 5) - 2 + 0.5;
                    dz = ((i + j) % 11) - 5 + 0.5;
                    distanceSquared = dx * dx + dy * dy + dz * dz;
                }
                const force = REPULSION / distanceSquared;
                const distance = Math.sqrt(distanceSquared);
                const nx = (dx / distance) * force;
                const ny = (dy / distance) * force;
                const nz = (dz / distance) * force;
                a.fx += nx;
                a.fy += ny;
                a.fz += nz;
                b.fx -= nx;
                b.fy -= ny;
                b.fz -= nz;
            }
        }
        for (const link of this.links) {
            const a = bodies[link.a];
            const b = bodies[link.b];
            if (a === undefined || b === undefined || !this.isVisible(a) || !this.isVisible(b))
                continue;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dz = b.z - a.z;
            const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy + dz * dz));
            const stretch = distance - SPRING_LEN * (link.kind === 'cite' ? 0.8 : 1);
            const strength = SPRING * (1 + link.weight * 0.25);
            const fx = (dx / distance) * stretch * strength;
            const fy = (dy / distance) * stretch * strength;
            const fz = (dz / distance) * stretch * strength;
            a.fx += fx;
            a.fy += fy;
            a.fz += fz;
            b.fx -= fx;
            b.fy -= fy;
            b.fz -= fz;
        }
        for (let i = 0; i < count; i += 1) {
            const body = bodies[i];
            if (body === undefined || !this.isVisible(body))
                continue;
            body.vx = (body.vx + body.fx) * DAMPING;
            body.vy = (body.vy + body.fy) * DAMPING;
            body.vz = (body.vz + body.fz) * DAMPING;
            body.vx = clamp(body.vx, -MAX_SPEED, MAX_SPEED);
            body.vy = clamp(body.vy, -MAX_SPEED, MAX_SPEED);
            body.vz = clamp(body.vz, -MAX_SPEED, MAX_SPEED);
            body.x += body.vx;
            body.y += body.vy;
            body.z += body.vz;
            if (this.mode === '2d') {
                // Flatten towards the plane so the relation map stays readable.
                body.vz = 0;
                body.z *= 0.82;
            }
        }
    }
    project() {
        const out = [];
        const centerX = this.width / 2;
        const centerY = this.height / 2;
        const cosYaw = Math.cos(this.yaw);
        const sinYaw = Math.sin(this.yaw);
        const cosPitch = Math.cos(this.pitch);
        const sinPitch = Math.sin(this.pitch);
        // Auto-fit: scale the graph so it always fills the viewport, no matter how
        // far the force layout spread or collapsed.
        const flat = this.mode === '2d';
        let sumSquares = 0;
        let counted = 0;
        for (const body of this.bodies) {
            if (!this.isVisible(body))
                continue;
            sumSquares += body.x * body.x + body.y * body.y + (flat ? 0 : body.z * body.z);
            counted += 1;
        }
        const rms = counted === 0 ? 1 : Math.sqrt(sumSquares / counted) || 1;
        const target = Math.min(this.width, this.height) * (flat ? 0.4 : 0.34);
        const fit = clamp(target / rms, 0.35, 6);
        const scale = fit * this.zoom;
        const radiusScale = clamp(0.6 + fit * 0.16, 0.78, flat ? 0.96 : 1.15);
        for (const body of this.bodies) {
            if (!this.isVisible(body))
                continue;
            const x1 = body.x * cosYaw - body.z * sinYaw;
            const z1 = body.x * sinYaw + body.z * cosYaw;
            const y2 = body.y * cosPitch - z1 * sinPitch;
            const z2 = body.y * sinPitch + z1 * cosPitch;
            // Compress depth so the cloud reads as a shallow galaxy instead of a ball.
            const depth = flat ? 1 : 1 / (1 + (z2 * 0.62) / FOCAL);
            out.push({
                body,
                sx: centerX + this.panX + x1 * scale * depth,
                sy: centerY + this.panY + y2 * scale * depth,
                depth,
                scale,
                r: body.radius * radiusScale * clamp(depth, 0.55, 1.3),
            });
        }
        out.sort((left, right) => left.depth - right.depth);
        this.projected = out;
        return out;
    }
    paint() {
        const ctx = this.ctx;
        const projected = this.project();
        const byBody = new Map();
        for (const item of projected)
            byBody.set(item.body, item);
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.clearRect(0, 0, this.width, this.height);
        const selectedIndex = this.selected === null ? undefined : this.index.get(this.selected);
        const selectedBody = selectedIndex === undefined ? undefined : this.bodies[selectedIndex];
        const neighbours = new Set();
        if (selectedIndex !== undefined) {
            for (const link of this.links) {
                if (link.a === selectedIndex)
                    neighbours.add(link.b);
                else if (link.b === selectedIndex)
                    neighbours.add(link.a);
            }
        }
        const focusMode = selectedIndex !== undefined || this.hovered !== null;
        // Edges first, so nodes always sit on top.
        ctx.lineWidth = 1;
        for (const link of this.links) {
            const a = this.bodies[link.a];
            const b = this.bodies[link.b];
            if (a === undefined || b === undefined || !this.isVisible(a) || !this.isVisible(b))
                continue;
            const pa = byBody.get(a);
            const pb = byBody.get(b);
            if (pa === undefined || pb === undefined)
                continue;
            const linked = selectedIndex !== undefined && (link.a === selectedIndex || link.b === selectedIndex);
            const dimmed = focusMode && !linked;
            const base = link.kind === 'cite' ? 0.62 : 0.26;
            const alpha = base * Math.min(pa.depth, pb.depth) * (dimmed ? 0.3 : linked ? 1.35 : 1);
            if (alpha < 0.02)
                continue;
            ctx.lineWidth = link.kind === 'cite' ? 1.2 : 1;
            ctx.strokeStyle = link.kind === 'cite'
                ? `rgba(226, 234, 252, ${clamp(alpha, 0, 0.8).toFixed(3)})`
                : `rgba(140, 154, 188, ${clamp(alpha, 0, 0.55).toFixed(3)})`;
            ctx.setLineDash(link.kind === 'relate' ? [2, 4] : []);
            ctx.beginPath();
            ctx.moveTo(pa.sx, pa.sy);
            ctx.lineTo(pb.sx, pb.sy);
            ctx.stroke();
        }
        ctx.setLineDash([]);
        const query = this.query;
        const time = performance.now() / 1000;
        for (const item of projected) {
            const node = item.body.node;
            const isSelected = this.selected === node.id;
            const isHovered = this.hovered === node.id;
            const isNeighbour = selectedIndex !== undefined && neighbours.has(this.index.get(node.id) ?? -1);
            const matches = query !== '' && (node.label.toLowerCase().includes(query) || node.path.toLowerCase().includes(query));
            const dimmed = focusMode && !isSelected && !isNeighbour && !matches;
            const baseAlpha = clamp(0.55 + item.depth * 0.5, 0.45, 1) * (dimmed ? 0.3 : 1);
            const color = KIND_COLOR[node.kind];
            if (isSelected || isHovered || matches) {
                ctx.beginPath();
                ctx.arc(item.sx, item.sy, item.r * 3, 0, Math.PI * 2);
                ctx.fillStyle = mixColor(color, 0.13);
                ctx.fill();
            }
            ctx.beginPath();
            ctx.arc(item.sx, item.sy, Math.max(1.4, item.r), 0, Math.PI * 2);
            ctx.fillStyle = mixColor(color, baseAlpha);
            ctx.fill();
            if (isSelected || isHovered) {
                ctx.lineWidth = 1.2;
                ctx.strokeStyle = mixColor('#ffffff', isSelected ? 0.85 : 0.5);
                ctx.stroke();
            }
            if (matches) {
                ctx.lineWidth = 1;
                ctx.strokeStyle = mixColor('#ffffff', 0.55);
                ctx.setLineDash([2, 3]);
                ctx.stroke();
                ctx.setLineDash([]);
            }
            if (isSelected) {
                const pulse = 4 + Math.sin(time * 3.2) * 2.4;
                ctx.beginPath();
                ctx.arc(item.sx, item.sy, item.r + pulse, 0, Math.PI * 2);
                ctx.lineWidth = 1;
                ctx.strokeStyle = mixColor(color, 0.45 + Math.sin(time * 3.2) * 0.12);
                ctx.stroke();
            }
        }
        // Labels: hubs stay readable, the rest show only on focus or search.
        ctx.font = '12px -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.textBaseline = 'middle';
        const candidates = [];
        for (const item of projected) {
            const node = item.body.node;
            const isSelected = this.selected === node.id;
            const isHovered = this.hovered === node.id;
            const isNeighbour = selectedIndex !== undefined && neighbours.has(this.index.get(node.id) ?? -1);
            const matches = query !== '' && (node.label.toLowerCase().includes(query) || node.path.toLowerCase().includes(query));
            const hub = node.degree >= 4 && item.depth > 0.72;
            // The tooltip already names the selected/hovered node: skip its inline label.
            if (isSelected || isHovered)
                continue;
            if (!hub && !matches && !isNeighbour && query === '')
                continue;
            candidates.push({
                item,
                text: node.label.length > 20 ? `${node.label.slice(0, 19)}…` : node.label,
                alpha: (matches ? 0.96 : hub ? 0.82 : 0.68) * (focusMode && !isNeighbour && !matches ? 0.35 : 1),
                priority: matches ? 3 : isNeighbour ? 2 : 1,
            });
        }
        // Nearest (largest depth) labels win; a simple rect test keeps them apart.
        candidates.sort((left, right) => (right.priority - left.priority) || (right.item.depth - left.item.depth));
        const placed = [];
        for (const candidate of candidates) {
            const x = candidate.item.sx + candidate.item.r + 7;
            const y = candidate.item.sy;
            const width = ctx.measureText(candidate.text).width;
            const rect = { left: x - 2, right: x + width + 2, top: y - 8, bottom: y + 8 };
            if (rect.right > this.width - 6 || rect.left < 2)
                continue;
            if (placed.some(other => rect.left < other.right && rect.right > other.left
                && rect.top < other.bottom && rect.bottom > other.top))
                continue;
            placed.push(rect);
            ctx.lineWidth = 3;
            ctx.strokeStyle = `rgba(10, 12, 17, ${(candidate.alpha * 0.9).toFixed(2)})`;
            ctx.strokeText(candidate.text, x, y);
            ctx.fillStyle = `rgba(232, 237, 248, ${candidate.alpha.toFixed(2)})`;
            ctx.fillText(candidate.text, x, y);
        }
        if (selectedBody !== undefined) {
            const item = projected.find(entry => entry.body === selectedBody);
            if (item !== undefined) {
                this.paintTooltip(item, selectedBody.node);
            }
        }
        else if (this.hovered !== null && this.inside) {
            const position = this.index.get(this.hovered);
            const body = position === undefined ? undefined : this.bodies[position];
            if (body !== undefined) {
                const item = byBody.get(body);
                if (item !== undefined)
                    this.paintTooltip(item, body.node);
            }
        }
    }
    paintTooltip(item, node) {
        const ctx = this.ctx;
        const title = node.label.length > 26 ? `${node.label.slice(0, 25)}…` : node.label;
        const meta = `${KIND_LABEL[node.kind]} · ${node.degree} 条关联`;
        ctx.font = '12px -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
        const titleWidth = ctx.measureText(title).width;
        ctx.font = '11px -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
        const metaWidth = ctx.measureText(meta).width;
        const width = Math.min(280, Math.max(titleWidth, metaWidth) + 20);
        const height = 42;
        let x = item.sx + 14;
        let y = item.sy - height - 10;
        if (x + width > this.width - 8)
            x = item.sx - width - 14;
        if (y < 8)
            y = item.sy + 16;
        x = clamp(x, 8, Math.max(8, this.width - width - 8));
        y = clamp(y, 8, Math.max(8, this.height - height - 8));
        const radius = 8;
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.arcTo(x + width, y, x + width, y + height, radius);
        ctx.arcTo(x + width, y + height, x, y + height, radius);
        ctx.arcTo(x, y + height, x, y, radius);
        ctx.arcTo(x, y, x + width, y, radius);
        ctx.closePath();
        ctx.fillStyle = 'rgba(18, 21, 28, 0.92)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.textBaseline = 'middle';
        ctx.font = '12px -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.fillStyle = 'rgba(238, 241, 250, 0.96)';
        ctx.fillText(title, x + 10, y + 15);
        ctx.font = '11px -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.fillStyle = 'rgba(160, 170, 192, 0.92)';
        ctx.fillText(meta, x + 10, y + 30);
    }
    hitTest(x, y) {
        let best = null;
        let nearest = null;
        for (const item of this.projected) {
            const dx = item.sx - x;
            const dy = item.sy - y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (nearest === null || distance < nearest.distance)
                nearest = { id: item.body.node.id, distance };
            if (distance > item.r + 6)
                continue;
            if (best === null || distance < best.distance)
                best = { id: item.body.node.id, distance };
        }
        // Small dots are hard to hit exactly: accept the nearest node inside a
        // forgiving halo, which also keeps touch/trackpad clicks pleasant.
        if (best !== null)
            return best.id;
        return nearest !== null && nearest.distance <= 26 ? nearest.id : null;
    }
    updateHover() {
        const hit = this.dragging ? null : this.hitTest(this.pointerX, this.pointerY);
        if (hit === this.hovered) {
            this.canvas.style.cursor = hit === null ? 'grab' : 'pointer';
            return;
        }
        this.hovered = hit;
        this.canvas.style.cursor = hit === null ? 'grab' : 'pointer';
        this.options.onHover?.(hit);
        this.loop(true);
    }
}
//# sourceMappingURL=graph-canvas.js.map
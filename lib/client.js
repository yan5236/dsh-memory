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
		//#region lib/client/graph-canvas.js
		/**
		* 3D memory cloud renderer.
		*
		* Framework-free on purpose: the vault page owns React, this module owns the
		* canvas, the force layout and the pointer maths. Nothing here imports React
		* or any host package, so it can also run from a standalone preview page.
		*/
		const KIND_COLOR = {
			topic: "#7ea6ff",
			summary: "#9b8cff",
			skill: "#45d6c4",
			note: "#f2c078",
			archive: "#7c8598"
		};
		const KIND_LABEL = {
			topic: "主题",
			summary: "回顾",
			skill: "技能",
			note: "笔记",
			archive: "归档"
		};
		/** Repulsion strength between every node pair. */
		const REPULSION = 175;
		/** Spring stiffness and natural length for linked nodes. */
		const SPRING = .035;
		const SPRING_LEN = 38;
		/** Weak pull towards the origin keeps the cloud compact. */
		const CENTER_PULL = .0055;
		/** Velocity damping per step. */
		const DAMPING = .86;
		/** Hard clamp so a bad frame can never explode the layout. */
		const MAX_SPEED = 3.2;
		const MAX_NODES = 420;
		/** Perspective focal length in world units. */
		const FOCAL = 300;
		function clamp(value, min, max) {
			return value < min ? min : value > max ? max : value;
		}
		function mixColor(hex, alpha) {
			const value = hex.replace("#", "");
			return `rgba(${Number.parseInt(value.slice(0, 2), 16)}, ${Number.parseInt(value.slice(2, 4), 16)}, ${Number.parseInt(value.slice(4, 6), 16)}, ${alpha})`;
		}
		function radiusFor(node) {
			return clamp(3.4 + Math.log2(Math.max(8, node.chars) + 8) * .78 + Math.min(3, node.degree * .55), 4, 13);
		}
		/** The 3D cloud canvas: layout, projection, painting and pointer handling. */
		var MemoryGraph = class {
			canvas;
			ctx;
			options;
			bodies = [];
			links = [];
			index = /* @__PURE__ */ new Map();
			projected = [];
			visible = /* @__PURE__ */ new Set([
				"topic",
				"summary",
				"skill",
				"note"
			]);
			selected = null;
			hovered = null;
			query = "";
			yaw = -.32;
			pitch = .26;
			zoom = 1;
			spin = 0;
			spinVelocity = 9e-4;
			/** Presentation mode: orbiting 3D cloud or a flat 2D relation map. */
			mode = "3d";
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
				const ctx = canvas.getContext("2d");
				if (ctx === null) throw new Error("memory cloud: 2d canvas context unavailable");
				this.canvas = canvas;
				this.ctx = ctx;
				this.options = options;
				this.canvas.style.touchAction = "none";
				this.onPointerDown = (event) => {
					if (event.button !== 0) return;
					this.dragging = true;
					this.dragMoved = 0;
					this.lastX = event.clientX;
					this.lastY = event.clientY;
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
						if (this.mode === "2d") {
							this.panX += dx;
							this.panY += dy;
						} else {
							this.yaw += dx * .007;
							this.pitch = clamp(this.pitch + dy * .006, -1.32, 1.32);
							this.spinVelocity = clamp(dx * 45e-5, -.012, .012);
							this.spin = 0;
						}
						return;
					}
					this.updateHover();
				};
				this.onPointerUp = (event) => {
					if (!this.dragging) return;
					this.dragging = false;
					if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
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
					this.zoom = clamp(this.zoom * (event.deltaY > 0 ? .92 : 1.08), .45, 2.6);
				};
				this.onDoubleClick = () => {
					this.resetView();
				};
				this.onVisibility = () => {
					if (document.hidden) this.stopLoop();
					else this.loop(false);
				};
				canvas.addEventListener("pointerdown", this.onPointerDown);
				canvas.addEventListener("pointermove", this.onPointerMove);
				canvas.addEventListener("pointerup", this.onPointerUp);
				canvas.addEventListener("pointercancel", this.onPointerUp);
				canvas.addEventListener("pointerleave", this.onPointerLeave);
				canvas.addEventListener("wheel", this.onWheel, { passive: false });
				canvas.addEventListener("dblclick", this.onDoubleClick);
				document.addEventListener("visibilitychange", this.onVisibility);
				if (typeof ResizeObserver === "function") {
					this.resizeObserver = new ResizeObserver(() => this.resize());
					this.resizeObserver.observe(canvas);
				} else this.resizeObserver = void 0;
				this.resize();
				this.loop(false);
			}
			/** Replace the graph and seed a deterministic spherical layout. */
			setData(data) {
				const nodes = data.nodes.slice(0, MAX_NODES);
				const count = nodes.length;
				this.bodies = new Array(count);
				this.index = /* @__PURE__ */ new Map();
				for (let position = 0; position < count; position += 1) {
					const node = nodes[position];
					if (node === void 0) continue;
					this.index.set(node.id, position);
					const phi = Math.acos(1 - 2 * (position + .5) / Math.max(1, count));
					const theta = Math.PI * (1 + Math.sqrt(5)) * (position + .5);
					const shell = 90 + position * 37 % 40;
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
						radius: radiusFor(node)
					};
				}
				const links = [];
				for (const edge of data.edges) {
					const a = this.index.get(edge.from);
					const b = this.index.get(edge.to);
					if (a === void 0 || b === void 0 || a === b) continue;
					links.push({
						a,
						b,
						kind: edge.kind,
						weight: clamp(edge.weight, .5, 6)
					});
				}
				this.links = links;
				if (this.selected !== null && !this.index.has(this.selected)) this.setSelected(null);
				this.loop(true);
			}
			/** Restrict the cloud to the given artifact kinds. */
			setVisibleKinds(kinds) {
				this.visible = new Set(kinds);
				if (this.selected !== null) {
					const position = this.index.get(this.selected);
					const node = position === void 0 ? void 0 : this.bodies[position]?.node;
					if (node === void 0 || !this.visible.has(node.kind)) this.setSelected(null);
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
				if (next === this.selected) return;
				this.selected = next;
				this.loop(true);
				this.options.onSelect?.(next);
			}
			/** Bring one node into focus without changing the selection source of truth. */
			focus(id) {
				const position = this.index.get(id);
				if (position === void 0) return;
				this.setSelected(this.bodies[position]?.node.id ?? null);
			}
			/** Switch between the orbiting 3D cloud and the flat 2D relation map. */
			setMode(mode) {
				if (mode === this.mode) return;
				this.mode = mode;
				this.panX = 0;
				this.panY = 0;
				this.spinVelocity = 9e-4;
				if (mode === "2d") {
					this.yaw = 0;
					this.pitch = 0;
					for (const body of this.bodies) body.vz = 0;
				} else {
					this.yaw = -.32;
					this.pitch = .26;
				}
				this.loop(true);
			}
			getMode() {
				return this.mode;
			}
			resetView() {
				this.yaw = -.32;
				this.pitch = .26;
				this.zoom = 1;
				this.panX = 0;
				this.panY = 0;
				this.spinVelocity = 9e-4;
				this.loop(true);
			}
			/** Re-seed the spherical layout (used by the page's "重新布局" action). */
			relayout() {
				const count = this.bodies.length;
				for (let position = 0; position < count; position += 1) {
					const body = this.bodies[position];
					if (body === void 0) continue;
					const phi = Math.acos(1 - 2 * (position + .5) / Math.max(1, count));
					const theta = Math.PI * (1 + Math.sqrt(5)) * (position + .5);
					const shell = 90 + position * 37 % 40;
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
				if (width === this.width && height === this.height && dpr === this.dpr) return;
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
				this.canvas.removeEventListener("pointerdown", this.onPointerDown);
				this.canvas.removeEventListener("pointermove", this.onPointerMove);
				this.canvas.removeEventListener("pointerup", this.onPointerUp);
				this.canvas.removeEventListener("pointercancel", this.onPointerUp);
				this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
				this.canvas.removeEventListener("wheel", this.onWheel);
				this.canvas.removeEventListener("dblclick", this.onDoubleClick);
				document.removeEventListener("visibilitychange", this.onVisibility);
			}
			isVisible(body) {
				return this.visible.has(body.node.kind);
			}
			loop(forceFrame) {
				if (this.disposed) return;
				if (forceFrame) this.needsFrame = true;
				if (this.raf !== 0) return;
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
				if (this.disposed) return;
				this.frame += 1;
				if (!document.hidden) {
					if (!this.dragging && this.mode === "3d") {
						if (this.selected === null && this.hovered === null) this.spinVelocity += (9e-4 - this.spinVelocity) * .01;
						this.yaw += this.spinVelocity;
						this.spinVelocity *= .994;
					}
					const settled = this.frame > 120 && !this.needsFrame && !this.dragging;
					const focused = this.selected !== null || this.hovered !== null || this.inside;
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
					if (a === void 0 || !this.isVisible(a)) continue;
					a.fx = -a.x * CENTER_PULL;
					a.fy = -a.y * CENTER_PULL;
					a.fz = -a.z * CENTER_PULL;
				}
				for (let i = 0; i < count; i += 1) {
					const a = bodies[i];
					if (a === void 0 || !this.isVisible(a)) continue;
					for (let j = i + 1; j < count; j += 1) {
						const b = bodies[j];
						if (b === void 0 || !this.isVisible(b)) continue;
						let dx = a.x - b.x;
						let dy = a.y - b.y;
						let dz = a.z - b.z;
						let distanceSquared = dx * dx + dy * dy + dz * dz;
						if (distanceSquared < 1) {
							dx = i % 7 - 3 + .5;
							dy = j % 5 - 2 + .5;
							dz = (i + j) % 11 - 5 + .5;
							distanceSquared = dx * dx + dy * dy + dz * dz;
						}
						const force = REPULSION / distanceSquared;
						const distance = Math.sqrt(distanceSquared);
						const nx = dx / distance * force;
						const ny = dy / distance * force;
						const nz = dz / distance * force;
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
					if (a === void 0 || b === void 0 || !this.isVisible(a) || !this.isVisible(b)) continue;
					const dx = b.x - a.x;
					const dy = b.y - a.y;
					const dz = b.z - a.z;
					const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy + dz * dz));
					const stretch = distance - SPRING_LEN * (link.kind === "cite" ? .8 : 1);
					const strength = SPRING * (1 + link.weight * .25);
					const fx = dx / distance * stretch * strength;
					const fy = dy / distance * stretch * strength;
					const fz = dz / distance * stretch * strength;
					a.fx += fx;
					a.fy += fy;
					a.fz += fz;
					b.fx -= fx;
					b.fy -= fy;
					b.fz -= fz;
				}
				for (let i = 0; i < count; i += 1) {
					const body = bodies[i];
					if (body === void 0 || !this.isVisible(body)) continue;
					body.vx = (body.vx + body.fx) * DAMPING;
					body.vy = (body.vy + body.fy) * DAMPING;
					body.vz = (body.vz + body.fz) * DAMPING;
					body.vx = clamp(body.vx, -3.2, MAX_SPEED);
					body.vy = clamp(body.vy, -3.2, MAX_SPEED);
					body.vz = clamp(body.vz, -3.2, MAX_SPEED);
					body.x += body.vx;
					body.y += body.vy;
					body.z += body.vz;
					if (this.mode === "2d") {
						body.vz = 0;
						body.z *= .82;
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
				const flat = this.mode === "2d";
				let sumSquares = 0;
				let counted = 0;
				for (const body of this.bodies) {
					if (!this.isVisible(body)) continue;
					sumSquares += body.x * body.x + body.y * body.y + (flat ? 0 : body.z * body.z);
					counted += 1;
				}
				const rms = counted === 0 ? 1 : Math.sqrt(sumSquares / counted) || 1;
				const fit = clamp(Math.min(this.width, this.height) * (flat ? .4 : .34) / rms, .35, 6);
				const scale = fit * this.zoom;
				const radiusScale = clamp(.6 + fit * .16, .78, flat ? .96 : 1.15);
				for (const body of this.bodies) {
					if (!this.isVisible(body)) continue;
					const x1 = body.x * cosYaw - body.z * sinYaw;
					const z1 = body.x * sinYaw + body.z * cosYaw;
					const y2 = body.y * cosPitch - z1 * sinPitch;
					const z2 = body.y * sinPitch + z1 * cosPitch;
					const depth = flat ? 1 : 1 / (1 + z2 * .62 / FOCAL);
					out.push({
						body,
						sx: centerX + this.panX + x1 * scale * depth,
						sy: centerY + this.panY + y2 * scale * depth,
						depth,
						scale,
						r: body.radius * radiusScale * clamp(depth, .55, 1.3)
					});
				}
				out.sort((left, right) => left.depth - right.depth);
				this.projected = out;
				return out;
			}
			paint() {
				const ctx = this.ctx;
				const projected = this.project();
				const byBody = /* @__PURE__ */ new Map();
				for (const item of projected) byBody.set(item.body, item);
				ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
				ctx.clearRect(0, 0, this.width, this.height);
				const selectedIndex = this.selected === null ? void 0 : this.index.get(this.selected);
				const selectedBody = selectedIndex === void 0 ? void 0 : this.bodies[selectedIndex];
				const neighbours = /* @__PURE__ */ new Set();
				if (selectedIndex !== void 0) {
					for (const link of this.links) if (link.a === selectedIndex) neighbours.add(link.b);
					else if (link.b === selectedIndex) neighbours.add(link.a);
				}
				const focusMode = selectedIndex !== void 0 || this.hovered !== null;
				ctx.lineWidth = 1;
				for (const link of this.links) {
					const a = this.bodies[link.a];
					const b = this.bodies[link.b];
					if (a === void 0 || b === void 0 || !this.isVisible(a) || !this.isVisible(b)) continue;
					const pa = byBody.get(a);
					const pb = byBody.get(b);
					if (pa === void 0 || pb === void 0) continue;
					const linked = selectedIndex !== void 0 && (link.a === selectedIndex || link.b === selectedIndex);
					const dimmed = focusMode && !linked;
					const alpha = (link.kind === "cite" ? .62 : .26) * Math.min(pa.depth, pb.depth) * (dimmed ? .3 : linked ? 1.35 : 1);
					if (alpha < .02) continue;
					ctx.lineWidth = link.kind === "cite" ? 1.2 : 1;
					ctx.strokeStyle = link.kind === "cite" ? `rgba(226, 234, 252, ${clamp(alpha, 0, .8).toFixed(3)})` : `rgba(140, 154, 188, ${clamp(alpha, 0, .55).toFixed(3)})`;
					ctx.setLineDash(link.kind === "relate" ? [2, 4] : []);
					ctx.beginPath();
					ctx.moveTo(pa.sx, pa.sy);
					ctx.lineTo(pb.sx, pb.sy);
					ctx.stroke();
				}
				ctx.setLineDash([]);
				const query = this.query;
				const time = performance.now() / 1e3;
				for (const item of projected) {
					const node = item.body.node;
					const isSelected = this.selected === node.id;
					const isHovered = this.hovered === node.id;
					const isNeighbour = selectedIndex !== void 0 && neighbours.has(this.index.get(node.id) ?? -1);
					const matches = query !== "" && (node.label.toLowerCase().includes(query) || node.path.toLowerCase().includes(query));
					const dimmed = focusMode && !isSelected && !isNeighbour && !matches;
					const baseAlpha = clamp(.55 + item.depth * .5, .45, 1) * (dimmed ? .3 : 1);
					const color = KIND_COLOR[node.kind];
					if (isSelected || isHovered || matches) {
						ctx.beginPath();
						ctx.arc(item.sx, item.sy, item.r * 3, 0, Math.PI * 2);
						ctx.fillStyle = mixColor(color, .13);
						ctx.fill();
					}
					ctx.beginPath();
					ctx.arc(item.sx, item.sy, Math.max(1.4, item.r), 0, Math.PI * 2);
					ctx.fillStyle = mixColor(color, baseAlpha);
					ctx.fill();
					if (isSelected || isHovered) {
						ctx.lineWidth = 1.2;
						ctx.strokeStyle = mixColor("#ffffff", isSelected ? .85 : .5);
						ctx.stroke();
					}
					if (matches) {
						ctx.lineWidth = 1;
						ctx.strokeStyle = mixColor("#ffffff", .55);
						ctx.setLineDash([2, 3]);
						ctx.stroke();
						ctx.setLineDash([]);
					}
					if (isSelected) {
						const pulse = 4 + Math.sin(time * 3.2) * 2.4;
						ctx.beginPath();
						ctx.arc(item.sx, item.sy, item.r + pulse, 0, Math.PI * 2);
						ctx.lineWidth = 1;
						ctx.strokeStyle = mixColor(color, .45 + Math.sin(time * 3.2) * .12);
						ctx.stroke();
					}
				}
				ctx.font = "12px -apple-system, \"Segoe UI\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif";
				ctx.textBaseline = "middle";
				const candidates = [];
				for (const item of projected) {
					const node = item.body.node;
					const isSelected = this.selected === node.id;
					const isHovered = this.hovered === node.id;
					const isNeighbour = selectedIndex !== void 0 && neighbours.has(this.index.get(node.id) ?? -1);
					const matches = query !== "" && (node.label.toLowerCase().includes(query) || node.path.toLowerCase().includes(query));
					const hub = node.degree >= 4 && item.depth > .72;
					if (isSelected || isHovered) continue;
					if (!hub && !matches && !isNeighbour && query === "") continue;
					candidates.push({
						item,
						text: node.label.length > 20 ? `${node.label.slice(0, 19)}…` : node.label,
						alpha: (matches ? .96 : hub ? .82 : .68) * (focusMode && !isNeighbour && !matches ? .35 : 1),
						priority: matches ? 3 : isNeighbour ? 2 : 1
					});
				}
				candidates.sort((left, right) => right.priority - left.priority || right.item.depth - left.item.depth);
				const placed = [];
				for (const candidate of candidates) {
					const x = candidate.item.sx + candidate.item.r + 7;
					const y = candidate.item.sy;
					const width = ctx.measureText(candidate.text).width;
					const rect = {
						left: x - 2,
						right: x + width + 2,
						top: y - 8,
						bottom: y + 8
					};
					if (rect.right > this.width - 6 || rect.left < 2) continue;
					if (placed.some((other) => rect.left < other.right && rect.right > other.left && rect.top < other.bottom && rect.bottom > other.top)) continue;
					placed.push(rect);
					ctx.lineWidth = 3;
					ctx.strokeStyle = `rgba(10, 12, 17, ${(candidate.alpha * .9).toFixed(2)})`;
					ctx.strokeText(candidate.text, x, y);
					ctx.fillStyle = `rgba(232, 237, 248, ${candidate.alpha.toFixed(2)})`;
					ctx.fillText(candidate.text, x, y);
				}
				if (selectedBody !== void 0) {
					const item = projected.find((entry) => entry.body === selectedBody);
					if (item !== void 0) this.paintTooltip(item, selectedBody.node);
				} else if (this.hovered !== null && this.inside) {
					const position = this.index.get(this.hovered);
					const body = position === void 0 ? void 0 : this.bodies[position];
					if (body !== void 0) {
						const item = byBody.get(body);
						if (item !== void 0) this.paintTooltip(item, body.node);
					}
				}
			}
			paintTooltip(item, node) {
				const ctx = this.ctx;
				const title = node.label.length > 26 ? `${node.label.slice(0, 25)}…` : node.label;
				const meta = `${KIND_LABEL[node.kind]} · ${node.degree} 条关联`;
				ctx.font = "12px -apple-system, \"Segoe UI\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif";
				const titleWidth = ctx.measureText(title).width;
				ctx.font = "11px -apple-system, \"Segoe UI\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif";
				const metaWidth = ctx.measureText(meta).width;
				const width = Math.min(280, Math.max(titleWidth, metaWidth) + 20);
				const height = 42;
				let x = item.sx + 14;
				let y = item.sy - height - 10;
				if (x + width > this.width - 8) x = item.sx - width - 14;
				if (y < 8) y = item.sy + 16;
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
				ctx.fillStyle = "rgba(18, 21, 28, 0.92)";
				ctx.fill();
				ctx.strokeStyle = "rgba(255, 255, 255, 0.10)";
				ctx.lineWidth = 1;
				ctx.stroke();
				ctx.textBaseline = "middle";
				ctx.font = "12px -apple-system, \"Segoe UI\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif";
				ctx.fillStyle = "rgba(238, 241, 250, 0.96)";
				ctx.fillText(title, x + 10, y + 15);
				ctx.font = "11px -apple-system, \"Segoe UI\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif";
				ctx.fillStyle = "rgba(160, 170, 192, 0.92)";
				ctx.fillText(meta, x + 10, y + 30);
			}
			hitTest(x, y) {
				let best = null;
				let nearest = null;
				for (const item of this.projected) {
					const dx = item.sx - x;
					const dy = item.sy - y;
					const distance = Math.sqrt(dx * dx + dy * dy);
					if (nearest === null || distance < nearest.distance) nearest = {
						id: item.body.node.id,
						distance
					};
					if (distance > item.r + 6) continue;
					if (best === null || distance < best.distance) best = {
						id: item.body.node.id,
						distance
					};
				}
				if (best !== null) return best.id;
				return nearest !== null && nearest.distance <= 26 ? nearest.id : null;
			}
			updateHover() {
				const hit = this.dragging ? null : this.hitTest(this.pointerX, this.pointerY);
				if (hit === this.hovered) {
					this.canvas.style.cursor = hit === null ? "grab" : "pointer";
					return;
				}
				this.hovered = hit;
				this.canvas.style.cursor = hit === null ? "grab" : "pointer";
				this.options.onHover?.(hit);
				this.loop(true);
			}
		};
		//#endregion
		//#region lib/client/memory-vault.js
		/**
		* 记忆库 — the vault page: a 3D memory cloud plus an in-place editor.
		*
		* Opened from the sidebar's 记忆库 entry (slot `sidebar.panellist` renders the
		* icon, slot `main` with key `dsh-memory-vault` renders this page). All data
		* comes from the plugin's own RPC route, so the page never reads files
		* directly and the memory root stays owned by the host side.
		*/
		const h = react.createElement;
		const PANEL_ID = "dsh-memory-vault";
		const CORE_FILES$1 = /* @__PURE__ */ new Set([
			"MEMORY.md",
			"memory_summary.md",
			"raw_memories.md",
			"raw_memories.archive.md"
		]);
		const KINDS = [
			"topic",
			"summary",
			"skill",
			"note",
			"archive"
		];
		const CSS$1 = [
			".mv{display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);overflow:hidden}",
			".mv *{box-sizing:border-box}",
			".mv-head{display:flex;align-items:center;gap:12px;padding:9px 16px;min-height:58px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:0 0 auto}",
			".mv-brand{display:flex;flex-direction:column;gap:1px;min-width:0;flex:0 0 auto}",
			".mv-brand b{font-size:14px;font-weight:600;letter-spacing:.3px;line-height:19px}",
			".mv-brand span{font-size:10.5px;line-height:15px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;max-width:190px;overflow:hidden;text-overflow:ellipsis}",
			".mv-chips{display:flex;align-items:center;gap:6px;flex-wrap:nowrap;min-width:0;overflow:hidden}",
			".mv-chip{display:inline-flex;align-items:center;gap:6px;height:25px;padding:0 9px;border-radius:13px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:1;cursor:pointer;white-space:nowrap;transition:background .16s,color .16s,border-color .16s}",
			".mv-chip:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
			".mv-chip.on{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent)}",
			".mv-chip.off{opacity:.55}",
			".mv-chip i{width:6px;height:6px;border-radius:50%;display:inline-block;flex:0 0 auto}",
			".mv-chip b{font-weight:600;font-variant-numeric:tabular-nums;font-size:10.5px;color:var(--dsw-alias-label-tertiary)}",
			".mv-chip.on b{color:var(--dsw-alias-label-secondary)}",
			".mv-search{position:relative;display:flex;align-items:center;flex:0 1 210px;min-width:110px}",
			".mv-search input{width:100%;height:28px;border-radius:14px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:0 10px 0 28px;outline:none}",
			".mv-search input:focus{border-color:var(--dsw-alias-brand-primary)}",
			".mv-search input::placeholder{color:var(--dsw-alias-label-tertiary)}",
			".mv-search svg{position:absolute;left:9px;color:var(--dsw-alias-label-tertiary);pointer-events:none}",
			".mv-actions{margin-left:auto;display:flex;align-items:center;gap:8px;flex:0 0 auto}",
			".mv-seg{display:inline-flex;align-items:center;height:26px;padding:2px;border-radius:13px;border:1px solid var(--dsw-alias-border-l1);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 70%,#000 6%)}",
			".mv-seg button{height:22px;min-width:34px;padding:0 9px;border:none;border-radius:11px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:11px;cursor:pointer;font-variant-numeric:tabular-nums;transition:background .16s,color .16s}",
			".mv-seg button:hover{color:var(--dsw-alias-label-primary)}",
			".mv-seg button.on{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 30%,transparent);color:var(--dsw-alias-label-primary);font-weight:500}",
			".mv-btn{height:28px;padding:0 12px;border-radius:14px;font:inherit;font-size:12px;display:inline-flex;align-items:center;justify-content:center;gap:6px;cursor:pointer;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);transition:background .16s,color .16s,border-color .16s;white-space:nowrap}",
			".mv-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
			".mv-btn:disabled{opacity:.4;cursor:default}",
			".mv-btn.primary{background:#4f7cff;border-color:transparent;color:#ffffff;font-weight:500}",
			".mv-btn.primary:hover:not(:disabled){background:#5f89ff;color:#ffffff}",
			".mv-btn.icon{width:28px;padding:0}",
			".mv-btn.full{width:100%;height:34px;border-radius:17px;font-size:13px}",
			".mv-body{flex:1 1 auto;display:flex;min-height:0;position:relative}",
			".mv-cloud{position:relative;flex:1 1 auto;min-width:0;overflow:hidden;background:radial-gradient(120% 100% at 50% -12%,rgba(98,124,255,.14),transparent 62%),radial-gradient(90% 80% at 88% 110%,rgba(140,90,255,.10),transparent 58%),var(--dsw-alias-bg-layer-1)}",
			".mv-cloud canvas{display:block;width:100%;height:100%;cursor:grab}",
			".mv-cloud canvas:active{cursor:grabbing}",
			".mv-hint{position:absolute;left:16px;bottom:11px;font-size:10.5px;color:var(--dsw-alias-label-tertiary);pointer-events:none;letter-spacing:.2px}",
			".mv-count{position:absolute;right:14px;bottom:11px;font-size:10.5px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;pointer-events:none}",
			".mv-overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;pointer-events:none}",
			".mv-overlay.card{pointer-events:auto}",
			".mv-card{max-width:340px;display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center;padding:22px 24px;border-radius:14px;border:1px solid var(--dsw-alias-border-l1);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 88%,transparent);backdrop-filter:blur(6px)}",
			".mv-card b{font-size:13px;font-weight:600}",
			".mv-card p{margin:0;font-size:12px;line-height:19px;color:var(--dsw-alias-label-tertiary)}",
			".mv-skel{width:180px;display:flex;flex-direction:column;gap:8px}",
			".mv-skel i{height:8px;border-radius:4px;background:var(--dsw-alias-interactive-bg-hover);animation:mvpulse 1.4s ease-in-out infinite}",
			".mv-skel i:nth-child(2){width:72%;animation-delay:.15s}",
			".mv-skel i:nth-child(3){width:46%;animation-delay:.3s}",
			"@keyframes mvpulse{0%,100%{opacity:.35}50%{opacity:.85}}",
			".mv-side{flex:0 0 356px;width:356px;display:flex;flex-direction:column;min-height:0;overflow:hidden;border-left:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}",
			".mv-side.fold{flex-basis:0;width:0;border-left:none;overflow:hidden}",
			".mv-side-head{display:flex;align-items:flex-start;gap:8px;padding:16px 16px 10px;flex:0 0 auto}",
			".mv-badge{display:inline-flex;align-items:center;height:19px;padding:0 8px;border-radius:10px;font-size:10.5px;letter-spacing:.3px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary);white-space:nowrap}",
			".mv-close{margin-left:auto;width:24px;height:24px;border-radius:12px;border:none;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;display:inline-flex;align-items:center;justify-content:center}",
			".mv-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
			".mv-side-body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:0 16px 12px;display:flex;flex-direction:column;gap:14px}",
			".mv-title{margin:0;font-size:14.5px;line-height:22px;font-weight:600;word-break:break-word}",
			".mv-cap{font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}",
			".mv-path{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;line-height:17px;color:var(--dsw-alias-label-tertiary);word-break:break-all;padding:7px 9px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 60%,#000 8%)}",
			".mv-meta{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}",
			".mv-meta div{display:flex;flex-direction:column;gap:1px}",
			".mv-meta b{font-size:13px;font-weight:600;font-variant-numeric:tabular-nums}",
			".mv-meta span{font-size:10px;color:var(--dsw-alias-label-tertiary)}",
			".mv-preview{margin:0;font-size:12.5px;line-height:20px;color:var(--dsw-alias-label-secondary);max-height:120px;overflow:hidden;-webkit-mask-image:linear-gradient(180deg,#000 70%,transparent);mask-image:linear-gradient(180deg,#000 70%,transparent)}",
			".mv-rel{display:flex;flex-direction:column;gap:3px}",
			".mv-relrow{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;border:1px solid transparent;background:transparent;width:100%;text-align:left;font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer}",
			".mv-relrow:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary)}",
			".mv-relrow i{width:6px;height:6px;border-radius:50%;flex:0 0 auto}",
			".mv-relrow span{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1 1 auto}",
			".mv-relrow em{font-style:normal;font-size:9.5px;color:var(--dsw-alias-label-tertiary);flex:0 0 auto}",
			".mv-side-foot{flex:0 0 auto;padding:12px 16px 14px;border-top:1px solid var(--dsw-alias-border-l1);display:flex;flex-direction:column;gap:8px}",
			".mv-status{font-size:10.5px;line-height:16px;color:var(--dsw-alias-label-tertiary);display:flex;align-items:center;gap:6px;flex-wrap:wrap}",
			".mv-status button{border:none;background:transparent;color:var(--dsw-alias-state-warn-label);cursor:pointer;font:inherit;font-size:10.5px;text-decoration:underline;padding:0}",
			".mv-editor{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;overflow:hidden}",
			".mv-editor-head{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:0 0 auto}",
			".mv-editor-path{flex:1 1 auto;min-width:0;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".mv-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-warn-primary);flex:0 0 auto}",
			".mv-textarea{flex:1 1 auto;min-height:0;width:100%;border:none;outline:none;resize:none;background:transparent;color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;line-height:20px;padding:12px 14px;tab-size:2}",
			".mv-editor-foot{display:flex;align-items:center;gap:8px;padding:9px 12px;border-top:1px solid var(--dsw-alias-border-l1);flex:0 0 auto}",
			".mv-editor-foot span{font-size:10.5px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}",
			".mv-warn{margin:0 12px;padding:7px 10px;border-radius:8px;font-size:11px;line-height:17px;color:var(--dsw-alias-state-warn-label);border:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 9%,transparent)}",
			".mv-err{color:var(--dsw-alias-state-error-primary)}",
			".mv-toast{position:absolute;left:50%;bottom:26px;transform:translateX(-50%);display:flex;align-items:center;gap:8px;padding:8px 15px;border-radius:999px;font-size:12px;color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 82%,#000 18%);box-shadow:0 10px 28px rgba(0,0,0,.34);animation:mvrise .18s ease-out}",
			".mv-toast.bad{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 55%,transparent)}",
			"@keyframes mvrise{from{opacity:0;transform:translateX(-50%) translateY(6px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}",
			"@media (max-width:1180px){.mv-side{flex-basis:320px;width:320px}.mv-chips{display:none}}",
			"@media (max-width:900px){.mv-side{flex-basis:290px;width:290px}.mv-brand span{display:none}}"
		].join("");
		const MODE_KEY = "dsh-memory-vault-mode";
		function storedMode() {
			try {
				return window.localStorage.getItem(MODE_KEY) === "2d" ? "2d" : "3d";
			} catch {
				return "3d";
			}
		}
		function ensureStyle() {
			if (document.head.querySelector("style[data-dsh-memory-vault]") !== null) return;
			const style = document.createElement("style");
			style.dataset.dshMemoryVault = "true";
			style.textContent = CSS$1;
			document.head.appendChild(style);
		}
		async function rpc$1(method, args = {}) {
			const response = await fetch("/dsh-memory/rpc", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					method,
					args
				})
			});
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				const message = typeof payload.message === "string" ? payload.message : `请求失败（HTTP ${response.status}）`;
				throw new Error(message);
			}
			return payload;
		}
		function fmtChars$1(count) {
			if (count < 1024) return `${count} 字`;
			if (count < 1024 * 1024) return `${(count / 1024).toFixed(1)}K`;
			return `${(count / 1024 / 1024).toFixed(1)}M`;
		}
		function fmtWhen(ms) {
			if (ms <= 0) return "从未";
			const delta = Date.now() - ms;
			if (delta < 6e4) return "刚刚";
			if (delta < 36e5) return `${Math.round(delta / 6e4)} 分钟前`;
			if (delta < 864e5) return `${Math.round(delta / 36e5)} 小时前`;
			return `${Math.round(delta / 864e5)} 天前`;
		}
		function shortPath(path) {
			return path.replace(/^rollout_summaries\//, "回顾/").replace(/^skills\//, "技能/");
		}
		function iconSearch() {
			return h("svg", {
				width: 13,
				height: 13,
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": true
			}, h("circle", {
				cx: 7,
				cy: 7,
				r: 4.6,
				stroke: "currentColor",
				strokeWidth: 1.4
			}), h("path", {
				d: "M10.6 10.6 14 14",
				stroke: "currentColor",
				strokeWidth: 1.4,
				strokeLinecap: "round"
			}));
		}
		function iconRefresh() {
			return h("svg", {
				width: 13,
				height: 13,
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": true
			}, h("path", {
				d: "M13 8a5 5 0 1 1-1.6-3.7",
				stroke: "currentColor",
				strokeWidth: 1.4,
				strokeLinecap: "round"
			}), h("path", {
				d: "M13 2.6V5.4h-2.8",
				stroke: "currentColor",
				strokeWidth: 1.4,
				strokeLinecap: "round",
				strokeLinejoin: "round"
			}));
		}
		function iconClose() {
			return h("svg", {
				width: 12,
				height: 12,
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": true
			}, h("path", {
				d: "m4 4 8 8M12 4l-8 8",
				stroke: "currentColor",
				strokeWidth: 1.5,
				strokeLinecap: "round"
			}));
		}
		function iconShuffle() {
			return h("svg", {
				width: 13,
				height: 13,
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": true
			}, h("path", {
				d: "M2 4h3.2c1 0 1.6.4 2.2 1.2l1.2 1.6c.6.8 1.2 1.2 2.2 1.2H14",
				stroke: "currentColor",
				strokeWidth: 1.4,
				strokeLinecap: "round"
			}), h("path", {
				d: "M12 6.4 14 8l-2 1.6",
				stroke: "currentColor",
				strokeWidth: 1.4,
				strokeLinecap: "round",
				strokeLinejoin: "round"
			}), h("path", {
				d: "M2 12h3.2c1 0 1.6-.4 2.2-1.2l.5-.7",
				stroke: "currentColor",
				strokeWidth: 1.4,
				strokeLinecap: "round"
			}));
		}
		/** Sidebar icon: a small constellation, drawn as inline SVG (no host imports). */
		function VaultPanelIcon(props) {
			const size = typeof props.size === "number" ? props.size : 18;
			const color = props.active === true ? "var(--dsw-alias-brand-primary)" : "currentColor";
			return h("svg", {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "none",
				"aria-hidden": true,
				style: { color }
			}, h("path", {
				d: "M7 8.5 12 5l5 3.5v7L12 19l-5-3.5z",
				stroke: "currentColor",
				strokeWidth: 1.3,
				strokeLinejoin: "round",
				opacity: .85
			}), h("circle", {
				cx: 7,
				cy: 8.5,
				r: 1.9,
				fill: "currentColor"
			}), h("circle", {
				cx: 17,
				cy: 8.5,
				r: 1.5,
				fill: "currentColor",
				opacity: .7
			}), h("circle", {
				cx: 12,
				cy: 19,
				r: 1.6,
				fill: "currentColor",
				opacity: .8
			}), h("circle", {
				cx: 12,
				cy: 5,
				r: 1.2,
				fill: "currentColor",
				opacity: .55
			}));
		}
		function MemoryVaultPage() {
			const canvasRef = react.useRef(null);
			const graphRef = react.useRef(null);
			const [payload, setPayload] = react.useState(null);
			const [vault, setVault] = react.useState({});
			const [loading, setLoading] = react.useState(true);
			const [error, setError] = react.useState(null);
			const [selected, setSelected] = react.useState(null);
			const [enabled, setEnabled] = react.useState(/* @__PURE__ */ new Set([
				"topic",
				"summary",
				"skill",
				"note"
			]));
			const [query, setQuery] = react.useState("");
			const [folded, setFolded] = react.useState(false);
			const [mode, setMode] = react.useState(() => storedMode());
			const [busy, setBusy] = react.useState(false);
			const [editing, setEditing] = react.useState(null);
			const [editorBusy, setEditorBusy] = react.useState(false);
			const [toast, setToast] = react.useState(null);
			const [warned, setWarned] = react.useState(false);
			const nodes = payload?.nodes ?? [];
			const edges = payload?.edges ?? [];
			const byId = react.useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
			const selectedNode = selected === null ? void 0 : byId.get(selected);
			const neighbours = react.useMemo(() => {
				if (selected === null) return [];
				const out = [];
				for (const edge of edges) if (edge.from === selected) {
					const node = byId.get(edge.to);
					if (node !== void 0) out.push({
						node,
						kind: edge.kind
					});
				} else if (edge.to === selected) {
					const node = byId.get(edge.from);
					if (node !== void 0) out.push({
						node,
						kind: edge.kind
					});
				}
				return out.sort((left, right) => left.kind === right.kind ? right.node.degree - left.node.degree : left.kind === "cite" ? -1 : 1);
			}, [
				edges,
				selected,
				byId
			]);
			const kindCounts = react.useMemo(() => {
				const counts = /* @__PURE__ */ new Map();
				for (const node of nodes) counts.set(node.kind, (counts.get(node.kind) ?? 0) + 1);
				return counts;
			}, [nodes]);
			const showToast = react.useCallback((text, bad = false) => {
				setToast({
					text,
					bad
				});
				window.setTimeout(() => setToast(null), 2200);
			}, []);
			const load = react.useCallback(async (quiet = false) => {
				if (!quiet) setLoading(true);
				setError(null);
				try {
					const [graph, state] = await Promise.all([rpc$1("get-graph"), rpc$1("get-state").catch(() => ({}))]);
					const next = graph;
					setPayload(next);
					setVault(state);
					if (selected !== null && !next.nodes.some((node) => node.id === selected)) setSelected(null);
				} catch (loadError) {
					setError(loadError instanceof Error ? loadError.message : String(loadError));
				} finally {
					setLoading(false);
				}
			}, [selected]);
			react.useEffect(() => {
				ensureStyle();
			}, []);
			react.useEffect(() => {
				load();
			}, []);
			react.useEffect(() => {
				const canvas = canvasRef.current;
				if (canvas === null) return void 0;
				const graph = new MemoryGraph(canvas, { onSelect: (id) => {
					setSelected(id);
				} });
				graphRef.current = graph;
				return () => {
					graph.dispose();
					graphRef.current = null;
				};
			}, []);
			react.useEffect(() => {
				const graph = graphRef.current;
				if (graph === null || payload === null) return;
				graph.setData({
					nodes: payload.nodes,
					edges: payload.edges
				});
				graph.setVisibleKinds(enabled);
			}, [payload, enabled]);
			react.useEffect(() => {
				graphRef.current?.setSearch(query);
			}, [query]);
			react.useEffect(() => {
				graphRef.current?.setSelected(selected);
			}, [selected]);
			react.useEffect(() => {
				graphRef.current?.setMode(mode);
				try {
					window.localStorage.setItem(MODE_KEY, mode);
				} catch {}
			}, [mode]);
			const focusNode = react.useCallback((id) => {
				setSelected(id);
				setFolded(false);
			}, []);
			const openEditor = react.useCallback(async (node) => {
				setEditorBusy(true);
				try {
					const result = await rpc$1("read-file", { path: node.path });
					const content = typeof result.content === "string" ? result.content : "";
					setEditing({
						path: node.path,
						content,
						original: content
					});
					setFolded(false);
				} catch (readError) {
					showToast(readError instanceof Error ? readError.message : String(readError), true);
				} finally {
					setEditorBusy(false);
				}
			}, [showToast]);
			const save = react.useCallback(async () => {
				if (editing === null) return;
				setEditorBusy(true);
				try {
					const result = await rpc$1("write-file", {
						path: editing.path,
						content: editing.content
					});
					if (result.ok === false) throw new Error(result.message ?? "写入失败");
					setEditing({
						path: editing.path,
						content: editing.content,
						original: editing.content
					});
					showToast(`已保存 · ${(/* @__PURE__ */ new Date()).toLocaleTimeString("zh-CN", {
						hour: "2-digit",
						minute: "2-digit"
					})}`);
					await load(true);
				} catch (writeError) {
					showToast(writeError instanceof Error ? writeError.message : String(writeError), true);
				} finally {
					setEditorBusy(false);
				}
			}, [
				editing,
				load,
				showToast
			]);
			const runPipeline = react.useCallback(async () => {
				setBusy(true);
				try {
					await rpc$1("run-pipeline");
					await load(true);
					showToast("整理已触发");
				} catch (runError) {
					showToast(runError instanceof Error ? runError.message : String(runError), true);
				} finally {
					setBusy(false);
				}
			}, [load, showToast]);
			const retryFailures = react.useCallback(async () => {
				setBusy(true);
				try {
					const result = await rpc$1("reset-failures");
					const reset = typeof result.reset === "number" ? result.reset : 0;
					await load(true);
					showToast(reset > 0 ? `已重新排队 ${reset} 个会话` : "没有需要重试的会话");
				} catch (retryError) {
					showToast(retryError instanceof Error ? retryError.message : String(retryError), true);
				} finally {
					setBusy(false);
				}
			}, [load, showToast]);
			const toggleKind = (kind) => {
				setEnabled((previous) => {
					const next = new Set(previous);
					if (next.has(kind)) next.delete(kind);
					else next.add(kind);
					return next;
				});
			};
			const failedCount = vault.counts?.failed ?? 0;
			const lastRun = vault.pipeline?.lastPhase1At ?? 0;
			return h("div", { className: "mv" }, h("div", { className: "mv-head" }, h("div", { className: "mv-brand" }, h("b", null, "记忆库"), h("span", null, `${nodes.length} 个节点 · ${edges.length} 条关联`)), h("div", { className: "mv-chips" }, KINDS.map((kind) => {
				const count = kindCounts.get(kind) ?? 0;
				if (count === 0 && kind === "archive") return null;
				const on = enabled.has(kind);
				return h("button", {
					key: kind,
					type: "button",
					className: `mv-chip ${on ? "on" : "off"}`,
					title: `${on ? "隐藏" : "显示"}${KIND_LABEL[kind]}`,
					onClick: () => toggleKind(kind)
				}, h("i", { style: { background: KIND_COLOR[kind] } }), KIND_LABEL[kind], h("b", null, String(count)));
			})), h("label", { className: "mv-search" }, iconSearch(), h("input", {
				value: query,
				placeholder: "搜索记忆…",
				spellCheck: false,
				onChange: (event) => setQuery(event.target.value)
			})), h("div", { className: "mv-actions" }, h("div", {
				className: "mv-seg",
				role: "group",
				title: "切换 3D 云图 / 2D 关联图"
			}, h("button", {
				type: "button",
				className: mode === "3d" ? "on" : "",
				title: "3D 云图：拖动旋转、滚轮缩放",
				onClick: () => setMode("3d")
			}, "3D"), h("button", {
				type: "button",
				className: mode === "2d" ? "on" : "",
				title: "2D 关联图：拖动平移、滚轮缩放",
				onClick: () => setMode("2d")
			}, "2D")), h("button", {
				type: "button",
				className: "mv-btn",
				disabled: busy,
				title: "重新读取记忆库",
				onClick: () => {
					load();
				}
			}, iconRefresh(), "刷新"), h("button", {
				type: "button",
				className: "mv-btn icon",
				title: "重新布局",
				onClick: () => graphRef.current?.relayout()
			}, iconShuffle()), h("button", {
				type: "button",
				className: "mv-btn icon",
				title: folded ? "展开详情" : "收起详情",
				onClick: () => setFolded((value) => !value)
			}, h("svg", {
				width: 13,
				height: 13,
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": true
			}, h("rect", {
				x: 2,
				y: 3,
				width: 12,
				height: 10,
				rx: 2,
				stroke: "currentColor",
				strokeWidth: 1.3
			}), h("path", {
				d: "M10 3v10",
				stroke: "currentColor",
				strokeWidth: 1.3
			}))))), h("div", { className: "mv-body" }, h("div", { className: "mv-cloud" }, h("canvas", { ref: canvasRef }), loading && payload === null ? h("div", { className: "mv-overlay" }, h("div", { className: "mv-skel" }, h("i"), h("i"), h("i"))) : null, error !== null ? h("div", { className: "mv-overlay card" }, h("div", { className: "mv-card" }, h("b", { className: "mv-err" }, "记忆库读取失败"), h("p", null, error), h("button", {
				type: "button",
				className: "mv-btn",
				onClick: () => {
					load();
				}
			}, "重试"))) : null, error === null && payload !== null && payload.nodes.length === 0 ? h("div", { className: "mv-overlay card" }, h("div", { className: "mv-card" }, h("b", null, "记忆库还是空的"), h("p", null, "还没有可展示的记忆。跑一次整理，插件会把近期会话提炼成回顾与手册，这里就会长出第一张网。"), h("button", {
				type: "button",
				className: "mv-btn primary",
				disabled: busy,
				onClick: () => {
					runPipeline();
				}
			}, busy ? "正在整理…" : "运行一次整理"))) : null, h("div", { className: "mv-hint" }, mode === "3d" ? "拖动旋转 · 滚轮缩放 · 单击查看 · 双击复位" : "拖动平移 · 滚轮缩放 · 单击查看 · 双击复位"), h("div", { className: "mv-count" }, `${enabled.size} 类 · ${nodes.filter((node) => enabled.has(node.kind)).length} 节点`), toast === null ? null : h("div", { className: `mv-toast ${toast.bad === true ? "bad" : ""}` }, toast.text)), h("div", { className: `mv-side ${folded ? "fold" : ""}` }, editing === null ? h(Inspector, {
				node: selectedNode,
				neighbours,
				busy,
				failedCount,
				lastRun,
				onClose: () => setSelected(null),
				onPick: (id) => focusNode(id),
				onEdit: (node) => {
					openEditor(node);
				},
				onRetryFailures: () => {
					retryFailures();
				}
			}) : h("div", { className: "mv-editor" }, h("div", { className: "mv-editor-head" }, h("button", {
				type: "button",
				className: "mv-btn icon",
				title: "返回详情",
				onClick: () => setEditing(null)
			}, h("svg", {
				width: 13,
				height: 13,
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": true
			}, h("path", {
				d: "M10 3 5 8l5 5",
				stroke: "currentColor",
				strokeWidth: 1.5,
				strokeLinecap: "round",
				strokeLinejoin: "round"
			}))), editing.content !== editing.original ? h("i", {
				className: "mv-dot",
				title: "有未保存修改"
			}) : null, h("div", {
				className: "mv-editor-path",
				title: editing.path
			}, shortPath(editing.path))), CORE_FILES$1.has(editing.path) && !warned ? h("p", { className: "mv-warn" }, "这是管道自动维护的核心文件：下次整合会整体重写它的部分内容，手工修改可能被覆盖。", h("button", {
				type: "button",
				className: "mv-btn",
				style: {
					marginLeft: 8,
					height: 22,
					padding: "0 8px",
					fontSize: 11
				},
				onClick: () => setWarned(true)
			}, "知道了")) : null, h("textarea", {
				className: "mv-textarea",
				value: editing.content,
				spellCheck: false,
				onChange: (event) => setEditing({
					path: editing.path,
					content: event.target.value,
					original: editing.original
				}),
				onKeyDown: (event) => {
					if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
						event.preventDefault();
						save();
					}
				}
			}), h("div", { className: "mv-editor-foot" }, h("button", {
				type: "button",
				className: "mv-btn primary",
				disabled: editorBusy || editing.content === editing.original,
				onClick: () => {
					save();
				}
			}, editorBusy ? "保存中…" : "保存"), h("button", {
				type: "button",
				className: "mv-btn",
				disabled: editorBusy || editing.content === editing.original,
				onClick: () => setEditing({
					path: editing.path,
					content: editing.original,
					original: editing.original
				})
			}, "还原"), h("span", { style: { marginLeft: "auto" } }, `${editing.content.length} 字 · Ctrl+S 保存`))))));
		}
		function Inspector(props) {
			const { node, neighbours } = props;
			if (node === void 0) return h(react.Fragment, null, h("div", { className: "mv-side-head" }, h("span", { className: "mv-badge" }, "记忆库"), h("div", {
				style: { marginLeft: "auto" },
				className: "mv-cap"
			}, `${neighbours.length} 条关联`)), h("div", { className: "mv-side-body" }, h("p", {
				className: "mv-title",
				style: {
					fontSize: 13,
					fontWeight: 500
				}
			}, "点击云图里的节点"), h("p", { className: "mv-preview" }, "节点之间实线是手册里明确引用的证据，虚线是关键词相近的联想。选一个节点，就能看到它连着谁，并直接修改对应的记忆文件。"), h("div", { className: "mv-meta" }, h("div", null, h("b", null, "3D"), h("span", null, "关联云图")), h("div", null, h("b", null, "就地"), h("span", null, "编辑记忆")), h("div", null, h("b", null, "自动"), h("span", null, "引用追踪")))), h("div", { className: "mv-side-foot" }, h("div", { className: "mv-status" }, h("span", null, `上次整理：${fmtWhen(props.lastRun)}`), props.failedCount > 0 ? h("button", {
				type: "button",
				disabled: props.busy,
				onClick: props.onRetryFailures
			}, `${props.failedCount} 个会话失败 · 重试`) : null)));
			return h(react.Fragment, null, h("div", { className: "mv-side-head" }, h("span", {
				className: "mv-badge",
				style: {
					color: KIND_COLOR[node.kind],
					borderColor: `color-mix(in srgb,${KIND_COLOR[node.kind]} 45%,transparent)`
				}
			}, KIND_LABEL[node.kind]), h("button", {
				type: "button",
				className: "mv-close",
				title: "取消选择",
				onClick: props.onClose
			}, iconClose())), h("div", { className: "mv-side-body" }, h("h2", { className: "mv-title" }, node.label), h("div", null, h("div", {
				className: "mv-cap",
				style: { marginBottom: 5 }
			}, "文件"), h("div", { className: "mv-path" }, node.path)), h("div", { className: "mv-meta" }, h("div", null, h("b", null, fmtChars$1(node.chars)), h("span", null, "体积")), h("div", null, h("b", null, fmtWhen(node.at)), h("span", null, "更新")), h("div", null, h("b", null, String(node.degree)), h("span", null, "关联"))), node.preview === void 0 || node.preview === "" ? null : h("div", null, h("div", {
				className: "mv-cap",
				style: { marginBottom: 5 }
			}, "摘要"), h("p", { className: "mv-preview" }, node.preview)), h("div", null, h("div", {
				className: "mv-cap",
				style: { marginBottom: 6 }
			}, `关联 · ${neighbours.length}`), h("div", { className: "mv-rel" }, neighbours.length === 0 ? h("p", {
				className: "mv-preview",
				style: { maxHeight: "none" }
			}, "这个节点还没连上别人，整理几次后会自动长出关联。") : neighbours.slice(0, 14).map((entry) => h("button", {
				key: entry.node.id,
				type: "button",
				className: "mv-relrow",
				title: entry.node.path,
				onClick: () => props.onPick(entry.node.id)
			}, h("i", { style: { background: KIND_COLOR[entry.node.kind] } }), h("span", null, entry.node.label), h("em", null, entry.kind === "cite" ? "引用" : "相近")))))), h("div", { className: "mv-side-foot" }, h("button", {
				type: "button",
				className: "mv-btn primary full",
				onClick: () => props.onEdit(node)
			}, "编辑这份记忆"), h("div", { className: "mv-status" }, h("span", null, `上次整理：${fmtWhen(props.lastRun)}`), props.failedCount > 0 ? h("button", {
				type: "button",
				disabled: props.busy,
				onClick: props.onRetryFailures
			}, `${props.failedCount} 个会话失败 · 重试`) : null)));
		}
		//#endregion
		//#region lib/client/index.js
		/** Web settings page for the long-term memory plugin. */
		const CSS = [
			".dm-section{box-sizing:border-box;max-width:760px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:12px;display:flex}",
			".dm-title{color:var(--dsw-alias-label-primary);margin:0;font-size:16px;font-weight:500;line-height:24px}",
			".dm-intro{color:var(--dsw-alias-label-tertiary);margin:0;font-size:14px;line-height:22px}",
			".dm-dimmed{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}",
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
			".dm-btn.primary{background:#4f7cff;color:#ffffff}",
			".dm-btn.primary:hover:not(:disabled){background:#5f89ff}",
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
			".dm-btn.armed{border:1px solid var(--dsw-alias-state-error-primary);color:#ffffff;background:var(--dsw-alias-state-error-primary)}"
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
		/**
		* 推理等级选项：只取适配器实际暴露的等级。适配器不暴露元数据时返回空
		* 数组（不展示兜底列表），避免用户选择运行期会被静默忽略的等级。
		*/
		function effortOptions(payload) {
			const raw = payload?.reasoningEfforts;
			if (!Array.isArray(raw) || raw.length === 0) return [];
			return raw.map((effort) => ({
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
			const effortSelect = (key, label, hint) => {
				const options = effortOptions(payload);
				const control = options.length > 0 ? el("select", {
					className: "dm-input",
					value: String(form[key] ?? ""),
					disabled: busy,
					onChange: (event) => set(key, event.target.value)
				}, el("option", { value: "" }, "默认（跟随模型）"), options.map((option) => el("option", {
					key: option.id,
					value: option.id
				}, option.label))) : el("select", {
					className: "dm-input",
					value: "",
					disabled: true,
					title: "当前路由的模型未暴露思考等级元数据"
				}, el("option", { value: "" }, "该模型未暴露思考等级（按默认执行）"));
				return el("div", { className: "dm-field" }, el("div", { className: "dm-label" }, label), control, el("p", { className: "dm-dimmed" }, hint));
			};
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
			const guardNotice = selectedPath === null ? null : CORE_FILES.includes(selectedPath) ? el("div", { style: { padding: "12px 16px 0" } }, el("p", { className: "dm-warn" }, "这是系统自动生成/维护的核心记忆文件（每次管道整合都会全量重写），手工改动很可能被覆盖或破坏插件行为；该文件受保护，无法删除。除非你非常清楚要做什么，否则不要修改。")) : selectedPath.startsWith("rollout_summaries/.retired/") ? el("div", { style: { padding: "12px 16px 0" } }, el("p", { className: "dm-warn" }, "这是已退役的回顾存档（遗忘系统只做可恢复的退役、不硬删）。该文件受保护，无法删除。")) : null;
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
				disabled: editorBusy || selectedPath !== null && (CORE_FILES.includes(selectedPath) || selectedPath.startsWith("rollout_summaries/.retired/")),
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
		const inject = ["slots"];
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
			slots.inject("sidebar.panellist", () => slots.register({
				name: "sidebar.panellist",
				id: PANEL_ID,
				order: 30,
				label: () => "记忆库"
			}, (props) => react.createElement(VaultPanelIcon, props)));
			slots.inject("main", () => slots.register({
				name: "main",
				key: PANEL_ID
			}, () => react.createElement(MemoryVaultPage)));
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
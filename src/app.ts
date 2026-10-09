// The editor: tools, selection, dragging, constraint and dimension commands,
// and the panels around the canvas.

import {
  type Sketch, type Id, type Point, type Line, type Circle, type Arc, type Curve, type Constraint,
  type ConstraintDraft, type Dimension, type DistanceMode,
  emptySketch, entity, point, constraint, points, curves, curvePoints, constraintRefs, isDimension,
  isFixed, arcRadius, addPoint, addLine, addCircle, addArc, addConstraint, remove, serialize,
  deserialize, clone,
} from "./model";
import { SketchSolver, type Drag, type SolveResult } from "./solver";
import { History } from "./history";
import {
  type V, sub, mul, dot, cross, norm, perp, mid, dist, angleOf, polar, wrap, inSweep,
  projectOnSegment, intersectLines, boxIsEmpty, TWO_PI,
} from "./geom";
import {
  type Prim, PAPER, mmPerUnit, geometryBox, buildPrims, dimensionPrims, primDistance, textBox,
  distanceFrame, angleFrame, roundFrame, formatNumber,
} from "./prims";
import {
  type View, type Glyph, type Preview, type SnapMark, GLYPH_SIZE, toScreen, toModel, layoutGlyphs,
  renderScene,
} from "./render";
import { icon } from "./icons";

type Tool = "select" | "point" | "line" | "circle" | "arc";
type Command =
  | "horizontal" | "vertical" | "parallel" | "perpendicular" | "equal" | "coincident"
  | "midpoint" | "tangent" | "fixed" | "dimension";

/** Where a click lands once snapping has had its say. */
interface Snap {
  pos: V;
  pointId?: Id;
  curveId?: Id;
  midpoint?: boolean;
  axis?: "h" | "v";
}

type Pending =
  /** `first` is the point the chain of lines began at, once it exists. */
  | { tool: "line"; start: Snap; first?: Id }
  | { tool: "circle"; center: Snap }
  | { tool: "arc"; center: Snap; start?: Snap; sweep: number; lastAng: number };

type DragState =
  | { kind: "pan"; last: V; moved: boolean }
  | { kind: "box"; a: V; b: V; additive: boolean }
  | { kind: "move"; grabbed: Id; startScreen: V; startModel: V; targets: { id: Id; x: number; y: number }[]; rim?: Id; moved: boolean; collapse: boolean }
  | { kind: "dim"; id: Id; startScreen: V; moved: boolean };

interface Hit { id: Id; kind: "point" | "glyph" | "dim" | "curve" }

const TOOLS: { id: Tool; label: string; key: string; icon: string }[] = [
  { id: "select", label: "Select", key: "Esc", icon: "select" },
  { id: "line", label: "Line", key: "L", icon: "line" },
  { id: "circle", label: "Circle", key: "C", icon: "circle" },
  { id: "arc", label: "Arc", key: "A", icon: "arc" },
  { id: "point", label: "Point", key: "P", icon: "point" },
];

const COMMANDS: { id: Command; label: string; key?: string; icon: string; need: string }[] = [
  { id: "horizontal", label: "Horizontal", key: "H", icon: "horizontal", need: "a line, or two points" },
  { id: "vertical", label: "Vertical", key: "V", icon: "vertical", need: "a line, or two points" },
  { id: "parallel", label: "Parallel", icon: "parallel", need: "two or more lines" },
  { id: "perpendicular", label: "Perpendicular", icon: "perpendicular", need: "two lines" },
  { id: "equal", label: "Equal", key: "E", icon: "equal", need: "two or more lines, or two or more circles" },
  { id: "coincident", label: "Coincident", key: "O", icon: "coincident", need: "two points, or a point and a line or circle" },
  { id: "midpoint", label: "Midpoint", key: "M", icon: "midpoint", need: "a point and a line" },
  { id: "tangent", label: "Tangent", key: "T", icon: "tangent", need: "a line and a circle or arc" },
  { id: "fixed", label: "Fix point", key: "F", icon: "fixed", need: "one or more points" },
  { id: "dimension", label: "Dimension", key: "D", icon: "dimension", need: "a line, two points, two lines, or a circle" },
];

const RELATION_NAMES: Record<string, string> = {
  coincident: "Coincident", pointOn: "Point on curve", midpoint: "Midpoint", horizontal: "Horizontal",
  vertical: "Vertical", parallel: "Parallel", perpendicular: "Perpendicular", equal: "Equal",
  tangent: "Tangent", fixed: "Fixed point", distance: "Distance", angle: "Angle", radius: "Radius",
};

const AUTOSAVE_KEY = "mech-sketch.autosave";
const POINT_TOL = 10;  // px
const CURVE_TOL = 7;   // px
const DEFAULT_SCALE = 40;

const $ = <T extends Element>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing element ${sel}`);
  return el;
};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Parses a number typed with either a decimal point or a decimal comma. */
function parseNumber(text: string): number {
  const t = text.trim().replace(",", ".");
  return t === "" ? NaN : Number(t);
}

export class App {
  sk: Sketch = emptySketch();
  private history = new History();
  private result: SolveResult = { ok: true, dof: 0, conflicting: [], redundant: [] };

  private view: View = { cx: 0, cy: 0, scale: DEFAULT_SCALE, w: 800, h: 600 };
  private tool: Tool = "select";
  private selection = new Set<Id>();
  private hover: Id | null = null;
  private pending: Pending | null = null;
  private drag: DragState | null = null;
  private cursor: V = [0, 0]; // last pointer position, screen px
  private snapMark: SnapMark | null = null;
  private altKey = false;
  private spaceKey = false;
  private editing: Id | null = null;

  private prims: Prim[] = [];
  private glyphs: Glyph[] = [];
  private frame = 0;
  private chromeDirty = true;
  private hintOverride: string | null = null;
  private toastTimer = 0;

  private svg = $<SVGSVGElement>("#canvas");
  private stage = $<HTMLElement>("#stage");
  private panel = $<HTMLElement>("#panel");
  private titleblock = $<HTMLElement>("#titleblock");
  private hintEl = $<HTMLElement>("#hint");
  private coordsEl = $<HTMLElement>("#coords");
  private toastEl = $<HTMLElement>("#toast");
  private emptyEl = $<HTMLElement>("#empty");
  private dimEditor = $<HTMLInputElement>("#dim-editor");
  private fileInput = $<HTMLInputElement>("#file-input");

  constructor(private solver: SketchSolver) {
    this.buildToolbars();
    this.bindEvents();
    this.restore();
    this.resize();
    this.fit();
    this.solve();
    this.history.reset(this.sk);
    this.render();
  }

  // ---- state ----------------------------------------------------------------

  private solve(drags: Drag[] = []): SolveResult {
    this.result = this.solver.solve(this.sk, drags);
    return this.result;
  }

  /** Records the current sketch as an undo step and saves it. */
  private commit(): void {
    this.history.commit(this.sk);
    this.autosave();
    this.touch();
  }

  private autosave(): void {
    try {
      localStorage.setItem(AUTOSAVE_KEY, serialize(this.sk));
    } catch {
      // Storage can be unavailable (private window, file:// in some browsers).
    }
  }

  private restore(): void {
    try {
      const saved = localStorage.getItem(AUTOSAVE_KEY);
      if (saved) this.sk = deserialize(saved);
    } catch {
      this.sk = emptySketch();
    }
  }

  /** Marks panels as stale and schedules a redraw. */
  private touch(): void {
    this.chromeDirty = true;
    this.render();
  }

  private render(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private replaceSketch(sk: Sketch): void {
    this.sk = sk;
    this.pruneSelection();
    this.pending = null;
    this.closeDimEditor();
    this.solve();
  }

  private pruneSelection(): void {
    for (const id of [...this.selection]) {
      if (!entity(this.sk, id) && !constraint(this.sk, id)) this.selection.delete(id);
    }
    if (this.hover && !entity(this.sk, this.hover) && !constraint(this.sk, this.hover)) this.hover = null;
  }

  private toast(message: string): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove("show"), 4200);
  }

  // ---- drawing the screen -----------------------------------------------------

  private draw(): void {
    const mm = mmPerUnit(this.sk);
    this.prims = buildPrims(this.sk, mm, { editor: true });
    this.glyphs = layoutGlyphs(this.sk, this.view);

    const related = new Set<Id>();
    for (const id of this.selection) {
      const c = constraint(this.sk, id);
      if (c) constraintRefs(c).forEach((r) => related.add(r));
    }
    this.svg.innerHTML = renderScene({
      sk: this.sk, view: this.view, mm, prims: this.prims, glyphs: this.glyphs,
      selection: this.selection, related, hover: this.hover,
      conflicting: new Set(this.result.conflicting), redundant: new Set(this.result.redundant),
      free: this.result.dof > 0 || !this.result.ok,
      preview: this.previewShapes(), snap: this.snapMark,
      box: this.drag?.kind === "box" ? { a: this.drag.a, b: this.drag.b } : null,
    });

    this.emptyEl.hidden = this.sk.entities.length > 0 || this.pending !== null;
    this.svg.dataset.tool = this.tool === "select" ? "select" : "draw";
    this.svg.classList.toggle("panning", this.drag?.kind === "pan" || this.spaceKey);
    this.svg.classList.toggle("over", this.tool === "select" && this.hover !== null && !this.drag);

    const m = toModel(this.view, this.cursor);
    this.coordsEl.textContent = `x ${formatNumber(m[0])}   y ${formatNumber(m[1])}`;
    this.hintEl.textContent = this.hintOverride ?? this.toolHint();

    if (this.chromeDirty) {
      this.chromeDirty = false;
      this.drawPanel();
      this.drawTitleblock(mm);
      this.updateButtons();
    }
    if (this.editing) this.placeDimEditor();
  }

  private toolHint(): string {
    const p = this.pending;
    switch (this.tool) {
      case "select":
        return "Click to select, drag to move. Shift-click adds to the selection. Wheel zooms; middle-drag or Space-drag pans.";
      case "point": return "Click to place a point.";
      case "line":
        return p ? "Click the next joint. Esc or right-click ends the chain. Hold Alt to switch snapping off."
          : "Click to place the first joint.";
      case "circle": return p ? "Click to set the radius." : "Click the centre.";
      case "arc":
        if (!p) return "Click the centre.";
        return p.tool === "arc" && p.start ? "Sweep around the centre, then click where the arc ends." : "Click where the arc starts.";
    }
  }

  private previewShapes(): Preview | null {
    const p = this.pending;
    if (!p || this.drag?.kind === "pan") return null;
    const snap = this.snapAt(this.cursor, this.snapAnchor());
    const pv: Preview = { lines: [], circles: [], arcs: [], points: [] };
    if (p.tool === "line") {
      pv.lines.push([p.start.pos, snap.pos]);
      if (!p.start.pointId) pv.points.push(p.start.pos);
    } else if (p.tool === "circle") {
      pv.circles.push({ c: p.center.pos, r: dist(p.center.pos, snap.pos) });
      pv.points.push(p.center.pos);
    } else {
      pv.points.push(p.center.pos);
      if (!p.start) {
        pv.lines.push([p.center.pos, snap.pos]);
      } else {
        const r = dist(p.center.pos, p.start.pos);
        const a0 = angleOf(sub(p.start.pos, p.center.pos));
        const a1 = angleOf(sub(snap.pos, p.center.pos));
        if (p.sweep >= 0) pv.arcs.push({ c: p.center.pos, r, a0, a1: a0 + (wrap(a1 - a0) || TWO_PI) });
        else pv.arcs.push({ c: p.center.pos, r, a0: a1, a1: a1 + (wrap(a0 - a1) || TWO_PI) });
        pv.points.push(p.start.pos);
      }
    }
    return pv;
  }

  // ---- hit testing and snapping -----------------------------------------------

  private pxPerMm(): number {
    return this.view.scale / mmPerUnit(this.sk);
  }

  private hitTest(sp: V): Hit | null {
    let best: Hit | null = null;
    let bestD = POINT_TOL;
    for (const p of points(this.sk)) {
      const d = dist(toScreen(this.view, [p.x, p.y]), sp);
      if (d < bestD) { bestD = d; best = { id: p.id, kind: "point" }; }
    }
    if (best) return best;

    const half = GLYPH_SIZE / 2 + 1;
    for (const g of this.glyphs) {
      if (Math.abs(sp[0] - g.x) <= half && Math.abs(sp[1] - g.y) <= half) return { id: g.id, kind: "glyph" };
    }

    const mm = mmPerUnit(this.sk);
    const q = mul(toModel(this.view, sp), mm);
    const tol = CURVE_TOL / this.pxPerMm();
    bestD = tol;
    for (const p of this.prims) {
      if (!p.ref) continue;
      // Text wins ties so a dimension's number is easy to grab.
      const d = primDistance(p, q) - (p.k === "text" ? tol * 0.5 : 0);
      if (d < bestD) { bestD = d; best = { id: p.ref, kind: p.layer === "dim" ? "dim" : "curve" }; }
    }
    return best;
  }

  /** The point a drawing tool's next click is measured from, for H/V inference. */
  private snapAnchor(): V | undefined {
    const p = this.pending;
    if (p?.tool === "line") return p.start.pos;
    return undefined;
  }

  private snapAt(sp: V, anchor?: V): Snap {
    const raw = toModel(this.view, sp);
    if (this.altKey) return { pos: raw };

    let bestD = POINT_TOL;
    let hitPoint: Point | null = null;
    for (const p of points(this.sk)) {
      const d = dist(toScreen(this.view, [p.x, p.y]), sp);
      if (d < bestD) { bestD = d; hitPoint = p; }
    }
    if (hitPoint) return { pos: [hitPoint.x, hitPoint.y], pointId: hitPoint.id };

    const tol = CURVE_TOL / this.view.scale;
    let bestCurve: Snap | null = null;
    let bestCurveD = tol;
    for (const e of curves(this.sk)) {
      if (e.type === "line") {
        const a = point(this.sk, e.p1), b = point(this.sk, e.p2);
        const A: V = [a.x, a.y], B: V = [b.x, b.y];
        const pr = projectOnSegment(raw, A, B);
        const d = dist(raw, pr.point);
        if (d >= bestCurveD) continue;
        const m = mid(A, B);
        const nearMid = dist(pr.point, m) * this.view.scale < 9;
        bestCurveD = d;
        bestCurve = nearMid ? { pos: m, curveId: e.id, midpoint: true } : { pos: pr.point, curveId: e.id };
      } else {
        const c = point(this.sk, e.c);
        const C: V = [c.x, c.y];
        const r = e.type === "circle" ? e.r : arcRadius(this.sk, e);
        const ang = angleOf(sub(raw, C));
        if (e.type === "arc") {
          const s = point(this.sk, e.p1), t = point(this.sk, e.p2);
          if (!inSweep(ang, angleOf([s.x - c.x, s.y - c.y]), angleOf([t.x - c.x, t.y - c.y]))) continue;
        }
        const d = Math.abs(dist(raw, C) - r);
        if (d >= bestCurveD) continue;
        bestCurveD = d;
        bestCurve = { pos: polar(C, r, ang), curveId: e.id };
      }
    }
    if (bestCurve) return bestCurve;

    if (anchor) {
      const a = toScreen(this.view, anchor);
      const dx = Math.abs(sp[0] - a[0]), dy = Math.abs(sp[1] - a[1]);
      if (dy < 7 && dx > 14) return { pos: [raw[0], anchor[1]], axis: "h" };
      if (dx < 7 && dy > 14) return { pos: [anchor[0], raw[1]], axis: "v" };
    }
    return { pos: raw };
  }

  private markFor(s: Snap, anchor?: V): SnapMark | null {
    if (s.pointId) return { pos: s.pos, kind: "point" };
    if (s.curveId) return { pos: s.pos, kind: s.midpoint ? "mid" : "curve" };
    if (s.axis) return { pos: s.pos, kind: s.axis, from: anchor };
    return null;
  }

  // ---- drawing tools ------------------------------------------------------------

  /** Turns a snap into a real point, creating it if the click was on empty space. */
  private materialize(s: Snap, autos: ConstraintDraft[], standalone = false): Id {
    if (s.pointId) return s.pointId;
    const p = addPoint(this.sk, s.pos[0], s.pos[1], standalone);
    if (s.curveId) {
      autos.push(s.midpoint ? { type: "midpoint", p: p.id, l: s.curveId } : { type: "pointOn", p: p.id, on: s.curveId });
    }
    return p.id;
  }

  /**
   * Adds the constraints a drawing tool inferred, keeping each one only if the
   * sketch still solves cleanly with it, then records the edit.
   */
  private finishDrawing(autos: ConstraintDraft[]): void {
    const baseline = this.solver.solve(this.sk);
    for (const a of autos) {
      const c = addConstraint(this.sk, a);
      const r = this.solver.solve(this.sk);
      if (!r.ok || r.conflicting.length > baseline.conflicting.length || r.redundant.length > baseline.redundant.length) {
        this.sk.constraints = this.sk.constraints.filter((x) => x !== c);
      }
    }
    this.solve();
    this.commit();
  }

  private toolClick(sp: V): void {
    const snap = this.snapAt(sp, this.snapAnchor());
    const autos: ConstraintDraft[] = [];
    const p = this.pending;

    if (this.tool === "point") {
      if (snap.pointId) return;
      this.materialize(snap, autos, true);
      this.finishDrawing(autos);
      return;
    }

    if (this.tool === "line") {
      if (!p || p.tool !== "line") {
        this.pending = { tool: "line", start: snap };
        return;
      }
      const s = p.start;
      const samePoint = snap.pointId !== undefined && snap.pointId === s.pointId;
      if (samePoint || dist(toScreen(this.view, s.pos), toScreen(this.view, snap.pos)) < 3) {
        this.pending = null; // clicking the last joint again ends the chain
        return;
      }
      const a = this.materialize(s, autos);
      const b = this.materialize(snap, autos);
      addLine(this.sk, a, b);
      if (snap.axis) autos.push({ type: snap.axis === "h" ? "horizontal" : "vertical", a, b });
      this.finishDrawing(autos);
      const first = p.first ?? a;
      if (b === first) {
        this.pending = null; // the chain closed on itself
        return;
      }
      const end = point(this.sk, b);
      this.pending = { tool: "line", start: { pos: [end.x, end.y], pointId: b }, first };
      return;
    }

    if (this.tool === "circle") {
      if (!p || p.tool !== "circle") {
        this.pending = { tool: "circle", center: snap };
        return;
      }
      const r = dist(p.center.pos, snap.pos);
      if (r * this.view.scale < 3) return;
      const c = this.materialize(p.center, autos);
      const circle = addCircle(this.sk, c, r);
      if (snap.pointId && snap.pointId !== c) autos.push({ type: "pointOn", p: snap.pointId, on: circle.id });
      this.pending = null;
      this.finishDrawing(autos);
      return;
    }

    if (this.tool === "arc") {
      if (!p || p.tool !== "arc") {
        this.pending = { tool: "arc", center: snap, sweep: 0, lastAng: 0 };
        return;
      }
      if (!p.start) {
        if (dist(p.center.pos, snap.pos) * this.view.scale < 3) return;
        p.start = snap;
        p.lastAng = angleOf(sub(snap.pos, p.center.pos));
        p.sweep = 0;
        return;
      }
      const r = dist(p.center.pos, p.start.pos);
      const endAng = angleOf(sub(snap.pos, p.center.pos));
      const c = this.materialize(p.center, autos);
      const s = this.materialize(p.start, autos);
      let e: Id;
      if (snap.pointId && snap.pointId !== s && snap.pointId !== c) e = snap.pointId;
      else {
        const q = polar(p.center.pos, r, endAng);
        e = addPoint(this.sk, q[0], q[1]).id;
      }
      if (p.sweep >= 0) addArc(this.sk, c, s, e);
      else addArc(this.sk, c, e, s);
      this.pending = null;
      this.finishDrawing(autos);
    }
  }

  private setTool(t: Tool): void {
    this.tool = t;
    this.pending = null;
    this.snapMark = null;
    if (t !== "select") {
      this.selection.clear();
      this.hover = null;
    }
    this.closeDimEditor();
    this.touch();
  }

  // ---- pointer --------------------------------------------------------------

  private screenPos(ev: PointerEvent | WheelEvent | MouseEvent): V {
    const r = this.svg.getBoundingClientRect();
    return [ev.clientX - r.left, ev.clientY - r.top];
  }

  private onPointerDown(ev: PointerEvent): void {
    const sp = this.screenPos(ev);
    this.cursor = sp;
    this.altKey = ev.altKey;
    if (this.editing) this.commitDimEditor();
    // Working on the canvas ends any typing in the panels.
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused !== document.body) focused.blur();
    this.svg.setPointerCapture(ev.pointerId);

    if (ev.button === 1 || ev.button === 2 || (ev.button === 0 && this.spaceKey)) {
      this.drag = { kind: "pan", last: sp, moved: false };
      this.render();
      return;
    }
    if (ev.button !== 0) return;

    if (this.tool !== "select") {
      this.toolClick(sp);
      this.updateSnapMark();
      this.render();
      return;
    }

    const hit = this.hitTest(sp);
    if (!hit) {
      this.drag = { kind: "box", a: sp, b: sp, additive: ev.shiftKey };
      return;
    }
    if (ev.shiftKey) {
      if (this.selection.has(hit.id)) this.selection.delete(hit.id);
      else this.selection.add(hit.id);
      this.touch();
      return;
    }
    const wasSelected = this.selection.has(hit.id);
    if (!wasSelected) this.selection = new Set([hit.id]);

    if (hit.kind === "dim") {
      this.drag = { kind: "dim", id: hit.id, startScreen: sp, moved: false };
    } else if (hit.kind !== "glyph") {
      this.drag = this.startMove(hit.id, sp, wasSelected && this.selection.size > 1);
    }
    this.touch();
  }

  private startMove(grabbed: Id, sp: V, collapse: boolean): DragState {
    const ids = new Set<Id>();
    let rim: Id | undefined;
    const selected = [...this.selection].map((id) => entity(this.sk, id)).filter((e) => e !== undefined);
    if (selected.length === 1 && (selected[0].type === "circle" || selected[0].type === "arc")) {
      rim = selected[0].id;
    } else {
      for (const e of selected) {
        if (e.type === "point") ids.add(e.id);
        else curvePoints(e).forEach((p) => ids.add(p));
      }
    }
    const targets = [...ids].map((id) => { const p = point(this.sk, id); return { id, x: p.x, y: p.y }; });
    return { kind: "move", grabbed, startScreen: sp, startModel: toModel(this.view, sp), targets, rim, moved: false, collapse };
  }

  private onPointerMove(ev: PointerEvent): void {
    const sp = this.screenPos(ev);
    this.cursor = sp;
    this.altKey = ev.altKey;
    const d = this.drag;

    if (d?.kind === "pan") {
      const dx = sp[0] - d.last[0], dy = sp[1] - d.last[1];
      if (Math.abs(dx) + Math.abs(dy) > 0) d.moved = true;
      this.view.cx -= dx / this.view.scale;
      this.view.cy += dy / this.view.scale;
      d.last = sp;
    } else if (d?.kind === "box") {
      d.b = sp;
    } else if (d?.kind === "move") {
      if (!d.moved && dist(sp, d.startScreen) < 3) return;
      d.moved = true;
      const m = toModel(this.view, sp);
      const delta = sub(m, d.startModel);
      const drags: Drag[] = d.rim
        ? [{ kind: "rim", id: d.rim, x: m[0], y: m[1] }]
        : d.targets.map((t) => ({ kind: "point", id: t.id, x: t.x + delta[0], y: t.y + delta[1] }));
      this.solve(drags);
      this.chromeDirty = true;
    } else if (d?.kind === "dim") {
      if (!d.moved && dist(sp, d.startScreen) < 3) return;
      d.moved = true;
      this.dragDimension(d.id, sp);
    } else if (this.tool === "select") {
      const hit = this.hitTest(sp);
      this.hover = hit?.id ?? null;
    } else {
      const p = this.pending;
      if (p?.tool === "arc" && p.start) {
        const ang = angleOf(sub(toModel(this.view, sp), p.center.pos));
        let step = ang - p.lastAng;
        if (step > Math.PI) step -= TWO_PI;
        if (step < -Math.PI) step += TWO_PI;
        p.sweep = Math.max(-TWO_PI, Math.min(TWO_PI, p.sweep + step));
        p.lastAng = ang;
      }
      this.updateSnapMark();
    }
    this.render();
  }

  private updateSnapMark(): void {
    if (this.tool === "select") {
      this.snapMark = null;
      return;
    }
    const anchor = this.snapAnchor();
    this.snapMark = this.markFor(this.snapAt(this.cursor, anchor), anchor);
  }

  private onPointerUp(ev: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    if (this.svg.hasPointerCapture(ev.pointerId)) this.svg.releasePointerCapture(ev.pointerId);
    if (!d) return;

    if (d.kind === "pan") {
      // A right-click that did not pan cancels what the tool was doing.
      if (!d.moved && ev.button === 2) this.cancel();
    } else if (d.kind === "box") {
      this.finishBox(d);
    } else if (d.kind === "move") {
      if (d.moved) {
        this.solve();
        this.commit();
      } else if (d.collapse) {
        this.selection = new Set([d.grabbed]);
      }
    } else if (d.kind === "dim" && d.moved) {
      this.commit();
    }
    this.touch();
  }

  private finishBox(d: Extract<DragState, { kind: "box" }>): void {
    if (!d.additive) this.selection.clear();
    if (dist(d.a, d.b) < 3) return;
    const x0 = Math.min(d.a[0], d.b[0]), x1 = Math.max(d.a[0], d.b[0]);
    const y0 = Math.min(d.a[1], d.b[1]), y1 = Math.max(d.a[1], d.b[1]);
    const inside = (id: Id) => {
      const p = point(this.sk, id);
      const s = toScreen(this.view, [p.x, p.y]);
      return s[0] >= x0 && s[0] <= x1 && s[1] >= y0 && s[1] <= y1;
    };
    for (const e of this.sk.entities) {
      if (e.type === "point") {
        if (inside(e.id)) this.selection.add(e.id);
      } else if (curvePoints(e).every(inside)) {
        if (e.type === "circle") {
          const c = toScreen(this.view, [point(this.sk, e.c).x, point(this.sk, e.c).y]);
          const r = e.r * this.view.scale;
          if (c[0] - r < x0 || c[0] + r > x1 || c[1] - r < y0 || c[1] + r > y1) continue;
        }
        this.selection.add(e.id);
      }
    }
  }

  private onWheel(ev: WheelEvent): void {
    ev.preventDefault();
    const sp = this.screenPos(ev);
    const before = toModel(this.view, sp);
    const unit = ev.deltaMode === 1 ? 32 : 1; // lines vs pixels
    const factor = Math.exp(-ev.deltaY * unit * 0.0016);
    this.view.scale = Math.max(1e-4, Math.min(1e7, this.view.scale * factor));
    const after = toModel(this.view, sp);
    this.view.cx += before[0] - after[0];
    this.view.cy += before[1] - after[1];
    this.render();
  }

  private onDoubleClick(ev: MouseEvent): void {
    if (this.tool !== "select") return;
    const hit = this.hitTest(this.screenPos(ev));
    if (hit?.kind === "dim") {
      this.selection = new Set([hit.id]);
      this.openDimEditor(hit.id);
      this.touch();
    }
  }

  /** Esc and right-click: back out one level at a time. */
  private cancel(): void {
    if (this.editing) this.closeDimEditor();
    else if (this.pending) this.pending = null;
    else if (this.tool !== "select") return this.setTool("select");
    else this.selection.clear();
    this.snapMark = null;
    this.touch();
  }

  // ---- dimensions -----------------------------------------------------------

  private dragDimension(id: Id, sp: V): void {
    const d = constraint(this.sk, id);
    if (!d || !isDimension(d)) return;
    const mm = mmPerUnit(this.sk);
    const q = mul(toModel(this.view, sp), mm);
    if (d.type === "distance") {
      const f = distanceFrame(this.sk, d, mm);
      d.offset = dot(sub(q, f.A), f.n);
    } else if (d.type === "angle") {
      const f = angleFrame(this.sk, d, mm);
      if (f) d.radius = Math.max(3, dist(q, f.vertex));
    } else {
      const f = roundFrame(this.sk, d.target, mm);
      if (f) d.angle = angleOf(sub(q, f.c));
    }
  }

  /**
   * Offset that puts a distance dimension on the outside of the figure: the
   * side of the two points that faces away from the middle of the geometry.
   */
  private outsideOffset(a: Point, b: Point, mode: DistanceMode): number {
    const mm = mmPerUnit(this.sk);
    const box = geometryBox(this.sk);
    const centre: V = [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2];
    const A: V = [a.x, a.y], B: V = [b.x, b.y];
    const m = mid(A, B);
    if (mode === "aligned") {
      const n = perp(norm(sub(B, A)));
      const lean = dot(sub(m, centre), n);
      const side = Math.abs(lean) < 1e-9 ? (n[1] > 0 ? -1 : 1) : Math.sign(lean);
      return side * PAPER.dimOffset;
    }
    // Horizontal dimensions sit above or below both points, vertical ones left or right.
    const i = mode === "horizontal" ? 1 : 0;
    const lo = Math.min(A[i], B[i]), hi = Math.max(A[i], B[i]);
    return m[i] <= centre[i] ? (lo - A[i]) * mm - PAPER.dimOffset : (hi - A[i]) * mm + PAPER.dimOffset;
  }

  private dimensionDraft(): ConstraintDraft | string {
    const { pts, lines, rounds } = this.picked();
    const mm = mmPerUnit(this.sk);
    const xy = (p: Point): V => [p.x, p.y];

    if ((pts.length === 2 && !lines.length && !rounds.length) || (lines.length === 1 && !pts.length && !rounds.length)) {
      const [a, b] = pts.length === 2 ? pts : [point(this.sk, lines[0].p1), point(this.sk, lines[0].p2)];
      const value = dist(xy(a), xy(b));
      if (value < 1e-9) return "Those two points are in the same place.";
      return { type: "distance", a: a.id, b: b.id, mode: "aligned", value, offset: this.outsideOffset(a, b, "aligned") };
    }

    if (lines.length === 2 && !pts.length && !rounds.length) {
      let [l1, l2] = lines;
      const ends = (l: Line): [V, V] => [xy(point(this.sk, l.p1)), xy(point(this.sk, l.p2))];
      let [a1, b1] = ends(l1), [a2, b2] = ends(l2);
      const vertex = intersectLines(a1, sub(b1, a1), a2, sub(b2, a2));
      if (!vertex) return "Those lines are parallel, so there is no angle to dimension.";
      // Measure along each member away from the vertex, towards its far end.
      let rev1 = dist(vertex, a1) > dist(vertex, b1);
      let rev2 = dist(vertex, a2) > dist(vertex, b2);
      let d1 = norm(sub(rev1 ? a1 : b1, vertex)), d2 = norm(sub(rev2 ? a2 : b2, vertex));
      let value = Math.atan2(cross(d1, d2), dot(d1, d2));
      if (value < 0) {
        [l1, l2] = [l2, l1];
        [rev1, rev2] = [rev2, rev1];
        [a1, b1, a2, b2] = [a2, b2, a1, b1];
        [d1, d2] = [d2, d1];
        value = -value;
      }
      if (value < 1e-6 || value > Math.PI - 1e-6) return "Those lines are in line with each other.";
      const reach = Math.min(dist(a1, b1), dist(a2, b2)) * mm;
      const radius = Math.max(6, Math.min(14, reach * 0.35));
      return { type: "angle", l1: l1.id, rev1, l2: l2.id, rev2, value, radius };
    }

    if (rounds.length === 1 && !pts.length && !lines.length) {
      const e = rounds[0];
      if (e.type === "circle") return { type: "radius", target: e.id, value: e.r, angle: Math.PI / 4 };
      const c = point(this.sk, e.c), s = point(this.sk, e.p1), t = point(this.sk, e.p2);
      const a0 = angleOf([s.x - c.x, s.y - c.y]);
      const a1 = a0 + (wrap(angleOf([t.x - c.x, t.y - c.y]) - a0) || TWO_PI);
      return { type: "radius", target: e.id, value: arcRadius(this.sk, e), angle: (a0 + a1) / 2 };
    }
    return "Select a line, two points, two lines, or a circle to dimension.";
  }

  private addDimension(): void {
    const draft = this.dimensionDraft();
    if (typeof draft === "string") return this.toast(draft);
    const made = this.addManual([draft], "That dimension would over-constrain the sketch.");
    if (!made) return;
    this.selection = new Set([made[0].id]);
    this.openDimEditor(made[0].id);
    this.touch();
  }

  /** The number shown to the user: degrees for angles, plain value otherwise. */
  private shownValue(d: Dimension): string {
    return formatNumber(d.type === "angle" ? (d.value * 180) / Math.PI : d.value);
  }

  private setDimValue(id: Id, text: string): boolean {
    const d = constraint(this.sk, id);
    if (!d || !isDimension(d)) return false;
    let v = parseNumber(text);
    if (!Number.isFinite(v)) {
      this.toast("Type a number, such as 3 or 2,5.");
      return false;
    }
    if (d.type === "angle") {
      if (v <= 0 || v >= 360) { this.toast("An angle must be between 0 and 360 degrees."); return false; }
      v = (v * Math.PI) / 180;
    } else if (d.type === "radius" || (d.type === "distance" && d.mode === "aligned")) {
      if (v <= 0) { this.toast("That value must be greater than zero."); return false; }
    } else if (v < 0) {
      this.toast("Distances cannot be negative.");
      return false;
    }
    if (Math.abs(v - d.value) < 1e-12) return true;

    const before = clone(this.sk);
    const old = d.value;
    d.value = v;
    let r = this.solver.solve(this.sk);
    if (!r.ok) {
      // A big jump can fail from the current shape; walk there in small steps.
      this.sk = clone(before);
      const dd = constraint(this.sk, id) as Dimension;
      const STEPS = 16;
      for (let k = 1; k <= STEPS; k++) {
        dd.value = old + ((v - old) * k) / STEPS;
        r = this.solver.solve(this.sk);
        if (!r.ok) break;
      }
    }
    if (!r.ok) {
      this.sk = before;
      this.solve();
      this.toast("No solution with that value. Another constraint or dimension rules it out.");
      this.touch();
      return false;
    }
    this.result = r;
    this.commit();
    this.keepInView();
    return true;
  }

  /** Refits the view when an edit left the figure off screen or tiny. */
  private keepInView(): void {
    const b = geometryBox(this.sk);
    if (boxIsEmpty(b)) return;
    const [x0, y1] = toScreen(this.view, [b.x0, b.y0]);
    const [x1, y0] = toScreen(this.view, [b.x1, b.y1]);
    const outside = x0 < 0 || y0 < 0 || x1 > this.view.w || y1 > this.view.h;
    const tiny = x1 - x0 < this.view.w * 0.15 && y1 - y0 < this.view.h * 0.15;
    if (outside || tiny) this.fit();
  }

  private openDimEditor(id: Id): void {
    const d = constraint(this.sk, id);
    if (!d || !isDimension(d)) return;
    this.editing = id;
    this.dimEditor.hidden = false;
    this.dimEditor.value = this.shownValue(d);
    this.placeDimEditor();
    this.dimEditor.focus();
    this.dimEditor.select();
  }

  private placeDimEditor(): void {
    const d = this.editing ? constraint(this.sk, this.editing) : undefined;
    if (!d || !isDimension(d)) return this.closeDimEditor();
    const mm = mmPerUnit(this.sk);
    const text = dimensionPrims(this.sk, d, mm).find((p) => p.k === "text");
    if (!text || text.k !== "text") return;
    const b = textBox(text);
    const s = toScreen(this.view, [(b.x0 + b.x1) / 2 / mm, (b.y0 + b.y1) / 2 / mm]);
    this.dimEditor.style.left = `${s[0]}px`;
    this.dimEditor.style.top = `${s[1]}px`;
  }

  private commitDimEditor(): void {
    const id = this.editing;
    if (!id) return;
    const text = this.dimEditor.value;
    this.closeDimEditor();
    this.setDimValue(id, text);
    this.touch();
  }

  private closeDimEditor(): void {
    if (!this.editing) return;
    this.editing = null;
    this.dimEditor.hidden = true;
  }

  // ---- constraint commands ------------------------------------------------------

  private picked() {
    const pts: Point[] = [], lines: Line[] = [], rounds: (Circle | Arc)[] = [], cons: Constraint[] = [];
    for (const id of this.selection) {
      const e = entity(this.sk, id);
      if (e?.type === "point") pts.push(e);
      else if (e?.type === "line") lines.push(e);
      else if (e) rounds.push(e);
      else {
        const c = constraint(this.sk, id);
        if (c) cons.push(c);
      }
    }
    return { pts, lines, rounds, cons };
  }

  private canApply(cmd: Command): boolean {
    const { pts, lines, rounds } = this.picked();
    const P = pts.length, L = lines.length, R = rounds.length;
    switch (cmd) {
      case "horizontal":
      case "vertical":
        return (L >= 1 && P === 0 && R === 0) || (P === 2 && L === 0 && R === 0);
      case "parallel": return L >= 2 && P === 0 && R === 0;
      case "perpendicular": return L === 2 && P === 0 && R === 0;
      case "equal": return (L >= 2 && P === 0 && R === 0) || (R >= 2 && P === 0 && L === 0);
      case "coincident": return (P === 2 && L + R === 0) || (P === 1 && L + R === 1);
      case "midpoint": return P === 1 && L === 1 && R === 0;
      case "tangent": return L === 1 && R === 1 && P === 0;
      case "fixed": return P >= 1 && L + R === 0;
      case "dimension":
        return (P === 2 && L + R === 0) || (L === 1 && P + R === 0) || (L === 2 && P + R === 0) || (R === 1 && P + L === 0);
    }
  }

  /**
   * Adds constraints the user asked for. If the sketch no longer solves, or
   * they add nothing new, the sketch is put back and the reason is shown.
   */
  private addManual(drafts: ConstraintDraft[], redundantMessage = "The sketch is already constrained that way."): Constraint[] | null {
    const before = clone(this.sk);
    const baseline = this.result;
    const made = drafts.map((d) => addConstraint(this.sk, d));
    const r = this.solver.solve(this.sk);
    let problem: string | null = null;
    if (r.conflicting.length > baseline.conflicting.length) problem = "That conflicts with constraints already in the sketch.";
    else if (!r.ok) problem = "The solver could not satisfy that constraint from the current shape.";
    else if (r.redundant.length > baseline.redundant.length) problem = redundantMessage;
    if (problem) {
      this.sk = before;
      this.solve();
      this.toast(problem);
      this.touch();
      return null;
    }
    this.result = r;
    this.commit();
    return made;
  }

  private run(cmd: Command): void {
    const info = COMMANDS.find((c) => c.id === cmd)!;
    if (!this.canApply(cmd)) {
      this.toast(`${info.label}: select ${info.need} first.`);
      return;
    }
    if (cmd === "dimension") return this.addDimension();

    const { pts, lines, rounds } = this.picked();
    const drafts: ConstraintDraft[] = [];
    switch (cmd) {
      case "horizontal":
      case "vertical":
        if (lines.length) lines.forEach((l) => drafts.push({ type: cmd, a: l.p1, b: l.p2 }));
        else drafts.push({ type: cmd, a: pts[0].id, b: pts[1].id });
        break;
      case "parallel":
        // Chained pair by pair, so no line collects a marker for every other line.
        lines.slice(1).forEach((l, i) => drafts.push({ type: "parallel", l1: lines[i].id, l2: l.id }));
        break;
      case "perpendicular":
        drafts.push({ type: "perpendicular", l1: lines[0].id, l2: lines[1].id });
        break;
      case "equal": {
        const items: Curve[] = lines.length ? lines : rounds;
        items.slice(1).forEach((e, i) => drafts.push({ type: "equal", a: items[i].id, b: e.id }));
        break;
      }
      case "coincident":
        if (pts.length === 2) drafts.push({ type: "coincident", a: pts[0].id, b: pts[1].id });
        else {
          const on = lines[0] ?? rounds[0];
          if (curvePoints(on).includes(pts[0].id)) return this.toast("That point already belongs to the curve.");
          drafts.push({ type: "pointOn", p: pts[0].id, on: on.id });
        }
        break;
      case "midpoint":
        if (curvePoints(lines[0]).includes(pts[0].id)) return this.toast("An endpoint cannot be the midpoint of its own line.");
        drafts.push({ type: "midpoint", p: pts[0].id, l: lines[0].id });
        break;
      case "tangent":
        drafts.push({ type: "tangent", l: lines[0].id, c: rounds[0].id });
        break;
      case "fixed": {
        const loose = pts.filter((p) => !isFixed(this.sk, p.id));
        if (!loose.length) {
          // Every selected point is fixed already: the button releases them.
          const ids = new Set(pts.map((p) => p.id));
          this.sk.constraints = this.sk.constraints.filter((c) => !(c.type === "fixed" && ids.has(c.p)));
          this.solve();
          this.commit();
          return;
        }
        loose.forEach((p) => drafts.push({ type: "fixed", p: p.id }));
        break;
      }
    }
    this.addManual(drafts);
  }

  private deleteSelection(): void {
    if (!this.selection.size) return;
    remove(this.sk, this.selection);
    this.selection.clear();
    this.hover = null;
    this.solve();
    this.commit();
  }

  // ---- history, files, view -------------------------------------------------

  private undo(): void {
    const sk = this.history.undo();
    if (!sk) return;
    this.replaceSketch(sk);
    this.autosave();
    this.touch();
  }

  private redo(): void {
    const sk = this.history.redo();
    if (!sk) return;
    this.replaceSketch(sk);
    this.autosave();
    this.touch();
  }

  private newSketch(): void {
    this.selection.clear();
    this.replaceSketch(emptySketch());
    this.commit();
    this.fit();
  }

  private save(): void {
    const blob = new Blob([serialize(this.sk)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "sketch.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  private async open(file: File): Promise<void> {
    try {
      const sk = deserialize(await file.text());
      this.selection.clear();
      this.replaceSketch(sk);
      this.commit();
      this.fit();
    } catch (err) {
      this.toast(err instanceof SyntaxError ? "That file is not valid JSON." : (err as Error).message);
    }
  }

  private resize(): void {
    const r = this.stage.getBoundingClientRect();
    this.view.w = Math.max(50, r.width);
    this.view.h = Math.max(50, r.height);
    this.svg.setAttribute("viewBox", `0 0 ${this.view.w} ${this.view.h}`);
    this.render();
  }

  /** Zooms so the whole figure, with room for its dimensions, is in view. */
  private fit(): void {
    const b = geometryBox(this.sk);
    if (boxIsEmpty(b)) {
      this.view.cx = 0;
      this.view.cy = 0;
      this.view.scale = DEFAULT_SCALE;
    } else {
      const margin = 18 / mmPerUnit(this.sk); // paper mm kept clear around the geometry
      const w = b.x1 - b.x0 + 2 * margin, h = b.y1 - b.y0 + 2 * margin;
      // Keep the figure clear of the title block in the bottom corner.
      const reserved = Math.min(this.titleblock.offsetHeight + 20, this.view.h / 3);
      const usable = this.view.h - reserved;
      this.view.scale = Math.min(this.view.w / w, usable / h);
      this.view.cx = (b.x0 + b.x1) / 2;
      this.view.cy = (b.y0 + b.y1) / 2 - reserved / 2 / this.view.scale;
    }
    this.render();
  }

  // ---- chrome ---------------------------------------------------------------

  private buildToolbars(): void {
    $("#tools").innerHTML = TOOLS.map((t) =>
      `<button type="button" class="tool" data-tool="${t.id}" aria-label="${t.label}" title="${t.label} (${t.key})">${icon(t.icon, 22)}<span>${t.label}</span></button>`,
    ).join("");
    $("#constraint-actions").innerHTML = COMMANDS.map((c) =>
      `${c.id === "dimension" ? `<span class="rule"></span>` : ""}<button type="button" class="icon-btn" data-cmd="${c.id}" aria-label="${c.label}" title="${c.label}${c.key ? ` (${c.key})` : ""}">${icon(c.icon)}</button>`,
    ).join("");
    $("#view-actions").innerHTML =
      `<button type="button" class="icon-btn" data-act="undo" aria-label="Undo" title="Undo (Ctrl+Z)">${icon("undo")}</button>` +
      `<button type="button" class="icon-btn" data-act="redo" aria-label="Redo" title="Redo (Ctrl+Y)">${icon("redo")}</button>` +
      `<button type="button" class="icon-btn" data-act="fit" aria-label="Zoom to fit" title="Zoom to fit (0)">${icon("fit")}</button>`;
  }

  private updateButtons(): void {
    document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.tool === this.tool));
    });
    document.querySelectorAll<HTMLButtonElement>("[data-cmd]").forEach((b) => {
      const cmd = b.dataset.cmd as Command;
      const ok = this.canApply(cmd);
      // Left focusable when unavailable, so the hint can explain what to select.
      b.setAttribute("aria-disabled", String(!ok));
      if (cmd === "fixed") {
        const { pts } = this.picked();
        b.setAttribute("aria-pressed", String(ok && pts.every((p) => isFixed(this.sk, p.id))));
      }
    });
    $<HTMLButtonElement>('[data-act="undo"]').disabled = !this.history.canUndo;
    $<HTMLButtonElement>('[data-act="redo"]').disabled = !this.history.canRedo;
  }

  private drawTitleblock(mm: number): void {
    const r = this.result;
    let state: string, cls: string, count: string;
    if (!this.sk.entities.length) { count = "–"; state = "Nothing drawn yet"; cls = ""; }
    else if (r.conflicting.length || !r.ok) { count = "!"; state = "Constraints conflict"; cls = "bad"; }
    else if (r.dof === 0) { count = "0"; state = "Fully constrained"; cls = "done"; }
    else { count = String(r.dof); state = r.dof === 1 ? "degree of freedom left" : "degrees of freedom left"; cls = "free"; }

    const active = document.activeElement === this.titleblock.querySelector("input");
    if (active) {
      // Leave the width field alone while it is being typed in.
      const dof = this.titleblock.querySelector(".tb-dof");
      if (dof) dof.outerHTML = this.dofCell(count, state, cls);
      const scale = this.titleblock.querySelector(".tb-scale-v");
      if (scale) scale.textContent = `1 unit = ${formatNumber(mm)} mm`;
      return;
    }
    this.titleblock.innerHTML =
      this.dofCell(count, state, cls) +
      `<label class="tb-cell"><span class="tb-k">Figure width</span><span class="tb-v"><input id="fig-width" type="text" inputmode="decimal" value="${formatNumber(this.sk.figureWidthMm / 10)}"> cm</span></label>` +
      `<div class="tb-cell"><span class="tb-k">Paper scale</span><span class="tb-v tb-scale-v">1 unit = ${formatNumber(mm)} mm</span></div>`;
  }

  private dofCell(count: string, state: string, cls: string): string {
    return `<div class="tb-cell tb-dof ${cls}"><span class="tb-count">${count}</span><span class="tb-state">${state}</span></div>`;
  }

  private describe(c: Constraint): string {
    if (isDimension(c)) {
      const unit = c.type === "angle" ? "°" : "";
      const label = c.label?.trim() ? ` shown as ${c.label.trim()}` : "";
      return `${RELATION_NAMES[c.type]} ${this.shownValue(c)}${unit}${label}`;
    }
    return RELATION_NAMES[c.type];
  }

  private constraintRows(list: Constraint[]): string {
    if (!list.length) return "";
    const bad = new Set(this.result.conflicting), extra = new Set(this.result.redundant);
    return `<ul class="rows">${list.map((c) => {
      const flag = bad.has(c.id) ? `<span class="flag bad">conflicts</span>` : extra.has(c.id) ? `<span class="flag extra">redundant</span>` : "";
      const ico = isDimension(c) ? "dimension" : c.type;
      return `<li><button type="button" class="row" data-select="${c.id}">${icon(ico, 16)}<span>${esc(this.describe(c))}</span>${flag}</button>` +
        `<button type="button" class="row-del" data-delete="${c.id}" aria-label="Delete ${esc(this.describe(c))}" title="Delete">${icon("trash", 16)}</button></li>`;
    }).join("")}</ul>`;
  }

  private drawPanel(): void {
    const focusField = (document.activeElement as HTMLElement | null)?.dataset?.field;
    const { pts, lines, rounds, cons } = this.picked();
    const entities = pts.length + lines.length + rounds.length;
    let html = "";

    if (cons.length === 1 && entities === 0 && isDimension(cons[0])) {
      const d = cons[0];
      html += `<h2>${RELATION_NAMES[d.type]}</h2>`;
      html += `<label class="field"><span>Value${d.type === "angle" ? " (degrees)" : ""}</span><input data-field="value" type="text" inputmode="decimal" value="${this.shownValue(d)}"></label>`;
      html += `<label class="field"><span>Label</span><input data-field="label" type="text" spellcheck="false" placeholder="2a, F_1, \\alpha" value="${esc(d.label ?? "")}"><small>Shown in the figure instead of the number. Written as TeX math.</small></label>`;
      if (d.type === "distance") {
        const modes: [DistanceMode, string][] = [["aligned", "Aligned"], ["horizontal", "Horizontal"], ["vertical", "Vertical"]];
        html += `<div class="field"><span id="mode-label">Measured</span><div class="segmented" role="group" aria-labelledby="mode-label">${modes.map(([m, name]) =>
          `<button type="button" data-mode="${m}" aria-pressed="${d.mode === m}">${name}</button>`).join("")}</div></div>`;
      }
      html += `<label class="check"><input data-field="hidden" type="checkbox"${d.hidden ? " checked" : ""}><span>Leave out of the figure</span></label>`;
      html += `<button type="button" class="danger" data-act="delete">Delete dimension</button>`;
    } else if (cons.length >= 1 && entities === 0) {
      html += `<h2>${cons.length === 1 ? RELATION_NAMES[cons[0].type] : `${cons.length} constraints`}</h2>`;
      html += this.constraintRows(cons);
      html += `<button type="button" class="danger" data-act="delete">Delete</button>`;
    } else if (entities > 0) {
      const names: string[] = [];
      const count = (n: number, one: string, many: string) => { if (n) names.push(`${n} ${n === 1 ? one : many}`); };
      count(pts.length, "point", "points");
      count(lines.length, "line", "lines");
      count(rounds.filter((r) => r.type === "circle").length, "circle", "circles");
      count(rounds.filter((r) => r.type === "arc").length, "arc", "arcs");
      html += `<h2>${names.join(", ")}</h2>`;
      if (pts.length === 1 && entities === 1) {
        html += `<p class="muted">x ${formatNumber(pts[0].x)}, y ${formatNumber(pts[0].y)}</p>`;
      }
      const cs: Curve[] = [...lines, ...rounds];
      if (cs.length) {
        const all = cs.every((c) => c.construction);
        html += `<label class="check"><input data-field="construction" type="checkbox"${all ? " checked" : ""}><span>Construction geometry</span></label><small class="note">Dashed here, and left out of the exported figure.</small>`;
      }
      const ids = new Set<Id>([...this.selection]);
      for (const c of cs) curvePoints(c).forEach((p) => ids.add(p));
      const attached = this.sk.constraints.filter((c) => constraintRefs(c).some((r) => ids.has(r)));
      html += `<h3>Constraints on the selection</h3>`;
      html += attached.length ? this.constraintRows(attached) : `<p class="muted">None yet.</p>`;
      html += `<button type="button" class="danger" data-act="delete">Delete selection</button>`;
    } else {
      html += `<h2>Nothing selected</h2>`;
      if (this.sk.constraints.length) {
        html += `<h3>All constraints</h3>${this.constraintRows(this.sk.constraints)}`;
      } else {
        html += `<ol class="steps"><li><b>Draw.</b> Place joints with the Line tool; exact positions do not matter yet.</li>` +
          `<li><b>Constrain.</b> Select geometry, then press a constraint in the top bar.</li>` +
          `<li><b>Dimension.</b> Select a line and press D, then type its length.</li></ol>`;
      }
    }
    this.panel.innerHTML = html;
    if (focusField) this.panel.querySelector<HTMLElement>(`[data-field="${focusField}"]`)?.focus();
  }

  // ---- events ---------------------------------------------------------------

  private bindEvents(): void {
    const svg = this.svg;
    svg.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    svg.addEventListener("pointermove", (e) => this.onPointerMove(e));
    svg.addEventListener("pointerup", (e) => this.onPointerUp(e));
    svg.addEventListener("pointercancel", (e) => this.onPointerUp(e));
    svg.addEventListener("pointerleave", () => {
      if (this.drag) return;
      this.hover = null;
      this.snapMark = null;
      this.render();
    });
    svg.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    svg.addEventListener("dblclick", (e) => this.onDoubleClick(e));
    svg.addEventListener("contextmenu", (e) => e.preventDefault());
    new ResizeObserver(() => this.resize()).observe(this.stage);

    document.addEventListener("click", (e) => {
      const btn = (e.target as Element).closest<HTMLElement>("button");
      if (!btn) return;
      const ds = btn.dataset;
      if (ds.tool) this.setTool(ds.tool as Tool);
      else if (ds.cmd) this.run(ds.cmd as Command);
      else if (ds.select) { this.selection = new Set([ds.select]); this.touch(); }
      else if (ds.delete) { remove(this.sk, [ds.delete]); this.pruneSelection(); this.solve(); this.commit(); }
      else if (ds.mode) this.setDimMode(ds.mode as DistanceMode);
      else if (ds.act) this.action(ds.act);
    });

    // Explain a button on hover or focus, including what it needs selected.
    const explain = (e: Event) => {
      const btn = (e.target as Element).closest?.<HTMLElement>("[data-cmd]");
      if (!btn) return;
      const info = COMMANDS.find((c) => c.id === btn.dataset.cmd)!;
      this.hintOverride = `${info.label}: select ${info.need}, then press this${info.key ? ` or ${info.key}` : ""}.`;
      this.render();
    };
    const unexplain = () => { this.hintOverride = null; this.render(); };
    const bar = $("#constraint-actions");
    bar.addEventListener("mouseover", explain);
    bar.addEventListener("focusin", explain);
    bar.addEventListener("mouseleave", unexplain);
    bar.addEventListener("focusout", unexplain);

    this.panel.addEventListener("change", (e) => this.onPanelChange(e.target as HTMLInputElement));
    this.titleblock.addEventListener("change", (e) => {
      const input = e.target as HTMLInputElement;
      const cm = parseNumber(input.value);
      if (Number.isFinite(cm) && cm >= 1 && cm <= 100) {
        this.sk.figureWidthMm = cm * 10;
        this.commit();
      } else {
        this.toast("Figure width must be between 1 and 100 cm.");
        input.value = formatNumber(this.sk.figureWidthMm / 10);
      }
    });
    this.titleblock.addEventListener("keydown", (e) => {
      if (e.key === "Enter") (e.target as HTMLElement).blur();
    });

    this.dimEditor.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); this.commitDimEditor(); }
      else if (e.key === "Escape") { e.preventDefault(); this.closeDimEditor(); this.touch(); }
      e.stopPropagation();
    });
    this.dimEditor.addEventListener("blur", () => { if (this.editing) this.commitDimEditor(); });

    this.fileInput.addEventListener("change", () => {
      const f = this.fileInput.files?.[0];
      if (f) void this.open(f);
      this.fileInput.value = "";
    });

    window.addEventListener("keydown", (e) => this.onKeyDown(e));
    window.addEventListener("keyup", (e) => {
      this.altKey = e.altKey;
      if (e.code === "Space") { this.spaceKey = false; this.render(); }
    });
    window.addEventListener("blur", () => { this.spaceKey = false; this.altKey = false; });
  }

  private action(act: string): void {
    switch (act) {
      case "undo": return this.undo();
      case "redo": return this.redo();
      case "fit": return this.fit();
      case "new": return this.newSketch();
      case "open": return this.fileInput.click();
      case "save": return this.save();
      case "delete": return this.deleteSelection();
    }
  }

  private selectedDimension(): Dimension | null {
    if (this.selection.size !== 1) return null;
    const c = constraint(this.sk, [...this.selection][0]);
    return c && isDimension(c) ? c : null;
  }

  private setDimMode(mode: DistanceMode): void {
    const d = this.selectedDimension();
    if (!d || d.type !== "distance" || d.mode === mode) return;
    const before = clone(this.sk);
    const a = point(this.sk, d.a), b = point(this.sk, d.b);
    // Keep the geometry where it is: the value becomes what the new direction measures now.
    const value = mode === "aligned" ? dist([a.x, a.y], [b.x, b.y]) : Math.abs(mode === "horizontal" ? b.x - a.x : b.y - a.y);
    if (mode === "aligned" && value < 1e-9) return this.toast("Those two points are in the same place.");
    d.mode = mode;
    d.value = value;
    d.offset = this.outsideOffset(a, b, mode);
    const r = this.solver.solve(this.sk);
    if (!r.ok || r.conflicting.length || r.redundant.length > this.result.redundant.length) {
      this.sk = before;
      this.solve();
      this.toast("Measured that way, the dimension would over-constrain the sketch.");
      return this.touch();
    }
    this.result = r;
    this.commit();
  }

  private onPanelChange(input: HTMLInputElement): void {
    const field = input.dataset.field;
    if (!field) return;
    if (field === "construction") {
      const { lines, rounds } = this.picked();
      for (const c of [...lines, ...rounds]) {
        if (input.checked) c.construction = true;
        else delete c.construction;
      }
      return this.commit();
    }
    const d = this.selectedDimension();
    if (!d) return;
    if (field === "value") {
      if (!this.setDimValue(d.id, input.value)) input.value = this.shownValue(d);
      this.touch();
    } else if (field === "label") {
      const label = input.value.trim().replace(/^\$+|\$+$/g, "");
      if (label) d.label = label;
      else delete d.label;
      this.commit();
    } else if (field === "hidden") {
      if (input.checked) d.hidden = true;
      else delete d.hidden;
      this.commit();
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    this.altKey = e.altKey;
    const target = e.target as HTMLElement;
    // Checkboxes and buttons keep focus after a click but take no text.
    const textInput = target.tagName === "INPUT" && !["checkbox", "radio", "button", "file"].includes((target as HTMLInputElement).type);
    const typing = textInput || target.tagName === "TEXTAREA" || target.isContentEditable;
    const mod = e.ctrlKey || e.metaKey;

    if (mod && !typing) {
      const k = e.key.toLowerCase();
      if (k === "z") { e.preventDefault(); return e.shiftKey ? this.redo() : this.undo(); }
      if (k === "y") { e.preventDefault(); return this.redo(); }
      if (k === "s") { e.preventDefault(); return this.save(); }
      if (k === "o") { e.preventDefault(); return this.fileInput.click(); }
      if (k === "a") {
        e.preventDefault();
        this.setTool("select");
        this.selection = new Set(this.sk.entities.map((x) => x.id));
        return this.touch();
      }
      return;
    }
    if (typing || mod || e.altKey) {
      if (e.key === "Enter" && typing && this.panel.contains(target)) target.blur();
      return;
    }

    if (e.code === "Space") {
      // Space on a focused button should press it, not start a pan.
      if (target.tagName === "BUTTON") return;
      e.preventDefault();
      if (!this.spaceKey) { this.spaceKey = true; this.render(); }
      return;
    }
    if (e.key === "Escape") return this.cancel();
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); return this.deleteSelection(); }
    if (e.key === "0" || e.key === "Home") return this.fit();
    if (e.key === "Enter" && this.tool === "select") {
      const d = this.selectedDimension();
      if (d) { e.preventDefault(); this.openDimEditor(d.id); }
      return;
    }

    const key = e.key.toUpperCase();
    const tool = TOOLS.find((t) => t.key === key);
    const cmd = COMMANDS.find((c) => c.key === key);
    if (!tool && !cmd) return;
    // Without this the letter would be typed into the dimension box a command opens.
    e.preventDefault();
    if (tool) this.setTool(tool.id);
    else if (cmd) this.run(cmd.id);
  }
}

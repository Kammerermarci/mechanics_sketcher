// Draws the editor canvas as SVG markup: the primitive list plus the editing
// aids (point handles, constraint markers, previews) that never get exported.

import {
  type Sketch, type Id, type Constraint, type Curve, ORIGIN, entity, point, isDimension, arcRadius, isFixed,
} from "./model";
import { type V, add, sub, mul, norm, perp, mid, polar, wrap, projectOnSegment, TWO_PI } from "./geom";
import { type Prim, type StrokeStyle, type Outline, PAPER, STROKE_DASH, strokeWidth, arrowHeads, strokedEnds, strokedSweep, textBox } from "./prims";
import type { Overlaps } from "./regions";
import { texEngine } from "./tex";
import { ICONS } from "./icons";

export interface View {
  /** Model point at the centre of the canvas. */
  cx: number;
  cy: number;
  /** Screen pixels per model unit. */
  scale: number;
  w: number;
  h: number;
}

export const toScreen = (v: View, p: V): V =>
  [(p[0] - v.cx) * v.scale + v.w / 2, v.h / 2 - (p[1] - v.cy) * v.scale];
export const toModel = (v: View, s: V): V =>
  [(s[0] - v.w / 2) / v.scale + v.cx, (v.h / 2 - s[1]) / v.scale + v.cy];

/** A constraint marker on the canvas. x, y is its centre in screen pixels. */
export interface Glyph { id: Id; icon: string; x: number; y: number }

/** Shapes a drawing tool shows before the click that commits them. Model units. */
export interface Preview {
  lines: [V, V][];
  circles: { c: V; r: number }[];
  arcs: { c: V; r: number; a0: number; a1: number }[];
  points: V[];
  /** Drawn as something about to be removed, not added. */
  danger?: boolean;
  /** The path the pointer has taken while trimming, drawn as a thin trail. */
  trail?: V[];
}

export interface SnapMark {
  pos: V;
  kind: "point" | "curve" | "mid" | "h" | "v";
  /** For h and v: the point the alignment is measured from. */
  from?: V;
}

export interface Scene {
  sk: Sketch;
  view: View;
  /** Paper mm per model unit. */
  mm: number;
  prims: Prim[];
  glyphs: Glyph[];
  selection: Set<Id>;
  /** Entities a selected constraint refers to. */
  related: Set<Id>;
  hover: Id | null;
  conflicting: Set<Id>;
  redundant: Set<Id>;
  /** Points and curves that can still move; everything else is fully constrained. */
  freeIds: Set<Id>;
  /** Stretches where curves lie on top of each other, drawn in red. */
  overlaps: Overlaps;
  preview: Preview | null;
  snap: SnapMark | null;
  /** Selection rectangle in screen pixels. */
  box: { a: V; b: V } | null;
  /** Handles to drag on the selected symbol, in screen pixels. */
  grips: V[];
  /** Print preview: only what is exported is drawn, with no grid, handles or markers. */
  plain: boolean;
}

export const GLYPH_SIZE = 18;
const n2 = (v: number) => v.toFixed(2);

// ---- constraint markers -----------------------------------------------------

const GLYPH_ICON: Record<string, string> = {
  coincident: "coincident", pointOn: "pointOn", midpoint: "midpoint", horizontal: "horizontal",
  vertical: "vertical", parallel: "parallel", perpendicular: "perpendicular", equal: "equal",
  tangent: "tangent", fixed: "fixed", mirror: "mirror", shift: "shift", turn: "turn",
};

/** Keeps a marker on the upper side of whatever it annotates. */
function upward(n: V): V {
  return n[1] > 1e-9 || (Math.abs(n[1]) <= 1e-9 && n[0] < 0) ? mul(n, -1) : n;
}

/** Lays out a marker for every constraint that `show` lets through. */
export function layoutGlyphs(sk: Sketch, view: View, show: (c: Constraint) => boolean = () => true): Glyph[] {
  const out: Glyph[] = [];
  const used = new Map<string, number>();
  const S = (id: Id): V => { const p = point(sk, id); return toScreen(view, [p.x, p.y]); };

  const place = (c: Constraint, base: V, away: V, along: V) => {
    const key = `${Math.round(base[0] / 6)}:${Math.round(base[1] / 6)}`;
    const k = used.get(key) ?? 0;
    used.set(key, k + 1);
    const pos = add(add(base, mul(away, 15)), mul(along, k * (GLYPH_SIZE + 2)));
    out.push({ id: c.id, icon: GLYPH_ICON[c.type], x: pos[0], y: pos[1] });
  };
  const atPoint = (c: Constraint, id: Id) => {
    // Below and to the right of the point, unless a support is drawn there:
    // then on the side facing away from the support's ground.
    const support = sk.symbols.find((s) => s.type === "support" && s.at === id);
    if (support?.type !== "support") return place(c, S(id), [0.75, 0.75], [1, 0]);
    const k = Math.cos(support.angle), n = Math.sin(support.angle);
    const up: V = [-0.75 * k - 0.75 * n, -0.75 * n + 0.75 * k]; // (-0.75, 0.75) turned with the support
    place(c, S(id), [up[0], -up[1]], [-1, 0]);
  };
  const atSpan = (c: Constraint, a: V, b: V) => {
    const u = norm(sub(b, a));
    place(c, mid(a, b), upward(perp(u)), u);
  };
  const atCurve = (c: Constraint, id: Id) => {
    const e = entity(sk, id) as Curve | undefined;
    if (!e) return;
    if (e.type === "line") return atSpan(c, S(e.p1), S(e.p2));
    const ctr = point(sk, e.c);
    let ang = Math.PI / 4;
    let r = 0;
    if (e.type === "circle") r = e.r;
    else {
      r = arcRadius(sk, e);
      const s = point(sk, e.p1), t = point(sk, e.p2);
      const a0 = Math.atan2(s.y - ctr.y, s.x - ctr.x);
      let a1 = Math.atan2(t.y - ctr.y, t.x - ctr.x);
      if (a1 <= a0) a1 += TWO_PI;
      ang = (a0 + a1) / 2;
    }
    const rim = toScreen(view, polar([ctr.x, ctr.y], r, ang));
    place(c, rim, [Math.cos(ang), -Math.sin(ang)], [1, 0]);
  };

  for (const c of sk.constraints) {
    if (isDimension(c) || !show(c)) continue;
    switch (c.type) {
      case "fixed": atPoint(c, c.p); break;
      case "coincident": atPoint(c, c.a); break;
      case "pointOn": atPoint(c, c.p); break;
      case "midpoint": atPoint(c, c.p); break;
      case "horizontal":
      case "vertical":
        atSpan(c, S(c.a), S(c.b));
        break;
      case "parallel":
      case "perpendicular":
        atCurve(c, c.l1);
        atCurve(c, c.l2);
        break;
      case "equal":
        atCurve(c, c.a);
        atCurve(c, c.b);
        break;
      // One marker for a whole mirror image or pattern: on the mirror line, between the
      // original and its first copy, or at the point the copies go around.
      case "mirror": atCurve(c, c.l); break;
      case "shift": {
        // Between a point of the original and its nearest copy.
        const first = [...c.pairs.map(([from, to, steps]) => ({ from, to, steps })), ...c.half]
          .sort((a, b) => (a.steps ?? 1) - (b.steps ?? 1))[0];
        if (first) atSpan(c, S(first.from), S(first.to));
        break;
      }
      case "turn": atPoint(c, c.c); break;
      case "tangent": {
        const l = entity(sk, c.l), round = entity(sk, c.c);
        if (l?.type !== "line" || !round || round.type === "point" || round.type === "line") break;
        const centre = S(round.c);
        const touch = projectOnSegment(centre, S(l.p1), S(l.p2)).point;
        place(c, touch, norm(sub(touch, centre)), [1, 0]);
        break;
      }
    }
  }
  return out;
}

// ---- drawing ----------------------------------------------------------------

function gridStep(scale: number): number {
  const target = 22 / scale; // model units for roughly 22 px
  const pow = Math.pow(10, Math.floor(Math.log10(target)));
  for (const m of [1, 2, 5, 10]) if (m * pow >= target) return m * pow;
  return 10 * pow;
}

function background(view: View, showOrigin: boolean, plain: boolean): string {
  if (plain) return `<rect class="sheet" width="${view.w}" height="${view.h}"/>`;
  const step = gridStep(view.scale) * view.scale;
  const o = toScreen(view, [0, 0]);
  const ox = ((o[0] % step) + step) % step - step / 2;
  const oy = ((o[1] % step) + step) % step - step / 2;
  const L = 34;
  let out =
    `<defs><pattern id="grid" width="${n2(step)}" height="${n2(step)}" patternUnits="userSpaceOnUse" x="${n2(ox)}" y="${n2(oy)}">` +
    `<circle class="grid-dot" cx="${n2(step / 2)}" cy="${n2(step / 2)}" r="0.9"/></pattern></defs>` +
    `<rect width="${view.w}" height="${view.h}" fill="url(#grid)"/>`;
  if (showOrigin) {
    out +=
      `<g class="origin"><path d="M${n2(o[0])} ${n2(o[1] - L)}V${n2(o[1])}H${n2(o[0] + L)}"/>` +
      `<path class="tip" d="M${n2(o[0] + L)} ${n2(o[1])}l-6-3v6zM${n2(o[0])} ${n2(o[1] - L)}l-3 6h6z"/>` +
      `<text x="${n2(o[0] + L + 5)}" y="${n2(o[1] + 4)}">x</text><text x="${n2(o[0] - 3)}" y="${n2(o[1] - L - 6)}">y</text></g>`;
  }
  return out;
}

/** Marks the dimension a tool is about to place; never part of the sketch. */
export const PREVIEW_REF = "__preview";

function primClass(s: Scene, p: Prim): string {
  // Typeset text is a nested <svg>; it gets its own base class so the stroke
  // rules for drawn shapes do not leak into it.
  const cls = p.k === "text" ? ["tex", p.layer] : p.k === "region" ? ["region"] : ["prim", p.layer, p.stroke];
  if ((p.k === "circle" || p.k === "poly") && p.fill) cls.push(p.fill === "ink" ? "solid" : "filled");
  if (p.color) cls.push("tinted");
  if (p.ghost) cls.push("ghost");
  const id = p.ref;
  if (p.layer === "geom") cls.push(id && s.freeIds.has(id) ? "free" : "defined");
  if (id === PREVIEW_REF) cls.push("pv");
  else if (id) {
    if (s.conflicting.has(id)) cls.push("bad");
    else if (s.redundant.has(id)) cls.push("extra");
    if (s.related.has(id)) cls.push("rel");
    if (s.hover === id) cls.push("hov");
    if (s.selection.has(id)) cls.push("sel");
  }
  return cls.join(" ");
}

function strokePx(p: { stroke: StrokeStyle; width?: number }, pxPerMm: number): number {
  // Never so thin that it is hard to see or to hit; a member at its standard thickness a little bolder.
  return Math.max(p.stroke === "member" && p.width === undefined ? 1.5 : 0.9, strokeWidth(p) * pxPerMm);
}

function arcPath(view: View, c: V, r: number, a0: number, a1: number): string {
  const s = toScreen(view, polar(c, r, a0)), e = toScreen(view, polar(c, r, a1));
  const rp = r * view.scale;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  // Counter-clockwise in the model is sweep-flag 0 once y is flipped for the screen.
  return `M${n2(s[0])} ${n2(s[1])}A${n2(rp)} ${n2(rp)} 0 ${large} 0 ${n2(e[0])} ${n2(e[1])}`;
}

/** SVG path data for the outlines of a region; M maps paper mm to the target, pxPerMm scales radii. */
export function outlinePath(outlines: Outline[], M: (p: V) => V, pxPerMm: number): string {
  let d = "";
  for (const o of outlines) {
    if (o.kind === "circle") {
      const c = M(o.c), r = o.r * pxPerMm;
      d += `M${n2(c[0] - r)} ${n2(c[1])}a${n2(r)} ${n2(r)} 0 1 0 ${n2(2 * r)} 0a${n2(r)} ${n2(r)} 0 1 0 ${n2(-2 * r)} 0Z`;
      continue;
    }
    const start = M(o.start);
    d += `M${n2(start[0])} ${n2(start[1])}`;
    for (const seg of o.segs) {
      const to = M(seg.to);
      if (seg.k === "L") d += `L${n2(to[0])} ${n2(to[1])}`;
      else {
        const sweep = seg.ccw ? wrap(seg.a1 - seg.a0) : wrap(seg.a0 - seg.a1);
        const r = n2(seg.r * pxPerMm);
        // Counter-clockwise on paper is sweep-flag 0 on the y-down screen.
        d += `A${r} ${r} 0 ${sweep > Math.PI ? 1 : 0} ${seg.ccw ? 0 : 1} ${n2(to[0])} ${n2(to[1])}`;
      }
    }
    d += "Z";
  }
  return d;
}

function drawPrims(s: Scene): string {
  const { view, mm } = s;
  const pxPerMm = view.scale / mm;
  const M = (p: V): V => toScreen(view, [p[0] / mm, p[1] / mm]);
  const engine = texEngine();
  let out = "";
  for (const p of s.prims) {
    const cls = primClass(s, p);
    if (p.k === "region") {
      out += `<path class="${cls}" d="${outlinePath(p.outlines, M, pxPerMm)}" fill="${p.color}" fill-rule="evenodd"/>`;
      continue;
    }
    if (p.k === "text") {
      const b = textBox(p);
      const topLeft = M([b.x0, b.y1]);
      const glyphs = engine.svg(p.tex, topLeft[0], topLeft[1], PAPER.em * pxPerMm, cls);
      if (p.rot && glyphs) {
        // Counter-clockwise on paper is a negative angle on the y-down screen.
        const at = M(p.at);
        out += `<g transform="rotate(${n2((-p.rot * 180) / Math.PI)} ${n2(at[0])} ${n2(at[1])})">${glyphs}</g>`;
      } else out += glyphs;
      continue;
    }
    const dash = STROKE_DASH[p.stroke];
    // The colour goes in as a variable, so the highlight rules for selection and hover still win.
    const sw = `stroke-width="${n2(strokePx(p, pxPerMm))}"` +
      (dash ? ` stroke-dasharray="${dash.map((d) => n2(d * pxPerMm)).join(" ")}"` : "") +
      (p.color ? ` style="--tint:${p.color}"` : "");
    if (p.k === "line") {
      const [a, b] = strokedEnds(p).map(M);
      out += `<line class="${cls}" x1="${n2(a[0])}" y1="${n2(a[1])}" x2="${n2(b[0])}" y2="${n2(b[1])}" ${sw}/>`;
    } else if (p.k === "circle") {
      const c = M(p.c);
      out += `<circle class="${cls}" cx="${n2(c[0])}" cy="${n2(c[1])}" r="${n2(p.r * pxPerMm)}" ${sw}/>`;
    } else if (p.k === "poly") {
      out += `<polygon class="${cls}" points="${p.pts.map((q) => M(q).map(n2).join(",")).join(" ")}" ${sw}/>`;
    } else {
      const [a0, a1] = strokedSweep(p);
      out += `<path class="${cls}" d="${arcPath(view, [p.c[0] / mm, p.c[1] / mm], p.r / mm, a0, a1)}" ${sw}/>`;
    }
    if (p.k === "line" || p.k === "arc") {
      for (const head of arrowHeads(p)) {
        out += `<polygon class="${cls} head" points="${head.map((q) => M(q).map(n2).join(",")).join(" ")}"/>`;
      }
    }
  }
  return out;
}

function drawHandles(s: Scene): string {
  let out = "";
  // A datum point shows its coloured dot: its handle is a ring around the dot, not a disc over it.
  const datums = new Set(s.sk.symbols.filter((x) => x.type === "datum").map((x) => (x as { at: Id }).at));
  const dotPx = (PAPER.datumRadius * s.view.scale) / s.mm;
  for (const e of s.sk.entities) {
    if (e.type !== "point") continue;
    const p = toScreen(s.view, [e.x, e.y]);
    const cls = ["pt"];
    const lit = s.selection.has(e.id) || s.hover === e.id;
    if (s.related.has(e.id)) cls.push("rel");
    if (s.hover === e.id) cls.push("hov");
    if (s.selection.has(e.id)) cls.push("sel");
    if (e.id === ORIGIN) {
      // The origin: a ring with a cross through it, as on a drawing's datum.
      const r = lit ? 6.5 : 5.5;
      out += `<g class="${cls.join(" ")} origin-pt"><circle cx="${n2(p[0])}" cy="${n2(p[1])}" r="${r}"/>` +
        `<path d="M${n2(p[0] - r - 3)} ${n2(p[1])}h${2 * r + 6}M${n2(p[0])} ${n2(p[1] - r - 3)}v${2 * r + 6}"/></g>`;
      continue;
    }
    if (isFixed(s.sk, e.id)) cls.push("fixed");
    if (!s.freeIds.has(e.id)) cls.push("defined");
    if (datums.has(e.id)) {
      cls.push("ring");
      out += `<circle class="${cls.join(" ")}" cx="${n2(p[0])}" cy="${n2(p[1])}" r="${n2(Math.max(4.6, dotPx + 2.2) + (lit ? 1.2 : 0))}"/>`;
      continue;
    }
    out += `<circle class="${cls.join(" ")}" cx="${n2(p[0])}" cy="${n2(p[1])}" r="${lit ? 4.6 : 3.4}"/>`;
  }
  return out;
}

function drawGrips(s: Scene): string {
  return s.grips.map((g) => `<rect class="grip" x="${n2(g[0] - 4)}" y="${n2(g[1] - 4)}" width="8" height="8" rx="1.5"/>`).join("");
}

/** Red over the stretches where two curves share the same space. */
function drawOverlaps(s: Scene): string {
  let out = "";
  for (const [a, b] of s.overlaps.segments) {
    const p = toScreen(s.view, a), q = toScreen(s.view, b);
    out += `<line class="overlap" x1="${n2(p[0])}" y1="${n2(p[1])}" x2="${n2(q[0])}" y2="${n2(q[1])}"/>`;
  }
  for (const r of s.overlaps.rounds) {
    if (r.a1 - r.a0 >= TWO_PI - 1e-9) {
      const c = toScreen(s.view, r.c);
      out += `<circle class="overlap" cx="${n2(c[0])}" cy="${n2(c[1])}" r="${n2(r.r * s.view.scale)}"/>`;
    } else {
      out += `<path class="overlap" d="${arcPath(s.view, r.c, r.r, r.a0, r.a1)}"/>`;
    }
  }
  return out;
}

function drawGlyphs(s: Scene): string {
  let out = "";
  const h = GLYPH_SIZE / 2;
  for (const g of s.glyphs) {
    const cls = ["glyph"];
    if (s.conflicting.has(g.id)) cls.push("bad");
    else if (s.redundant.has(g.id)) cls.push("extra");
    if (s.hover === g.id) cls.push("hov");
    if (s.selection.has(g.id)) cls.push("sel");
    out += `<g class="${cls.join(" ")}" transform="translate(${n2(g.x - h)} ${n2(g.y - h)})">` +
      `<rect width="${GLYPH_SIZE}" height="${GLYPH_SIZE}" rx="4"/>` +
      `<g transform="translate(2 2) scale(0.7)" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[g.icon]}</g></g>`;
  }
  return out;
}

function drawPreview(s: Scene): string {
  const pv = s.preview;
  if (!pv) return "";
  const cls = pv.danger ? "preview danger" : "preview";
  let out = "";
  for (const [a, b] of pv.lines) {
    const p = toScreen(s.view, a), q = toScreen(s.view, b);
    out += `<line class="${cls}" x1="${n2(p[0])}" y1="${n2(p[1])}" x2="${n2(q[0])}" y2="${n2(q[1])}"/>`;
  }
  for (const c of pv.circles) {
    const p = toScreen(s.view, c.c);
    out += `<circle class="${cls}" cx="${n2(p[0])}" cy="${n2(p[1])}" r="${n2(c.r * s.view.scale)}"/>`;
  }
  for (const a of pv.arcs) out += `<path class="${cls}" d="${arcPath(s.view, a.c, a.r, a.a0, a.a1)}"/>`;
  if (pv.trail && pv.trail.length > 1) {
    out += `<polyline class="trail" points="${pv.trail.map((q) => toScreen(s.view, q).map(n2).join(",")).join(" ")}"/>`;
  }
  for (const q of pv.points) {
    const p = toScreen(s.view, q);
    out += `<circle class="pt preview-pt" cx="${n2(p[0])}" cy="${n2(p[1])}" r="3.4"/>`;
  }
  return out;
}

function drawSnap(s: Scene): string {
  const m = s.snap;
  if (!m) return "";
  const p = toScreen(s.view, m.pos);
  const [x, y] = [n2(p[0]), n2(p[1])];
  if (m.kind === "point") return `<circle class="snap" cx="${x}" cy="${y}" r="8"/>`;
  if (m.kind === "curve") return `<path class="snap" d="M${n2(p[0] - 5)} ${n2(p[1] - 5)}l10 10m0-10l-10 10"/>`;
  if (m.kind === "mid") return `<path class="snap" d="M${x} ${n2(p[1] - 7)}l6.5 11h-13z"/>`;
  let out = "";
  if (m.from) {
    const f = toScreen(s.view, m.from);
    out += `<line class="snap guide" x1="${n2(f[0])}" y1="${n2(f[1])}" x2="${x}" y2="${y}"/>`;
  }
  const icon = m.kind === "h" ? "horizontal" : "vertical";
  out += `<g class="glyph hint" transform="translate(${n2(p[0] + 12)} ${n2(p[1] - 26)})"><rect width="${GLYPH_SIZE}" height="${GLYPH_SIZE}" rx="4"/>` +
    `<g transform="translate(2 2) scale(0.7)" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">${ICONS[icon]}</g></g>`;
  return out;
}

export function renderScene(s: Scene): string {
  let box = "";
  if (s.box) {
    const x = Math.min(s.box.a[0], s.box.b[0]), y = Math.min(s.box.a[1], s.box.b[1]);
    box = `<rect class="marquee" x="${n2(x)}" y="${n2(y)}" width="${n2(Math.abs(s.box.a[0] - s.box.b[0]))}" height="${n2(Math.abs(s.box.a[1] - s.box.b[1]))}"/>`;
  }
  if (s.plain) return background(s.view, false, true) + drawPrims(s) + drawGrips(s) + drawPreview(s) + drawSnap(s) + box;
  return background(s.view, s.sk.showOrigin, false) + drawPrims(s) + drawOverlaps(s) + drawHandles(s) + drawGlyphs(s) + drawGrips(s) + drawPreview(s) + drawSnap(s) + box;
}

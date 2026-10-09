// The primitive list: the sketch broken down into lines, circles, arcs and
// text, positioned in paper millimetres (y-up). The screen and every exporter
// draw from this one list, so they cannot drift apart.

import {
  type Sketch, type Id, type Dimension, type DistanceDim, type AngleDim, type RadiusDim,
  type Arc, type Line, type Sym, type Support, type Frame,
  ORIGIN, entity, point, arcRadius, isDimension, curves, curvePoints,
} from "./model";
import {
  type V, type Box, add, sub, mul, dot, norm, perp, mid, polar, dist, len, angleOf, wrap, inSweep,
  distToSegment, intersectLines, emptyBox, grow, boxIsEmpty, TWO_PI,
} from "./geom";
import { texEngine } from "./tex";

/** Sizes on paper, in mm. 1 pt = 0.3515 mm. */
export const PAPER = {
  member: 0.28,        // 0.8 pt
  construction: 0.14,  // 0.4 pt
  dim: 0.105,          // 0.3 pt
  arrowLen: 1.8,
  arrowWidth: 1.1,
  em: 3.515,           // 10 pt text
  textSep: 0.7,        // gap between text and what it labels
  extGap: 1.0,         // extension line starts this far from the geometry
  extOver: 1.5,        // and runs this far past the dimension line
  dimOffset: 8,        // default distance of a dimension line from the geometry
  // Supports
  symbol: 0.14,        // 0.4 pt outline
  hatch: 0.105,        // 0.3 pt ground hatching
  supportHalfWidth: 2.4,
  pinHeight: 4.0,
  rollerHeight: 3.4,
  wheelRadius: 0.6,
  hingeRadius: 0.55,
  groundHalfWidth: 4.0,
  hatchStep: 1.15,
  hatchDepth: 1.25,
};

export type Anchor = "c" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export type StrokeStyle = "member" | "construction" | "dim" | "symbol" | "hatch";
/** Line width of each stroke style, in mm. */
export const STROKE_MM: Record<StrokeStyle, number> = {
  member: PAPER.member, construction: PAPER.construction, dim: PAPER.dim,
  symbol: PAPER.symbol, hatch: PAPER.hatch,
};
/** "paper" fills a shape with the background, hiding what lies under it. */
export type Fill = "paper";

interface Base {
  /** The entity, symbol or dimension this primitive belongs to. */
  ref?: Id;
  layer: "geom" | "sym" | "dim";
  /** Shown faded in the editor and left out of exports (hidden dimensions). */
  ghost?: boolean;
}
export interface LinePrim extends Base { k: "line"; a: V; b: V; stroke: StrokeStyle; arrowA?: boolean; arrowB?: boolean }
export interface CirclePrim extends Base { k: "circle"; c: V; r: number; stroke: StrokeStyle; fill?: Fill }
/** A closed outline. */
export interface PolyPrim extends Base { k: "poly"; pts: V[]; stroke: StrokeStyle; fill?: Fill }
/** Counter-clockwise from a0 to a1, with a1 > a0. */
export interface ArcPrim extends Base { k: "arc"; c: V; r: number; a0: number; a1: number; stroke: StrokeStyle; arrowA?: boolean; arrowB?: boolean }
/** `anchor` names the side of the text box that sits at `at`, as in TikZ. */
export interface TextPrim extends Base { k: "text"; at: V; tex: string; anchor: Anchor }
export type Prim = LinePrim | CirclePrim | PolyPrim | ArcPrim | TextPrim;

// ---- paper scale ----------------------------------------------------------

function arcAngles(sk: Sketch, a: Arc): { a0: number; a1: number } {
  const c = point(sk, a.c), s = point(sk, a.p1), e = point(sk, a.p2);
  const a0 = Math.atan2(s.y - c.y, s.x - c.x);
  let a1 = Math.atan2(e.y - c.y, e.x - c.x);
  if (a1 <= a0) a1 += TWO_PI;
  return { a0, a1 };
}

/** Bounding box of the geometry in model units. Dimensions are not included. */
export function geometryBox(sk: Sketch): Box {
  const b = emptyBox();
  // The origin counts only when something is drawn from it.
  const originUsed = curves(sk).some((c) => curvePoints(c).includes(ORIGIN));
  for (const e of sk.entities) {
    if (e.type === "point") {
      if (e.id !== ORIGIN || originUsed) grow(b, [e.x, e.y]);
    }
    else if (e.type === "circle") {
      const c = point(sk, e.c);
      grow(b, [c.x, c.y], e.r);
    } else if (e.type === "arc") {
      const c = point(sk, e.c);
      const r = arcRadius(sk, e);
      const { a0, a1 } = arcAngles(sk, e);
      for (let q = 0; q < 4; q++) {
        const ang = (q * Math.PI) / 2;
        if (inSweep(ang, a0, a1)) grow(b, polar([c.x, c.y], r, ang));
      }
    }
  }
  return b;
}

const DEFAULT_MM_PER_UNIT = 10;

/**
 * Paper millimetres per model unit, chosen so the geometry is `figureWidthMm`
 * wide. Tall, narrow sketches are limited by height instead, so a single
 * vertical member does not blow the scale up.
 */
export function mmPerUnit(sk: Sketch): number {
  const b = geometryBox(sk);
  if (boxIsEmpty(b)) return DEFAULT_MM_PER_UNIT;
  const extent = Math.max(b.x1 - b.x0, (b.y1 - b.y0) * 0.3);
  if (extent < 1e-9) return DEFAULT_MM_PER_UNIT;
  return sk.figureWidthMm / extent;
}

// ---- dimension text ---------------------------------------------------------

export function formatNumber(v: number): string {
  return String(Number(v.toFixed(3)));
}

/** The TeX shown on a dimension: its label, or else its value. */
export function dimTex(d: Dimension): string {
  const label = d.label?.trim();
  if (label) return label;
  if (d.type === "angle") return `${formatNumber((d.value * 180) / Math.PI)}^\\circ`;
  if (d.type === "radius") return `R${formatNumber(d.value)}`;
  return formatNumber(d.value);
}

/** The anchor that puts text on the `out` side of a point. */
export function anchorFor(out: V): Anchor {
  const names: Anchor[] = ["e", "ne", "n", "nw", "w", "sw", "s", "se"];
  const back = Math.atan2(-out[1], -out[0]);
  return names[Math.round(wrap(back) / (Math.PI / 4)) % 8];
}

// ---- dimension layout ---------------------------------------------------------

const P = (sk: Sketch, id: Id, mm: number): V => {
  const p = point(sk, id);
  return [p.x * mm, p.y * mm];
};

/** Where a distance dimension's line runs, in paper mm. */
export function distanceFrame(sk: Sketch, d: DistanceDim, mm: number) {
  const A = P(sk, d.a, mm), B = P(sk, d.b, mm);
  const side = d.offset < 0 ? -1 : 1;
  if (d.mode === "horizontal") {
    const y = A[1] + d.offset;
    return { A, B, A2: [A[0], y] as V, B2: [B[0], y] as V, n: [0, 1] as V, out: [0, side] as V };
  }
  if (d.mode === "vertical") {
    const x = A[0] + d.offset;
    return { A, B, A2: [x, A[1]] as V, B2: [x, B[1]] as V, n: [1, 0] as V, out: [side, 0] as V };
  }
  const n = perp(norm(sub(B, A)));
  return { A, B, A2: add(A, mul(n, d.offset)), B2: add(B, mul(n, d.offset)), n, out: mul(n, side) };
}

function distancePrims(sk: Sketch, d: DistanceDim, mm: number): Prim[] {
  const base = { ref: d.id, layer: "dim" as const };
  const f = distanceFrame(sk, d, mm);
  const out: Prim[] = [];
  for (const [from, to] of [[f.A, f.A2], [f.B, f.B2]] as [V, V][]) {
    const l = dist(from, to);
    if (l <= PAPER.extGap) continue;
    const dir = norm(sub(to, from));
    out.push({ ...base, k: "line", stroke: "dim", a: add(from, mul(dir, PAPER.extGap)), b: add(to, mul(dir, PAPER.extOver)) });
  }
  out.push({ ...base, k: "line", stroke: "dim", a: f.A2, b: f.B2, arrowA: true, arrowB: true });
  out.push({ ...base, k: "text", at: mid(f.A2, f.B2), tex: dimTex(d), anchor: anchorFor(f.out) });
  return out;
}

/** The vertex and directions an angle dimension is measured between, in paper mm. */
export function angleFrame(sk: Sketch, d: AngleDim, mm: number) {
  const l1 = entity(sk, d.l1) as Line, l2 = entity(sk, d.l2) as Line;
  const a1 = P(sk, d.rev1 ? l1.p2 : l1.p1, mm), b1 = P(sk, d.rev1 ? l1.p1 : l1.p2, mm);
  const a2 = P(sk, d.rev2 ? l2.p2 : l2.p1, mm), b2 = P(sk, d.rev2 ? l2.p1 : l2.p2, mm);
  const d1 = norm(sub(b1, a1)), d2 = norm(sub(b2, a2));
  const vertex = intersectLines(a1, d1, a2, d2);
  if (!vertex) return null;
  const start = angleOf(d1);
  return { vertex, start, end: start + d.value, seg1: [a1, b1] as [V, V], seg2: [a2, b2] as [V, V] };
}

function anglePrims(sk: Sketch, d: AngleDim, mm: number): Prim[] {
  const base = { ref: d.id, layer: "dim" as const };
  const f = angleFrame(sk, d, mm);
  if (!f) return [];
  const out: Prim[] = [];
  // Extension lines where the arc ends beyond a member.
  for (const [seg, ang] of [[f.seg1, f.start], [f.seg2, f.end]] as [[V, V], number][]) {
    const tip = polar(f.vertex, d.radius, ang);
    if (distToSegment(tip, seg[0], seg[1]) < 0.3) continue;
    const near = dist(tip, seg[0]) < dist(tip, seg[1]) ? seg[0] : seg[1];
    const dir = norm(sub(tip, near));
    out.push({ ...base, k: "line", stroke: "dim", a: add(near, mul(dir, PAPER.extGap)), b: add(tip, mul(dir, PAPER.extOver)) });
  }
  out.push({ ...base, k: "arc", stroke: "dim", c: f.vertex, r: d.radius, a0: f.start, a1: f.end, arrowA: true, arrowB: true });
  const midAng = (f.start + f.end) / 2;
  out.push({ ...base, k: "text", at: polar(f.vertex, d.radius, midAng), tex: dimTex(d), anchor: anchorFor([Math.cos(midAng), Math.sin(midAng)]) });
  return out;
}

/** Centre and radius of a circle or arc, in paper mm. */
export function roundFrame(sk: Sketch, id: Id, mm: number): { c: V; r: number } | null {
  const e = entity(sk, id);
  if (e?.type === "circle") return { c: P(sk, e.c, mm), r: e.r * mm };
  if (e?.type === "arc") return { c: P(sk, e.c, mm), r: arcRadius(sk, e) * mm };
  return null;
}

function radiusPrims(sk: Sketch, d: RadiusDim, mm: number): Prim[] {
  const base = { ref: d.id, layer: "dim" as const };
  const f = roundFrame(sk, d.target, mm);
  if (!f) return [];
  const dir: V = [Math.cos(d.angle), Math.sin(d.angle)];
  const tip = add(f.c, mul(dir, f.r));
  let side = perp(dir);
  if (side[1] < -1e-9 || (Math.abs(side[1]) <= 1e-9 && side[0] > 0)) side = mul(side, -1);
  return [
    { ...base, k: "line", stroke: "dim", a: f.c, b: tip, arrowB: true },
    { ...base, k: "text", at: mid(f.c, tip), tex: dimTex(d), anchor: anchorFor(side) },
  ];
}

export function dimensionPrims(sk: Sketch, d: Dimension, mm: number): Prim[] {
  const prims = d.type === "distance" ? distancePrims(sk, d, mm)
    : d.type === "angle" ? anglePrims(sk, d, mm)
    : radiusPrims(sk, d, mm);
  if (d.hidden) prims.forEach((p) => { p.ghost = true; });
  return prims;
}

// ---- symbols ----------------------------------------------------------------

/** Where a symbol sits, in model units. */
export function symbolPosition(sk: Sketch, s: Sym): V {
  if (s.at !== undefined) {
    const p = point(sk, s.at);
    return [p.x, p.y];
  }
  return s.type === "frame" ? [s.x, s.y] : [0, 0];
}

/** Maps a symbol's own coordinates (mm, joint at the origin) onto the paper. */
function placer(at: V, angle: number): (p: V) => V {
  const c = Math.cos(angle), k = Math.sin(angle);
  return ([x, y]) => [at[0] + x * c - y * k, at[1] + x * k + y * c];
}

function supportPrims(sk: Sketch, s: Support, mm: number): Prim[] {
  const base = { ref: s.id, layer: "sym" as const };
  const T = placer(mul(symbolPosition(sk, s), mm), s.angle);
  const out: Prim[] = [];
  const line = (a: V, b: V, stroke: StrokeStyle) => out.push({ ...base, k: "line", a: T(a), b: T(b), stroke });

  // Drawn with the ground below the joint; `ground` is how far below.
  let ground = 0;
  if (s.kind !== "fixed") {
    const h = s.kind === "pin" ? PAPER.pinHeight : PAPER.rollerHeight;
    const w = PAPER.supportHalfWidth;
    out.push({ ...base, k: "poly", pts: [T([0, 0]), T([-w, -h]), T([w, -h])], stroke: "symbol", fill: "paper" });
    ground = h;
    if (s.kind === "roller") {
      const r = PAPER.wheelRadius;
      for (const x of [-w * 0.55, w * 0.55]) {
        out.push({ ...base, k: "circle", c: T([x, -h - r]), r, stroke: "symbol", fill: "paper" });
      }
      ground = h + 2 * r;
    }
  }
  const g = PAPER.groundHalfWidth;
  const n = Math.floor((2 * g) / PAPER.hatchStep);
  for (let i = 1; i <= n; i++) {
    const x = -g + i * PAPER.hatchStep;
    line([x, -ground], [x - PAPER.hatchDepth * 0.85, -ground - PAPER.hatchDepth], "hatch");
  }
  line([-g, -ground], [g, -ground], s.kind === "fixed" ? "member" : "symbol");
  if (s.kind !== "fixed") {
    out.push({ ...base, k: "circle", c: T([0, 0]), r: PAPER.hingeRadius, stroke: "symbol", fill: "paper" });
  }
  return out;
}

function framePrims(sk: Sketch, f: Frame, mm: number): Prim[] {
  const base = { ref: f.id, layer: "sym" as const };
  const o = mul(symbolPosition(sk, f), mm);
  const out: Prim[] = [];
  const axes: [number, string][] = [[f.angle, f.xLabel], [f.angle + Math.PI / 2, f.yLabel]];
  for (const [ang, label] of axes) {
    const dir: V = [Math.cos(ang), Math.sin(ang)];
    const tip = add(o, mul(dir, f.size));
    out.push({ ...base, k: "line", a: o, b: tip, stroke: "symbol", arrowB: true });
    if (label.trim()) out.push({ ...base, k: "text", at: tip, tex: label.trim(), anchor: anchorFor(dir) });
  }
  return out;
}

export function symbolPrims(sk: Sketch, s: Sym, mm: number): Prim[] {
  return s.type === "support" ? supportPrims(sk, s, mm) : framePrims(sk, s, mm);
}

// ---- the list -------------------------------------------------------------

export interface BuildOptions {
  /** Construction geometry and hidden dimensions: on for the editor, off for exports. */
  editor: boolean;
}

export function buildPrims(sk: Sketch, mm: number, opts: BuildOptions): Prim[] {
  const out: Prim[] = [];
  for (const e of sk.entities) {
    if (e.type === "point") continue;
    if (e.construction && !opts.editor) continue;
    const base = { ref: e.id, layer: "geom" as const, stroke: (e.construction ? "construction" : "member") as StrokeStyle };
    if (e.type === "line") {
      out.push({ ...base, k: "line", a: P(sk, e.p1, mm), b: P(sk, e.p2, mm) });
    } else if (e.type === "circle") {
      out.push({ ...base, k: "circle", c: P(sk, e.c, mm), r: e.r * mm });
    } else {
      const { a0, a1 } = arcAngles(sk, e);
      out.push({ ...base, k: "arc", c: P(sk, e.c, mm), r: arcRadius(sk, e) * mm, a0, a1 });
    }
  }
  for (const sym of sk.symbols) out.push(...symbolPrims(sk, sym, mm));
  for (const c of sk.constraints) {
    if (!isDimension(c)) continue;
    if (c.hidden && !opts.editor) continue;
    out.push(...dimensionPrims(sk, c, mm));
  }
  return out;
}

// ---- shared drawing helpers -------------------------------------------------

/** Outline of an arrowhead whose tip is at `tip`, pointing along `dir`. */
export function arrowHead(tip: V, dir: V): V[] {
  const u = norm(dir), n = perp(u);
  const back = sub(tip, mul(u, PAPER.arrowLen));
  return [
    tip,
    add(back, mul(n, PAPER.arrowWidth / 2)),
    sub(tip, mul(u, PAPER.arrowLen * 0.72)),
    sub(back, mul(n, PAPER.arrowWidth / 2)),
  ];
}

/** Arrowhead outlines for a line or arc primitive. */
export function arrowHeads(p: LinePrim | ArcPrim): V[][] {
  const heads: V[][] = [];
  if (p.k === "line") {
    if (len(sub(p.b, p.a)) < 1e-9) return heads;
    if (p.arrowA) heads.push(arrowHead(p.a, sub(p.a, p.b)));
    if (p.arrowB) heads.push(arrowHead(p.b, sub(p.b, p.a)));
    return heads;
  }
  // On an arc the head is turned by half the angle it spans, so it follows the curve.
  const lean = Math.min(PAPER.arrowLen / (2 * Math.max(p.r, 1e-6)), 0.6);
  if (p.arrowA) {
    const t = p.a0 + lean;
    heads.push(arrowHead(polar(p.c, p.r, p.a0), [Math.sin(t), -Math.cos(t)]));
  }
  if (p.arrowB) {
    const t = p.a1 - lean;
    heads.push(arrowHead(polar(p.c, p.r, p.a1), [-Math.sin(t), Math.cos(t)]));
  }
  return heads;
}

/**
 * Box of a text primitive in paper mm (y-up), including the part of the text
 * that hangs below its baseline.
 */
export function textBox(p: TextPrim, em = PAPER.em): Box {
  const m = texEngine().measure(p.tex);
  const w = m.w * em;
  const h = (m.asc + m.desc) * em;
  const sep = PAPER.textSep;
  const a = p.anchor;
  const x0 = a.includes("w") ? p.at[0] + sep : a.includes("e") ? p.at[0] - sep - w : p.at[0] - w / 2;
  const y0 = a.includes("s") ? p.at[1] + sep : a.includes("n") ? p.at[1] - sep - h : p.at[1] - h / 2;
  return { x0, y0, x1: x0 + w, y1: y0 + h };
}

function insidePolygon(q: V, pts: V[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (yi > q[1] !== yj > q[1] && q[0] < ((xj - xi) * (q[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance in mm from q to a primitive; 0 inside a text box or a filled shape. */
export function primDistance(p: Prim, q: V): number {
  switch (p.k) {
    case "line": return distToSegment(q, p.a, p.b);
    case "circle": {
      const d = dist(q, p.c);
      return p.fill && d < p.r ? 0 : Math.abs(d - p.r);
    }
    case "poly": {
      if (p.fill && insidePolygon(q, p.pts)) return 0;
      let best = Infinity;
      p.pts.forEach((a, i) => { best = Math.min(best, distToSegment(q, a, p.pts[(i + 1) % p.pts.length])); });
      return best;
    }
    case "arc": {
      const ang = angleOf(sub(q, p.c));
      if (inSweep(ang, p.a0, p.a1)) return Math.abs(dist(q, p.c) - p.r);
      return Math.min(dist(q, polar(p.c, p.r, p.a0)), dist(q, polar(p.c, p.r, p.a1)));
    }
    case "text": {
      const b = textBox(p);
      const dx = Math.max(b.x0 - q[0], 0, q[0] - b.x1);
      const dy = Math.max(b.y0 - q[1], 0, q[1] - b.y1);
      return Math.hypot(dx, dy);
    }
  }
}

/** Projection helper used when dragging an aligned dimension. */
export function offsetAlong(n: V, from: V, q: V): number {
  return dot(sub(q, from), n);
}

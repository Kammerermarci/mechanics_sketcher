// The primitive list: the sketch broken down into lines, circles, arcs and
// text, positioned in paper millimetres (y-up). The screen and every exporter
// draw from this one list, so they cannot drift apart.

import {
  type Sketch, type Id, type Dimension, type DistanceDim, type AngleDim, type RadiusDim,
  type Arc, type Line, type Sym, type Support, type Frame, type CenterMark, type Balloon,
  type Fill as FillSym, type Hatch,
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
  // Annotations
  centre: 0.105,        // 0.3 pt centre lines
  centreCross: 1.2,     // half-length of the cross at the centre
  centreGap: 0.8,
  centreOver: 2.0,      // how far centre lines run past the rim
  balloonRadius: 2.6,   // smallest balloon
  balloonPad: 0.7,
  leaderDot: 0.45,
};

export type Anchor = "c" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export type StrokeStyle = "member" | "construction" | "dim" | "symbol" | "hatch" | "centre" | "centreline";
/** Line width of each stroke style, in mm. */
export const STROKE_MM: Record<StrokeStyle, number> = {
  member: PAPER.member, construction: PAPER.construction, dim: PAPER.dim,
  symbol: PAPER.symbol, hatch: PAPER.hatch, centre: PAPER.centre, centreline: PAPER.symbol,
};
/** Dash patterns, as on and off lengths in mm. Styles not listed are solid. */
export const STROKE_DASH: Partial<Record<StrokeStyle, number[]>> = {
  centreline: [4, 1, 0.6, 1], // long dash, short dash
};
/** "paper" fills a shape with the background, hiding what lies under it; "ink" makes it solid. */
export type Fill = "paper" | "ink";

interface Base {
  /** The entity, symbol or dimension this primitive belongs to. */
  ref?: Id;
  layer: "fill" | "geom" | "sym" | "dim";
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
/** One closed outline of a region: a whole circle, or straight and arc pieces end to end. */
export type Outline =
  | { kind: "circle"; c: V; r: number }
  | { kind: "path"; start: V; segs: OutlineSeg[] };
export type OutlineSeg =
  | { k: "L"; to: V }
  /** An arc about c from angle a0 to a1, counter-clockwise when ccw. */
  | { k: "A"; to: V; c: V; r: number; a0: number; a1: number; ccw: boolean };
/** A filled area with no outline of its own. Later outlines cut holes (even-odd). */
export interface RegionPrim extends Base { k: "region"; outlines: Outline[]; color: string }
export type Prim = LinePrim | CirclePrim | PolyPrim | ArcPrim | TextPrim | RegionPrim;

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
 * Paper millimetres per model unit that makes the geometry `widthMm` wide.
 * Tall, narrow sketches are limited by height instead, so a single vertical
 * member does not blow the scale up.
 */
export function scaleForWidth(sk: Sketch, widthMm: number): number {
  const b = geometryBox(sk);
  if (boxIsEmpty(b)) return DEFAULT_MM_PER_UNIT;
  const extent = Math.max(b.x1 - b.x0, (b.y1 - b.y0) * 0.3);
  if (extent < 1e-9) return DEFAULT_MM_PER_UNIT;
  return widthMm / extent;
}

/**
 * Paper millimetres per model unit. Either a set value, or whatever makes the
 * geometry `figureWidthMm` wide.
 */
export function mmPerUnit(sk: Sketch): number {
  return sk.scaleMode === "fixed" ? sk.mmPerUnit : scaleForWidth(sk, sk.figureWidthMm);
}

/** Width of the geometry on paper at the current scale, in mm. */
export function figureWidth(sk: Sketch): number {
  const b = geometryBox(sk);
  return boxIsEmpty(b) ? 0 : (b.x1 - b.x0) * mmPerUnit(sk);
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

/** Start, end and direction data of a curve, in model units. */
type CurveShape =
  | { kind: "line"; a: V; b: V }
  | { kind: "round"; c: V; r: number; a0: number; a1: number; full: boolean };

function curveShape(sk: Sketch, id: Id): CurveShape | null {
  const e = entity(sk, id);
  if (!e || e.type === "point") return null;
  const xy = (pid: Id): V => { const p = point(sk, pid); return [p.x, p.y]; };
  if (e.type === "line") return { kind: "line", a: xy(e.p1), b: xy(e.p2) };
  if (e.type === "circle") return { kind: "round", c: xy(e.c), r: e.r, a0: 0, a1: TWO_PI, full: true };
  return { kind: "round", c: xy(e.c), r: arcRadius(sk, e), ...arcAngles(sk, e), full: false };
}

/** The point at parameter t of a curve: a fraction along a line or arc, an angle on a circle. */
export function pointOnCurve(sk: Sketch, id: Id, t: number): V | null {
  const c = curveShape(sk, id);
  if (!c) return null;
  if (c.kind === "line") return add(c.a, mul(sub(c.b, c.a), t));
  return polar(c.c, c.r, c.full ? t : c.a0 + t * (c.a1 - c.a0));
}

/** The parameter of the point on a curve nearest to q; the inverse of pointOnCurve. */
export function curveParam(sk: Sketch, id: Id, q: V): number {
  const c = curveShape(sk, id);
  if (!c) return 0;
  if (c.kind === "line") {
    const d = sub(c.b, c.a);
    const l2 = dot(d, d);
    return l2 < 1e-18 ? 0 : Math.max(0, Math.min(1, dot(sub(q, c.a), d) / l2));
  }
  const ang = angleOf(sub(q, c.c));
  if (c.full) return ang;
  return Math.max(0, Math.min(1, wrap(ang - c.a0) / (c.a1 - c.a0)));
}

/** Signed distance from q to a curve in model units: positive on its left (inside, for a circle or arc). */
export function sideOfCurve(sk: Sketch, id: Id, q: V): number {
  const c = curveShape(sk, id);
  if (!c) return 0;
  if (c.kind === "line") return dot(sub(q, c.a), perp(norm(sub(c.b, c.a))));
  return c.r - dist(q, c.c);
}

/** What a balloon's leader points at, in model units. */
export function balloonAnchor(sk: Sketch, b: Balloon): V {
  if (b.at) {
    const p = point(sk, b.at);
    return [p.x, p.y];
  }
  if (b.on) return pointOnCurve(sk, b.on, b.t ?? 0.5) ?? [b.x, b.y];
  return [b.x, b.y];
}

/** Where a symbol sits, in model units. */
export function symbolPosition(sk: Sketch, s: Sym): V {
  switch (s.type) {
    case "support": {
      const p = point(sk, s.at);
      return [p.x, p.y];
    }
    case "frame":
      if (s.at) {
        const p = point(sk, s.at);
        return [p.x, p.y];
      }
      return [s.x, s.y];
    case "centermark": return curveShape(sk, s.on)?.kind === "round" ? (curveShape(sk, s.on) as { c: V }).c : [0, 0];
    case "balloon": return balloonAnchor(sk, s);
    case "hatch": return pointOnCurve(sk, s.on, curveShape(sk, s.on)?.kind === "round" && (curveShape(sk, s.on) as { full: boolean }).full ? 0 : 0.5) ?? [0, 0];
    case "fill": {
      const outline = fillOutlines(sk, s, 1)[0];
      if (!outline) return [0, 0];
      if (outline.kind === "circle") return outline.c;
      const poly = outlinePolygon(outline);
      const sum = poly.reduce<V>((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
      return [sum[0] / poly.length, sum[1] / poly.length];
    }
  }
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
  const axes: [number, string, number][] = [[f.angle, f.xLabel, f.xSize], [f.angle + Math.PI / 2, f.yLabel, f.ySize]];
  for (const [ang, label, size] of axes) {
    if (size <= 0) continue;
    const dir: V = [Math.cos(ang), Math.sin(ang)];
    const tip = add(o, mul(dir, size));
    out.push({ ...base, k: "line", a: o, b: tip, stroke: "symbol", arrowB: true });
    if (label.trim()) out.push({ ...base, k: "text", at: tip, tex: label.trim(), anchor: anchorFor(dir) });
  }
  return out;
}

function centerMarkPrims(sk: Sketch, s: CenterMark, mm: number): Prim[] {
  const base = { ref: s.id, layer: "sym" as const, k: "line" as const, stroke: "centre" as const };
  const f = roundFrame(sk, s.on, mm);
  if (!f) return [];
  const out: Prim[] = [];
  const reach = f.r + PAPER.centreOver;
  const inner = PAPER.centreCross + PAPER.centreGap;
  for (const ang of [s.angle, s.angle + Math.PI / 2]) {
    const at = (d: number) => polar(f.c, d, ang);
    if (reach - inner < PAPER.centreCross) {
      // Too small for a separate cross: one line each way.
      out.push({ ...base, a: at(-reach), b: at(reach) });
      continue;
    }
    out.push({ ...base, a: at(-PAPER.centreCross), b: at(PAPER.centreCross) });
    out.push({ ...base, a: at(inner), b: at(reach) });
    out.push({ ...base, a: at(-inner), b: at(-reach) });
  }
  return out;
}

/** Radius of a balloon that holds its text, in mm. */
export function balloonRadius(text: string): number {
  const m = texEngine().measure(text.trim() || "0");
  const half = Math.hypot(m.w, m.asc + m.desc) * PAPER.em * 0.5;
  return Math.max(PAPER.balloonRadius, half + PAPER.balloonPad);
}

function balloonPrims(sk: Sketch, s: Balloon, mm: number): Prim[] {
  const base = { ref: s.id, layer: "sym" as const };
  const anchor = mul(balloonAnchor(sk, s), mm);
  const centre: V = [anchor[0] + s.dx, anchor[1] + s.dy];
  const r = balloonRadius(s.text);
  const out: Prim[] = [];
  const reach = dist(anchor, centre);
  if (reach > r + 0.3) {
    const edge = add(centre, mul(norm(sub(anchor, centre)), r));
    out.push({ ...base, k: "line", a: anchor, b: edge, stroke: "symbol", arrowA: s.end === "arrow" });
    if (s.end === "dot") out.push({ ...base, k: "circle", c: anchor, r: PAPER.leaderDot, stroke: "symbol", fill: "ink" });
  }
  out.push({ ...base, k: "circle", c: centre, r, stroke: "symbol", fill: "paper" });
  if (s.text.trim()) out.push({ ...base, k: "text", at: centre, tex: s.text.trim(), anchor: "c" });
  return out;
}

function hatchPrims(sk: Sketch, s: Hatch, mm: number): Prim[] {
  const base = { ref: s.id, layer: "sym" as const, k: "line" as const, stroke: "hatch" as const };
  const c = curveShape(sk, s.on);
  if (!c || s.spacing <= 0) return [];
  const out: Prim[] = [];
  // Each stroke leaves the curve towards the chosen side, leaning back along it.
  const stroke = (at: V, along: V, side: V) => {
    out.push({ ...base, a: at, b: add(at, add(mul(side, s.depth), mul(along, -s.depth * 0.85))) });
  };
  if (c.kind === "line") {
    const a = mul(c.a, mm), b = mul(c.b, mm);
    const length = dist(a, b);
    if (length < 1e-9) return [];
    const u = norm(sub(b, a));
    const n = mul(perp(u), s.side);
    const count = Math.max(1, Math.floor(length / s.spacing));
    const first = (length - (count - 1) * s.spacing) / 2;
    for (let i = 0; i < count; i++) stroke(add(a, mul(u, first + i * s.spacing)), u, n);
    return out;
  }
  const ctr = mul(c.c, mm), r = c.r * mm;
  const sweep = c.a1 - c.a0;
  const count = Math.max(1, Math.round((r * sweep) / s.spacing));
  const step = sweep / count;
  for (let i = 0; i < count; i++) {
    const ang = c.a0 + (i + 0.5) * step;
    const radial: V = [Math.cos(ang), Math.sin(ang)];
    // Left of a counter-clockwise curve is its inside.
    stroke(polar(ctr, r, ang), perp(radial), mul(radial, -s.side));
  }
  return out;
}

/** The outlines of a fill at the current geometry: the region first, then its holes. */
export function fillOutlines(sk: Sketch, f: FillSym, mm: number): Outline[] {
  const out: Outline[] = [];
  const circle = (id: Id) => {
    const r = roundFrame(sk, id, mm);
    if (r) out.push({ kind: "circle", c: r.c, r: r.r });
  };
  if (f.circle) circle(f.circle);
  else if (f.points.length >= 2) {
    const at = (i: number) => P(sk, f.points[i % f.points.length], mm);
    const segs: OutlineSeg[] = [];
    f.points.forEach((_, i) => {
      const from = at(i), to = at(i + 1);
      const arcId = f.arcs[i];
      const arc = arcId ? entity(sk, arcId) : undefined;
      if (arc?.type !== "arc") {
        segs.push({ k: "L", to });
        return;
      }
      const c = P(sk, arc.c, mm);
      const first = angleOf(sub(P(sk, arc.p1, mm), c));
      const a0 = angleOf(sub(from, c)), a1 = angleOf(sub(to, c));
      // The arc runs counter-clockwise from its first point; this piece does too if `from` comes before `to` on it.
      const ccw = wrap(a0 - first + 1e-9) < wrap(a1 - first + 1e-9);
      segs.push({ k: "A", to, c, r: dist(from, c), a0, a1, ccw });
    });
    out.push({ kind: "path", start: at(0), segs });
  }
  f.holes.forEach(circle);
  return out;
}

/** An outline as a polygon, with arcs and circles sampled. */
export function outlinePolygon(o: Outline): V[] {
  if (o.kind === "circle") {
    return Array.from({ length: 64 }, (_, i) => polar(o.c, o.r, (i * TWO_PI) / 64));
  }
  const pts: V[] = [o.start];
  for (const seg of o.segs) {
    if (seg.k === "A") {
      const sweep = seg.ccw ? wrap(seg.a1 - seg.a0) || TWO_PI : -(wrap(seg.a0 - seg.a1) || TWO_PI);
      const n = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 30)));
      for (let i = 1; i < n; i++) pts.push(polar(seg.c, seg.r, seg.a0 + (sweep * i) / n));
    }
    pts.push(seg.to);
  }
  pts.pop(); // the last point closes onto the first
  return pts;
}

function fillPrims(sk: Sketch, f: FillSym, mm: number): Prim[] {
  const outlines = fillOutlines(sk, f, mm);
  return outlines.length ? [{ k: "region", outlines, color: f.color, ref: f.id, layer: "fill" }] : [];
}

export function symbolPrims(sk: Sketch, s: Sym, mm: number): Prim[] {
  switch (s.type) {
    case "support": return supportPrims(sk, s, mm);
    case "frame": return framePrims(sk, s, mm);
    case "centermark": return centerMarkPrims(sk, s, mm);
    case "balloon": return balloonPrims(sk, s, mm);
    case "hatch": return hatchPrims(sk, s, mm);
    case "fill": return fillPrims(sk, s, mm);
  }
}

// ---- the list -------------------------------------------------------------

export interface BuildOptions {
  /** Construction geometry and hidden dimensions: on for the editor, off for exports. */
  editor: boolean;
}

export function buildPrims(sk: Sketch, mm: number, opts: BuildOptions): Prim[] {
  const out: Prim[] = [];
  // Fills lie under everything else.
  for (const sym of sk.symbols) if (sym.type === "fill") out.push(...symbolPrims(sk, sym, mm));
  for (const e of sk.entities) {
    if (e.type === "point") continue;
    if (e.construction && !opts.editor) continue;
    const stroke: StrokeStyle = e.construction ? "construction" : e.centre ? "centreline" : "member";
    const base = { ref: e.id, layer: "geom" as const, stroke };
    if (e.type === "line") {
      out.push({ ...base, k: "line", a: P(sk, e.p1, mm), b: P(sk, e.p2, mm) });
    } else if (e.type === "circle") {
      out.push({ ...base, k: "circle", c: P(sk, e.c, mm), r: e.r * mm });
    } else {
      const { a0, a1 } = arcAngles(sk, e);
      out.push({ ...base, k: "arc", c: P(sk, e.c, mm), r: arcRadius(sk, e) * mm, a0, a1 });
    }
  }
  for (const sym of sk.symbols) if (sym.type !== "fill") out.push(...symbolPrims(sk, sym, mm));
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
    case "region": {
      // Even-odd: inside an odd number of outlines means inside the fill.
      let inside = false;
      for (const o of p.outlines) {
        if (o.kind === "circle" ? dist(q, o.c) < o.r : insidePolygon(q, outlinePolygon(o))) inside = !inside;
      }
      return inside ? 0 : Infinity;
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

// The primitive list: the sketch broken down into lines, circles, arcs and
// text, positioned in paper millimetres (y-up). The screen and every exporter
// draw from this one list, so they cannot drift apart.

import {
  type Sketch, type Id, type Dimension, type DistanceDim, type AngleDim, type RadiusDim,
  type Arc, type Line, type Curve, type Sym, type Support, type Frame, type CenterMark, type Balloon,
  type Fill as FillSym, type Hatch, type Datum, type Note, type Load, type LineLoad, type Moment, type AnyLoad, type LoadKind, type Diagram,
  entity, point, arcRadius, arcAngles, isDimension, isNamed, geometryBox, geometryExtent,
} from "./model";
import { elementPaths, elementReach } from "./element";
import {
  type V, type Box, add, sub, mul, dot, norm, perp, mid, polar, dist, len, angleOf, wrap, inSweep,
  distToSegment, intersectLines, TWO_PI,
} from "./geom";
import { texEngine } from "./tex";
import { baseline, diagramShape } from "./diagram";
import { PLOT, PLOT_DASH } from "./plotmath";

/** Sizes of annotations in annotation mm: what they measure on paper at a dimension size of 100%. 1 pt = 0.3515 mm. */
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
  arrow: 0.21,          // 0.6 pt arrow annotations
  arrowScale: 1.5,      // their heads, against a dimension's
  datumRadius: 0.7,
  massRadius: 1.5,      // the mark of a centre of mass
  element: 0.21,        // 0.6 pt springs and dampers
  radiusLeader: 8,      // default length of a radius leader drawn outside the circle
  loadHead: 0.62,       // the heads of a spread load's arrows, against a dimension's
  loadShade: 0.16,      // how much of a spread load's colour is in the shading under its arrows
};

export type Anchor = "c" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export type StrokeStyle = "member" | "construction" | "dim" | "symbol" | "hatch" | "centre" | "centreline" | "arrow" | "element";
/** Line width of each stroke style, in mm. */
export const STROKE_MM: Record<StrokeStyle, number> = {
  member: PAPER.member, construction: PAPER.construction, dim: PAPER.dim,
  symbol: PAPER.symbol, hatch: PAPER.hatch, centre: PAPER.centre, centreline: PAPER.symbol,
  arrow: PAPER.arrow, element: PAPER.element,
};
/** One point, in mm. */
export const PT_MM = 0.3515;
/** How thick a curve is drawn when it has no thickness of its own, in points. */
export function standardWeight(e: Curve): number {
  return Number((STROKE_MM[curveStroke(e)] / PT_MM).toFixed(2));
}
/** The stroke style a curve of the sketch is drawn in. */
function curveStroke(e: Curve): StrokeStyle {
  if (e.construction) return "construction";
  if (e.type !== "circle" && e.arrow) return "arrow";
  if (e.type !== "circle" && e.element) return "element";
  return e.centre ? "centreline" : "member";
}
/** Width a primitive is stroked with, in mm: its own, or that of its style. */
export function strokeWidth(p: { stroke: StrokeStyle; width?: number }): number {
  return p.width ?? STROKE_MM[p.stroke];
}
/** Dash patterns, as on and off lengths in mm. Styles not listed are solid. */
export const STROKE_DASH: Partial<Record<StrokeStyle, number[]>> = {
  centreline: [2, 0.6, 0.3, 0.6], // long dash, short dash
};
/** The pattern of a curve that is drawn dashed, as on and off lengths in mm. */
export const DASHED = [2, 1.2];
/** The pattern a stroked primitive is drawn with: its own, or that of its style. Null for a solid line. */
export function dashOf(p: { stroke: StrokeStyle; dash?: number[] }): number[] | null {
  return p.dash ?? STROKE_DASH[p.stroke] ?? null;
}
/** "paper" fills a shape with the background, hiding what lies under it; "ink" makes it solid. */
export type Fill = "paper" | "ink";

interface Base {
  /** The entity, symbol or dimension this primitive belongs to. */
  ref?: Id;
  layer: "fill" | "geom" | "sym" | "dim";
  /** Shown faded in the editor and left out of exports (hidden dimensions). */
  ghost?: boolean;
  /** Which piece of its owner this is, where the editor treats pieces differently (a name, an axis). */
  part?: string;
  /** CSS hex colour a solid shape is filled with instead of black. Its outline stays black. */
  color?: string;
  /** CSS hex colour it is drawn in instead of black: its stroke, its arrowheads, its text. */
  ink?: string;
}
/**
 * `head` scales the arrowheads; 1 is the size used on dimensions. `width`, in mm, replaces the width of the stroke style,
 * and `dash` its pattern, as on and off lengths in mm.
 */
export interface LinePrim extends Base { k: "line"; a: V; b: V; stroke: StrokeStyle; width?: number; dash?: number[]; arrowA?: boolean; arrowB?: boolean; head?: number }
export interface CirclePrim extends Base { k: "circle"; c: V; r: number; stroke: StrokeStyle; width?: number; dash?: number[]; fill?: Fill }
/** A closed outline. */
export interface PolyPrim extends Base { k: "poly"; pts: V[]; stroke: StrokeStyle; fill?: Fill; dash?: undefined }
/** An open run of straight pieces: a plotted curve. `dash` is its pattern, as on and off lengths in mm. */
export interface PathPrim extends Base { k: "path"; pts: V[]; stroke: StrokeStyle; width?: number; dash?: number[] }
/** Counter-clockwise from a0 to a1, with a1 > a0. */
export interface ArcPrim extends Base { k: "arc"; c: V; r: number; a0: number; a1: number; stroke: StrokeStyle; width?: number; dash?: number[]; arrowA?: boolean; arrowB?: boolean; head?: number }
/**
 * `anchor` names the side of the text box that sits at `at`, as in TikZ.
 * `rot` turns the text about `at`, counter-clockwise in radians.
 */
export interface TextPrim extends Base {
  k: "text"; at: V; tex: string; anchor: Anchor; rot?: number;
  /** Plain LaTeX to put in the TikZ picture in place of the math in `tex`: a note's text, set as text. */
  latex?: string;
  /** How many lines the text has, when more than one. */
  lines?: number;
}
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
export type Prim = LinePrim | CirclePrim | PolyPrim | PathPrim | ArcPrim | TextPrim | RegionPrim;

// ---- scale ------------------------------------------------------------------

export { geometryBox };

const DEFAULT_MM_PER_UNIT = 10;

/**
 * Annotation millimetres per model unit for the exported figure. Laid out at
 * this scale and then enlarged by dimScale as a whole, the geometry comes out
 * figureWidthMm wide and every annotation dimScale times its standard size.
 */
export function printMm(sk: Sketch): number {
  const extent = geometryExtent(sk);
  if (extent < 1e-9) return DEFAULT_MM_PER_UNIT;
  return sk.figureWidthMm / sk.dimScale / extent;
}

// ---- dimension text ---------------------------------------------------------

export function formatNumber(v: number): string {
  return String(Number(v.toFixed(3)));
}

/**
 * A typed label as TeX. Math mode drops spaces, so each typed space becomes
 * "\ " and shows; the one space that ends a command name (\alpha b) is kept
 * as it is.
 */
export function labelTex(typed: string): string {
  // One character for each accented letter, however it was typed or pasted.
  const s = typed.trim().normalize("NFC");
  let out = "";
  for (let i = 0; i < s.length;) {
    if (s[i] === "\\") {
      let j = i + 1;
      if (j < s.length && /[a-zA-Z]/.test(s[j])) {
        while (j < s.length && /[a-zA-Z]/.test(s[j])) j++;
        if (s[j] === " ") j++;
      } else j++; // a control symbol such as "\ " or "\,"
      out += s.slice(i, j);
      i = j;
    } else {
      out += s[i] === " " ? "\\ " : s[i];
      i++;
    }
  }
  return out;
}

/** The lines of a note, each cut into text and math by turns: even pieces are text, odd ones math. */
function noteLines(typed: string): string[][] {
  typed = typed.normalize("NFC");
  const lines: string[][] = [];
  let line: string[] = [""];
  for (let i = 0; i < typed.length; i++) {
    const ch = typed[i];
    const math = line.length % 2 === 0;
    if (ch === "\\" && typed[i + 1] === "$" && !math) {
      line[line.length - 1] += "\\$"; // a dollar sign meant as one
      i++;
    } else if (ch === "$") line.push("");
    else if (ch === "\n" || (ch === "\\" && typed[i + 1] === "\\" && !math)) {
      if (ch === "\\") i++;
      lines.push(line);
      line = [""];
    } else line[line.length - 1] += ch;
  }
  lines.push(line);
  return lines.map((l) => l.map((piece, i) => {
    if (i % 2) return piece.trim();
    // Spaces at either end of a line are not part of it.
    if (i === 0) piece = piece.trimStart();
    return i === l.length - 1 ? piece.trimEnd() : piece;
  }));
}

/**
 * The text pieces of one line of a note, made safe for LaTeX. Commands such
 * as \textbf{...} are left to work; characters that would break the line
 * (% & # _ ^ ~) are escaped unless they already are, and braces too when
 * they do not pair up.
 */
function noteText(pieces: string[]): string[] {
  let depth = 0, balanced = true;
  for (let i = 0; i < pieces.length; i += 2) {
    const t = pieces[i];
    for (let j = 0; j < t.length; j++) {
      if (t[j] === "\\") { j++; continue; }
      if (t[j] === "{") depth++;
      else if (t[j] === "}" && --depth < 0) balanced = false;
    }
  }
  if (depth !== 0) balanced = false;
  const SAFE: Record<string, string> = { "%": "\\%", "&": "\\&", "#": "\\#", "_": "\\_", "^": "\\^{}", "~": "\\~{}" };
  return pieces.map((t, i) => {
    if (i % 2) return t;
    let out = "";
    for (let j = 0; j < t.length; j++) {
      const ch = t[j];
      if (ch === "\\" && j + 1 < t.length) { out += ch + t[++j]; continue; }
      if (ch === "\\") continue; // a lone one at the very end: the start of something not typed yet
      if (ch in SAFE) out += SAFE[ch];
      else if ((ch === "{" || ch === "}") && !balanced) out += "\\" + ch;
      else out += ch;
    }
    return out;
  });
}

/** A note as TeX math for the screen and the SVG: its text upright, its math as typed, its lines stacked. */
export function noteTex(typed: string): string {
  const lines = noteLines(typed.trim()).map((pieces) =>
    noteText(pieces).map((t, i) => (i % 2 ? t : t ? `\\text{${t}}` : "")).join(""));
  if (lines.length === 1) return lines[0];
  return `\\begin{array}{@{}l@{}}${lines.join("\\\\")}\\end{array}`;
}

/** A note as LaTeX text for the TikZ picture, and how many lines it has. */
export function noteLatex(typed: string): { latex: string; lines: number } {
  const lines = noteLines(typed.trim()).map((pieces) =>
    noteText(pieces).map((t, i) => (i % 2 ? `$${t}$` : t)).join("").trim());
  return { latex: lines.join("\\\\"), lines: lines.length };
}

/** The TeX shown on a dimension: its label, or else its value. */
export function dimTex(d: Dimension): string {
  const label = d.label?.trim();
  if (label) return labelTex(label);
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
  const offset = d.offset * mm;
  if (d.mode === "horizontal") {
    const y = A[1] + offset;
    return { A, B, A2: [A[0], y] as V, B2: [B[0], y] as V, n: [0, 1] as V, out: [0, side] as V };
  }
  if (d.mode === "vertical") {
    const x = A[0] + offset;
    return { A, B, A2: [x, A[1]] as V, B2: [x, B[1]] as V, n: [1, 0] as V, out: [side, 0] as V };
  }
  const n = perp(norm(sub(B, A)));
  return { A, B, A2: add(A, mul(n, offset)), B2: add(B, mul(n, offset)), n, out: mul(n, side) };
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
  const at = mid(f.A2, f.B2);
  const along = (d.text ?? (d.mode === "aligned" ? "along" : "upright")) === "along";
  const span = sub(f.B2, f.A2);
  if (!along || len(span) < 1e-9) {
    out.push({ ...base, k: "text", at, tex: dimTex(d), anchor: anchorFor(f.out) });
    return out;
  }
  // Turned to run along the dimension line, the way that reads from below or from the right.
  let rot = angleOf(span);
  if (rot > Math.PI / 2 + 1e-9) rot -= Math.PI;
  else if (rot <= -Math.PI / 2 + 1e-9) rot += Math.PI;
  const up: V = [-Math.sin(rot), Math.cos(rot)];
  const text: TextPrim = { ...base, k: "text", at, tex: dimTex(d), anchor: dot(f.out, up) >= 0 ? "s" : "n" };
  if (Math.abs(rot) > 1e-9) text.rot = rot;
  out.push(text);
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
  const radius = d.radius * mm;
  // Extension lines where the arc ends beyond a member.
  for (const [seg, ang] of [[f.seg1, f.start], [f.seg2, f.end]] as [[V, V], number][]) {
    const tip = polar(f.vertex, radius, ang);
    if (distToSegment(tip, seg[0], seg[1]) < 0.3) continue;
    const near = dist(tip, seg[0]) < dist(tip, seg[1]) ? seg[0] : seg[1];
    const dir = norm(sub(tip, near));
    out.push({ ...base, k: "line", stroke: "dim", a: add(near, mul(dir, PAPER.extGap)), b: add(tip, mul(dir, PAPER.extOver)) });
  }
  out.push({ ...base, k: "arc", stroke: "dim", c: f.vertex, r: radius, a0: f.start, a1: f.end, arrowA: true, arrowB: true });
  const midAng = (f.start + f.end) / 2;
  out.push({ ...base, k: "text", at: polar(f.vertex, radius, midAng), tex: dimTex(d), anchor: anchorFor([Math.cos(midAng), Math.sin(midAng)]) });
  return out;
}

/** Centre and radius of a circle or arc, in paper mm. */
export function roundFrame(sk: Sketch, id: Id, mm: number): { c: V; r: number } | null {
  const e = entity(sk, id);
  if (e?.type === "circle") return { c: P(sk, e.c, mm), r: e.r * mm };
  if (e?.type === "arc") return { c: P(sk, e.c, mm), r: arcRadius(sk, e) * mm };
  return null;
}

/**
 * The leader of a radius dimension, in paper mm: `tip` is on the rim, `far`
 * its other end. Inside the circle it runs from the centre unless a length
 * is set; outside it points in at the rim.
 */
export function radiusLeader(sk: Sketch, d: RadiusDim, mm: number): { c: V; r: number; dir: V; tip: V; far: V } | null {
  const f = roundFrame(sk, d.target, mm);
  if (!f) return null;
  const dir: V = [Math.cos(d.angle), Math.sin(d.angle)];
  const tip = add(f.c, mul(dir, f.r));
  const far = d.outside
    ? add(tip, mul(dir, d.len === undefined ? PAPER.radiusLeader : d.len * mm))
    : d.len === undefined ? f.c : sub(tip, mul(dir, d.len * mm));
  return { ...f, dir, tip, far };
}

function radiusPrims(sk: Sketch, d: RadiusDim, mm: number): Prim[] {
  const base = { ref: d.id, layer: "dim" as const };
  const f = radiusLeader(sk, d, mm);
  if (!f) return [];
  const line: Prim = { ...base, k: "line", stroke: "dim", a: f.far, b: f.tip, arrowB: true };
  // Outside, the text carries on from the end of the leader.
  if (d.outside) return [line, { ...base, k: "text", at: f.far, tex: dimTex(d), anchor: anchorFor(f.dir) }];
  let side = perp(f.dir);
  if (side[1] < -1e-9 || (Math.abs(side[1]) <= 1e-9 && side[0] > 0)) side = mul(side, -1);
  return [line, { ...base, k: "text", at: mid(f.far, f.tip), tex: dimTex(d), anchor: anchorFor(side) }];
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
    case "support":
    case "datum": {
      const p = point(sk, s.at);
      return [p.x, p.y];
    }
    case "frame":
      if (s.at) {
        const p = point(sk, s.at);
        return [p.x, p.y];
      }
      return [s.x, s.y];
    case "note": return [s.x, s.y];
    case "load":
    case "moment": {
      const p = point(sk, s.at);
      return [p.x, p.y];
    }
    case "lineload": {
      const f = lineLoadFrame(sk, s, 1);
      return f ? mid(f.s0, f.s1) : [0, 0];
    }
    case "diagram": {
      const b = baseline(sk, s);
      return b ? b.at((s.t0 + s.t1) / 2) : [0, 0];
    }
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
  // Supports have a size of their own: everything about one is drawn `k` times its standard size.
  const k = sk.supportScale ?? 1;
  const T = placer(mul(symbolPosition(sk, s), mm), s.angle);
  const out: Prim[] = [];
  const line = (a: V, b: V, stroke: StrokeStyle) => out.push({ ...base, k: "line", a: T(a), b: T(b), stroke });

  // Drawn with the ground below the joint; `ground` is how far below.
  let ground = 0;
  if (s.kind !== "fixed") {
    const h = s.kind === "pin" ? (PAPER.pinHeight * k) : (PAPER.rollerHeight * k);
    const w = (PAPER.supportHalfWidth * k);
    out.push({ ...base, k: "poly", pts: [T([0, 0]), T([-w, -h]), T([w, -h])], stroke: "symbol", fill: "paper" });
    ground = h;
    if (s.kind === "roller") {
      const r = (PAPER.wheelRadius * k);
      for (const x of [-w * 0.55, w * 0.55]) {
        out.push({ ...base, k: "circle", c: T([x, -h - r]), r, stroke: "symbol", fill: "paper" });
      }
      ground = h + 2 * r;
    }
  }
  const g = (PAPER.groundHalfWidth * k);
  const n = Math.floor((2 * g) / (PAPER.hatchStep * k));
  for (let i = 1; i <= n; i++) {
    const x = -g + i * (PAPER.hatchStep * k);
    line([x, -ground], [x - (PAPER.hatchDepth * k) * 0.85, -ground - (PAPER.hatchDepth * k)], "hatch");
  }
  line([-g, -ground], [g, -ground], s.kind === "fixed" ? "member" : "symbol");
  if (s.kind !== "fixed") {
    out.push({ ...base, k: "circle", c: T([0, 0]), r: (PAPER.hingeRadius * k), stroke: "symbol", fill: "paper" });
  }
  return out;
}

function framePrims(sk: Sketch, f: Frame, mm: number): Prim[] {
  const base = { ref: f.id, layer: "sym" as const };
  const o = mul(symbolPosition(sk, f), mm);
  const out: Prim[] = [];
  const axes: [number, string, number, string][] = [[f.angle, f.xLabel, f.xSize, "x"], [f.angle + Math.PI / 2, f.yLabel, f.ySize, "y"]];
  for (const [ang, label, size, part] of axes) {
    if (size <= 0) continue;
    const dir: V = [Math.cos(ang), Math.sin(ang)];
    const tip = add(o, mul(dir, size * mm));
    out.push({ ...base, k: "line", a: o, b: tip, stroke: "symbol", arrowB: true, part });
    if (label.trim()) out.push({ ...base, k: "text", at: tip, tex: labelTex(label), anchor: anchorFor(dir), part });
  }
  return out;
}

/** The arrow tips of a pair of axes, in paper mm; null for an axis that is left out. */
export function frameTips(sk: Sketch, f: Frame, mm: number): { x: V | null; y: V | null } {
  const o = mul(symbolPosition(sk, f), mm);
  const tip = (ang: number, size: number): V | null => (size > 0 ? polar(o, size * mm, ang) : null);
  return { x: tip(f.angle, f.xSize), y: tip(f.angle + Math.PI / 2, f.ySize) };
}

/**
 * How a centre mark's line is broken up, in paper mm: `shorts` short dashes
 * with a gap on either side of each, between long dashes of length `long`.
 * As on a centre line it starts and ends on a long dash, and with fewer short
 * dashes than asked for when the mark is too small to hold them. No short
 * dashes means one unbroken line.
 */
export function centerMarkDashes(s: CenterMark, r: number): { reach: number; short: number; gap: number; long: number; shorts: number } {
  const k = s.scale ?? 1;
  const reach = r + PAPER.centreOver * k;
  const short = 2 * PAPER.centreCross * k, gap = PAPER.centreGap * k;
  const longWith = (n: number) => (2 * reach - n * short - 2 * n * gap) / (n + 1);
  let shorts = s.solid ? 0 : Math.max(1, Math.round((s.gaps ?? 2) / 2));
  // The long dashes must stay recognisable: at least half a short one.
  while (shorts > 0 && longWith(shorts) < short / 2) shorts--;
  return { reach, short, gap, long: longWith(shorts), shorts };
}

function centerMarkPrims(sk: Sketch, s: CenterMark, mm: number): Prim[] {
  const base = { ref: s.id, layer: "sym" as const, k: "line" as const, stroke: "centre" as const };
  const f = roundFrame(sk, s.on, mm);
  if (!f) return [];
  const out: Prim[] = [];
  const d = centerMarkDashes(s, f.r);
  for (const ang of [s.angle, s.angle + Math.PI / 2]) {
    const at = (t: number) => polar(f.c, t, ang);
    // Long, short, long ... from one end to the other. With an odd number of
    // short dashes one of them is at the centre, where the two lines cross.
    let t = -d.reach;
    for (let i = 0; i <= d.shorts; i++) {
      out.push({ ...base, a: at(t), b: at(t + d.long) });
      t += d.long + d.gap;
      if (i < d.shorts) {
        out.push({ ...base, a: at(t), b: at(t + d.short) });
        t += d.short + d.gap;
      }
    }
  }
  return out;
}

/** The four ends of a centre mark's lines, in paper mm. */
export function centerMarkEnds(sk: Sketch, s: CenterMark, mm: number): V[] {
  const f = roundFrame(sk, s.on, mm);
  if (!f) return [];
  const reach = f.r + PAPER.centreOver * (s.scale ?? 1);
  return [0, 1, 2, 3].map((i) => polar(f.c, reach, s.angle + (i * Math.PI) / 2));
}

/**
 * The room a balloon's text takes, in mm, and where its leader stops for a
 * leader coming in along `dir` (a unit vector from the centre): on the
 * circle, on the side of the box, or just clear of bare text.
 */
function balloonFrame(s: Pick<Balloon, "text" | "frame">, dir: V): { hw: number; hh: number; r: number; reach: number } {
  const m = texEngine().measure(labelTex(s.text) || "0");
  const hw = (m.w * PAPER.em) / 2, hh = ((m.asc + m.desc) * PAPER.em) / 2;
  const half = Math.hypot(hw, hh);
  const frame = s.frame ?? "circle";
  if (frame === "box") {
    // No narrower than it is tall, so a single digit sits in a square.
    const bh = hh + PAPER.balloonPad, bw = Math.max(hw + PAPER.balloonPad, bh);
    const reach = Math.min(bw / Math.max(Math.abs(dir[0]), 1e-9), bh / Math.max(Math.abs(dir[1]), 1e-9));
    return { hw: bw, hh: bh, r: 0, reach };
  }
  const r = frame === "circle" ? Math.max(PAPER.balloonRadius, half + PAPER.balloonPad) : half + PAPER.balloonPad * 0.6;
  return { hw, hh, r, reach: r };
}

function balloonPrims(sk: Sketch, s: Balloon, mm: number): Prim[] {
  const anchor = mul(balloonAnchor(sk, s), mm);
  return balloonShape(s.id, anchor, [anchor[0] + s.dx * mm, anchor[1] + s.dy * mm], s);
}

/** A balloon whose text is centred at `centre`, with its leader to `anchor`, both in paper mm. */
export function balloonShape(ref: Id, anchor: V, centre: V, s: Pick<Balloon, "text" | "end" | "frame">): Prim[] {
  const base = { ref, layer: "sym" as const };
  const frame = s.frame ?? "circle";
  const out: Prim[] = [];
  const far = dist(anchor, centre);
  const dir: V = far > 1e-9 ? norm(sub(anchor, centre)) : [1, 0];
  const f = balloonFrame(s, dir);
  const leader = (to: V) => {
    out.push({ ...base, k: "line", a: anchor, b: to, stroke: "symbol", arrowA: s.end === "arrow" });
    if (s.end === "dot") out.push({ ...base, k: "circle", c: anchor, r: PAPER.leaderDot, stroke: "symbol", fill: "ink" });
  };
  if (frame === "underline") {
    // The text stands on a line, and the leader runs to the end of that line nearer to what it points at.
    const y = centre[1] - f.hh - PAPER.balloonPad * 0.6;
    const x0 = centre[0] - f.hw - PAPER.balloonPad, x1 = centre[0] + f.hw + PAPER.balloonPad;
    const end: V = [anchor[0] < centre[0] ? x0 : x1, y];
    const onText = Math.abs(anchor[0] - centre[0]) < f.hw + PAPER.balloonPad && Math.abs(anchor[1] - centre[1]) < f.hh + PAPER.balloonPad;
    if (!onText && dist(anchor, end) > 0.3) leader(end);
    out.push({ ...base, k: "line", a: [x0, y], b: [x1, y], stroke: "symbol" });
  } else {
    if (far > f.reach + 0.3) leader(add(centre, mul(dir, f.reach)));
    if (frame === "circle") out.push({ ...base, k: "circle", c: centre, r: f.r, stroke: "symbol", fill: "paper" });
    else if (frame === "box") {
      const [x, y] = centre;
      out.push({ ...base, k: "poly", pts: [[x - f.hw, y - f.hh], [x + f.hw, y - f.hh], [x + f.hw, y + f.hh], [x - f.hw, y + f.hh]], stroke: "symbol", fill: "paper" });
    }
  }
  if (s.text.trim()) out.push({ ...base, k: "text", at: centre, tex: labelTex(s.text), anchor: "c" });
  return out;
}

function datumPrims(sk: Sketch, s: Datum, mm: number): Prim[] {
  const base = { ref: s.id, layer: "sym" as const };
  const at = P(sk, s.at, mm);
  const out: Prim[] = [];
  if (s.mass) {
    // A circle in quarters, the upper right and the lower left filled: the mark of a centre of mass.
    const r = PAPER.massRadius;
    out.push({ ...base, k: "circle", c: at, r, stroke: "symbol", fill: "paper", ink: s.color });
    for (const from of [0, Math.PI]) {
      const pts: V[] = [at];
      for (let i = 0; i <= 8; i++) pts.push(polar(at, r, from + (i * Math.PI) / 16));
      out.push({ ...base, k: "poly", pts, stroke: "symbol", fill: "ink", color: s.color, ink: s.color });
    }
  } else out.push({ ...base, k: "circle", c: at, r: PAPER.datumRadius, stroke: "symbol", fill: "ink", color: s.color });
  if (s.label.trim()) out.push({ ...base, k: "text", at: [at[0] + s.dx, at[1] + s.dy], tex: labelTex(s.label), anchor: "c", part: "label" });
  return out;
}

function notePrims(s: Note, mm: number): Prim[] {
  return noteShape(s.id, [s.x * mm, s.y * mm], s.text);
}

/** A note whose text starts at `at`, the middle of its left edge, in paper mm. */
export function noteShape(ref: Id, at: V, typed: string): Prim[] {
  if (!typed.trim()) return [];
  const { latex, lines } = noteLatex(typed);
  const text: TextPrim = { ref, layer: "sym", k: "text", at, tex: noteTex(typed), anchor: "w", latex };
  if (lines > 1) text.lines = lines;
  return [text];
}

// ---- loads ------------------------------------------------------------------

/** Model units of length per unit of magnitude, for a kind of load that has not been given a scale. */
const LOAD_UNIT = 1;
/** Smallest sizes in annotation mm, so a small load is still an arrow: a force's length, a moment's radius, and the shortest arrow drawn in a spread load. */
const LOAD_MIN = { force: PAPER.arrowLen * PAPER.arrowScale * 1.6, moment: 2.4, lineArrow: PAPER.arrowLen * PAPER.loadHead * 1.5 };
/** How far round a moment's arc runs. */
const MOMENT_SWEEP = 1.5 * Math.PI;

/** How large a load of magnitude 1 is drawn, in model units. */
export function loadScaleOf(sk: Sketch, kind: LoadKind): number {
  const k = sk.loadScale?.[kind];
  return k !== undefined && k > 0 ? k : LOAD_UNIT;
}

/** The arrow of a force, in paper mm: `free` is the end that is not on its point, and `out` points on from there. */
export function loadArrow(sk: Sketch, s: Load, mm: number): { tail: V; tip: V; free: V; out: V } {
  const p = P(sk, s.at, mm);
  const d: V = [Math.cos(s.angle), Math.sin(s.angle)];
  const reach = mul(d, Math.max(s.value * loadScaleOf(sk, "force") * mm, LOAD_MIN.force));
  if (s.pull) return { tail: p, tip: add(p, reach), free: add(p, reach), out: d };
  return { tail: sub(p, reach), tip: p, free: sub(p, reach), out: mul(d, -1) };
}

/**
 * Where a load spread along a line lies, in paper mm: s0 to s1 on the line,
 * e0 to e1 the far ends of its first and last arrow. `body` points from the
 * line to that far side. Null when it is not on a line with some length.
 */
export function lineLoadFrame(sk: Sketch, s: LineLoad, mm: number): { s0: V; s1: V; e0: V; e1: V; body: V; a: V; b: V } | null {
  const l = entity(sk, s.on);
  if (l?.type !== "line") return null;
  const a = P(sk, l.p1, mm), b = P(sk, l.p2, mm);
  if (dist(a, b) < 1e-9) return null;
  const span = sub(b, a);
  const n = mul(perp(norm(span)), s.side);
  // The arrows arrive from the far side, or leave towards it. Square to the line that side is
  // the one chosen; at an angle of its own it is whichever side the arrows come from or go to.
  const body: V = s.angle === undefined ? n : mul([Math.cos(s.angle), Math.sin(s.angle)], s.pull ? 1 : -1);
  const k = loadScaleOf(sk, "line") * mm;
  const s0 = add(a, mul(span, s.t0)), s1 = add(a, mul(span, s.t1));
  return { s0, s1, e0: add(s0, mul(body, s.q1 * k)), e1: add(s1, mul(body, s.q2 * k)), body, a, b };
}

/** The arc of a moment, in paper mm. */
export function momentArc(sk: Sketch, s: Moment, mm: number): { c: V; r: number; a0: number; a1: number } {
  return { c: P(sk, s.at, mm), r: Math.max(s.value * loadScaleOf(sk, "moment") * mm, LOAD_MIN.moment), a0: s.angle, a1: s.angle + MOMENT_SWEEP };
}

/** Where the name of a load goes, in paper mm, and which side of it sits there. */
export function loadLabel(sk: Sketch, s: AnyLoad, mm: number): { at: V; anchor: Anchor } | null {
  let at: V, out: V;
  if (s.type === "load") {
    const f = loadArrow(sk, s, mm);
    at = f.free;
    out = f.out;
  } else if (s.type === "moment") {
    const f = momentArc(sk, s, mm);
    const middle = (f.a0 + f.a1) / 2;
    out = [Math.cos(middle), Math.sin(middle)];
    at = polar(f.c, f.r, middle);
  } else {
    const f = lineLoadFrame(sk, s, mm);
    if (!f) return null;
    at = mid(f.e0, f.e1);
    out = f.body;
  }
  return { at: [at[0] + (s.dx ?? 0), at[1] + (s.dy ?? 0)], anchor: anchorFor(out) };
}

/** How far a load reaches, in model units: the points a view has to hold to show all of it. */
export function loadReach(sk: Sketch, s: AnyLoad): V[] {
  if (s.type === "load") { const f = loadArrow(sk, s, 1); return [f.tail, f.tip]; }
  if (s.type === "moment") { const f = momentArc(sk, s, 1); return [[f.c[0] - f.r, f.c[1] - f.r], [f.c[0] + f.r, f.c[1] + f.r]]; }
  const f = lineLoadFrame(sk, s, 1);
  return f ? [f.s0, f.s1, f.e0, f.e1] : [];
}

/** A colour thinned towards white, as a CSS hex colour: `share` of it is left. */
export function tint(hex: string, share: number): string {
  const v = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!v) return "#eeeeee";
  return "#" + v.slice(1).map((c) => Math.round(255 - (255 - parseInt(c, 16)) * share).toString(16).padStart(2, "0")).join("");
}

/** The shading of a spread load: the area between its line and its envelope, in a light tone of its colour. */
function loadShade(sk: Sketch, s: LineLoad, mm: number): Prim[] {
  if (s.plain) return [];
  const f = lineLoadFrame(sk, s, mm);
  if (!f || Math.max(dist(f.s0, f.e0), dist(f.s1, f.e1)) < 1e-6) return [];
  // Round the four corners and back to the first; a side with no height just folds flat.
  const segs: OutlineSeg[] = [f.s1, f.e1, f.e0, f.s0].map((to) => ({ k: "L", to }));
  return [{ k: "region", outlines: [{ kind: "path", start: f.s0, segs }], color: tint(s.color, PAPER.loadShade), ref: s.id, layer: "fill" }];
}

/**
 * How a value is written beside a diagram: with up to three decimals, fewer
 * for large numbers, so that 28.125 and 1012.5 come out as they are and a
 * third does not run on. Below one it keeps three digits that count.
 */
export function valueText(v: number): string {
  const size = Math.abs(v);
  return String(Number(size >= 1 ? v.toFixed(size >= 1000 ? 1 : size >= 100 ? 2 : 3) : v.toPrecision(3)));
}

/** The shading of a diagram: the areas between its member and its curves, each in a light tone of its curve's colour. */
function diagramShade(sk: Sketch, s: Diagram, mm: number): Prim[] {
  if (s.plain) return [];
  const shape = diagramShape(sk, s);
  if (!shape) return [];
  const out: Prim[] = [];
  for (const part of shape.parts) {
    for (const area of part.areas) {
      const [start, ...rest] = area.map((q) => mul(q, mm));
      out.push({ k: "region", layer: "fill", ref: s.id, color: tint(part.curve.color, PLOT.shade), outlines: [{ kind: "path", start, segs: [...rest, start].map((to) => ({ k: "L" as const, to })) }] });
    }
  }
  return out;
}

/** A plot laid along a member: its curves, the lines that close them down to the member, and whatever strokes and values go with them. */
function diagramPrims(sk: Sketch, s: Diagram, mm: number): Prim[] {
  const shape = diagramShape(sk, s);
  if (!shape) return [];
  const base = { ref: s.id, layer: "sym" as const };
  const M = (q: V) => mul(q, mm);
  const out: Prim[] = [];
  // Along the middle of a beam there is no line to be the diagram's zero, so it brings one.
  if (s.axis) {
    const n = shape.base.kind === "arc" ? 48 : 1;
    out.push({ ...base, k: "path", pts: Array.from({ length: n + 1 }, (_, i) => M(shape.base.at(s.t0 + ((s.t1 - s.t0) * i) / n))), stroke: "dim", part: "zero" });
  }
  for (const part of shape.parts) {
    const c = part.curve;
    for (const [a, b] of part.strokes) out.push({ ...base, k: "line", a: M(a), b: M(b), stroke: "hatch", ink: c.color, part: "stroke" });
    const line = { ...base, k: "path" as const, stroke: "member" as const, width: (c.weight ?? PLOT.weight) * PT_MM, ink: c.color, ...(c.dash ? { dash: PLOT_DASH[c.dash] } : {}) };
    for (const pts of part.lines) out.push({ ...line, pts: pts.map(M) });
    for (const up of part.uprights) out.push({ ...line, pts: up.map(M) });
    for (const v of part.values) out.push({ ...base, k: "text", at: M(v.at), tex: valueText(v.v), anchor: anchorFor(v.out), ink: c.color, part: "value" });
  }
  return out;
}

function loadPrims(sk: Sketch, s: AnyLoad, mm: number): Prim[] {
  const base = { ref: s.id, layer: "sym" as const, ink: s.color };
  const out: Prim[] = [];
  if (s.type === "load") {
    const f = loadArrow(sk, s, mm);
    out.push({ ...base, k: "line", a: f.tail, b: f.tip, stroke: "arrow", arrowB: true, head: PAPER.arrowScale });
  } else if (s.type === "moment") {
    const f = momentArc(sk, s, mm);
    const arc: ArcPrim = { ...base, k: "arc", ...f, stroke: "arrow", head: PAPER.arrowScale };
    if (s.cw) arc.arrowA = true;
    else arc.arrowB = true;
    out.push(arc);
  } else {
    const f = lineLoadFrame(sk, s, mm);
    if (!f) return [];
    const n = Math.max(2, Math.round(s.count));
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const foot = add(f.s0, mul(sub(f.s1, f.s0), t)), far = add(f.e0, mul(sub(f.e1, f.e0), t));
      // Where the load runs down to nothing there is no room for an arrow; the envelope says it.
      if (dist(foot, far) < LOAD_MIN.lineArrow) continue;
      out.push(s.pull
        ? { ...base, k: "line", a: foot, b: far, stroke: "symbol", arrowB: true, head: PAPER.loadHead }
        : { ...base, k: "line", a: far, b: foot, stroke: "symbol", arrowB: true, head: PAPER.loadHead });
    }
    out.push({ ...base, k: "line", a: f.e0, b: f.e1, stroke: "symbol", part: "envelope" });
  }
  const label = s.label.trim() ? loadLabel(sk, s, mm) : null;
  if (label) out.push({ ...base, k: "text", at: label.at, tex: labelTex(s.label), anchor: label.anchor, part: "label" });
  return out;
}

/** Most strokes a hatching is drawn with, however fine its spacing. */
const HATCH_MAX = 2000;

/** How many strokes fit along a curve of a given length at a given spacing. */
export function hatchCount(length: number, spacing: number): number {
  // The small allowance keeps a spacing worked out as length / n at n strokes.
  return Math.max(1, Math.min(HATCH_MAX, Math.floor(length / spacing + 1e-6)));
}

/** Length of a line, arc or circle in model units. */
export function curveLength(sk: Sketch, id: Id): number {
  const c = curveShape(sk, id);
  if (!c) return 0;
  return c.kind === "line" ? dist(c.a, c.b) : c.r * (c.a1 - c.a0);
}

function hatchPrims(sk: Sketch, s: Hatch, mm: number): Prim[] {
  const base = { ref: s.id, layer: "sym" as const, k: "line" as const, stroke: "hatch" as const };
  const c = curveShape(sk, s.on);
  if (!c || s.spacing <= 0) return [];
  const out: Prim[] = [];
  // Each stroke leaves the curve towards the chosen side, leaning back along it (or forwards).
  const lean = s.lean ?? 1;
  // Spacing and reach are kept in model units, like the curve they sit on.
  const spacing = s.spacing * mm, depth = s.depth * mm;
  const stroke = (at: V, along: V, side: V) => {
    out.push({ ...base, a: at, b: add(at, add(mul(side, depth), mul(along, -depth * 0.85 * lean))) });
  };
  if (c.kind === "line") {
    const a = mul(c.a, mm), b = mul(c.b, mm);
    const length = dist(a, b);
    if (length < 1e-9) return [];
    const u = norm(sub(b, a));
    const n = mul(perp(u), s.side);
    const count = hatchCount(length, spacing);
    const first = (length - (count - 1) * spacing) / 2;
    for (let i = 0; i < count; i++) stroke(add(a, mul(u, first + i * spacing)), u, n);
    return out;
  }
  const ctr = mul(c.c, mm), r = c.r * mm;
  const sweep = c.a1 - c.a0;
  const count = hatchCount(r * sweep, spacing);
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
    case "datum": return datumPrims(sk, s, mm);
    case "note": return notePrims(s, mm);
    case "load":
    case "lineload":
    case "moment":
      return loadPrims(sk, s, mm);
    case "diagram": return diagramPrims(sk, s, mm);
  }
}

/** The middle of an arrow, a spring or a damper, in paper mm: where its name is measured from. */
export function arrowAnchor(sk: Sketch, e: Line | Arc, mm: number): V {
  // A spiral spring is wound about the start of its line.
  if (e.type === "line") return e.element === "spiral" ? P(sk, e.p1, mm) : mid(P(sk, e.p1, mm), P(sk, e.p2, mm));
  const { a0, a1 } = arcAngles(sk, e);
  return polar(P(sk, e.c, mm), arcRadius(sk, e) * mm, (a0 + a1) / 2);
}

/**
 * Centre of the name of an arrow, a spring or a damper in paper mm, or null
 * when it has none. With `always`, where the name would go even though there
 * is none yet.
 */
export function arrowLabelAt(sk: Sketch, e: Line | Arc, mm: number, always = false): V | null {
  const tex = labelTex(e.label ?? "");
  if (!isNamed(e) || (!tex && !always)) return null;
  const m = arrowAnchor(sk, e, mm);
  if (e.lx !== undefined && e.ly !== undefined) return [m[0] + e.lx, m[1] + e.ly];
  let n: V;
  if (e.type === "line" && e.element === "spiral") {
    // Outside the spiral, across from where its outer end is held.
    const a = P(sk, e.p1, mm), b = P(sk, e.p2, mm);
    n = len(sub(a, b)) < 1e-9 ? [0, 1] : norm(sub(a, b));
    const t = texEngine().measure(tex || "F");
    const reach = (Math.abs(n[0]) * t.w + Math.abs(n[1]) * (t.asc + t.desc)) * PAPER.em / 2;
    return add(m, mul(n, len(sub(a, b)) + reach + PAPER.textSep + 0.6));
  }
  if (e.type === "line") {
    // Beside the arrow, on its upper side.
    const a = P(sk, e.p1, mm), b = P(sk, e.p2, mm);
    n = len(sub(b, a)) < 1e-9 ? [0, 1] : perp(norm(sub(b, a)));
    if (n[1] < -1e-9 || (Math.abs(n[1]) <= 1e-9 && n[0] > 0)) n = mul(n, -1);
  } else {
    // Outside the arc.
    const c = P(sk, e.c, mm);
    n = len(sub(m, c)) < 1e-9 ? [0, 1] : norm(sub(m, c));
  }
  // Just clear of the stroke, or of the coils of a spring, however wide the name is.
  const t = texEngine().measure(tex || "F");
  const reach = (Math.abs(n[0]) * t.w + Math.abs(n[1]) * (t.asc + t.desc)) * PAPER.em / 2;
  return add(m, mul(n, reach + PAPER.textSep + 0.6 + elementReach(sk, e) * mm));
}

// ---- the list -------------------------------------------------------------

export interface BuildOptions {
  /** Construction geometry and hidden dimensions: on for the editor, off for exports. */
  editor: boolean;
}

export function buildPrims(sk: Sketch, mm: number, opts: BuildOptions): Prim[] {
  const out: Prim[] = [];
  // Fills lie under everything else, and so does the shading of a spread load: the line it is on is drawn over it.
  for (const sym of sk.symbols) {
    if (sym.type === "fill") out.push(...symbolPrims(sk, sym, mm));
    else if (sym.type === "lineload") out.push(...loadShade(sk, sym, mm));
    else if (sym.type === "diagram") out.push(...diagramShade(sk, sym, mm));
  }
  for (const e of sk.entities) {
    if (e.type === "point") continue;
    if (e.construction && !opts.editor) continue;
    const base: { ref: Id; layer: "geom"; stroke: StrokeStyle; width?: number; dash?: number[] } = { ref: e.id, layer: "geom", stroke: curveStroke(e) };
    if (e.weight !== undefined) base.width = e.weight * PT_MM;
    if (e.dashed && !e.construction) base.dash = DASHED;
    const named = isNamed(e) ? e : null;
    const name = (): void => {
      const at = named ? arrowLabelAt(sk, named, mm) : null;
      if (at) out.push({ ref: e.id, layer: "geom", k: "text", at, tex: labelTex(named?.label ?? ""), anchor: "c", part: "label" });
    };
    if (e.type !== "circle" && e.element && !e.construction) {
      // A spring or a damper: drawn in its place, from one end to the other.
      for (const run of elementPaths(sk, e)) out.push({ ...base, k: "path", pts: run.map((q): V => [q[0] * mm, q[1] * mm]) });
      name();
      continue;
    }
    const arrow = e.type !== "circle" && !e.construction ? e.arrow : undefined;
    // The head of a thicker arrow grows with it, though not as fast, so it still reads as a head.
    const head = PAPER.arrowScale * Math.sqrt(Math.max(1, (e.weight ?? 0) / standardWeight(e)));
    if (e.type === "line") {
      const line: LinePrim = { ...base, k: "line", a: P(sk, e.p1, mm), b: P(sk, e.p2, mm) };
      if (arrow) {
        line.head = head;
        if (arrow !== "end") line.arrowA = true;
        if (arrow !== "start") line.arrowB = true;
      }
      out.push(line);
      name();
    } else if (e.type === "circle") {
      out.push({ ...base, k: "circle", c: P(sk, e.c, mm), r: e.r * mm });
    } else {
      const { a0, a1 } = arcAngles(sk, e);
      const arc: ArcPrim = { ...base, k: "arc", c: P(sk, e.c, mm), r: arcRadius(sk, e) * mm, a0, a1 };
      if (arrow) {
        arc.head = head;
        if (arrow !== "end") arc.arrowA = true;
        if (arrow !== "start") arc.arrowB = true;
      }
      out.push(arc);
      name();
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

/** Outline of an arrowhead whose tip is at `tip`, pointing along `dir`. `scale` 1 is the size on dimensions. */
export function arrowHead(tip: V, dir: V, scale = 1): V[] {
  const u = norm(dir), n = perp(u);
  const length = PAPER.arrowLen * scale, width = PAPER.arrowWidth * scale;
  const back = sub(tip, mul(u, length));
  return [
    tip,
    add(back, mul(n, width / 2)),
    sub(tip, mul(u, length * 0.72)),
    sub(back, mul(n, width / 2)),
  ];
}

/**
 * The ends of a line primitive as they are stroked: an end under an arrowhead
 * stops inside the head, so the line's round cap does not blunt the tip.
 */
export function strokedEnds(p: LinePrim): [V, V] {
  const span = len(sub(p.b, p.a));
  const back = PAPER.arrowLen * (p.head ?? 1) * 0.6;
  if (span < 1e-9 || (!p.arrowA && !p.arrowB)) return [p.a, p.b];
  const u = norm(sub(p.b, p.a));
  const heads = (p.arrowA ? 1 : 0) + (p.arrowB ? 1 : 0);
  if (span <= back * heads) return [p.a, p.b];
  return [p.arrowA ? add(p.a, mul(u, back)) : p.a, p.arrowB ? sub(p.b, mul(u, back)) : p.b];
}

/** The same for an arc: the angles it is stroked between. */
export function strokedSweep(p: ArcPrim): [number, number] {
  const back = (PAPER.arrowLen * (p.head ?? 1) * 0.6) / Math.max(p.r, 1e-6);
  const heads = (p.arrowA ? 1 : 0) + (p.arrowB ? 1 : 0);
  if (!heads || p.a1 - p.a0 <= back * heads) return [p.a0, p.a1];
  return [p.arrowA ? p.a0 + back : p.a0, p.arrowB ? p.a1 - back : p.a1];
}

/** Arrowhead outlines for a line or arc primitive. */
export function arrowHeads(p: LinePrim | ArcPrim): V[][] {
  const heads: V[][] = [];
  if (p.k === "line") {
    if (len(sub(p.b, p.a)) < 1e-9) return heads;
    if (p.arrowA) heads.push(arrowHead(p.a, sub(p.a, p.b), p.head));
    if (p.arrowB) heads.push(arrowHead(p.b, sub(p.b, p.a), p.head));
    return heads;
  }
  // On an arc the head is turned by half the angle it spans, so it follows the curve.
  const lean = Math.min((PAPER.arrowLen * (p.head ?? 1)) / (2 * Math.max(p.r, 1e-6)), 0.6);
  if (p.arrowA) {
    const t = p.a0 + lean;
    heads.push(arrowHead(polar(p.c, p.r, p.a0), [Math.sin(t), -Math.cos(t)], p.head));
  }
  if (p.arrowB) {
    const t = p.a1 - lean;
    heads.push(arrowHead(polar(p.c, p.r, p.a1), [-Math.sin(t), Math.cos(t)], p.head));
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

/** Turns q about `about` by `rot` radians, counter-clockwise. */
function turn(q: V, about: V, rot: number): V {
  const c = Math.cos(rot), k = Math.sin(rot);
  const x = q[0] - about[0], y = q[1] - about[1];
  return [about[0] + x * c - y * k, about[1] + x * k + y * c];
}

/** The four corners of a text primitive on paper, with its rotation applied. */
export function textCorners(p: TextPrim): V[] {
  const b = textBox(p);
  const corners: V[] = [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]];
  return p.rot ? corners.map((q) => turn(q, p.at, p.rot!)) : corners;
}

/** Centre of a text primitive on paper, with its rotation applied. */
export function textCentre(p: TextPrim): V {
  const b = textBox(p);
  const c: V = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
  return p.rot ? turn(c, p.at, p.rot) : c;
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
    case "path": {
      let best = Infinity;
      for (let i = 1; i < p.pts.length; i++) best = Math.min(best, distToSegment(q, p.pts[i - 1], p.pts[i]));
      return best;
    }
    case "arc": {
      const ang = angleOf(sub(q, p.c));
      if (inSweep(ang, p.a0, p.a1)) return Math.abs(dist(q, p.c) - p.r);
      return Math.min(dist(q, polar(p.c, p.r, p.a0)), dist(q, polar(p.c, p.r, p.a1)));
    }
    case "text": {
      const b = textBox(p);
      if (p.rot) q = turn(q, p.at, -p.rot); // measure in the text's own frame
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

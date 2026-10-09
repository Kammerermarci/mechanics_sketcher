// The sketch document: geometry, constraints, dimensions and symbols.
// Coordinates are y-up, in unitless model units.

import { type Box, emptyBox, grow, boxIsEmpty, inSweep, polar, TWO_PI } from "./geom";

export type Id = string;

export interface Point {
  id: Id;
  type: "point";
  x: number;
  y: number;
  /** Placed with the Point tool, so it survives when nothing else uses it. */
  standalone?: boolean;
}
export interface Line {
  id: Id;
  type: "line";
  p1: Id;
  p2: Id;
  /** A helper: dashed in the editor and left out of the figure. */
  construction?: boolean;
  /** A centre line: thin dash-dot, and not an edge of any shape. */
  centre?: boolean;
  /** An arrow annotation: which end carries the head. p1 is the start, p2 the end. */
  arrow?: ArrowEnds;
  /** The arrow's name, as TeX math. */
  label?: string;
  /** Where the name sits, in annotation mm from the middle of the arrow. Unset: beside it. */
  lx?: number;
  ly?: number;
}
export type ArrowEnds = "end" | "start" | "both";
export interface Circle {
  id: Id;
  type: "circle";
  c: Id;
  r: number;
  /** A helper: dashed in the editor and left out of the figure. */
  construction?: boolean;
  /** A centre line: thin dash-dot, and not an edge of any shape. */
  centre?: boolean;
}
/** Counter-clockwise from p1 to p2 around c. */
export interface Arc {
  id: Id;
  type: "arc";
  c: Id;
  p1: Id;
  p2: Id;
  /** A helper: dashed in the editor and left out of the figure. */
  construction?: boolean;
  /** A centre line: thin dash-dot, and not an edge of any shape. */
  centre?: boolean;
  /** A curved arrow: which end carries the head. p1 is the start, p2 the end, counter-clockwise. */
  arrow?: ArrowEnds;
  /** The arrow's name, as TeX math. */
  label?: string;
  /** Where the name sits, in annotation mm from the middle of the arc. Unset: outside it. */
  lx?: number;
  ly?: number;
}
export type Entity = Point | Line | Circle | Arc;
export type Curve = Line | Circle | Arc;

export interface Coincident { id: Id; type: "coincident"; a: Id; b: Id }
export interface PointOn { id: Id; type: "pointOn"; p: Id; on: Id }
export interface Midpoint { id: Id; type: "midpoint"; p: Id; l: Id }
export interface Horizontal { id: Id; type: "horizontal"; a: Id; b: Id }
export interface Vertical { id: Id; type: "vertical"; a: Id; b: Id }
export interface Parallel { id: Id; type: "parallel"; l1: Id; l2: Id }
export interface Perpendicular { id: Id; type: "perpendicular"; l1: Id; l2: Id }
/** Equal length for two lines, equal radius for circles and arcs. */
export interface Equal { id: Id; type: "equal"; a: Id; b: Id }
export interface Tangent { id: Id; type: "tangent"; l: Id; c: Id }
export interface Fixed { id: Id; type: "fixed"; p: Id }

interface DimBase {
  id: Id;
  /** Driving value. Angles are in radians. */
  value: number;
  /** TeX shown instead of the number, e.g. "2a". Written without $ signs. */
  label?: string;
  /** Still drives the geometry, but is left out of the figure. */
  hidden?: boolean;
}
export type DistanceMode = "aligned" | "horizontal" | "vertical";
export interface DistanceDim extends DimBase {
  type: "distance";
  a: Id;
  b: Id;
  mode: DistanceMode;
  /** Where the dimension line sits, in model units from point a. Signed. */
  offset: number;
  /** Whether the text is turned to run along the dimension line. Unset: along for aligned, upright otherwise. */
  text?: "along" | "upright";
}
export interface AngleDim extends DimBase {
  type: "angle";
  l1: Id;
  /** Measure line 1 from p2 to p1 instead of p1 to p2. */
  rev1: boolean;
  l2: Id;
  rev2: boolean;
  /** Radius of the dimension arc, in model units. */
  radius: number;
}
export interface RadiusDim extends DimBase {
  type: "radius";
  target: Id;
  /** Direction of the leader, in radians. */
  angle: number;
  /** Drawn outside the circle, pointing in at the rim, instead of from the inside. */
  outside?: boolean;
  /** Length of the leader in model units. Unset: from the centre when inside, a standard length outside. */
  len?: number;
}
export type Dimension = DistanceDim | AngleDim | RadiusDim;
export type Relation =
  | Coincident | PointOn | Midpoint | Horizontal | Vertical | Parallel
  | Perpendicular | Equal | Tangent | Fixed;
export type Constraint = Relation | Dimension;

// Symbols are drawn on the figure but take no part in solving.

export type SupportKind = "pin" | "roller" | "fixed";
export interface Support {
  id: Id;
  type: "support";
  kind: SupportKind;
  /** The joint it carries. */
  at: Id;
  /** Rotation in radians, counter-clockwise. At 0 the ground is below the joint. */
  angle: number;
}
/** A pair of coordinate axes, placed anywhere as an annotation. */
export interface Frame {
  id: Id;
  type: "frame";
  /** A point it is pinned to. When absent it sits at x, y. */
  at?: Id;
  x: number;
  y: number;
  /** Direction of the first axis, in radians. */
  angle: number;
  /** TeX labels of the two axes; empty for none. */
  xLabel: string;
  yLabel: string;
  /** Length of each axis in annotation mm (see Sketch.dimScale). 0 leaves that axis out. */
  xSize: number;
  ySize: number;
}
/** Centre lines through a circle or arc. */
export interface CenterMark {
  id: Id;
  type: "centermark";
  on: Id;
  angle: number;
  /** Size of the cross, its gaps and the reach past the rim, against the standard mark. Unset: 1. */
  scale?: number;
}
export type LeaderEnd = "arrow" | "dot" | "none";
/** A circled number (or any TeX) with a leader, for naming parts. */
export interface Balloon {
  id: Id;
  type: "balloon";
  text: string;
  /** What the leader points at: a point, a spot on a curve, or the position x, y. */
  at?: Id;
  on?: Id;
  /** Where on the curve `on`: fraction along a line or arc, angle on a circle. */
  t?: number;
  x: number;
  y: number;
  /** Centre of the balloon relative to what it points at, in model units. */
  dx: number;
  dy: number;
  end: LeaderEnd;
  /** False leaves out the circle, so only the text and its leader are drawn. */
  circle?: boolean;
}
/** A closed region filled with a colour. */
export interface Fill {
  id: Id;
  type: "fill";
  /** CSS hex colour, e.g. "#d5dbe1". */
  color: string;
  /** Set when the region is one whole circle. */
  circle?: Id;
  /** Otherwise the corners of the region, in order around it. */
  points: Id[];
  /** For each corner, the arc that runs from it to the next corner; null for a straight side. */
  arcs: (Id | null)[];
  /** Every line and arc on the boundary; the fill goes when one of them does. */
  curves: Id[];
  /** Circles inside the region that are left unfilled. */
  holes: Id[];
}
/** Short slanted strokes along one side of a curve, like the ground under a support. */
export interface Hatch {
  id: Id;
  type: "hatch";
  on: Id;
  /** Which side of the curve, seen along its direction: 1 left, -1 right. */
  side: 1 | -1;
  /** Distance between strokes and how far they reach, in annotation mm. */
  spacing: number;
  depth: number;
  /** Which way the strokes lean along the curve: 1 back towards its start, -1 forwards. */
  lean?: 1 | -1;
}
/** A point marked with a coloured dot and a name, such as a joint called A. It is part of the figure. */
export interface Datum {
  id: Id;
  type: "datum";
  /** The point it marks. */
  at: Id;
  /** CSS hex colour of the dot. */
  color: string;
  /** Name as TeX math; empty for none. */
  label: string;
  /** Centre of the name relative to the point, in annotation mm. */
  dx: number;
  dy: number;
}
export type Sym = Support | Frame | CenterMark | Balloon | Fill | Hatch | Datum;

/** Everything a symbol needs to exist; it is removed when any of these is. */
export function symbolRefs(s: Sym): Id[] {
  switch (s.type) {
    case "support":
    case "datum":
      return [s.at];
    case "frame": return s.at ? [s.at] : [];
    case "centermark":
    case "hatch":
      return [s.on];
    case "balloon": return s.at ? [s.at] : s.on ? [s.on] : [];
    case "fill": return s.circle ? [s.circle] : [...s.points, ...s.curves];
  }
}

/**
 * Sizes come in two kinds. Geometry, and where a dimension or balloon sits,
 * is in model units. The size of what annotates it (text, arrowheads,
 * supports, the gaps of a dimension) is in "annotation mm": the size it has
 * on paper when dimScale is 1. While editing, annotations keep one size on
 * screen however far the view is zoomed; in print they are scaled by dimScale.
 */
export interface Sketch {
  version: 2;
  nextId: number;
  entities: Entity[];
  constraints: Constraint[];
  symbols: Sym[];
  /** Width of the drawn geometry in the exported figure, in mm. */
  figureWidthMm: number;
  /** How large annotations are in the exported figure: 1 gives 10 pt text, 2 twice that. */
  dimScale: number;
  /** Whether the editor draws axes at the origin. They are never exported. */
  showOrigin: boolean;
}

/**
 * The origin: a point at (0, 0) that every sketch has. It cannot move or be
 * deleted, so geometry can be constrained and dimensioned against it.
 */
export const ORIGIN: Id = "origin";

function originPoint(): Point {
  return { id: ORIGIN, type: "point", x: 0, y: 0, standalone: true };
}

export function emptySketch(): Sketch {
  return {
    version: 2, nextId: 1, entities: [originPoint()], constraints: [], symbols: [],
    figureWidthMm: 80, dimScale: 1, showOrigin: true,
  };
}

export function isDimension(c: Constraint): c is Dimension {
  return c.type === "distance" || c.type === "angle" || c.type === "radius";
}

const PREFIX: Record<string, string> = { point: "p", line: "l", circle: "c", arc: "a", symbol: "s" };

export function newId(sk: Sketch, kind: string): Id {
  return `${PREFIX[kind] ?? "k"}${sk.nextId++}`;
}

// ---- lookup -------------------------------------------------------------

export function entity(sk: Sketch, id: Id): Entity | undefined {
  return sk.entities.find((e) => e.id === id);
}
export function point(sk: Sketch, id: Id): Point {
  const e = entity(sk, id);
  if (!e || e.type !== "point") throw new Error(`no point ${id}`);
  return e;
}
export function constraint(sk: Sketch, id: Id): Constraint | undefined {
  return sk.constraints.find((c) => c.id === id);
}
export function symbol(sk: Sketch, id: Id): Sym | undefined {
  return sk.symbols.find((s) => s.id === id);
}
export function points(sk: Sketch): Point[] {
  return sk.entities.filter((e): e is Point => e.type === "point");
}
export function curves(sk: Sketch): Curve[] {
  return sk.entities.filter((e): e is Curve => e.type !== "point");
}

/** True for curves that form the shapes of the figure: not helpers, centre lines or arrows. */
export function isEdge(e: Curve): boolean {
  return !e.construction && !e.centre && !((e.type === "line" || e.type === "arc") && e.arrow);
}

/** Removes a point that no curve is built on any more, unless it was placed on purpose. */
export function dropIfUnused(sk: Sketch, pointId: Id): void {
  const p = entity(sk, pointId);
  if (!p || p.type !== "point" || p.standalone || pointId === ORIGIN) return;
  if (!pointInUse(sk, pointId)) remove(sk, [pointId]);
}

/** Ids of the points a curve is built on. */
export function curvePoints(e: Curve): Id[] {
  if (e.type === "line") return [e.p1, e.p2];
  if (e.type === "circle") return [e.c];
  return [e.c, e.p1, e.p2];
}

/** Every entity id a constraint refers to. */
export function constraintRefs(c: Constraint): Id[] {
  switch (c.type) {
    case "coincident":
    case "horizontal":
    case "vertical":
    case "equal":
      return [c.a, c.b];
    case "pointOn": return [c.p, c.on];
    case "midpoint": return [c.p, c.l];
    case "parallel":
    case "perpendicular":
      return [c.l1, c.l2];
    case "tangent": return [c.l, c.c];
    case "fixed": return [c.p];
    case "distance": return [c.a, c.b];
    case "angle": return [c.l1, c.l2];
    case "radius": return [c.target];
  }
}

export function isFixed(sk: Sketch, pointId: Id): boolean {
  return pointId === ORIGIN || sk.constraints.some((c) => c.type === "fixed" && c.p === pointId);
}

/** True when a line, circle or arc is built on the point. */
export function pointInUse(sk: Sketch, pointId: Id): boolean {
  return curves(sk).some((e) => curvePoints(e).includes(pointId));
}

export function arcRadius(sk: Sketch, a: Arc): number {
  const c = point(sk, a.c), s = point(sk, a.p1);
  return Math.hypot(s.x - c.x, s.y - c.y);
}

/** Start and end angle of an arc, with the end above the start. */
export function arcAngles(sk: Sketch, a: Arc): { a0: number; a1: number } {
  const c = point(sk, a.c), s = point(sk, a.p1), e = point(sk, a.p2);
  const a0 = Math.atan2(s.y - c.y, s.x - c.x);
  let a1 = Math.atan2(e.y - c.y, e.x - c.x);
  if (a1 <= a0) a1 += TWO_PI;
  return { a0, a1 };
}

/** Bounding box of the geometry in model units. Dimensions are not included. */
export function geometryBox(sk: Pick<Sketch, "entities">): Box {
  const all = sk as Sketch;
  const b = emptyBox();
  // The origin counts only when something is drawn from it.
  const originUsed = curves(all).some((c) => curvePoints(c).includes(ORIGIN));
  for (const e of sk.entities) {
    if (e.type === "point") {
      if (e.id !== ORIGIN || originUsed) grow(b, [e.x, e.y]);
    } else if (e.type === "circle") {
      const c = point(all, e.c);
      grow(b, [c.x, c.y], e.r);
    } else if (e.type === "arc") {
      const c = point(all, e.c);
      const r = arcRadius(all, e);
      const { a0, a1 } = arcAngles(all, e);
      for (let q = 0; q < 4; q++) {
        const ang = (q * Math.PI) / 2;
        if (inSweep(ang, a0, a1)) grow(b, polar([c.x, c.y], r, ang));
      }
    }
  }
  return b;
}

/**
 * How far the geometry reaches for the purpose of fitting it to a width: its
 * width, or for tall, narrow sketches part of its height, so a single
 * vertical member does not blow the scale up. 0 when there is nothing to fit.
 */
export function geometryExtent(sk: Pick<Sketch, "entities">): number {
  const b = geometryBox(sk);
  return boxIsEmpty(b) ? 0 : Math.max(b.x1 - b.x0, (b.y1 - b.y0) * 0.3);
}

// ---- editing ------------------------------------------------------------

export function addPoint(sk: Sketch, x: number, y: number, standalone = false): Point {
  const p: Point = { id: newId(sk, "point"), type: "point", x, y };
  if (standalone) p.standalone = true;
  sk.entities.push(p);
  return p;
}
export function addLine(sk: Sketch, p1: Id, p2: Id): Line {
  const l: Line = { id: newId(sk, "line"), type: "line", p1, p2 };
  sk.entities.push(l);
  return l;
}
export function addCircle(sk: Sketch, c: Id, r: number): Circle {
  const e: Circle = { id: newId(sk, "circle"), type: "circle", c, r };
  sk.entities.push(e);
  return e;
}
export function addArc(sk: Sketch, c: Id, p1: Id, p2: Id): Arc {
  const e: Arc = { id: newId(sk, "arc"), type: "arc", c, p1, p2 };
  sk.entities.push(e);
  return e;
}

export function addSupport(sk: Sketch, kind: SupportKind, at: Id, angle = 0): Support {
  const s: Support = { id: newId(sk, "symbol"), type: "support", kind, at, angle };
  sk.symbols.push(s);
  return s;
}
export function addFrame(sk: Sketch, x: number, y: number, at?: Id): Frame {
  const f: Frame = { id: newId(sk, "symbol"), type: "frame", x, y, angle: 0, xLabel: "x", yLabel: "y", xSize: 10, ySize: 10 };
  if (at) f.at = at;
  sk.symbols.push(f);
  return f;
}
type SymDraft<T> = T extends unknown ? Omit<T, "id"> : never;
/** Adds any symbol; the typed helpers above cover the common ones. */
export function addSymbol<T extends SymDraft<Sym>>(sk: Sketch, draft: T): Extract<Sym, { type: T["type"] }> {
  const full = { ...draft, id: newId(sk, "symbol") } as unknown as Extract<Sym, { type: T["type"] }>;
  sk.symbols.push(full);
  return full;
}

type Draft<T> = T extends unknown ? Omit<T, "id"> : never;
/** A constraint before it has been given an id. */
export type ConstraintDraft = Draft<Constraint>;

export function addConstraint<T extends ConstraintDraft>(sk: Sketch, c: T): Extract<Constraint, { type: T["type"] }> {
  const full = { ...c, id: newId(sk, "constraint") } as unknown as Extract<Constraint, { type: T["type"] }>;
  sk.constraints.push(full);
  return full;
}

/**
 * Removes entities, constraints and symbols by id. Curves built on a removed
 * point go with it, points left with nothing attached are cleaned up, and
 * constraints and symbols that lost something they refer to are dropped. The
 * origin always stays.
 */
export function remove(sk: Sketch, ids: Iterable<Id>): void {
  const gone = new Set(ids);
  gone.delete(ORIGIN);
  sk.constraints = sk.constraints.filter((c) => !gone.has(c.id));
  sk.symbols = sk.symbols.filter((s) => !gone.has(s.id));

  // Points that curves were using before this delete; candidates for cleanup.
  const candidates = new Set<Id>();
  for (const e of curves(sk)) {
    const pts = curvePoints(e);
    if (gone.has(e.id) || pts.some((p) => gone.has(p))) {
      gone.add(e.id);
      pts.forEach((p) => candidates.add(p));
    }
  }
  sk.entities = sk.entities.filter((e) => !gone.has(e.id));

  const used = new Set<Id>();
  for (const e of curves(sk)) curvePoints(e).forEach((p) => used.add(p));
  const orphans = new Set<Id>();
  for (const id of candidates) {
    const p = entity(sk, id);
    if (p && p.type === "point" && !p.standalone && !used.has(id)) orphans.add(id);
  }
  sk.entities = sk.entities.filter((e) => !orphans.has(e.id));

  const alive = new Set(sk.entities.map((e) => e.id));
  sk.constraints = sk.constraints.filter((c) => constraintRefs(c).every((r) => alive.has(r)));
  sk.symbols = sk.symbols.filter((s) => symbolRefs(s).every((r) => alive.has(r)));
  for (const s of sk.symbols) if (s.type === "fill") s.holes = s.holes.filter((h) => alive.has(h));
}

// ---- files --------------------------------------------------------------

export function serialize(sk: Sketch): string {
  return JSON.stringify(sk, null, 1);
}

/** Brings a symbol saved by an earlier build up to the current shape. */
function upgradeSymbol(s: Sym): Sym {
  if (s.type === "frame" && s.xSize === undefined) {
    const { size, ...rest } = s as Frame & { size?: number };
    return { ...rest, xSize: size ?? 10, ySize: size ?? 10 };
  }
  return s;
}

/** A sketch as saved by the first file format, where placements were in paper mm. */
interface SketchV1 {
  version: 1;
  nextId?: number;
  entities: Entity[];
  constraints: Constraint[];
  symbols?: Sym[];
  figureWidthMm?: number;
  scaleMode?: "width" | "fixed";
  mmPerUnit?: number;
  showOrigin?: boolean;
}

/**
 * Brings a version 1 sketch up to date. It kept where dimensions and
 * balloons sit in paper millimetres, at a paper scale that was either set
 * or followed from a figure width. Those placements become model units, at
 * the scale the sketch had, so the figure prints as it did.
 */
function upgradeV1(raw: SketchV1, entities: Entity[]): Pick<Sketch, "constraints" | "symbols" | "figureWidthMm"> {
  const extent = geometryExtent({ entities });
  let width = raw.figureWidthMm && raw.figureWidthMm > 0 ? raw.figureWidthMm : 80;
  let mm = extent > 1e-9 ? width / extent : 10;
  if (raw.scaleMode === "fixed" && raw.mmPerUnit && raw.mmPerUnit > 0) {
    mm = raw.mmPerUnit;
    if (extent > 1e-9) width = Math.max(10, Math.min(1000, extent * mm));
  }
  const constraints = raw.constraints.map((c): Constraint => {
    if (c.type === "distance") return { ...c, offset: c.offset / mm };
    if (c.type === "angle") return { ...c, radius: c.radius / mm };
    if (c.type === "radius" && c.len !== undefined) return { ...c, len: c.len / mm };
    return c;
  });
  const symbols = (Array.isArray(raw.symbols) ? raw.symbols : []).map((s): Sym =>
    s.type === "balloon" ? { ...s, dx: s.dx / mm, dy: s.dy / mm } : s);
  return { constraints, symbols, figureWidthMm: width };
}

export function deserialize(text: string): Sketch {
  const raw = JSON.parse(text) as Partial<Sketch> | SketchV1;
  if ((raw.version !== 1 && raw.version !== 2) || !Array.isArray(raw.entities) || !Array.isArray(raw.constraints)) {
    throw new Error("This file is not a sketch saved by this tool.");
  }
  // Files from before the origin existed get one.
  const entities = raw.entities.some((e) => e.id === ORIGIN) ? raw.entities : [originPoint(), ...raw.entities];
  const body = raw.version === 1
    ? upgradeV1(raw, entities)
    : {
      constraints: raw.constraints,
      symbols: Array.isArray(raw.symbols) ? raw.symbols : [],
      figureWidthMm: raw.figureWidthMm && raw.figureWidthMm > 0 ? raw.figureWidthMm : 80,
    };
  const dimScale = raw.version === 2 && raw.dimScale && raw.dimScale > 0 ? raw.dimScale : 1;
  return {
    version: 2,
    nextId: raw.nextId ?? 1,
    entities,
    constraints: body.constraints,
    symbols: body.symbols.map(upgradeSymbol),
    figureWidthMm: body.figureWidthMm,
    dimScale,
    showOrigin: raw.showOrigin ?? true,
  };
}

export function clone(sk: Sketch): Sketch {
  return structuredClone(sk);
}

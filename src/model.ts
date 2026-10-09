// The sketch document: geometry, constraints, dimensions and symbols.
// Coordinates are y-up, in unitless model units.

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
}
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
  /** Where the dimension line sits, in paper mm from point a. Signed. */
  offset: number;
}
export interface AngleDim extends DimBase {
  type: "angle";
  l1: Id;
  /** Measure line 1 from p2 to p1 instead of p1 to p2. */
  rev1: boolean;
  l2: Id;
  rev2: boolean;
  /** Radius of the dimension arc, in paper mm. */
  radius: number;
}
export interface RadiusDim extends DimBase {
  type: "radius";
  target: Id;
  /** Direction of the leader, in radians. */
  angle: number;
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
  /** Length of each axis on paper, in mm. 0 leaves that axis out. */
  xSize: number;
  ySize: number;
}
/** Centre lines through a circle or arc. */
export interface CenterMark {
  id: Id;
  type: "centermark";
  on: Id;
  angle: number;
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
  /** Centre of the balloon relative to what it points at, in paper mm. */
  dx: number;
  dy: number;
  end: LeaderEnd;
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
  /** Distance between strokes and how far they reach, in paper mm. */
  spacing: number;
  depth: number;
}
export type Sym = Support | Frame | CenterMark | Balloon | Fill | Hatch;

/** Everything a symbol needs to exist; it is removed when any of these is. */
export function symbolRefs(s: Sym): Id[] {
  switch (s.type) {
    case "support": return [s.at];
    case "frame": return s.at ? [s.at] : [];
    case "centermark":
    case "hatch":
      return [s.on];
    case "balloon": return s.at ? [s.at] : s.on ? [s.on] : [];
    case "fill": return s.circle ? [s.circle] : [...s.points, ...s.curves];
  }
}

/** How the paper scale is chosen: fit a set width, or stay at a set scale. */
export type ScaleMode = "width" | "fixed";

export interface Sketch {
  version: 1;
  nextId: number;
  entities: Entity[];
  constraints: Constraint[];
  symbols: Sym[];
  /** Width of the drawn geometry on paper, in mm. Used when scaleMode is "width". */
  figureWidthMm: number;
  /** "width": the scale follows the drawing so it stays figureWidthMm wide. "fixed": it stays at mmPerUnit. */
  scaleMode: ScaleMode;
  /** Paper mm per model unit. Used when scaleMode is "fixed". */
  mmPerUnit: number;
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
    version: 1, nextId: 1, entities: [originPoint()], constraints: [], symbols: [],
    figureWidthMm: 80, scaleMode: "width", mmPerUnit: 10, showOrigin: true,
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

/** True for curves that form the shapes of the figure: not helpers, not centre lines. */
export function isEdge(e: Curve): boolean {
  return !e.construction && !e.centre;
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

export function deserialize(text: string): Sketch {
  const raw = JSON.parse(text) as Partial<Sketch>;
  if (raw.version !== 1 || !Array.isArray(raw.entities) || !Array.isArray(raw.constraints)) {
    throw new Error("This file is not a sketch saved by this tool.");
  }
  // Files from before the origin existed get one.
  const entities = raw.entities.some((e) => e.id === ORIGIN) ? raw.entities : [originPoint(), ...raw.entities];
  return {
    version: 1,
    nextId: raw.nextId ?? 1,
    entities,
    constraints: raw.constraints,
    symbols: (Array.isArray(raw.symbols) ? raw.symbols : []).map(upgradeSymbol),
    figureWidthMm: raw.figureWidthMm ?? 80,
    scaleMode: raw.scaleMode === "fixed" ? "fixed" : "width",
    mmPerUnit: raw.mmPerUnit && raw.mmPerUnit > 0 ? raw.mmPerUnit : 10,
    showOrigin: raw.showOrigin ?? true,
  };
}

export function clone(sk: Sketch): Sketch {
  return structuredClone(sk);
}

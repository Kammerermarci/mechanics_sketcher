// The sketch document: geometry, constraints and dimensions.
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
  construction?: boolean;
}
export interface Circle {
  id: Id;
  type: "circle";
  c: Id;
  r: number;
  construction?: boolean;
}
/** Counter-clockwise from p1 to p2 around c. */
export interface Arc {
  id: Id;
  type: "arc";
  c: Id;
  p1: Id;
  p2: Id;
  construction?: boolean;
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

export interface Sketch {
  version: 1;
  nextId: number;
  entities: Entity[];
  constraints: Constraint[];
  /** Width of the drawn geometry on paper, in mm. */
  figureWidthMm: number;
}

export function emptySketch(): Sketch {
  return { version: 1, nextId: 1, entities: [], constraints: [], figureWidthMm: 80 };
}

export function isDimension(c: Constraint): c is Dimension {
  return c.type === "distance" || c.type === "angle" || c.type === "radius";
}

const PREFIX: Record<string, string> = { point: "p", line: "l", circle: "c", arc: "a" };

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
export function points(sk: Sketch): Point[] {
  return sk.entities.filter((e): e is Point => e.type === "point");
}
export function curves(sk: Sketch): Curve[] {
  return sk.entities.filter((e): e is Curve => e.type !== "point");
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
  return sk.constraints.some((c) => c.type === "fixed" && c.p === pointId);
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

type Draft<T> = T extends unknown ? Omit<T, "id"> : never;
/** A constraint before it has been given an id. */
export type ConstraintDraft = Draft<Constraint>;

export function addConstraint<T extends ConstraintDraft>(sk: Sketch, c: T): Extract<Constraint, { type: T["type"] }> {
  const full = { ...c, id: newId(sk, "constraint") } as unknown as Extract<Constraint, { type: T["type"] }>;
  sk.constraints.push(full);
  return full;
}

/**
 * Removes entities and constraints by id. Curves built on a removed point go
 * with it, points left with nothing attached are cleaned up, and constraints
 * that lost something they refer to are dropped.
 */
export function remove(sk: Sketch, ids: Iterable<Id>): void {
  const gone = new Set(ids);
  sk.constraints = sk.constraints.filter((c) => !gone.has(c.id));

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
}

// ---- files --------------------------------------------------------------

export function serialize(sk: Sketch): string {
  return JSON.stringify(sk, null, 1);
}

export function deserialize(text: string): Sketch {
  const raw = JSON.parse(text) as Partial<Sketch>;
  if (raw.version !== 1 || !Array.isArray(raw.entities) || !Array.isArray(raw.constraints)) {
    throw new Error("This file is not a sketch saved by this tool.");
  }
  return {
    version: 1,
    nextId: raw.nextId ?? 1,
    entities: raw.entities,
    constraints: raw.constraints,
    figureWidthMm: raw.figureWidthMm ?? 80,
  };
}

export function clone(sk: Sketch): Sketch {
  return structuredClone(sk);
}

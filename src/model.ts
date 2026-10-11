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
  /** Line thickness in points, at a dimension size of 100%. Unset: the standard thickness for how it is drawn. */
  weight?: number;
  /** Drawn with dashes: an edge that is hidden, or a second position of a part. */
  dashed?: boolean;
  /** An arrow annotation: which end carries the head. p1 is the start, p2 the end. */
  arrow?: ArrowEnds;
  /** An arrow that starts from a short bar across it: a coordinate, measured from there. */
  tail?: boolean;
  /**
   * Drawn as a machine element between its two points instead of as a line:
   * a spring, a damper, or a spiral spring wound about p1 whose outer end is p2.
   */
  element?: LineElement;
  /** How an element is drawn; see ElementLook. */
  look?: ElementLook;
  /** The name of the arrow or the element, as TeX math. */
  label?: string;
  /** Where the name sits, in annotation mm from the middle of the arrow or element. Unset: beside it. */
  lx?: number;
  ly?: number;
}
export type ArrowEnds = "end" | "start" | "both";
export type LineElement = "spring" | "damper" | "spiral";
export type ArcElement = "spring" | "damper";
/**
 * How a spring or a damper is drawn. Its sizes are in model units: it is
 * part of the drawing, so it looks the same however far the view is zoomed,
 * and a spring that is pulled longer gets more turns, not wider ones.
 */
export interface ElementLook {
  /** How wide it is across: the zigzag or the coils of a spring, the cylinder of a damper. */
  across: number;
  /** A spring: how far apart its turns are. A spiral spring: how far apart its windings are. */
  pitch: number;
  /** A spring drawn as the loops of a coil. Unset: a zigzag. */
  coil?: boolean;
  /** A damper: the cylinder is at the start, not the end. A spiral spring: wound clockwise on its way out. */
  flip?: boolean;
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
  /** Line thickness in points, at a dimension size of 100%. Unset: the standard thickness for how it is drawn. */
  weight?: number;
  /** Drawn with dashes. */
  dashed?: boolean;
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
  /** Line thickness in points, at a dimension size of 100%. Unset: the standard thickness for how it is drawn. */
  weight?: number;
  /** Drawn with dashes. */
  dashed?: boolean;
  /** A curved arrow: which end carries the head. p1 is the start, p2 the end, counter-clockwise. */
  arrow?: ArrowEnds;
  /** An arrow that starts from a short bar across it: an angle, measured from there. */
  tail?: boolean;
  /** Drawn as a spring or a damper bent round its centre, as one that resists turning is. */
  element?: ArcElement;
  look?: ElementLook;
  /** The name of the arrow or the element, as TeX math. */
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
/** A line touching a circle or arc; or, with a circle or arc in the place of the line, two of those touching each other. */
export interface Tangent { id: Id; type: "tangent"; l: Id; c: Id }
export interface Fixed { id: Id; type: "fixed"; p: Id }

/**
 * A point of the original and its image under a mirror, a shift or a turn.
 * In a pattern, `steps` says which copy the image belongs to: the second copy
 * is two steps from the original. Unset: one.
 */
export type Pair = [from: Id, to: Id, steps?: number];
/**
 * A pair that is held by one equation only. Its image is an end (or the
 * centre) of a copied arc, and the arc already ties that point down but for
 * one direction; a second equation would say the same thing twice.
 */
export interface HalfPair { from: Id; to: Id; arc: Id; role: "end" | "centre"; steps?: number }
/**
 * Links hold copies to what they were copied from. One link covers a whole
 * mirror image or pattern: `pairs` are its points, `circles` the circles kept
 * at the radius of the original. Every copy is tied to the original itself,
 * so deleting one copy leaves the others as they were.
 */
interface LinkBase {
  id: Id;
  pairs: Pair[];
  half: HalfPair[];
  circles: Pair[];
}
/** Each image is the mirror image of its point in line l. */
export interface Mirror extends LinkBase { type: "mirror"; l: Id }
/** Each image is its point moved by its number of steps, the same step for every pair. The step itself is free. */
export interface Shift extends LinkBase { type: "shift" }
/** Each image is its point turned about c by `angle` radians, counter-clockwise, once for each of its steps. */
export interface Turn extends LinkBase { type: "turn"; c: Id; angle: number }
export type Link = Mirror | Shift | Turn;

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
  | Perpendicular | Equal | Tangent | Fixed | Link;
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
  /** Length of each axis in model units, like the geometry it sits in. 0 leaves that axis out. */
  xSize: number;
  ySize: number;
}
/** Centre lines through a circle or arc. */
export interface CenterMark {
  id: Id;
  type: "centermark";
  on: Id;
  angle: number;
  /** Size of the short dashes, the gaps and the reach past the rim, against the standard mark. Unset: 1. */
  scale?: number;
  /**
   * How many gaps each of its two lines has. The lines are drawn like a centre
   * line, long and short dashes in turn, so this is even: 2 gives the classic
   * mark with one short dash at the centre. Unset: 2.
   */
  gaps?: number;
  /** Drawn as two unbroken lines instead. */
  solid?: boolean;
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
  /** What is drawn around the text. Unset: a circle. */
  frame?: BalloonFrame;
}
/** A circle or a box around a balloon's text, a line under it, or nothing at all. */
export type BalloonFrame = "circle" | "box" | "underline" | "none";
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
  /** Distance between strokes and how far they reach, in model units: the hatching belongs to the drawing. */
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
  /** Drawn as the mark of a centre of mass: a circle in quarters, two of them filled. Unset: a dot. */
  mass?: boolean;
}
/** Text placed freely on the figure. */
export interface Note {
  id: Id;
  type: "note";
  /** Where the text starts: the middle of its left edge, in model units. */
  x: number;
  y: number;
  /** As typed: plain text, with $...$ for math and \\ between lines. */
  text: string;
}
/**
 * A force on a point, drawn as an arrow. How long the arrow is follows the
 * magnitude, at the scale the sketch keeps for forces.
 */
export interface Load {
  id: Id;
  type: "load";
  /** The point it acts on. */
  at: Id;
  /** Which way it acts, in radians. */
  angle: number;
  /** Its magnitude: what its length is worked out from. Not negative. */
  value: number;
  /** Name as TeX math; empty for none. */
  label: string;
  /** CSS hex colour of the arrow and its name. */
  color: string;
  /** Drawn leaving the point, as a pull. Unset: arriving at it, as a push. */
  pull?: boolean;
  /** How far the name has been moved from where it is put by default, in annotation mm. */
  dx?: number;
  dy?: number;
}
/**
 * A load spread along a line: a row of arrows under a straight envelope,
 * growing from magnitude q1 at one end of its span to q2 at the other.
 */
export interface LineLoad {
  id: Id;
  type: "lineload";
  on: Id;
  /** Where along the line it starts and ends, as fractions of the line from its first point. */
  t0: number;
  t1: number;
  q1: number;
  q2: number;
  /** Which side of the line it is drawn on, seen along the line: 1 left, -1 right. */
  side: 1 | -1;
  /** Which way the arrows point, in radians, for a load that is not square to the line (weight on a slope, say). Unset: square to the line. */
  angle?: number;
  /** The arrows leave the line. Unset: they arrive at it. */
  pull?: boolean;
  /** How many arrows it is drawn with. */
  count: number;
  /** Drawn without the shading between the line and the envelope. */
  plain?: boolean;
  label: string;
  color: string;
  dx?: number;
  dy?: number;
}
/** A moment about a point: an arc with a head, whose radius follows the magnitude. */
export interface Moment {
  id: Id;
  type: "moment";
  at: Id;
  value: number;
  /** Turning clockwise. Unset: counter-clockwise. */
  cw?: boolean;
  /** Where the arc starts, in radians. It runs three quarters of the way round from there. */
  angle: number;
  label: string;
  color: string;
  dx?: number;
  dy?: number;
}
/**
 * A plot laid along a member, as an internal force diagram is drawn: the
 * plot's horizontal axis runs along a line, an arc or the middle of a beam,
 * and the values of its functions are set off square to it. It stays tied to
 * the plot: change a function there and the diagram follows.
 */
export interface Diagram {
  id: Id;
  type: "diagram";
  /** The plot whose functions it draws. */
  plot: Id;
  /** The line or arc it was put on. */
  on: Id;
  /**
   * Set when that curve is a side of a beam and the diagram is drawn along
   * the middle of the beam instead: the centres of the beam's two ends, and
   * of its bend when it is curved (it then runs counter-clockwise from a to b).
   */
  axis?: { a: Id; b: Id; o?: Id };
  /** Where along the member it starts and ends, as fractions of it from its start. */
  t0: number;
  t1: number;
  /** The plot's axis runs from the far end of the member back towards its start. */
  back?: boolean;
  /** Which side positive values are drawn on, seen along the member: 1 left, -1 right. */
  side: 1 | -1;
  /** How far a value of one is set off from the member, in model units. */
  scale: number;
  /** Drawn without the shading between the member and the curves. */
  plain?: boolean;
  /** How many strokes are drawn from the member to the curves, square to it. Unset: none. */
  strokes?: number;
  /** The values at the ends, the jumps and the peaks are written beside the curves. */
  values?: boolean;
  /** Each curve is closed down to the member at its two ends. Unset: it ends at the value it has there. */
  closed?: boolean;
}
export type AnyLoad = Load | LineLoad | Moment;
/** Which scale a load is drawn at: forces, loads along a line and moments are different quantities. */
export type LoadKind = "force" | "line" | "moment";
export const loadKind = (s: AnyLoad): LoadKind => (s.type === "load" ? "force" : s.type === "lineload" ? "line" : "moment");
export const isLoad = (s: Sym): s is AnyLoad => s.type === "load" || s.type === "lineload" || s.type === "moment";

export type Sym = Support | Frame | CenterMark | Balloon | Fill | Hatch | Datum | Note | AnyLoad | Diagram;

/** Everything a symbol needs to exist; it is removed when any of these is. */
export function symbolRefs(s: Sym): Id[] {
  switch (s.type) {
    case "support":
    case "datum":
    case "load":
    case "moment":
      return [s.at];
    case "lineload": return [s.on];
    case "diagram": return s.axis ? [s.on, s.axis.a, s.axis.b, ...(s.axis.o ? [s.axis.o] : [])] : [s.on];
    case "frame": return s.at ? [s.at] : [];
    case "note": return [];
    case "centermark":
    case "hatch":
      return [s.on];
    case "balloon": return s.at ? [s.at] : s.on ? [s.on] : [];
    case "fill": return s.circle ? [s.circle] : [...s.points, ...s.curves];
  }
}

/**
 * Sizes come in two kinds. Geometry, where a dimension or balloon sits, how
 * long a pair of axes is and how hatching is spaced are in model units. The size of what annotates it (text, arrowheads,
 * supports, the gaps of a dimension) is in "annotation mm": the size it has
 * on paper when dimScale is 1. While editing, annotations keep one size on
 * screen however far the view is zoomed; in print they are scaled by dimScale.
 */
export interface Sketch {
  version: 4;
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
  /**
   * How large loads are drawn: model units of arrow length (or of radius, for
   * a moment) per unit of magnitude. Each kind gets its scale when the first
   * load of that kind is placed.
   */
  loadScale?: Partial<Record<LoadKind, number>>;
  /** How large supports are drawn, against their standard size. It scales the supports and nothing else. Unset: 1. */
  supportScale?: number;
  /** The plots kept with the sketch. */
  plots?: Plot[];
}

// ---- plots ------------------------------------------------------------------

/** One stretch of a plotted function: its formula, and where along the horizontal axis it holds. No end given: as far as the plot goes. */
export interface PlotPiece { expr: string; from?: number; to?: number }
export type PlotDash = "dashed" | "dotted";
/** A function drawn in a plot, in one piece or several, as an internal force diagram is. */
export interface PlotCurve {
  id: Id;
  pieces: PlotPiece[];
  color: string;
  /** Line thickness in points. Unset: that of a member. */
  weight?: number;
  /** Unset: a solid line. */
  dash?: PlotDash;
  /** False leaves a jump between two pieces open; otherwise it is drawn as an upright line. */
  join?: boolean;
  /** The area between the curve and the horizontal axis is shaded. */
  fill?: boolean;
  /** Its name, written as TeX math, and where the middle of the name sits in the plot's own coordinates. Unset: beside the curve. */
  label?: string;
  lx?: number;
  ly?: number;
}
export interface PlotAxis {
  min: number;
  max: number;
  /** Written as TeX math. */
  label: string;
  /** Distance between ticks. Unset: chosen to suit the size of the plot. */
  step?: number;
}
/** A plot of functions: a figure of its own beside the sketch, with its size on paper in mm. */
export interface Plot {
  id: Id;
  name: string;
  curves: PlotCurve[];
  x: PlotAxis;
  y: PlotAxis;
  width: number;
  height: number;
  /** Unset: arrowed axes through the origin. */
  frame?: "box";
  grid?: "lines" | "dots";
  /** Unset: tick marks with their numbers. */
  ticks?: "marks" | "none";
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
    version: 4, nextId: 1, entities: [originPoint()], constraints: [], symbols: [],
    figureWidthMm: 80, dimScale: 1, showOrigin: true,
  };
}

export function isDimension(c: Constraint): c is Dimension {
  return c.type === "distance" || c.type === "angle" || c.type === "radius";
}
export function isLink(c: Constraint): c is Link {
  return c.type === "mirror" || c.type === "shift" || c.type === "turn";
}

const PREFIX: Record<string, string> = { point: "p", line: "l", circle: "c", arc: "a", symbol: "s", plot: "g", curve: "f" };

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

/** True for a line or arc that carries a name of its own: an arrow, a spring, a damper. */
export function isNamed(e: Entity | undefined): e is Line | Arc {
  return !!e && (e.type === "line" || e.type === "arc") && !!(e.arrow || e.element);
}

/** True for curves that form the shapes of the figure: not helpers, centre lines, arrows, springs or dampers. */
export function isEdge(e: Curve): boolean {
  return !e.construction && !e.centre && !isNamed(e);
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
    case "mirror":
    case "shift":
    case "turn": {
      const ids = new Set<Id>();
      if (c.type === "mirror") ids.add(c.l);
      if (c.type === "turn") ids.add(c.c);
      for (const [a, b] of c.pairs) ids.add(a).add(b);
      for (const h of c.half) ids.add(h.from).add(h.to);
      for (const [a, b] of c.circles) ids.add(a).add(b);
      return [...ids];
    }
  }
}

/**
 * A link after some of what it refers to has gone: the pairs that are still
 * whole, or null when nothing is left for it to hold.
 */
function pruneLink(c: Link, alive: Set<Id>): Link | null {
  if (c.type === "mirror" && !alive.has(c.l)) return null;
  if (c.type === "turn" && !alive.has(c.c)) return null;
  const pairs = c.pairs.filter(([a, b]) => alive.has(a) && alive.has(b));
  const half: HalfPair[] = [];
  for (const h of c.half) {
    if (!alive.has(h.from) || !alive.has(h.to)) continue;
    // Without its arc the image is an ordinary point again, and needs both equations.
    if (alive.has(h.arc)) half.push(h);
    else pairs.push(h.steps === undefined ? [h.from, h.to] : [h.from, h.to, h.steps]);
  }
  const circles = c.circles.filter(([a, b]) => alive.has(a) && alive.has(b));
  if (!pairs.length && !half.length && !circles.length) return null;
  return { ...c, pairs, half, circles };
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
export function addFrame(sk: Sketch, x: number, y: number, at?: Id, size = 1): Frame {
  const f: Frame = { id: newId(sk, "symbol"), type: "frame", x, y, angle: 0, xLabel: "x", yLabel: "y", xSize: size, ySize: size };
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
  // A link lives on with the pairs it has left; any other constraint needs everything it names.
  sk.constraints = sk.constraints.flatMap((c): Constraint[] => {
    if (isLink(c)) {
      const kept = pruneLink(c, alive);
      return kept ? [kept] : [];
    }
    return constraintRefs(c).every((r) => alive.has(r)) ? [c] : [];
  });
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
  // A balloon used to have its circle or not; now that is one of several frames.
  if (s.type === "balloon" && "circle" in s) {
    const { circle, ...rest } = s as Balloon & { circle?: boolean };
    return circle === false ? { ...rest, frame: "none" } : rest;
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
 * Sizes that used to be kept in annotation mm and now belong to the drawing
 * become model units, at `mm` per unit: axis lengths (up to version 2) and
 * the spacing and reach of hatching (up to version 3).
 */
function sizesToModel(symbols: Sym[], mm: number, what: { axes: boolean }): Sym[] {
  return symbols.map((s): Sym => {
    if (s.type === "frame" && what.axes) return { ...s, xSize: s.xSize / mm, ySize: s.ySize / mm };
    if (s.type === "hatch") return { ...s, spacing: s.spacing / mm, depth: s.depth / mm };
    return s;
  });
}

/**
 * Brings a version 1 sketch up to date. It kept where dimensions and
 * balloons sit, and how long axes are, in paper millimetres, at a paper
 * scale that was either set or followed from a figure width. Those become
 * model units, at the scale the sketch had, so the figure prints as it did.
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
  const symbols = (Array.isArray(raw.symbols) ? raw.symbols : []).map(upgradeSymbol).map((s): Sym =>
    s.type === "balloon" ? { ...s, dx: s.dx / mm, dy: s.dy / mm } : s);
  return { constraints, symbols: sizesToModel(symbols, mm, { axes: true }), figureWidthMm: width };
}

/** True for something that has the shape of a plot, so a damaged file cannot bring in one that will not draw. */
function isPlot(p: Plot): boolean {
  const axis = (a: PlotAxis) => !!a && Number.isFinite(a.min) && Number.isFinite(a.max) && a.max > a.min && typeof a.label === "string";
  return !!p && typeof p.id === "string" && Array.isArray(p.curves) && axis(p.x) && axis(p.y) && p.width > 0 && p.height > 0 &&
    p.curves.every((c) => !!c && typeof c.id === "string" && Array.isArray(c.pieces) && c.pieces.every((x) => !!x && typeof x.expr === "string"));
}

export function deserialize(text: string): Sketch {
  const raw = JSON.parse(text) as (Omit<Partial<Sketch>, "version"> & { version: 2 | 3 | 4 }) | SketchV1;
  if (![1, 2, 3, 4].includes(raw.version) || !Array.isArray(raw.entities) || !Array.isArray(raw.constraints)) {
    throw new Error("This file is not a sketch saved by this tool.");
  }
  // Files from before the origin existed get one.
  const entities = raw.entities.some((e) => e.id === ORIGIN) ? raw.entities : [originPoint(), ...raw.entities];
  if (raw.version === 1) {
    return { version: 4, nextId: raw.nextId ?? 1, entities, ...upgradeV1(raw, entities), dimScale: 1, showOrigin: raw.showOrigin ?? true };
  }
  const figureWidthMm = raw.figureWidthMm && raw.figureWidthMm > 0 ? raw.figureWidthMm : 80;
  const dimScale = raw.dimScale && raw.dimScale > 0 ? raw.dimScale : 1;
  let symbols = (Array.isArray(raw.symbols) ? raw.symbols : []).map(upgradeSymbol);
  if (raw.version < 4) {
    // At the scale the figure printed at, so axes and hatching print as they did.
    const extent = geometryExtent({ entities });
    symbols = sizesToModel(symbols, extent > 1e-9 ? figureWidthMm / dimScale / extent : 10, { axes: raw.version === 2 });
  }
  const plots = Array.isArray(raw.plots) ? raw.plots.filter(isPlot) : [];
  // A diagram is a plot laid along a member: without its plot there is nothing to lay.
  symbols = symbols.filter((s) => s.type !== "diagram" || plots.some((p) => p.id === s.plot));
  return {
    version: 4,
    nextId: raw.nextId ?? 1,
    entities,
    constraints: raw.constraints,
    symbols,
    figureWidthMm,
    dimScale,
    showOrigin: raw.showOrigin ?? true,
    ...(raw.loadScale && typeof raw.loadScale === "object" ? { loadScale: raw.loadScale } : {}),
    ...(typeof raw.supportScale === "number" && raw.supportScale > 0 ? { supportScale: raw.supportScale } : {}),
    ...(plots.length ? { plots } : {}),
  };
}

export function clone(sk: Sketch): Sketch {
  return structuredClone(sk);
}

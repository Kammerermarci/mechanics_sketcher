// Mirror images and patterns: copies of geometry that stay tied to what they
// were made from. A copy is ordinary geometry; one link constraint per mirror
// or pattern holds every copied point where its original puts it.

import {
  type Sketch, type Id, type Curve, type Arc, type Sym, type Link, type Pair, type HalfPair, type ArrowEnds, type ElementLook,
  ORIGIN, entity, point, curves, curvePoints, addPoint, addLine, addCircle, addArc, addSymbol, newId,
  geometryBox,
} from "./model";
import { type V, add, sub, mul, dot, cross, norm, dist, boxIsEmpty } from "./geom";

/** How a copy is placed: where points land, and what that does to directions. */
interface Move {
  at(p: V): V;
  /** True for a point that lands on itself; the copy then shares it. */
  stays(p: V): boolean;
  /** A mirror image runs the other way round. */
  flips: boolean;
  /** A direction, as an angle. */
  angle(a: number): number;
  /** An offset from a point. */
  vec(v: V): V;
}

/** What one copy is made from, and what it came out as. */
interface Batch { curves: Id[]; points: Id[]; symbols: Id[] }

export interface CopyResult {
  /** Curves, lone points and symbols that were made, for selecting them. */
  made: Id[];
  /** The constraint that ties the copies to the original. */
  link: Id;
  /** Points on the mirror line that the image shares with the original. They belong on the line. */
  shared: Id[];
}

const xy = (sk: Sketch, id: Id): V => { const p = point(sk, id); return [p.x, p.y]; };
/** Turns an element round: the other end of a damper, the other way of winding. */
const turnRound = (look: ElementLook): void => { if (look.flip) delete look.flip; else look.flip = true; };

/** Distances below this count as none, for a sketch of this size. */
function tolerance(sk: Sketch): number {
  const b = geometryBox(sk);
  const size = boxIsEmpty(b) ? 1 : Math.max(b.x1 - b.x0, b.y1 - b.y0, 1e-6);
  return size * 1e-7;
}

/**
 * What a selection asks to have copied: its curves, and the points picked on
 * their own. The points of a picked curve come along with the curve.
 */
function gather(sk: Sketch, picked: Iterable<Id>, skip: Id[] = []): Batch {
  const ids = new Set(picked);
  for (const id of skip) ids.delete(id);
  const list = curves(sk).filter((c) => ids.has(c.id));
  const used = new Set<Id>();
  for (const c of list) curvePoints(c).forEach((p) => used.add(p));
  const lone = sk.entities.filter((e) => e.type === "point" && ids.has(e.id) && !used.has(e.id) && e.id !== ORIGIN).map((e) => e.id);
  // Symbols on what is copied come along, picked or not.
  const hosts = new Set<Id>([...list.map((c) => c.id), ...used, ...lone]);
  const symbols = sk.symbols.filter((s) => attachedTo(s, hosts)).map((s) => s.id);
  return { curves: list.map((c) => c.id), points: lone, symbols };
}

/** True for a symbol that sits on the given geometry and is of a kind that is copied with it. */
function attachedTo(s: Sym, hosts: Set<Id>): boolean {
  switch (s.type) {
    case "support":
    case "datum":
    case "load":
    case "moment":
      return hosts.has(s.at);
    case "centermark":
    case "hatch":
    case "lineload":
      return hosts.has(s.on);
    case "fill":
      return s.circle ? hosts.has(s.circle) : s.curves.length > 0 && s.curves.every((c) => hosts.has(c));
    default:
      return false;
  }
}

/** The next free name for a datum point: A, B, C and so on, then A_1, B_1. */
export function nextDatumName(sk: Sketch): string {
  const used = new Set(sk.symbols.flatMap((s) => (s.type === "datum" ? [s.label.trim()] : [])));
  for (let round = 0; round < 50; round++) {
    for (let i = 0; i < 26; i++) {
      const name = String.fromCharCode(65 + i) + (round ? `_{${round}}` : "");
      if (!used.has(name)) return name;
    }
  }
  return "";
}

/**
 * Makes one copy of a batch, moved by `move`, and adds what ties it to the
 * batch to `link`. `steps` is which copy of a pattern this is. Returns what
 * was made.
 */
function copyOnce(sk: Sketch, src: Batch, move: Move, link: Link, tol: number, shared: Set<Id>, steps = 1): Batch {
  const out: Batch = { curves: [], points: [], symbols: [] };
  const pmap = new Map<Id, Id>(), cmap = new Map<Id, Id>();
  const stays = (id: Id) => move.stays(xy(sk, id));
  const lands = (id: Id, on: Id) => dist(move.at(xy(sk, id)), xy(sk, on)) < tol;

  // Curves that are their own image are left alone: one on the mirror line, or one that crosses it squarely.
  const todo: Curve[] = [];
  for (const id of src.curves) {
    const e = entity(sk, id);
    if (!e || e.type === "point") continue;
    const own =
      e.type === "line" ? (stays(e.p1) && stays(e.p2)) || (lands(e.p1, e.p2) && lands(e.p2, e.p1))
      : e.type === "circle" ? stays(e.c)
      : stays(e.c) && ((stays(e.p1) && stays(e.p2)) || (move.flips && lands(e.p1, e.p2)));
    if (own) cmap.set(id, id);
    else todo.push(e);
  }

  /** The image of a point: itself where it stays put, otherwise a new point, made once. */
  const image = (id: Id, standalone = false): Id => {
    const have = pmap.get(id);
    if (have) return have;
    let to = id;
    if (stays(id)) shared.add(id);
    else {
      const q = move.at(xy(sk, id));
      to = addPoint(sk, q[0], q[1], standalone).id;
    }
    pmap.set(id, to);
    return to;
  };
  const isNew = (id: Id) => pmap.get(id) !== id;

  const arcs: { from: Arc; to: Arc }[] = [];
  for (const e of todo) {
    let made: Curve;
    if (e.type === "line") {
      const line = addLine(sk, image(e.p1), image(e.p2));
      if (e.arrow) line.arrow = e.arrow;
      if (e.tail) line.tail = true;
      if (e.element) {
        line.element = e.element;
        if (e.look) line.look = { ...e.look };
        // A spiral seen in a mirror winds the other way.
        if (line.look && e.element === "spiral" && move.flips) turnRound(line.look);
      }
      if (e.label) line.label = e.label;
      if (e.lx !== undefined && e.ly !== undefined) [line.lx, line.ly] = move.vec([e.lx, e.ly]);
      made = line;
    } else if (e.type === "circle") {
      made = addCircle(sk, image(e.c), e.r);
      link.circles.push([e.id, made.id]);
    } else {
      // An arc runs counter-clockwise, so a mirror image has its ends the other way round.
      const [p1, p2] = move.flips ? [image(e.p2), image(e.p1)] : [image(e.p1), image(e.p2)];
      const arc = addArc(sk, image(e.c), p1, p2);
      if (e.arrow) {
        const swap: Record<ArrowEnds, ArrowEnds> = { end: "start", start: "end", both: "both" };
        arc.arrow = move.flips ? swap[e.arrow] : e.arrow;
      }
      if (e.tail) arc.tail = true;
      if (e.element) {
        arc.element = e.element;
        if (e.look) arc.look = { ...e.look };
        // Its ends have changed places, so the cylinder of a damper has to as well to stay where it was.
        if (arc.look && e.element === "damper" && move.flips) turnRound(arc.look);
      }
      if (e.label) arc.label = e.label;
      if (e.lx !== undefined && e.ly !== undefined) [arc.lx, arc.ly] = move.vec([e.lx, e.ly]);
      arcs.push({ from: e, to: arc });
      made = arc;
    }
    if (e.construction) made.construction = true;
    if (e.centre) made.centre = true;
    if (e.dashed) made.dashed = true;
    if (e.weight !== undefined) made.weight = e.weight;
    cmap.set(e.id, made.id);
    out.curves.push(made.id);
  }
  for (const id of src.points) {
    if (stays(id)) continue;
    out.points.push(image(id, true));
  }

  // How each new point is held. An arc has five freedoms and its three points
  // would take six equations, so one point of every copied arc gets a single
  // equation: the arc itself supplies the rest.
  const held = new Map<Id, "pair" | HalfPair>(); // by the source point
  const given = (id: Id) => !isNew(id) || held.has(id);
  for (const { from, to } of arcs) {
    const ends = [from.p1, from.p2];
    const open = ends.filter((p) => !given(p));
    if (!given(from.c)) {
      // With both ends placed already, the centre can only slide along their bisector.
      held.set(from.c, open.length ? "pair" : { from: from.c, to: pmap.get(from.c)!, arc: to.id, role: "centre" });
      if (!open.length) continue;
    }
    const half = (p: Id) => held.set(p, { from: p, to: pmap.get(p)!, arc: to.id, role: "end" });
    if (open.length === 2) {
      held.set(open[0], "pair");
      half(open[1]);
    } else if (open.length === 1) half(open[0]);
    else {
      // Both ends are placed by other curves: one of them gives up an equation, if it has two.
      const full = ends.find((p) => held.get(p) === "pair");
      if (full) half(full);
    }
  }
  for (const [from, to] of pmap) {
    if (from === to) continue;
    const h = held.get(from);
    if (h && h !== "pair") link.half.push(steps === 1 ? h : { ...h, steps });
    else link.pairs.push((steps === 1 ? [from, to] : [from, to, steps]) as Pair);
  }

  // Symbols on the copied geometry.
  const mapped = (id: Id) => cmap.get(id) ?? pmap.get(id);
  for (const id of src.symbols) {
    const s = sk.symbols.find((x) => x.id === id);
    if (!s) continue;
    let made: Sym | null = null;
    if (s.type === "support") {
      const at = pmap.get(s.at);
      // One support per joint: a point shared with the original keeps the one it has.
      if (at && at !== s.at) made = addSymbol(sk, { type: "support", kind: s.kind, at, angle: move.flips ? move.angle(s.angle) + Math.PI : move.angle(s.angle) });
    } else if (s.type === "datum") {
      const at = pmap.get(s.at);
      if (at && at !== s.at) {
        const [dx, dy] = move.vec([s.dx, s.dy]);
        // A datum point gets the next name; the mark of a centre of mass keeps the one it has.
        made = addSymbol(sk, { type: "datum", at, color: s.color, label: s.mass ? s.label : s.label.trim() ? nextDatumName(sk) : "", dx, dy, ...(s.mass ? { mass: true } : {}) });
      }
    } else if (s.type === "load" || s.type === "moment") {
      const at = pmap.get(s.at);
      if (at && at !== s.at) {
        const { id: _id, dx, dy, ...rest } = s;
        const copy = addSymbol(sk, { ...rest, at, angle: move.angle(s.angle) });
        if (dx !== undefined && dy !== undefined) [copy.dx, copy.dy] = move.vec([dx, dy]);
        if (copy.type === "moment" && move.flips) {
          // In a mirror a moment turns the other way, and its arc runs back from where it started.
          if (s.type === "moment" && s.cw) delete copy.cw;
          else copy.cw = true;
          copy.angle = move.angle(s.angle) - 1.5 * Math.PI;
        }
        made = copy;
      }
    } else if (s.type === "lineload") {
      const on = cmap.get(s.on);
      if (on && on !== s.on) {
        const { id: _id, dx, dy, ...rest } = s;
        const copy = addSymbol(sk, { ...rest, on });
        if (move.flips) copy.side = s.side === 1 ? -1 : 1;
        if (s.angle !== undefined) copy.angle = move.angle(s.angle);
        if (dx !== undefined && dy !== undefined) [copy.dx, copy.dy] = move.vec([dx, dy]);
        made = copy;
      }
    } else if (s.type === "centermark") {
      const on = cmap.get(s.on);
      if (on && on !== s.on) {
        const { id: _id, ...rest } = s;
        made = addSymbol(sk, { ...rest, on, angle: move.angle(s.angle) });
      }
    } else if (s.type === "hatch") {
      const on = cmap.get(s.on);
      const host = entity(sk, s.on);
      if (on && on !== s.on && host && host.type !== "point") {
        const { id: _id, ...rest } = s;
        const h = addSymbol(sk, { ...rest, on });
        if (move.flips) {
          // Seen along a mirrored line, left and right change places. A circle or arc keeps
          // its inside, but is run through the other way, so the strokes lean the other way.
          if (host.type === "line") h.side = s.side === 1 ? -1 : 1;
          else h.lean = (s.lean ?? 1) === 1 ? -1 : 1;
        }
        made = h;
      }
    } else if (s.type === "fill") {
      if (s.circle) {
        const circle = cmap.get(s.circle);
        if (circle && circle !== s.circle) made = addSymbol(sk, { type: "fill", color: s.color, circle, points: [], arcs: [], curves: [], holes: [] });
      } else {
        const points = s.points.map((p) => pmap.get(p)), outline = s.curves.map((c) => cmap.get(c));
        const arcIds = s.arcs.map((a) => (a ? cmap.get(a) : null));
        const whole = points.every((p) => p) && outline.every((c) => c) && arcIds.every((a) => a !== undefined);
        if (whole && outline.some((c, i) => c !== s.curves[i])) {
          made = addSymbol(sk, {
            type: "fill", color: s.color, points: points as Id[], arcs: arcIds as (Id | null)[], curves: outline as Id[],
            holes: s.holes.flatMap((h) => { const to = mapped(h); return to && to !== h ? [to] : []; }),
          });
        }
      }
    }
    if (made) out.symbols.push(made.id);
  }
  return out;
}

function finish(sk: Sketch, link: Link, batches: Batch[], shared: Set<Id>): CopyResult | string {
  const made = batches.flatMap((b) => [...b.curves, ...b.points, ...b.symbols]);
  if (!made.length) return "There is nothing there to copy: it would land on itself.";
  sk.constraints.push(link);
  return { made, link: link.id, shared: [...shared] };
}

const NOTHING = "Select the lines, circles, arcs or points to copy first.";

/** Copies the picked geometry to the other side of a line. Returns what was made, or why nothing was. */
export function mirrorCopy(sk: Sketch, picked: Iterable<Id>, axisId: Id): CopyResult | string {
  const axis = entity(sk, axisId);
  if (axis?.type !== "line") return "Mirror about a line.";
  const src = gather(sk, picked, [axisId]);
  if (!src.curves.length && !src.points.length) return NOTHING;
  const a = xy(sk, axis.p1);
  const span = sub(xy(sk, axis.p2), a);
  if (Math.hypot(span[0], span[1]) < 1e-12) return "That line has no length to mirror about.";
  const u = norm(span);
  const phi = Math.atan2(u[1], u[0]);
  const tol = tolerance(sk);
  const reflect = (v: V): V => sub(mul(u, 2 * dot(v, u)), v);
  const move: Move = {
    at: (p) => add(a, reflect(sub(p, a))),
    stays: (p) => Math.abs(cross(u, sub(p, a))) < tol,
    flips: true,
    angle: (t) => 2 * phi - t,
    vec: reflect,
  };
  const link: Link = { id: newId(sk, "constraint"), type: "mirror", l: axisId, pairs: [], half: [], circles: [] };
  const shared = new Set<Id>();
  const copy = copyOnce(sk, src, move, link, tol, shared);
  // The ends of the mirror line are on it by nature; the others need holding there.
  shared.delete(axis.p1);
  shared.delete(axis.p2);
  return finish(sk, link, [copy], shared);
}

/** Most copies a pattern makes, the original included. */
export const PATTERN_MAX = 60;

/** Repeats the picked geometry `count` times in all, each copy one `step` on from the last. */
export function linearCopy(sk: Sketch, picked: Iterable<Id>, count: number, step: V): CopyResult | string {
  const src = gather(sk, picked);
  if (!src.curves.length && !src.points.length) return NOTHING;
  if (Math.hypot(step[0], step[1]) < 1e-12) return "The copies need a step to be apart by.";
  const link: Link = { id: newId(sk, "constraint"), type: "shift", pairs: [], half: [], circles: [] };
  const tol = tolerance(sk), shared = new Set<Id>();
  const batches: Batch[] = [];
  // Every copy is made from the original, so each is tied to it and not to its neighbour.
  for (let k = 1; k < Math.min(count, PATTERN_MAX); k++) {
    const by = mul(step, k);
    const move: Move = { at: (p) => add(p, by), stays: () => false, flips: false, angle: (t) => t, vec: (v) => v };
    batches.push(copyOnce(sk, src, move, link, tol, shared, k));
  }
  return finish(sk, link, batches, new Set());
}

/** Repeats the picked geometry `count` times in all around a point, each copy turned by `angle` from the last. */
export function circularCopy(sk: Sketch, picked: Iterable<Id>, centreId: Id, count: number, angle: number): CopyResult | string {
  const all = gather(sk, picked);
  // The centre itself stays where it is.
  const src = { ...all, points: all.points.filter((p) => p !== centreId) };
  if (!src.curves.length && !src.points.length) return NOTHING;
  if (Math.abs(angle) < 1e-9) return "The copies need an angle to be apart by.";
  const c = xy(sk, centreId);
  const tol = tolerance(sk);
  const link: Link = { id: newId(sk, "constraint"), type: "turn", c: centreId, angle, pairs: [], half: [], circles: [] };
  const shared = new Set<Id>();
  const batches: Batch[] = [];
  // Every copy is made from the original, so each is tied to it and not to its neighbour.
  for (let i = 1; i < Math.min(count, PATTERN_MAX); i++) {
    const by = angle * i;
    const k = Math.cos(by), n = Math.sin(by);
    const turn = (v: V): V => [v[0] * k - v[1] * n, v[0] * n + v[1] * k];
    const move: Move = {
      at: (p) => add(c, turn(sub(p, c))),
      stays: (p) => dist(p, c) < tol,
      flips: false,
      angle: (t) => t + by,
      vec: turn,
    };
    batches.push(copyOnce(sk, src, move, link, tol, shared, i));
  }
  return finish(sk, link, batches, new Set());
}

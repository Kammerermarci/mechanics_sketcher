// Springs and dampers: a line or an arc of the sketch drawn as a machine
// element between its two ends. Each is worked out on a straight strip, as
// runs of straight pieces, and then laid along the line or bent round the arc.
// Its sizes are in model units, so it is the same drawing at every zoom.

import { type Sketch, type Line, type Arc, type ElementLook, point, arcAngles, arcRadius } from "./model";
import { type V, add, mul, norm, perp, sub, dist, polar, angleOf } from "./geom";

/** A point on the strip: how far along from the start, and how far to the left of the middle. */
type S = [along: number, left: number];

/** The most turns a spring is drawn with, however long it is and however close its turns are set. */
export const TURNS_MAX = 300;
/** How far a spring's straight ends run before its turns start, against its width. */
const LEAD = 0.6;
/** Points a coil's loop, and a spiral's winding, are drawn through. */
const LOOP_POINTS = 24;

/** How many turns a spring of this length has: as many as fit at its pitch, so a longer spring has more of them. */
export function springTurns(length: number, look: ElementLook): number {
  const body = length - 2 * springLead(length, look);
  const fit = body / Math.max(look.pitch, 1e-9) - (look.coil ? 0.5 : 0);
  return Math.max(1, Math.min(TURNS_MAX, Math.round(fit)));
}

/** The straight piece at each end of a spring. A short spring gives up its ends before its turns. */
function springLead(length: number, look: ElementLook): number {
  return Math.min(look.across * LEAD, length * 0.2);
}

/** A spring on the strip, from 0 to `length`: a zigzag, or the loops of a coil. */
function spring(length: number, look: ElementLook): S[][] {
  const half = look.across / 2;
  const lead = springLead(length, look);
  const body = length - 2 * lead;
  const turns = springTurns(length, look);
  const run: S[] = [[0, 0], [lead, 0]];
  if (!look.coil) {
    // Up to one side, across to the other: one turn, with half a stroke at either end to meet the middle.
    const pitch = body / turns;
    for (let i = 0; i < turns; i++) run.push([lead + (i + 0.25) * pitch, half], [lead + (i + 0.75) * pitch, -half]);
  } else {
    // A wire wound round a rod, seen from the side: it goes up the near side, comes back over the top
    // and forward again, each loop lying over the last. It ends half a loop on, back in the middle.
    const sweep = 2 * Math.PI * turns + Math.PI;
    const pitch = body / (turns + 0.5);
    // How far a loop leans back over the one before it: a share of the pitch, and no wider than the coil is.
    const back = Math.min(0.55 * pitch, body / 2, half * 1.2);
    const forward = (body - 2 * back) / sweep;
    const n = Math.ceil((sweep / (2 * Math.PI)) * LOOP_POINTS);
    for (let i = 1; i < n; i++) {
      const t = (sweep * i) / n;
      run.push([lead + back * (1 - Math.cos(t)) + forward * t, half * Math.sin(t)]);
    }
  }
  run.push([length - lead, 0], [length, 0]);
  return [run];
}

/** How long the cylinder of a damper is, against its width. */
const CYLINDER = 1.5;

/**
 * A damper on the strip: a rod with a piston on it, in a cylinder that is
 * open towards the start and closed at the end the second rod leaves from.
 */
function damper(length: number, look: ElementLook): S[][] {
  const half = look.across / 2;
  const body = Math.min(look.across * CYLINDER, length * 0.7);
  const open = (length - body) / 2, closed = open + body;
  const piston = open + body * 0.55;
  const runs: S[][] = [
    [[0, 0], [piston, 0]],
    [[piston, -half * 0.78], [piston, half * 0.78]],
    [[open, half], [closed, half], [closed, -half], [open, -half]],
    [[closed, 0], [length, 0]],
  ];
  // Turned round, the cylinder is at the start.
  return look.flip ? runs.map((r) => r.map(([s, t]): S => [length - s, t])) : runs;
}

/** How many times a spiral spring of this radius goes round: its windings are a pitch apart. */
export function spiralTurns(radius: number, look: ElementLook): number {
  const inner = spiralInner(radius, look);
  return Math.max(0.75, Math.min(40, (radius - inner) / Math.max(look.pitch, 1e-9)));
}
/** Where a spiral starts: half a pitch from its centre, or closer when it is small. */
const spiralInner = (radius: number, look: ElementLook): number => Math.min(look.pitch / 2, radius * 0.3);

/** A spiral spring about `centre` whose outer end is at `end`: counter-clockwise on its way out unless flipped. */
function spiral(centre: V, end: V, look: ElementLook): V[][] {
  const radius = dist(centre, end);
  if (radius < 1e-12) return [];
  const inner = spiralInner(radius, look);
  const turns = spiralTurns(radius, look);
  const last = angleOf(sub(end, centre)), way = look.flip ? -1 : 1;
  const n = Math.max(8, Math.ceil(turns * LOOP_POINTS));
  const run: V[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    run.push(polar(centre, inner + (radius - inner) * u, last - way * 2 * Math.PI * turns * (1 - u)));
  }
  run[n] = end;
  return [run];
}

/** What a new spring or damper looks like, for a width across of `across` model units. */
export function defaultLook(across: number): ElementLook {
  return { across, pitch: across * 0.5 };
}

/** The look of an element: its own, or one made up for a file that has none. */
export function lookOf(sk: Sketch, e: Line | Arc): ElementLook {
  if (e.look && e.look.across > 0 && e.look.pitch > 0) return e.look;
  return defaultLook(Math.max(elementLength(sk, e) / 8, 1e-6));
}

/** How long the line or arc an element is drawn along is, in model units. */
export function elementLength(sk: Sketch, e: Line | Arc): number {
  if (e.type === "line") {
    const a = point(sk, e.p1), b = point(sk, e.p2);
    return Math.hypot(b.x - a.x, b.y - a.y);
  }
  const { a0, a1 } = arcAngles(sk, e);
  return arcRadius(sk, e) * (a1 - a0);
}

/**
 * The runs of straight pieces an element is drawn with, in model units; none
 * for a curve that is not an element, or has no length.
 */
export function elementPaths(sk: Sketch, e: Line | Arc): V[][] {
  if (!e.element) return [];
  const look = lookOf(sk, e);
  const length = elementLength(sk, e);
  if (!(length > 1e-12)) return [];
  if (e.type === "line") {
    const a = point(sk, e.p1), b = point(sk, e.p2);
    const A: V = [a.x, a.y], B: V = [b.x, b.y];
    if (e.element === "spiral") return spiral(A, B, look);
    const u = norm(sub(B, A)), n = perp(u);
    return (e.element === "spring" ? spring(length, look) : damper(length, look))
      .map((run) => run.map(([s, t]) => add(add(A, mul(u, s)), mul(n, t))));
  }
  // Bent round the centre of the arc: left of the way it runs is towards that centre.
  const c = point(sk, e.c);
  const C: V = [c.x, c.y], r = arcRadius(sk, e), { a0 } = arcAngles(sk, e);
  const at = ([s, t]: S): V => polar(C, r - t, a0 + s / r);
  return (e.element === "spring" ? spring(length, look) : damper(length, look)).map((run) => {
    const out: V[] = [at(run[0])];
    for (let i = 1; i < run.length; i++) {
      // A piece that runs along the arc is curved, so it gets a point every few degrees.
      const [s0, t0] = run[i - 1], [s1, t1] = run[i];
      const steps = Math.max(1, Math.ceil(Math.abs(s1 - s0) / r / 0.07));
      for (let k = 1; k <= steps; k++) out.push(at([s0 + ((s1 - s0) * k) / steps, t0 + ((t1 - t0) * k) / steps]));
    }
    return out;
  });
}

/** How far an element reaches to either side of its middle line, in model units: where its name has to clear. */
export function elementReach(sk: Sketch, e: Line | Arc): number {
  if (!e.element || e.element === "spiral") return 0;
  return lookOf(sk, e).across / 2;
}

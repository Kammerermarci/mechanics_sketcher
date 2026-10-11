// Beams: a bar between two points, straight or bent round a centre, with
// round or square ends. A beam is ordinary geometry: lines and arcs that
// share their ends, held in shape by ordinary constraints.

import { type Sketch, type Id, type ConstraintDraft, point, addPoint, addLine, addArc } from "./model";
import { type V, add, sub, mul, norm, perp, dist } from "./geom";

/** What a beam's ends look like: half-circles, as on a slot, or cut off square. */
export type BeamEnds = "round" | "square";

export interface BeamParts {
  /** The lines and arcs of its outline. */
  made: Id[];
  /** The constraints that hold its shape, to be added one by one where they fit. */
  autos: ConstraintDraft[];
}

const xy = (sk: Sketch, id: Id): V => { const p = point(sk, id); return [p.x, p.y]; };

/** A straight beam around the centres a and b, reaching `r` either side of the line between them. */
export function straightBeam(sk: Sketch, a: Id, b: Id, r: number, ends: BeamEnds): BeamParts {
  const A = xy(sk, a), B = xy(sk, b);
  const off = mul(perp(norm(sub(B, A))), r);
  // Left and right of a, then right and left of b, seen from a towards b.
  const [a1, a2, b1, b2] = [add(A, off), sub(A, off), sub(B, off), add(B, off)].map((c) => addPoint(sk, c[0], c[1]).id);
  const low = addLine(sk, a2, b1), high = addLine(sk, b2, a1);
  const made: Id[] = [low.id, high.id];
  const autos: ConstraintDraft[] = [];
  if (ends === "square") {
    const endA = addLine(sk, a1, a2), endB = addLine(sk, b1, b2);
    made.push(endA.id, endB.id);
    autos.push(
      { type: "midpoint", p: a, l: endA.id }, { type: "midpoint", p: b, l: endB.id },
      { type: "perpendicular", l1: low.id, l2: endA.id }, { type: "perpendicular", l1: low.id, l2: endB.id },
      { type: "parallel", l1: low.id, l2: high.id },
    );
  } else {
    // Counter-clockwise round the outside of each end.
    const arcA = addArc(sk, a, a1, a2), arcB = addArc(sk, b, b1, b2);
    made.push(arcA.id, arcB.id);
    for (const line of [low, high]) for (const arc of [arcA, arcB]) autos.push({ type: "tangent", l: line.id, c: arc.id });
    autos.push({ type: "equal", a: arcA.id, b: arcB.id });
  }
  return { made, autos };
}

/**
 * A beam bent round the centre o: it runs counter-clockwise from a to b,
 * reaching `r` inside and outside the arc between them. Its two long sides
 * are arcs about o.
 */
export function curvedBeam(sk: Sketch, o: Id, a: Id, b: Id, r: number, ends: BeamEnds): BeamParts {
  const O = xy(sk, o), A = xy(sk, a), B = xy(sk, b);
  const eA = norm(sub(A, O)), eB = norm(sub(B, O));
  // The width is kept clear of the centre, so there is an inner side to draw.
  const half = Math.min(r, 0.95 * Math.min(dist(O, A), dist(O, B)));
  const at = (q: V) => addPoint(sk, q[0], q[1]).id;
  const aOut = at(add(A, mul(eA, half))), aIn = at(sub(A, mul(eA, half)));
  const bOut = at(add(B, mul(eB, half))), bIn = at(sub(B, mul(eB, half)));
  const outer = addArc(sk, o, aOut, bOut), inner = addArc(sk, o, aIn, bIn);
  const made: Id[] = [outer.id, inner.id];
  const autos: ConstraintDraft[] = [];
  if (ends === "square") {
    // Each end is a line through the centre of the bend, with its own centre at its middle.
    const endA = addLine(sk, aIn, aOut), endB = addLine(sk, bIn, bOut);
    made.push(endA.id, endB.id);
    autos.push(
      { type: "midpoint", p: a, l: endA.id }, { type: "midpoint", p: b, l: endB.id },
      { type: "pointOn", p: o, on: endA.id }, { type: "pointOn", p: o, on: endB.id },
    );
  } else {
    // Round the back of a, and round the front of b, counter-clockwise both.
    const capA = addArc(sk, a, aIn, aOut), capB = addArc(sk, b, bOut, bIn);
    made.push(capA.id, capB.id);
    // Tangent where they meet: that alone puts both caps midway between the sides, at one radius.
    for (const cap of [capA, capB]) for (const side of [outer, inner]) autos.push({ type: "tangent", l: cap.id, c: side.id });
  }
  return { made, autos };
}

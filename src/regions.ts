// Finds the closed regions that lines and arcs enclose, so a click inside a
// shape can be turned into a fill.
//
// Lines and arcs are cut at every point that lies on them, which gives a
// planar graph; its bounded faces are the regions. Curves that cross without
// a point at the crossing are not split there, so such regions are not found.

import { type Sketch, type Id, type Point, points, point, curves, curvePoints, arcRadius, isEdge } from "./model";
import { type V, sub, dist, angleOf, polar, wrap, projectOnSegment, TWO_PI } from "./geom";
import { splineCubics } from "./splines";
import { flattenCubic } from "./bezier";

/** A bounded region: corners in counter-clockwise order, and what joins each to the next. */
export interface Face {
  points: Id[];
  /** For each corner, the arc running to the next corner, or null for a straight side. */
  arcs: (Id | null)[];
  curves: Id[];
  /** The outline in model units, with arcs sampled; for area and inside tests. */
  polygon: V[];
  area: number;
}

interface HalfEdge {
  from: Id;
  to: Id;
  curve: Id;
  arc: Id | null;
  /** Direction in which it leaves `from`. */
  angle: number;
  /** Points strictly between the ends, along an arc. */
  inner: V[];
  twin: number;
  used: boolean;
}

export function signedArea(poly: V[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  }
  return a / 2;
}

export function insidePolygon(q: V, poly: V[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > q[1] !== yj > q[1] && q[0] < ((xj - xi) * (q[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Points along an arc from angle a0 to a1 (a1 > a0), ends excluded. */
function arcInner(c: V, r: number, a0: number, a1: number): V[] {
  const n = Math.max(2, Math.ceil((a1 - a0) / (Math.PI / 30)));
  const out: V[] = [];
  for (let i = 1; i < n; i++) out.push(polar(c, r, a0 + ((a1 - a0) * i) / n));
  return out;
}

export function findFaces(sk: Sketch): Face[] {
  const pts = points(sk);
  let size = 0;
  for (const p of pts) size = Math.max(size, Math.abs(p.x), Math.abs(p.y));
  const eps = Math.max(1e-9, size * 1e-7);

  // Points in the same place count as one node. It goes by the name of a point
  // a curve ends in where there is one, so a region stays tied to its own corners
  // and not to, say, the origin that happens to sit under one of them.
  const ends = new Set<Id>();
  for (const e of curves(sk)) curvePoints(e).forEach((id) => ends.add(id));
  const reps: Point[] = [];
  for (const p of [...pts].sort((a, b) => Number(ends.has(b.id)) - Number(ends.has(a.id)))) {
    if (!reps.some((r) => Math.hypot(r.x - p.x, r.y - p.y) < eps)) reps.push(p);
  }
  const pos = (id: Id): V => { const p = point(sk, id); return [p.x, p.y]; };

  const half: HalfEdge[] = [];
  const link = (u: Id, v: Id, curve: Id, arc: Id | null, inner: V[]) => {
    if (u === v) return;
    const a = pos(u), b = pos(v);
    // An arc leaves along its first sample, which also orders it against a line tangent to it.
    const first = inner[0] ?? b, last = inner[inner.length - 1] ?? a;
    const i = half.length;
    half.push({ from: u, to: v, curve, arc, angle: angleOf(sub(first, a)), inner, twin: i + 1, used: false });
    half.push({ from: v, to: u, curve, arc, angle: angleOf(sub(last, b)), inner: [...inner].reverse(), twin: i, used: false });
  };

  for (const e of curves(sk)) {
    if (!isEdge(e)) continue;
    if (e.type === "line") {
      const a = pos(e.p1), b = pos(e.p2);
      if (dist(a, b) < eps) continue;
      const on: { id: Id; t: number }[] = [];
      for (const r of reps) {
        const q: V = [r.x, r.y];
        const pr = projectOnSegment(q, a, b);
        if (dist(q, pr.point) < eps) on.push({ id: r.id, t: pr.t });
      }
      on.sort((x, y) => x.t - y.t);
      for (let i = 0; i + 1 < on.length; i++) link(on[i].id, on[i + 1].id, e.id, null, []);
    } else if (e.type === "arc") {
      const c = pos(e.c);
      const r = arcRadius(sk, e);
      if (r < eps) continue;
      const a0 = angleOf(sub(pos(e.p1), c));
      const sweep = wrap(angleOf(sub(pos(e.p2), c)) - a0) || TWO_PI;
      const on: { id: Id; s: number }[] = [];
      for (const rp of reps) {
        const q: V = [rp.x, rp.y];
        if (Math.abs(dist(q, c) - r) > eps * 10) continue;
        let s = wrap(angleOf(sub(q, c)) - a0);
        if (s > sweep + 1e-7) {
          if (TWO_PI - s < 1e-7) s = 0; // the start point, a hair before zero
          else continue;
        }
        on.push({ id: rp.id, s: Math.min(s, sweep) });
      }
      on.sort((x, y) => x.s - y.s);
      for (let i = 0; i + 1 < on.length; i++) {
        link(on[i].id, on[i + 1].id, e.id, e.id, arcInner(c, r, a0 + on[i].s, a0 + on[i + 1].s));
      }
    }
  }

  // Around each node, the edges leaving it in counter-clockwise order.
  const around = new Map<Id, number[]>();
  half.forEach((h, i) => {
    const list = around.get(h.from) ?? [];
    list.push(i);
    around.set(h.from, list);
  });
  for (const list of around.values()) list.sort((x, y) => half[x].angle - half[y].angle);

  const faces: Face[] = [];
  for (let start = 0; start < half.length; start++) {
    if (half[start].used) continue;
    // Walk with the region on the left: at each node take the next edge clockwise from the way back.
    let cycle: number[] = [];
    let e = start;
    for (let guard = 0; guard <= half.length; guard++) {
      half[e].used = true;
      cycle.push(e);
      const list = around.get(half[e].to)!;
      const back = list.indexOf(half[e].twin);
      e = list[(back - 1 + list.length) % list.length];
      if (e === start) break;
    }
    // Drop dead ends: an edge followed straight away by its own way back.
    for (let changed = true; changed && cycle.length > 1; ) {
      changed = false;
      for (let i = 0; i < cycle.length; i++) {
        const j = (i + 1) % cycle.length;
        if (half[cycle[i]].twin === cycle[j]) {
          cycle = cycle.filter((_, k) => k !== i && k !== j);
          changed = true;
          break;
        }
      }
    }
    if (cycle.length < 2) continue;
    const polygon: V[] = [];
    for (const i of cycle) polygon.push(pos(half[i].from), ...half[i].inner);
    const area = signedArea(polygon);
    if (area <= eps * eps) continue; // the unbounded outside, or nothing enclosed
    faces.push({
      points: cycle.map((i) => half[i].from),
      arcs: cycle.map((i) => half[i].arc),
      curves: [...new Set(cycle.map((i) => half[i].curve))],
      polygon,
      area,
    });
  }
  return faces;
}

export type Region =
  | { kind: "spline"; spline: Id; holes: Id[] }
  | { kind: "circle"; circle: Id }
  | { kind: "face"; face: Face; holes: Id[] };

/** The smallest closed region around a position, or null in open space. */
export function regionAt(sk: Sketch, q: V): Region | null {
  let best: Region | null = null;
  let bestArea = Infinity;
  const faces = findFaces(sk);
  const splinePolygons=new Map<Id,V[]>();
  for(const s of sk.entities) if(s.type==="spline"&&s.closed&&!s.construction&&!s.centre){
    const poly=splineCubics(sk,s).flatMap((c)=>flattenCubic(c,0.002).slice(0,-1));
    splinePolygons.set(s.id,poly);
    const area=Math.abs(signedArea(poly))||poly.reduce((sum,p,i)=>{const q=poly[(i+1)%poly.length];return sum+Math.abs(p[0]*q[1]-p[1]*q[0]);},0)/2;
    if(area<1e-12)continue;
    if(insidePolygon(q,poly)&&area<bestArea){best={kind:"spline",spline:s.id,holes:[]};bestArea=area;}
  }
  for (const f of faces) {
    if (f.area < bestArea && insidePolygon(q, f.polygon)) {
      best = { kind: "face", face: f, holes: [] };
      bestArea = f.area;
    }
  }
  const circles = curves(sk).filter((e) => e.type === "circle" && isEdge(e));
  for (const c of circles) {
    if (c.type !== "circle") continue;
    const ctr = point(sk, c.c);
    const area = Math.PI * c.r * c.r;
    if (area < bestArea && Math.hypot(q[0] - ctr.x, q[1] - ctr.y) < c.r) {
      best = { kind: "circle", circle: c.id };
      bestArea = area;
    }
  }
  if (best?.kind === "face" || best?.kind==="spline") {
    // Circles lying wholly inside the region are left as holes.
    const poly = best.kind==="face"?best.face.polygon:splinePolygons.get(best.spline)!;
    for (const c of circles) {
      if (c.type !== "circle") continue;
      const ctr = point(sk, c.c);
      const C: V = [ctr.x, ctr.y];
      if (!insidePolygon(C, poly)) continue;
      let clear = Infinity;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        clear = Math.min(clear, dist(C, projectOnSegment(C, poly[j], poly[i]).point));
      }
      if (clear > c.r) best.holes.push(c.id);
    }
  }
  return best;
}

// ---- overlaps -----------------------------------------------------------------

/** Stretches where two curves lie on top of each other, in model units. */
export interface Overlaps {
  segments: [V, V][];
  rounds: { c: V; r: number; a0: number; a1: number }[];
}

export function findOverlaps(sk: Sketch): Overlaps {
  const out: Overlaps = { segments: [], rounds: [] };
  const drawn = curves(sk).filter(isEdge);
  const pos = (id: Id): V => { const p = point(sk, id); return [p.x, p.y]; };

  const lines = drawn.filter((e) => e.type === "line").map((e) => ({ a: pos((e as { p1: Id }).p1), b: pos((e as { p2: Id }).p2) }));
  for (let i = 0; i < lines.length; i++) {
    const { a, b } = lines[i];
    const len = dist(a, b);
    if (len < 1e-12) continue;
    const u: V = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const tol = len * 1e-6;
    for (let j = i + 1; j < lines.length; j++) {
      const { a: c, b: d } = lines[j];
      const off = (p: V) => Math.abs((p[0] - a[0]) * u[1] - (p[1] - a[1]) * u[0]);
      if (off(c) > tol || off(d) > tol) continue;
      const along = (p: V) => (p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1];
      const lo = Math.max(0, Math.min(along(c), along(d)));
      const hi = Math.min(len, Math.max(along(c), along(d)));
      if (hi - lo > tol) out.segments.push([[a[0] + u[0] * lo, a[1] + u[1] * lo], [a[0] + u[0] * hi, a[1] + u[1] * hi]]);
    }
  }

  // Circles and arcs: same centre and radius, with some of the rim in common.
  const rounds = drawn.flatMap((e) => {
    if (e.type === "circle") return [{ c: pos(e.c), r: e.r, a0: 0, a1: TWO_PI }];
    if (e.type === "arc") {
      const c = pos(e.c);
      const a0 = angleOf(sub(pos(e.p1), c));
      return [{ c, r: arcRadius(sk, e), a0, a1: a0 + (wrap(angleOf(sub(pos(e.p2), c)) - a0) || TWO_PI) }];
    }
    return [];
  });
  for (let i = 0; i < rounds.length; i++) {
    for (let j = i + 1; j < rounds.length; j++) {
      const p = rounds[i], q = rounds[j];
      const tol = Math.max(p.r, q.r) * 1e-6;
      if (dist(p.c, q.c) > tol || Math.abs(p.r - q.r) > tol) continue;
      const full = (x: typeof p) => x.a1 - x.a0 >= TWO_PI - 1e-9;
      if (full(p)) out.rounds.push(q);
      else if (full(q)) out.rounds.push(p);
      else {
        // Two arcs: the part of q's sweep that falls inside p's.
        const start = wrap(q.a0 - p.a0), sweepP = p.a1 - p.a0, sweepQ = q.a1 - q.a0;
        if (start < sweepP - 1e-9) out.rounds.push({ c: p.c, r: p.r, a0: q.a0, a1: q.a0 + Math.min(sweepQ, sweepP - start) });
        else if (start + sweepQ > TWO_PI + 1e-9) out.rounds.push({ c: p.c, r: p.r, a0: p.a0, a1: p.a0 + Math.min(sweepP, start + sweepQ - TWO_PI) });
      }
    }
  }
  return out;
}

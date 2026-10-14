import { type Sketch, type Spline, type SplineSegment, type Id, addPoint, point, newId, curvePoints, entity, addConstraint, constraintRefs, symbolRefs } from "./model";
import { type V, dist, add, mul, sub, norm } from "./geom";
import { type Cubic, splitCubic } from "./bezier";

export function splineCubics(sk: Sketch, spline: Spline, scale = 1): Cubic[] {
  const at = (id: Id): V => { const p = point(sk, id); return [p.x * scale, p.y * scale]; };
  return spline.segments.map((s) => [at(s.p1), at(s.c1), at(s.c2), at(s.p2)]);
}
export function addSpline(sk: Sketch, segments: SplineSegment[]): Spline {
  const spline: Spline = { id: newId(sk, "spline"), type: "spline", segments };
  sk.entities.push(spline); return spline;
}
export function reverseSpline(s: Spline): void {
  s.segments = s.segments.slice().reverse().map((c) => ({p1:c.p2, c1:c.c2, c2:c.c1, p2:c.p1}));
}
export function bridgeSpline(sk: Sketch, a: Id, b: Id): SplineSegment {
  const p = point(sk, a), q = point(sk, b);
  const c1 = addPoint(sk, (2*p.x+q.x)/3, (2*p.y+q.y)/3), c2 = addPoint(sk, (p.x+2*q.x)/3, (p.y+2*q.y)/3);
  return {p1:a, c1:c1.id, c2:c2.id, p2:b};
}
/** Orient both curves to connect their nearest open endpoints. Preserve their shapes. */
export function joinSplines(sk: Sketch, a: Spline, b: Spline): Spline | string {
  if (a.id === b.id) return "Choose two different splines. Use Close to close one spline.";
  if (a.closed || b.closed) return "Open closed splines before joining them.";
  const ends = (s: Spline) => [s.segments[0].p1, s.segments.at(-1)!.p2];
  const ae = ends(a), be = ends(b);
  const xy = (id: Id): V => { const p = point(sk,id); return [p.x,p.y]; };
  let best = Infinity, ai = 1, bi = 0;
  for (let i=0;i<2;i++) for (let j=0;j<2;j++) { const d=dist(xy(ae[i]),xy(be[j])); if(d<best){best=d;ai=i;bi=j;} }
  if (ai === 0) reverseSpline(a);
  if (bi === 1) reverseSpline(b);
  const end = a.segments.at(-1)!.p2, start = b.segments[0].p1;
  if (end !== start) {
    if (best > 1e-9) a.segments.push(bridgeSpline(sk,end,start));
    else { addConstraint(sk,{type:"coincident",a:end,b:start}); }
  }
  a.segments.push(...b.segments);
  sk.entities = sk.entities.filter((e) => e.id !== b.id);
  sk.zOrder = sk.zOrder?.filter((id) => id !== b.id);
  return a;
}
export function closeSpline(sk: Sketch, s: Spline): void {
  if (s.closed) return;
  const a=s.segments.at(-1)!.p2,b=s.segments[0].p1;
  if(a!==b) s.segments.push(bridgeSpline(sk,a,b));
  s.closed=true;
}
export function openSpline(sk: Sketch, s: Spline): void {
  if(!s.closed) return;
  const end = s.segments.at(-1)!;
  // Duplicate the closing anchor so the endpoints can move independently.
  const p=point(sk,end.p2); end.p2=addPoint(sk,p.x,p.y).id;
  delete s.closed;
}
/** Insert a node without changing the curve, using de Casteljau subdivision. */
export function subdivideSpline(sk: Sketch, s: Spline, index: number): void {
  const old=s.segments[index]; if(!old) return;
  const [a,b]=splitCubic(splineCubics(sk,s)[index]);
  const make=(v:V)=>addPoint(sk,v[0],v[1]).id;
  const node=make(a[3]);
  s.segments.splice(index,1,{p1:old.p1,c1:make(a[1]),c2:make(a[2]),p2:node},{p1:node,c1:make(b[1]),c2:make(b[2]),p2:old.p2});
  pruneSplineControls(sk,[old.c1,old.c2]);
}
function pruneSplineControls(sk: Sketch, ids: Id[]): void {
  // Retain handles used by another curve or by a point constraint/symbol.
  for (const id of ids) {
    const used = sk.entities.some((e)=>e.type!=="point" && curvePoints(e).includes(id));
    if(!used && !sk.constraints.some((c)=>constraintRefs(c).includes(id)) && !sk.symbols.some((s)=>symbolRefs(s).includes(id)) && !((entity(sk,id) as {standalone?:boolean})?.standalone)) sk.entities=sk.entities.filter((e)=>e.id!==id);
  }
}
/** Split at an existing interior anchor. Both pieces retain their original shape. */
export function splitSpline(sk: Sketch, s: Spline, anchor: Id): Spline | string {
  if(s.closed) return "Open the spline before splitting it.";
  const index=s.segments.findIndex((c,i)=>i>0 && c.p1===anchor);
  if(index<1) return "Select an interior spline node as well as the spline.";
  const tail=s.segments.splice(index), p=point(sk,anchor), separate=addPoint(sk,p.x,p.y).id;
  tail[0].p1=separate;
  const made=addSpline(sk,tail);
  for(const key of ["construction","centre","dashed","weight","color"] as const) if(s[key]!==undefined) Object.assign(made,{[key]:s[key]});
  return made;
}
/** Align the two handles at a node, retaining their lengths. */
export function smoothSplineNode(sk: Sketch, s: Spline, anchor: Id): boolean {
  const before=s.segments.find((c)=>c.p2===anchor), after=s.segments.find((c)=>c.p1===anchor);
  if(!before||!after) return false;
  const p=point(sk,anchor), a=point(sk,before.c2), b=point(sk,after.c1), at:V=[p.x,p.y];
  let direction=sub([b.x,b.y],[a.x,a.y]);
  if(Math.hypot(...direction)<1e-9) direction=sub([b.x,b.y],at);
  if(Math.hypot(...direction)<1e-9){const prev=point(sk,before.p1),next=point(sk,after.p2);direction=sub([next.x,next.y],[prev.x,prev.y]);}
  if(Math.hypot(...direction)<1e-9) return false;
  const prev=point(sk,before.p1),next=point(sk,after.p2);
  const al=dist(at,[a.x,a.y])||dist(at,[prev.x,prev.y])/3,bl=dist(at,[b.x,b.y])||dist(at,[next.x,next.y])/3;
  const u=norm(direction), av=add(at,mul(u,-al)),bv=add(at,mul(u,bl));
  [a.x,a.y]=av;[b.x,b.y]=bv; return true;
}
export function splineControlIds(sk: Sketch): Set<Id> {
  return new Set(sk.entities.flatMap((e)=>e.type==="spline" ? e.segments.flatMap((s)=>[s.c1,s.c2]):[]));
}
export function visibleSplineControls(sk: Sketch, selection: Set<Id>): Set<Id> {
  return new Set(sk.entities.flatMap((e)=>e.type==="spline" && (selection.has(e.id)||curvePoints(e).some((id)=>selection.has(id))) ? e.segments.flatMap((s)=>[s.c1,s.c2]):[]));
}

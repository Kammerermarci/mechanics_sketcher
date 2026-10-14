import type { ArcPrim, LinePrim } from "./prims";
import { add, sub, mul, norm, perp, polar, type V } from "./geom";

/** A solid bar at the unheaded end, normal to the straight or curved shaft. */
export function arrowFoot(p: LinePrim | ArcPrim, enabled: boolean | undefined, width: number): LinePrim | null {
  if (!enabled || p.width === 0 || !!p.arrowA === !!p.arrowB) return null;
  let tail: V, normal: V;
  if (p.k === "line") {
    if (Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]) < 1e-9) return null;
    tail = p.arrowB ? p.a : p.b;
    normal = perp(norm(sub(p.b, p.a)));
  } else {
    if (p.r < 1e-9 || p.a1 - p.a0 < 1e-9) return null;
    const angle = p.arrowB ? p.a0 : p.a1;
    tail = polar(p.c, p.r, angle);
    normal = [Math.cos(angle), Math.sin(angle)];
  }
  const half = mul(normal, width / 2);
  return { k: "line", ref: p.ref, layer: p.layer, part: "foot", stroke: p.stroke,
    a: sub(tail, half), b: add(tail, half), ...(p.width !== undefined ? { width: p.width } : {}),
    ...(p.ink ? { ink: p.ink } : {}) };
}

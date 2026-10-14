import { point, type Sketch, type Support } from "./model";
import type { V } from "./geom";
import type { Prim } from "./prims";
import { CUSTOM_SUPPORT_SHAPES } from "./custom-support-shapes";

/** The supplied artwork in annotation millimetres, anchored at the joint. */
export function customSupportPrims(sk: Sketch, support: Support, mm: number): Prim[] {
  const at = point(sk, support.at), scale = sk.supportScale ?? 1;
  const c = Math.cos(support.angle), s = Math.sin(support.angle);
  const transform = ([x, y]: V): V => [at.x * mm + scale * (x * c - y * s), at.y * mm + scale * (x * s + y * c)];
  const base = { ref: support.id, layer: "sym" as const, stroke: "symbol" as const };
  const result: Prim[] = [];
  for (const shape of CUSTOM_SUPPORT_SHAPES[support.kind]) {
    const filled = shape.fill !== "none", stroked = shape.stroke !== "none" && shape.width > 0;
    if (shape.kind === "circle") {
      result.push({ ...base, k: "circle", c: transform(shape.center), r: shape.radius * scale,
        width: stroked ? shape.width * scale : 0, ink: shape.stroke,
        ...(filled ? { fill: "ink" as const, color: shape.fill } : {}) });
    } else {
      const pts = shape.points.map(transform);
      // SVG fills implicitly close a path; its outline may deliberately stay open.
      if (filled) result.push({ ...base, k: "poly", pts, fill: "ink", color: shape.fill, width: 0 });
      if (stroked) result.push({ ...base, k: "path", pts: shape.closed ? [...pts, pts[0]] : pts,
        width: shape.width * scale, ink: shape.stroke });
    }
  }
  return result;
}

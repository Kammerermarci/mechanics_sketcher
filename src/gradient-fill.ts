import type { FillGradient } from "./model";
import { colorAlpha } from "./color-channels";
import type { Outline } from "./prims";
import { cubicBounds } from "./bezier";
import { type V, type Box, emptyBox, grow, polar, inSweep, sub, dist, norm, perp, dot, add, mul } from "./geom";

export function defaultGradient(type: FillGradient["type"]): FillGradient {
  return { type, from: type === "linear" ? [0, 0.5] : [0.5, 0.5], to: [1, 0.5], color: "#ffffff" };
}

export function fillBounds(outlines: Outline[]): Box {
  const box = emptyBox();
  // Holes never determine the outer region's extent.
  const outline = outlines[0];
  if (!outline) return box;
  if (outline.kind === "circle") {
    grow(box, [outline.c[0] - outline.r, outline.c[1] - outline.r]);
    grow(box, [outline.c[0] + outline.r, outline.c[1] + outline.r]);
  } else {
    grow(box, outline.start);
    let from=outline.start;
    for (const seg of outline.segs) {
      grow(box, seg.to);
      if(seg.k==="C"){const b=cubicBounds([from,seg.c1,seg.c2,seg.to]);grow(box,[b.x0,b.y0]);grow(box,[b.x1,b.y1]);}
      if (seg.k === "A") for (const angle of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
        if (inSweep(angle, seg.ccw ? seg.a0 : seg.a1, seg.ccw ? seg.a1 : seg.a0)) grow(box, polar(seg.c, seg.r, angle));
      }
      from=seg.to;
    }
  }
  return box;
}

export function gradientPoints(outlines: Outline[], gradient: FillGradient): [V, V] {
  const b = fillBounds(outlines);
  const at = (p: V): V => [b.x0 + p[0] * (b.x1 - b.x0), b.y0 + p[1] * (b.y1 - b.y0)];
  return [at(gradient.from), at(gradient.to)];
}

export function gradientPosition(outlines: Outline[], p: V): V {
  const b = fillBounds(outlines);
  return [(p[0] - b.x0) / (b.x1 - b.x0 || 1), (p[1] - b.y0) / (b.y1 - b.y0 || 1)];
}

export function svgGradient(outlines: Outline[], gradient: FillGradient, startColor: string, id: string, map: (p: V) => V, scale: number): string {
  const [start, end] = gradientPoints(outlines, gradient), a = map(start), b = map(end);
  const stops = `<stop offset="0" stop-color="${startColor}"/><stop offset="1" stop-color="${gradient.color}"/>`;
  return gradient.type === "linear"
    ? `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}">${stops}</linearGradient></defs>`
    : `<defs><radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${a[0]}" cy="${a[1]}" r="${Math.max(1e-9, dist(start, end) * scale)}">${stops}</radialGradient></defs>`;
}

/** Portable TikZ gradient: fine colour bands clipped to the original region, including holes. */
export function tikzGradient(outlines: Outline[], gradient: FillGradient, startColor: string, path: string): string {
  const [a, b] = gradientPoints(outlines, gradient), box = fillBounds(outlines);
  const corners: V[] = [[box.x0, box.y0], [box.x1, box.y0], [box.x1, box.y1], [box.x0, box.y1]];
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const c0 = rgb(startColor), c1 = rgb(gradient.color);
  const alpha0 = colorAlpha(startColor), alpha1 = colorAlpha(gradient.color);
  const transparent = alpha0 < 1 || alpha1 < 1;
  const color = (t: number) => `{rgb,255:red,${Math.round(c0[0] + (c1[0] - c0[0]) * t)};green,${Math.round(c0[1] + (c1[1] - c0[1]) * t)};blue,${Math.round(c0[2] + (c1[2] - c0[2]) * t)}}${transparent ? `, fill opacity=${Number((alpha0 + (alpha1 - alpha0) * t).toFixed(6))}` : ""}`;
  const co = (p: V) => `(${p[0].toFixed(5)},${p[1].toFixed(5)})`;
  const parts = [`  \\begin{scope}`, `    \\path ${co(corners[0])} rectangle ${co(corners[2])};`, `    \\clip[even odd rule] ${path};`, `    \\begin{pgfinterruptboundingbox}`];
  const radius = Math.max(1e-9, dist(a, b)), count = 128;
  if (gradient.type === "radial") {
    // Transparent rings must not overlap: stacking translucent disks changes their opacity.
    const outerHole = transparent ? ` ${co(a)} circle[radius=${radius.toFixed(5)}]` : "";
    parts.push(`    \\fill[fill=${color(1)}${transparent ? ", even odd rule" : ""}] ${co(corners[0])} rectangle ${co(corners[2])}${outerHole};`);
    for (let i = count; i > 0; i--) {
      const inner = transparent && i > 1 ? ` ${co(a)} circle[radius=${(radius * (i - 1) / count).toFixed(5)}]` : "";
      parts.push(`    \\fill[fill=${color((i - 0.5) / count)}${transparent ? ", even odd rule" : ""}] ${co(a)} circle[radius=${(radius * i / count).toFixed(5)}]${inner};`);
    }
  } else {
    const u = norm(sub(b, a)), n = perp(u);
    const projections = corners.map((p) => dot(sub(p, a), u) / radius);
    const across = Math.max(...corners.map((p) => Math.abs(dot(sub(p, a), n)))) + 1;
    const band = (lo: number, hi: number, t: number) => {
      const at = (x: number, y: number) => co(add(a, add(mul(u, x * radius), mul(n, y))));
      parts.push(`    \\fill[fill=${color(t)}] ${at(lo, -across)} -- ${at(hi, -across)} -- ${at(hi, across)} -- ${at(lo, across)} -- cycle;`);
    };
    const lo = Math.min(0, ...projections) - 1, hi = Math.max(1, ...projections) + 1;
    band(lo, transparent ? 0 : 0.00001, 0);
    for (let i = 0; i < count; i++) band(i / count, (i + 1) / count + (transparent ? 0 : 0.00001), (i + 0.5) / count);
    band(1, hi, 1);
  }
  parts.push("    \\end{pgfinterruptboundingbox}", "  \\end{scope}");
  return parts.join("\n");
}

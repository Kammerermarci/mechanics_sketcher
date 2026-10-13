import { describe, it, expect } from "vitest";
import { defaultGradient, gradientPoints, gradientPosition, fillBounds } from "../src/gradient-fill";
import { emptySketch, addPoint, addCircle, addSymbol, serialize, deserialize, point, type Fill } from "../src/model";
import { fillOutlines, buildPrims } from "../src/prims";
import { toSvg, toTikz } from "../src/export";
import { drawPrims } from "../src/render";
import { linearCopy, mirrorCopy } from "../src/pattern";

function fixture(type: "linear" | "radial") {
  const sk = emptySketch(), center = addPoint(sk, 5, 3), circle = addCircle(sk, center.id, 4);
  const hole = addCircle(sk, center.id, 1);
  const fill = addSymbol(sk, { type: "fill", circle: circle.id, color: "#1565c0", gradient: defaultGradient(type), points: [], arcs: [], curves: [], holes: [hole.id] });
  return { sk, circle, fill };
}

describe("gradient fills", () => {
  it("keeps handles relative to the boundary when it moves and resizes", () => {
    const { sk, circle, fill } = fixture("radial");
    expect(gradientPoints(fillOutlines(sk, fill, 1), fill.gradient!)).toEqual([[5, 3], [9, 3]]);
    circle.r = 8;
    point(sk, circle.c).x = 7;
    const outlines = fillOutlines(sk, fill, 1);
    expect(gradientPoints(outlines, fill.gradient!)).toEqual([[7, 3], [15, 3]]);
    expect(gradientPosition(outlines, [15, 3])).toEqual([1, 0.5]);
    expect(fillBounds(outlines)).toEqual({ x0: -1, y0: -5, x1: 15, y1: 11 });
  });
  it.each(["linear", "radial"] as const)("saves and exports %s gradients with hole clipping", (type) => {
    const { sk, fill } = fixture(type);
    expect(deserialize(serialize(sk)).symbols).toContainEqual(fill);
    const svg = toSvg(sk)!;
    expect(svg).toContain(type === "linear" ? "<linearGradient" : "<radialGradient");
    expect(svg).toContain('stop-color="#1565c0"');
    expect(svg).toContain('stop-color="#ffffff"');
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg).not.toMatch(/NaN|Infinity/);
    const tikz = toTikz(sk)!;
    expect(tikz).toContain("\\clip[even odd rule]");
    expect(tikz.match(/\\fill\[fill=\{rgb/g)?.length).toBeGreaterThanOrEqual(128);
    expect(tikz).not.toMatch(/NaN|Infinity/);
    const screen = drawPrims({ view: { cx: 0, cy: 0, scale: 40, w: 800, h: 600 }, mm: 1, prims: buildPrims(sk, 1, { editor: false }), selection: new Set(), related: new Set(), hover: null, conflicting: new Set(), redundant: new Set(), freeIds: new Set() });
    expect(screen).toContain(type === "linear" ? "<linearGradient" : "<radialGradient");
  });
  it("keeps gradient colours and direction in translated copies", () => {
    const { sk, circle, fill } = fixture("linear");
    const result = linearCopy(sk, [circle.id], 2, [10, 0]);
    if (typeof result === "string") throw new Error(result);
    const copy = sk.symbols.find((s): s is Fill => s.type === "fill" && s.id !== fill.id)!;
    expect(copy.gradient).toEqual(fill.gradient);
    const [a, b] = gradientPoints(fillOutlines(sk, copy, 1), copy.gradient!);
    expect(a).toEqual([11, 3]);
    expect(b).toEqual([19, 3]);
  });
  it("mirrors gradient handles along with their geometry", async () => {
    const { addLine } = await import("../src/model");
    const { sk, circle, fill } = fixture("linear");
    const a = addPoint(sk, 0, -10), b = addPoint(sk, 0, 10), axis = addLine(sk, a.id, b.id);
    const result = mirrorCopy(sk, [circle.id], axis.id);
    if (typeof result === "string") throw new Error(result);
    const copy = sk.symbols.find((s): s is Fill => s.type === "fill" && s.id !== fill.id)!;
    const handles = gradientPoints(fillOutlines(sk, copy, 1), copy.gradient!);
    expect(handles).toEqual([[-1, 3], [-9, 3]]);
  });
  it("falls back to a solid fill when saved gradient coordinates are invalid", () => {
    const { sk, fill } = fixture("linear");
    fill.gradient!.to = [NaN, 0];
    const loaded = deserialize(serialize(sk));
    expect((loaded.symbols.find((s) => s.id === fill.id) as Fill).gradient).toBeUndefined();
  });
});

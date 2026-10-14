import { describe, it, expect, vi } from "vitest";
import { App } from "../src/app";
import { History } from "../src/history";
import { emptySketch, addPoint, addLine, addCircle, addArc, addSymbol, serialize, deserialize, entity } from "../src/model";
import { buildPrims, invisibleStroke, arrowHeads, primDistance, type Prim } from "../src/prims";
import { drawPrims } from "../src/render";
import { toSvg, toTikz, primsToTikz, primsToSvg } from "../src/export";
import { copyObjects, pasteObjects } from "../src/object-clipboard";
import { newPlot, plotPrims, plotTikz } from "../src/plot";

function screen(prims: Prim[]) {
  return drawPrims({ prims, view: { cx: 0, cy: 0, scale: 40, w: 800, h: 600 }, mm: 10,
    selection: new Set(), related: new Set(), hover: null, conflicting: new Set(), redundant: new Set(), freeIds: new Set() });
}

describe("zero-width strokes", () => {
  it("hides lines, circles, arcs, arrowheads and springs but keeps their primitives available for picking", () => {
    const sk = emptySketch(), a = addPoint(sk, 0, 0), b = addPoint(sk, 4, 0), c = addPoint(sk, 0, 4);
    const line = addLine(sk, a.id, b.id), circle = addCircle(sk, a.id, 2), arc = addArc(sk, a.id, b.id, c.id);
    const spring = addLine(sk, b.id, c.id); spring.element = "spring";
    for (const e of [line, circle, arc, spring]) e.weight = 0;
    line.arrow = "both"; arc.arrow = "both";
    const prims = buildPrims(sk, 10, { editor: true });
    expect(prims.length).toBeGreaterThanOrEqual(4);
    expect(prims.every(invisibleStroke)).toBe(true);
    const stroke = prims.find((p) => p.ref === line.id)!;
    expect(primDistance(stroke, [20, 0])).toBe(0);
    for (const p of prims) if (p.k === "line" || p.k === "arc") expect(arrowHeads(p)).toHaveLength(0);
    expect(screen(prims)).toBe("");
    expect(toSvg(sk)).toBeNull(); expect(toTikz(sk)).not.toContain("\\draw[");
  });

  it("retains fills and labels in the editor, SVG and TikZ without emitting hairline outlines", () => {
    const sk = emptySketch(), center = addPoint(sk, 0, 0), circle = addCircle(sk, center.id, 3);
    circle.weight = 0;
    addSymbol(sk, { type: "fill", circle: circle.id, color: "#123456", points: [], curves: [], arcs: [], holes: [] });
    const arrow = addLine(sk, center.id, addPoint(sk, 5, 0).id);
    arrow.arrow = "both"; arrow.label = "F"; arrow.weight = 0;
    const prims = buildPrims(sk, 10, { editor: false });
    expect(prims.some((p) => p.k === "region")).toBe(true);
    expect(prims.some((p) => p.k === "text" && p.tex === "F")).toBe(true);
    const svg = toSvg(sk)!;
    expect(svg).toContain('fill="#123456"'); expect(svg).not.toContain("<line "); expect(svg).not.toContain("<circle ");
    const tikz = toTikz(sk)!;
    expect(tikz).toContain("\\fill["); expect(tikz).toContain("$F$"); expect(tikz).not.toContain("\\draw[");
    expect(screen(prims)).toContain('fill="#123456"');
  });

  it("retains solid primitive fills with an explicitly hidden stroke in both exporters", () => {
    const prims: Prim[] = [{ k: "circle", layer: "sym", stroke: "member", width: 0, c: [0, 0], r: 2, fill: "ink", color: "#123456" }];
    expect(screen(prims)).toMatch(/stroke-width="0(?:\.0+)?"/);
    expect(primsToSvg(prims)).toContain('stroke-width="0"');
    expect(primsToTikz(prims)).toContain("draw=none");
  });

  it("sets zero with the thickness slider and preserves it in history, saved files, and pasted copies", () => {
    const sk = emptySketch(), line = addLine(sk, addPoint(sk, 0, 0).id, addPoint(sk, 4, 0).id);
    const history = new History(); history.reset(sk);
    const app = Object.assign(Object.create(App.prototype), {
      sk, selection: new Set([line.id]), render: vi.fn(), commit: () => history.commit(sk),
    }) as any;
    app.onPanelChange({ dataset: { field: "weight" }, value: "0" });
    expect(line.weight).toBe(0);
    expect(entity(history.undo()!, line.id)).not.toHaveProperty("weight");
    expect(entity(history.redo()!, line.id)).toMatchObject({ weight: 0 });
    expect(entity(deserialize(serialize(sk)), line.id)).toMatchObject({ weight: 0 });
    const target = emptySketch();
    expect(entity(target, pasteObjects(target, copyObjects(sk, [line.id])!, [2, 2])[0])).toMatchObject({ weight: 0 });
    app.resetWeight(); expect(line.weight).toBeUndefined();
  });

  it("hides plot outlines while retaining shading and labels, including in pgfplots export", () => {
    const sk = emptySketch(), plot = newPlot(sk), curve = plot.curves[0];
    curve.weight = 0; curve.fill = true; curve.label = "f"; curve.pieces = [{ expr: "x" }];
    const prims = plotPrims(plot);
    expect(prims.some((p) => p.k === "region")).toBe(true);
    expect(prims.some((p) => p.k === "text" && p.tex === "f")).toBe(true);
    expect(prims.filter((p) => p.ref === curve.id && p.k === "path").every(invisibleStroke)).toBe(true);
    const tikz = plotTikz(plot);
    expect(tikz).toContain("\\addplot[draw=none");
    expect(tikz).not.toContain("line width=0pt");
  });
});

import { describe, it, expect } from "vitest";
import { emptySketch, addPoint, addCircle, addLine, addSymbol, serialize, deserialize, type Sketch } from "../src/model";
import { buildPrims } from "../src/prims";
import { figurePrims } from "../src/export";
import { moveInZ } from "../src/z-order";
import { App } from "../src/app";

function filledCircles() {
  const sk = emptySketch();
  const a = addPoint(sk, 0, 0), b = addPoint(sk, 1, 0);
  const circleA = addCircle(sk, a.id, 2), circleB = addCircle(sk, b.id, 2);
  const fillA = addSymbol(sk, { type: "fill", circle: circleA.id, color: "#d5dbe1", points: [], arcs: [], curves: [], holes: [] });
  const fillB = addSymbol(sk, { type: "fill", circle: circleB.id, color: "#f6d9a8", points: [], arcs: [], curves: [], holes: [] });
  return { sk, circleA, circleB, fillA, fillB };
}
const order = (sk: Sketch) => [...new Set(buildPrims(sk, 10, { editor: true }).map(p => p.stack))];

describe("object depth order", () => {
  it("paints each fill immediately with its own outline, before the next object", () => {
    const { sk, circleA, circleB, fillA, fillB } = filledCircles();
    expect(buildPrims(sk, 10, { editor: false }).map(p => [p.ref, p.stack])).toEqual([
      [fillA.id, fillA.id], [circleA.id, fillA.id], [fillB.id, fillB.id], [circleB.id, fillB.id],
    ]);
  });

  it("raises or lowers the whole filled object when its outline is selected", () => {
    const { sk, circleA, fillA, fillB } = filledCircles();
    expect(moveInZ(sk, new Set([circleA.id]), buildPrims(sk, 10, { editor: true }), 1)).toBe(true);
    expect(order(sk)).toEqual([fillB.id, fillA.id]);
    expect(moveInZ(sk, new Set([fillA.id]), buildPrims(sk, 10, { editor: true }), -1)).toBe(true);
    expect(order(sk)).toEqual([fillA.id, fillB.id]);
    expect(moveInZ(sk, new Set([fillA.id]), buildPrims(sk, 10, { editor: true }), -1)).toBe(false);
  });

  it("preserves saved ordering in both editor and exported primitives", () => {
    const { sk, fillA, fillB } = filledCircles();
    moveInZ(sk, new Set([fillA.id]), buildPrims(sk, 10, { editor: true }), 1);
    const loaded = deserialize(serialize(sk));
    expect(order(loaded)).toEqual([fillB.id, fillA.id]);
    expect([...new Set(figurePrims(loaded).map(p => p.stack))]).toEqual([fillB.id, fillA.id]);
    const note = addSymbol(loaded, { type: "note", x: 0, y: 0, text: "New object" });
    expect(order(loaded)).toEqual([fillB.id, fillA.id, note.id]);
  });

  it("moves multiple selected objects one step without reversing them", () => {
    const { sk, fillA, fillB } = filledCircles();
    const note = addSymbol(sk, { type: "note", x: 0, y: 0, text: "Note" });
    moveInZ(sk, new Set([fillA.id, fillB.id]), buildPrims(sk, 10, { editor: true }), 1);
    expect(order(sk)).toEqual([note.id, fillA.id, fillB.id]);
  });

  it("groups polygon and hole boundary strokes at the fill depth", () => {
    const sk = emptySketch();
    const corners = [[0, 0], [4, 0], [4, 4], [0, 4]].map(([x, y]) => addPoint(sk, x, y));
    const lines = corners.map((p, i) => addLine(sk, p.id, corners[(i + 1) % 4].id));
    const hole = addCircle(sk, addPoint(sk, 2, 2).id, 0.5);
    const fill = addSymbol(sk, { type: "fill", color: "#d5dbe1", points: corners.map(p => p.id), arcs: [null, null, null, null], curves: lines.map(l => l.id), holes: [hole.id] });
    expect(order(sk)).toEqual([fill.id]);
    expect(buildPrims(sk, 10, { editor: true }).filter(p => p.stack === fill.id)).toHaveLength(6);
  });

  it("picks the frontmost overlapping fill first", () => {
    const { sk, fillA, fillB } = filledCircles();
    const app = Object.assign(Object.create(App.prototype), {
      sk, glyphs: [], view: { cx: 0, cy: 0, scale: 40, w: 800, h: 600 },
      mm: () => 10, prims: buildPrims(sk, 10, { editor: true }),
    }) as { prims: ReturnType<typeof buildPrims>; hitCandidates(sp: [number, number]): { id: string }[] };
    expect(app.hitCandidates([410, 310])[0].id).toBe(fillB.id);
    moveInZ(sk, new Set([fillB.id]), app.prims, -1);
    app.prims = buildPrims(sk, 10, { editor: true });
    expect(app.hitCandidates([410, 310])[0].id).toBe(fillA.id);
  });
});

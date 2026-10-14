import { describe, expect, it, vi } from "vitest";
import { emptySketch, addPoint, addLine, addCircle, addArc, addSymbol, entity, serialize, deserialize, type Line, type Spline } from "../src/model";
import { selectedColorCurves, setStrokeColor } from "../src/stroke-colors";
import { addSpline, closeSpline, splitSpline, openSpline } from "../src/splines";
import { buildPrims } from "../src/prims";
import { toSvg, toTikz } from "../src/export";
import { linearCopy } from "../src/pattern";
import { copyObjects, pasteObjects } from "../src/object-clipboard";
import { applyTrim, planTrim } from "../src/trim";
import { History } from "../src/history";
import { App } from "../src/app";

function fixture() {
  const sk = emptySketch(), a = addPoint(sk, 0, 0), b = addPoint(sk, 4, 0), c = addPoint(sk, 0, 4);
  const line = addLine(sk, a.id, b.id), circle = addCircle(sk, a.id, 2), arc = addArc(sk, a.id, b.id, c.id);
  const spline = addSpline(sk, [{ p1: a.id, c1: addPoint(sk, 1, 2).id, c2: addPoint(sk, 3, 2).id, p2: b.id }]);
  return { sk, a, line, circle, arc, spline };
}

describe("geometry stroke colors", () => {
  it("colors multiple curves together without changing points or fills", () => {
    const { sk, a, line, circle, arc, spline } = fixture();
    const fill = addSymbol(sk, { type: "fill", circle: circle.id, color: "#d5dbe1", points: [], arcs: [], curves: [], holes: [] });
    const selection = [a.id, line.id, circle.id, arc.id, spline.id, fill.id];
    expect(setStrokeColor(selectedColorCurves(sk, selection), "#1565c080")).toBe(true);
    expect([line, circle, arc, spline].map((e) => e.color)).toEqual(Array(4).fill("#1565c080"));
    expect(fill.color).toBe("#d5dbe1"); expect(a).not.toHaveProperty("color");
  });
  it("renders and exports line, circle, arc and spline colors with opacity", () => {
    const { sk, line, circle, arc, spline } = fixture();
    const objects = [line, circle, arc, spline]; setStrokeColor(objects, "#1565c080");
    const prims = buildPrims(sk, 1, { editor: false });
    for (const object of objects) expect(prims.find((p) => p.ref === object.id)).toHaveProperty("ink", "#1565c080");
    expect(toSvg(sk)).toContain('stroke="#1565c0" stroke-opacity="0.501961"');
    expect(toTikz(sk)).toContain("draw={rgb,255:red,21;green,101;blue,192}, draw opacity=0.501961");
    const saved = deserialize(serialize(sk));
    for (const object of objects) expect(entity(saved, object.id)).toHaveProperty("color", "#1565c080");
  });
  it("recolors selected ordinary lines as one undoable app edit", () => {
    const { sk, line } = fixture(), other = addLine(sk, addPoint(sk, 7, 0).id, addPoint(sk, 7, 4).id);
    const history = new History(); history.reset(sk);
    const commit = vi.fn(() => history.commit(sk));
    const app = Object.assign(Object.create(App.prototype), { sk, selection: new Set([line.id, other.id]), commit });
    app.setColor("#d32f2f");
    expect(line.color).toBe("#d32f2f"); expect(other.color).toBe("#d32f2f"); expect(commit).toHaveBeenCalledOnce();
    expect(entity(history.undo()!, line.id)).not.toHaveProperty("color");
    expect(entity(history.redo()!, other.id)).toHaveProperty("color", "#d32f2f");
  });
  it("preserves curve colors in patterns and independent pasted copies", () => {
    const { sk, line, circle, arc, spline } = fixture();
    setStrokeColor([line, circle, arc, spline], "#6a1b9a");
    expect(typeof linearCopy(sk, [line.id, circle.id, arc.id, spline.id], 2, [10, 0])).not.toBe("string");
    expect(sk.entities.filter((e) => e.type !== "point").every((e) => e.color === "#6a1b9a")).toBe(true);
    const pasted = emptySketch(); pasteObjects(pasted, copyObjects(sk, [line.id, circle.id, arc.id, spline.id])!, [30, 0]);
    expect(pasted.entities.filter((e) => e.type !== "point").every((e) => e.color === "#6a1b9a")).toBe(true);
  });
  it("preserves line colors in both pieces after trimming", () => {
    const sk = emptySketch();
    const line = addLine(sk, addPoint(sk, 0, 0).id, addPoint(sk, 10, 0).id); line.color = "#d32f2f";
    for (const x of [3, 7]) addLine(sk, addPoint(sk, x, -2).id, addPoint(sk, x, 2).id);
    applyTrim(sk, planTrim(sk, line.id, [5, 0])!);
    const pieces = sk.entities.filter((e): e is Line => e.type === "line" && e.color === "#d32f2f");
    expect(pieces).toHaveLength(2);
  });
  it("preserves spline colors when splitting and keeps construction colors in the editor", () => {
    const { sk, spline, line } = fixture(); spline.color = "#2e7d32";
    closeSpline(sk, spline); openSpline(sk, spline);
    const tail = splitSpline(sk, spline, spline.segments[1].p1) as Spline; expect(tail.color).toBe("#2e7d32");
    line.color = "#d32f2f"; line.construction = true;
    expect(buildPrims(sk, 1, { editor: true }).find((p) => p.ref === line.id)?.ink).toBeUndefined();
    expect(buildPrims(sk, 1, { editor: false }).some((p) => p.ref === line.id)).toBe(false);
  });
});

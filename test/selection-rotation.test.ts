import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { make_gcs_wrapper } from "@salusoft89/planegcs";
import { SketchSolver } from "../src/solver";
import { App } from "../src/app";
import { History } from "../src/history";
import { addPoint, addLine, addCircle, addArc, addConstraint, addSymbol, clone, emptySketch, point, type Sketch } from "../src/model";
import { rotationSelection, rotateSelection, rotatePosition, rotationHandles, rotationOverlay } from "../src/selection-rotation";
import { rectangleParts } from "../src/primitive-geometry";
import { addSpline } from "../src/splines";
import { defaultGradient, gradientPoints } from "../src/gradient-fill";
import { fillOutlines } from "../src/prims";
import { toScreen, type View } from "../src/render";

let solver: SketchSolver;
beforeAll(async () => { solver = new SketchSolver(await make_gcs_wrapper()); });
afterAll(() => solver.dispose());
afterEach(() => vi.unstubAllGlobals());
const view: View = { cx: 2, cy: 0, scale: 40, w: 800, h: 600 };
function fixture() {
  const sk = emptySketch(), a = addPoint(sk, 0, 0), b = addPoint(sk, 4, 0), line = addLine(sk, a.id, b.id);
  return { sk, a, b, line };
}
function editor(sk: Sketch, id: string, selected = false) {
  vi.stubGlobal("document", { activeElement: null });
  vi.stubGlobal("HTMLElement", class {});
  const history = new History(); history.reset(sk);
  return Object.assign(Object.create(App.prototype), {
    sk, solver, history, result: solver.solve(sk), view: { ...view }, tab: "sketch", preview: false,
    selection: new Set(selected ? [id] : []), selectionRotation: null, tool: "select", editing: null,
    screenPos: (e: { pos: [number, number] }) => e.pos,
    svg: { setPointerCapture: vi.fn(), hasPointerCapture: () => false },
    pickAt: () => ({ id, kind: "curve" }), touch: vi.fn(), render: vi.fn(), autosave: vi.fn(), toast: vi.fn(),
  }) as any;
}
const event = (pos: [number, number], extra = {}) => ({ pos: toScreen(view, pos), button: 0, pointerId: 1, timeStamp: 1000, type: "pointerup", ...extra });

describe("selection rotation interaction", () => {
  it("selects on the first click, shows rotation on the next click, and rotates with one Undo step", () => {
    const { sk, a, b, line } = fixture(), app = editor(sk, line.id);
    app.onPointerDown(event([0, 0])); app.onPointerUp(event([0, 0]));
    expect(app.selectionRotation).toBeNull();
    app.onPointerDown(event([0, 0])); app.onPointerUp(event([0, 0]));
    expect(app.selectionRotation.pivot).toEqual([2, 0]);
    expect(app.selection).toEqual(new Set([line.id]));
    app.onPointerDown(event([2, 1.5]));
    expect(app.drag.kind).toBe("rotation");
    app.onPointerMove(event([3.5, 0])); app.onPointerUp(event([3.5, 0]));
    expect(point(app.sk, a.id).x).toBeCloseTo(2); expect(point(app.sk, a.id).y).toBeCloseTo(2);
    expect(point(app.sk, b.id).x).toBeCloseTo(2); expect(point(app.sk, b.id).y).toBeCloseTo(-2);
    expect(app.history.undo()).toEqual(sk);
    expect(app.history.undo()).toBeNull();
    expect(app.history.redo()).toEqual(app.sk);
    expect(app.view).toEqual(view);
  });
  it("keeps the existing translation drag even when pressing an already selected object", () => {
    const { sk, a, line } = fixture(), app = editor(sk, line.id, true);
    app.onPointerDown(event([0, 0])); app.onPointerMove(event([1, 2])); app.onPointerUp(event([1, 2]));
    expect(point(app.sk, a.id).x).toBeCloseTo(1); expect(point(app.sk, a.id).y).toBeCloseTo(2);
    expect(app.selectionRotation).toBeNull();
  });
  it("moves the pivot without editing the document or Undo history, then rotates about that pivot", () => {
    const { sk, a, line } = fixture(), app = editor(sk, line.id, true), original = clone(sk);
    app.toggleSelectionRotation();
    app.onPointerDown(event([2, 0])); app.onPointerMove(event([1, 1])); app.onPointerUp(event([1, 1]));
    expect(app.selectionRotation.pivot).toEqual([1, 1]);
    expect(app.sk).toEqual(original); expect(app.history.undo()).toBeNull();
    app.onPointerDown(event([1, 2.5])); app.onPointerMove(event([2.5, 1])); app.onPointerUp(event([2.5, 1]));
    expect(point(app.sk, a.id).x).toBeCloseTo(0); expect(point(app.sk, a.id).y).toBeCloseTo(2);
  });
  it("snaps to 15 degrees with Shift and rolls back a cancelled rotation", () => {
    const { sk, a, line } = fixture(), app = editor(sk, line.id, true), original = clone(sk);
    app.toggleSelectionRotation();
    app.onPointerDown(event([2, 1.5], { shiftKey: true }));
    const angle = Math.PI / 2 + 19 * Math.PI / 180;
    app.onPointerMove(event([2 + 1.5 * Math.cos(angle), 1.5 * Math.sin(angle)], { shiftKey: true }));
    const expected = rotatePosition([0, 0], [2, 0], Math.PI / 12);
    expect(point(app.sk, a.id).x).toBeCloseTo(expected[0]); expect(point(app.sk, a.id).y).toBeCloseTo(expected[1]);
    app.onPointerUp(event([0, 0], { type: "pointercancel" }));
    expect(app.sk).toEqual(original); expect(app.history.undo()).toBeNull();
  });
  it("returns to moving after another click, and clears rotation when the selection changes", () => {
    const { sk, line } = fixture(), app = editor(sk, line.id, true);
    app.toggleSelectionRotation();
    app.onPointerDown(event([0, 0])); app.onPointerUp(event([0, 0]));
    expect(app.selectionRotation).toBeNull();
    app.toggleSelectionRotation(); app.selection.clear();
    expect(app.activeSelectionRotation()).toBeNull();
  });
  it("keeps rotation controls the same size at different zoom levels", () => {
    const mode = { key: "x", pivot: [2, 0] as [number, number], angle: Math.PI / 2 };
    for (const scale of [10, 100]) {
      const h = rotationHandles({ ...view, scale }, mode);
      expect(Math.hypot(h.handle[0] - h.pivot[0], h.handle[1] - h.pivot[1])).toBeCloseTo(60);
      expect(rotationOverlay({ ...view, scale }, mode)).toContain('class="rotation-pivot"');
    }
  });
  it("rotates a selected filled shape and its hole together when dragging its body", () => {
    const sk = emptySketch(), c = addPoint(sk, 10, 0), h = addPoint(sk, 11, 0);
    const circle = addCircle(sk, c.id, 4), hole = addCircle(sk, h.id, 1);
    const fill = addSymbol(sk, { type: "fill", circle: circle.id, color: "#1565c080", gradient: defaultGradient("linear"), points: [], curves: [], arcs: [], holes: [hole.id] });
    const app = editor(sk, fill.id, true);
    app.pickAt = () => ({ id: fill.id, kind: "fill" });
    app.selection.add(circle.id); app.selection.add(hole.id);
    app.toggleSelectionRotation();
    app.onPointerDown(event([13, 0]));
    expect(app.drag.kind).toBe("rotation");
    app.onPointerMove(event([10, 3])); app.onPointerUp(event([10, 3]));
    expect(point(app.sk, h.id).x).toBeCloseTo(10); expect(point(app.sk, h.id).y).toBeCloseTo(1);
    expect(app.selection).toEqual(new Set([fill.id, circle.id, hole.id]));
    const turnedFill = app.sk.symbols.find((s: { id: string }) => s.id === fill.id);
    expect(fillOutlines(app.sk, turnedFill, 1)).toHaveLength(2);
    const stops = gradientPoints(fillOutlines(app.sk, turnedFill, 1), turnedFill.gradient);
    expect(stops[0][0]).toBeCloseTo(10); expect(stops[1][0]).toBeCloseTo(10);
  });
  it("snaps the movable pivot to the grid and lets Alt place it freely", () => {
    const { sk, line } = fixture(), app = editor(sk, line.id, true);
    sk.snapToGrid = true; sk.backgroundSpacingMm = 0.5;
    app.toggleSelectionRotation(); app.onPointerDown(event([2, 0]));
    app.onPointerMove(event([2.7, 0.6]));
    expect(app.selectionRotation.pivot).toEqual([2.5, 0.5]);
    app.onPointerMove(event([2.7, 0.6], { altKey: true }));
    expect(app.selectionRotation.pivot[0]).toBeCloseTo(2.7); expect(app.selectionRotation.pivot[1]).toBeCloseTo(0.6);
    app.onPointerUp(event([2.7, 0.6]));
    expect(app.history.undo()).toBeNull();
  });
  it("Escape discards a live rotation without losing the selection", () => {
    const { sk, line } = fixture(), app = editor(sk, line.id, true), original = clone(sk);
    app.toggleSelectionRotation(); app.onPointerDown(event([2, 1.5])); app.onPointerMove(event([3.5, 0]));
    app.cancel();
    expect(app.sk).toEqual(original); expect(app.drag).toBeNull(); expect(app.selectionRotation).toBeNull();
    expect(app.selection).toEqual(new Set([line.id])); expect(app.history.undo()).toBeNull();
  });
});

describe("rigid selection rotation", () => {
  it("preserves relative rectangle constraints, attached symbols, and gradient positions", () => {
    const sk = emptySketch(), rect = rectangleParts(sk, [[1, 1], [5, 1], [5, 3], [1, 3]], "rect3");
    rect.autos.forEach(c => addConstraint(sk, c));
    const corners = rect.made.map(id => { const e = sk.entities.find(e => e.id === id)!; return e.type === "line" ? e.p1 : ""; });
    const fill = addSymbol(sk, { type: "fill", color: "#1565c080", gradient: defaultGradient("linear"), points: corners, curves: rect.made, arcs: [null, null, null, null], holes: [] });
    const support = addSymbol(sk, { type: "support", at: corners[0], kind: "pin", angle: 0 });
    const snapshot = rotationSelection(sk, rect.made)!, stops = gradientPoints(fillOutlines(sk, fill, 1), fill.gradient!);
    const turned = rotateSelection(snapshot, solver, [0, 0], Math.PI / 3)!;
    expect(turned).not.toBeNull();
    expect(turned.sketch.constraints).toEqual(sk.constraints);
    const turnedSupport = turned.sketch.symbols.find(s => s.id === support.id)!;
    expect(turnedSupport.type === "support" && turnedSupport.angle).toBeCloseTo(Math.PI / 3);
    const turnedFill = turned.sketch.symbols.find(s => s.id === fill.id)!;
    if (turnedFill.type !== "fill") throw Error();
    const newStops = gradientPoints(fillOutlines(turned.sketch, turnedFill, 1), turnedFill.gradient!);
    newStops.forEach((p, i) => { const q = rotatePosition(stops[i], [0, 0], Math.PI / 3); expect(p[0]).toBeCloseTo(q[0]); expect(p[1]).toBeCloseTo(q[1]); });
    expect(sk).toEqual(snapshot.source);
  });
  it("rotates circles, arcs and spline controls together without cumulative drift", () => {
    const sk = emptySketch(), c = addPoint(sk, 5, 0), a = addPoint(sk, 7, 0), b = addPoint(sk, 5, 2);
    const circle = addCircle(sk, c.id, 2), arc = addArc(sk, c.id, a.id, b.id);
    const c1 = addPoint(sk, 8, 1), c2 = addPoint(sk, 6, 3), spline = addSpline(sk, [{ p1: a.id, c1: c1.id, c2: c2.id, p2: b.id }]);
    const snapshot = rotationSelection(sk, [circle.id, arc.id, spline.id])!;
    for (const angle of [Math.PI / 3, Math.PI, 0]) {
      const turned = rotateSelection(snapshot, solver, [1, 1], angle)!;
      expect(turned).not.toBeNull();
      for (const id of snapshot.points) {
        const p = point(sk, id), q = rotatePosition([p.x, p.y], [1, 1], angle);
        expect(point(turned.sketch, id).x).toBeCloseTo(q[0]); expect(point(turned.sketch, id).y).toBeCloseTo(q[1]);
      }
      const e = turned.sketch.entities.find(e => e.id === circle.id)!;
      expect(e.type === "circle" && e.r).toBeCloseTo(2);
    }
  });
  it("rejects rotation blocked by fixed points or world directions without deforming anything", () => {
    for (const type of ["fixed", "horizontal"] as const) {
      const { sk, a, b, line } = fixture();
      addConstraint(sk, type === "fixed" ? { type, p: a.id } : { type, a: a.id, b: b.id });
      const before = clone(sk), snapshot = rotationSelection(sk, [line.id])!;
      expect(rotateSelection(snapshot, solver, [2, 0], Math.PI / 4)).toBeNull();
      expect(sk).toEqual(before);
    }
  });
});

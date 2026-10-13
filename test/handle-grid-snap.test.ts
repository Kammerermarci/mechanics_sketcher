import { describe, it, expect, vi } from "vitest";
import { App } from "../src/app";
import { emptySketch, addPoint, addCircle, addSymbol, addFrame, point, type Sketch } from "../src/model";
import { toScreen, type View } from "../src/render";
import { defaultGradient, gradientPoints } from "../src/gradient-fill";
import { fillOutlines } from "../src/prims";
import type { V } from "../src/geom";

const view: View = { cx: -2, cy: 3, scale: 40, w: 800, h: 600 };
function appFor(sk: Sketch) {
  return Object.assign(Object.create(App.prototype), {
    sk, view: { ...view }, altKey: false, tool: "select", drag: null, snapMark: null,
    cursor: [0, 0], render: vi.fn(), solve: vi.fn(), mm: () => 2,
    screenPos: (event: { pos: V }) => event.pos,
  }) as {
    view: View; drag: unknown; solve: ReturnType<typeof vi.fn>; snapMark: { kind: string } | null;
    onPointerMove(event: PointerEvent): void;
    dragSymbol(drag: unknown, pos: V): void;
    dragAxis(drag: unknown, pos: V): void;
  };
}
const move = (pos: V, altKey = false, ctrlKey = false) => ({ pos: toScreen(view, pos), altKey, ctrlKey }) as unknown as PointerEvent;

describe("grid snapping existing handles", () => {
  it.each([false, true])("locks horizontal group movement with Ctrl and Alt=%s", (alt) => {
    const sk = { ...emptySketch(), snapToGrid: true }, app = appFor(sk);
    const a = addPoint(sk, 0.2, 0.3), b = addPoint(sk, 2.7, 1.1);
    app.drag = { kind: "move", grabbed: a.id, startScreen: toScreen(view, [0.25, 0.35]), startModel: [0.25, 0.35], targets: [a, b].map((p) => ({ id: p.id, x: p.x, y: p.y })), moved: false };
    app.onPointerMove(move([2.24, 0.74], alt, true));
    let targets = app.solve.mock.calls[0][0];
    expect(targets[0].x).toBeCloseTo(alt ? 2.19 : 2);
    expect(targets[0].y).toBe(0.3);
    expect(targets[1].y).toBe(1.1);
    // Crossing to a mostly vertical mouse displacement does not flip the chosen axis.
    app.onPointerMove(move([1.24, 6.74], alt, true));
    targets = app.solve.mock.calls[1][0];
    expect(targets[0].y).toBe(0.3);
    // Releasing Ctrl restores unrestricted movement.
    app.onPointerMove(move([1.24, 6.74], true, false));
    targets = app.solve.mock.calls[2][0];
    expect(targets[0].y).toBeCloseTo(6.69);
  });
  it("locks an Alt+Ctrl gradient endpoint vertically", () => {
    const sk = { ...emptySketch(), snapToGrid: true };
    const center = addPoint(sk, 0, 0), circle = addCircle(sk, center.id, 5);
    const fill = addSymbol(sk, { type: "fill", color: "#1565c0", gradient: defaultGradient("linear"), circle: circle.id, points: [], arcs: [], curves: [], holes: [] });
    const app = appFor(sk);
    app.drag = { kind: "gradient", id: fill.id, end: 1, startScreen: toScreen(view, [5, 0]), moved: false };
    app.onPointerMove(move([5.3, 2.7], true, true));
    const endpoint = gradientPoints(fillOutlines(sk, fill, 1), fill.gradient!)[1];
    expect(endpoint[0]).toBeCloseTo(5);
    expect(endpoint[1]).toBeCloseTo(2.7);
  });
  it.each([true, false])("moves a gradient endpoint with grid enabled=%s", (enabled) => {
    const sk = { ...emptySketch(), snapToGrid: enabled };
    const center = addPoint(sk, 0, 0), circle = addCircle(sk, center.id, 5);
    const fill = addSymbol(sk, { type: "fill", color: "#1565c0", gradient: defaultGradient("radial"), circle: circle.id, points: [], arcs: [], curves: [], holes: [] });
    const app = appFor(sk), camera = { ...app.view };
    app.drag = { kind: "gradient", id: fill.id, end: 1, startScreen: toScreen(view, [5, 0]), moved: false };
    app.onPointerMove(move([2.2, 3.7]));
    const end = gradientPoints(fillOutlines(sk, fill, 1), fill.gradient!)[1];
    expect(end[0]).toBeCloseTo(enabled ? 2 : 2.2);
    expect(end[1]).toBeCloseTo(enabled ? 4 : 3.7);
    expect(app.view).toEqual(camera);
    app.onPointerMove(move([3.2, 4.4], true));
    const free = gradientPoints(fillOutlines(sk, fill, 1), fill.gradient!)[1];
    expect(free[0]).toBeCloseTo(3.2);
    expect(free[1]).toBeCloseTo(4.4);
  });
  it("snaps a group's grabbed point rather than its mouse position and preserves offsets", () => {
    const sk = { ...emptySketch(), snapToGrid: true }, app = appFor(sk);
    const a = addPoint(sk, 0.2, 0.3), b = addPoint(sk, 2.7, 1.1);
    app.drag = { kind: "move", grabbed: a.id, startScreen: toScreen(view, [0.25, 0.35]), startModel: [0.25, 0.35], targets: [a, b].map((p) => ({ id: p.id, x: p.x, y: p.y })), moved: false };
    app.onPointerMove(move([2.24, 3.74]));
    const targets = app.solve.mock.calls[0][0];
    expect(targets[0]).toMatchObject({ id: a.id, x: 2, y: 4 });
    expect(targets[1].x - targets[0].x).toBeCloseTo(b.x - a.x);
    expect(targets[1].y - targets[0].y).toBeCloseTo(b.y - a.y);
    expect(app.snapMark?.kind).toBe("grid");
  });
  it("snaps a moved note's anchor while preserving its grab offset", () => {
    const sk = { ...emptySketch(), snapToGrid: true }, app = appFor(sk);
    const note = addSymbol(sk, { type: "note", x: 0.2, y: 0.3, text: "Example" });
    app.dragSymbol({ kind: "sym", id: note.id, startModel: [0.5, 0.7], origin: [0.2, 0.3] }, toScreen(view, [2.4, 3.8]));
    expect([note.x, note.y]).toEqual([2, 3]);
  });
  it("snaps axis tips after compensating for the initial grab offset", () => {
    const sk = { ...emptySketch(), snapToGrid: true }, app = appFor(sk);
    const frame = addFrame(sk, 0, 0);
    app.dragAxis({ kind: "axis", id: frame.id, axis: "x", slack: 0.4 }, toScreen(view, [3.3, 0]));
    expect(frame.xSize).toBe(3);
    expect(point(sk, "origin").x).toBe(0);
  });
});

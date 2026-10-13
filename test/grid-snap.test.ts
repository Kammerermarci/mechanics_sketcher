import { afterEach, describe, it, expect, vi } from "vitest";
import { App } from "../src/app";
import { snapToGrid } from "../src/grid-snap";
import { emptySketch, addPoint, addLine, points, deserialize, serialize, type Sketch } from "../src/model";
import { toScreen, type View } from "../src/render";
import type { V } from "../src/geom";

const view: View = { cx: -2, cy: 3, scale: 40, w: 800, h: 600 };
function sketchingApp(sk: Sketch = { ...emptySketch(), snapToGrid: true }) {
  return Object.assign(Object.create(App.prototype), {
    sk, view: { ...view }, altKey: false, tool: "line", tab: "sketch", pending: null,
    cursor: toScreen(view, [2.2, 1.8]), selection: new Set(),
    commit: vi.fn(), toast: vi.fn(), finishDrawing: vi.fn(),
  }) as {
    sk: Sketch; view: View; altKey: boolean; ctrlKey: boolean; pending: unknown;
    snapAt(sp: V, anchor?: V): { pos: V; pointId?: string; curveId?: string; axis?: string; grid?: true };
    toolClick(sp: V): void;
    onKeyDown(e: KeyboardEvent): void;
  };
}
afterEach(() => vi.unstubAllGlobals());

describe("grid snapping while sketching", () => {
  it.each([false, true])("locks the drawing direction with Ctrl and Alt=%s", (alt) => {
    const app = sketchingApp(), start: V = [0.2, 0.3];
    app.ctrlKey = true;
    app.altKey = alt;
    let next = app.snapAt(toScreen(view, [2.34, 0.89]), start);
    expect(next.pos[0]).toBeCloseTo(alt ? 2.34 : 2);
    expect(next.pos[1]).toBe(0.3);
    expect(next.axis).toBe("h");
    next = app.snapAt(toScreen(view, [1.34, 5.89]), start);
    expect(next.pos[1]).toBe(0.3);
    app.ctrlKey = false;
    app.altKey = true;
    const free = app.snapAt(toScreen(view, [1.34, 5.89]), start).pos;
    expect(free[0]).toBeCloseTo(1.34);
    expect(free[1]).toBeCloseTo(5.89);
  });
  it("does not let an off-axis joint override Ctrl drawing alignment", () => {
    const app = sketchingApp();
    app.ctrlKey = true;
    addPoint(app.sk, 2.15, 0.16);
    expect(app.snapAt(toScreen(view, [2.15, 0.16]), [0, 0]).pos).toEqual([2, 0]);
  });
  it("draws an Alt+Ctrl vertical line with exact alignment and no grid rounding", () => {
    const app = sketchingApp();
    app.ctrlKey = true;
    app.altKey = true;
    app.toolClick(toScreen(view, [0.2, 0.3]));
    app.toolClick(toScreen(view, [0.7, 3.74]));
    const ends = points(app.sk).filter(p => p.id !== "origin");
    expect(ends[0].x).toBeCloseTo(0.2);
    expect(ends[1].x).toBeCloseTo(0.2);
    expect(ends[1].y).toBeCloseTo(3.74);
    expect(app.sk.entities.filter(e => e.type === "line")).toHaveLength(1);
  });
  it("uses the background spacing for positive, negative and decimal coordinates", () => {
    expect(snapToGrid([1.23, -2.38], 0.25)).toEqual([1.25, -2.5]);
    expect(snapToGrid([0.31, -0.31], 0.1)).toEqual([0.3, -0.3]);
    const app = sketchingApp({ ...emptySketch(), snapToGrid: true, backgroundSpacingMm: 0.25 });
    expect(app.snapAt(toScreen(view, [1.23, -2.38])).pos).toEqual([1.25, -2.5]);
  });

  it("keeps existing joints and curves ahead of grid snapping", () => {
    const app = sketchingApp();
    const a = addPoint(app.sk, 2.15, 3.25), b = addPoint(app.sk, 4.15, 3.25);
    const line = addLine(app.sk, a.id, b.id);
    expect(app.snapAt(toScreen(view, [2.17, 3.28]))).toMatchObject({ pos: [a.x, a.y], pointId: a.id });
    expect(app.snapAt(toScreen(view, [2.7, 3.26]))).toMatchObject({ pos: [2.7, 3.25], curveId: line.id });
  });

  it("leaves free placement available when disabled or Alt is held", () => {
    const app = sketchingApp(), raw: V = [2.2, 1.8], sp = toScreen(view, raw);
    app.altKey = true;
    expect(app.snapAt(sp).pos).toEqual(raw);
    app.altKey = false;
    app.sk.snapToGrid = false;
    expect(app.snapAt(sp).pos).toEqual(raw);
  });

  it("creates real line endpoints on the grid without moving the camera", () => {
    const app = sketchingApp(), camera = { ...app.view };
    app.toolClick(toScreen(view, [2.2, 1.8]));
    app.toolClick(toScreen(view, [4.2, 3.8]));
    expect(points(app.sk).filter(p => p.id !== "origin").map(p => [p.x, p.y])).toEqual([[2, 2], [4, 4]]);
    expect(app.view).toEqual(camera);
  });

  it("toggles on S while keeping typed S and held-key repeats harmless", () => {
    vi.stubGlobal("document", { querySelector: () => null });
    const app = sketchingApp(emptySketch());
    const event = (target: string, repeat = false) => ({
      key: "s", target: { tagName: target, type: "text" }, preventDefault: vi.fn(), repeat,
    }) as unknown as KeyboardEvent;
    app.onKeyDown(event("INPUT"));
    expect(app.sk.snapToGrid).toBeUndefined();
    app.onKeyDown(event("SELECT"));
    expect(app.sk.snapToGrid).toBeUndefined();
    app.onKeyDown(event("BODY"));
    expect(app.sk.snapToGrid).toBe(true);
    app.onKeyDown(event("BODY", true));
    expect(app.sk.snapToGrid).toBe(true);
    app.onKeyDown(event("BODY"));
    expect(app.sk.snapToGrid).toBe(false);
  });

  it("saves the toggle with the sketch and defaults older files to off", () => {
    expect(deserialize(serialize({ ...emptySketch(), snapToGrid: true })).snapToGrid).toBe(true);
    expect(deserialize(serialize(emptySketch())).snapToGrid).toBeUndefined();
  });
});

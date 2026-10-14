import { beforeAll, afterAll, afterEach, describe, it, expect, vi } from "vitest";
import { make_gcs_wrapper } from "@salusoft89/planegcs";
import { SketchSolver, type Drag } from "../src/solver";
import { solveGroupMove } from "../src/group-move";
import { App } from "../src/app";
import { History } from "../src/history";
import { copyObjects, pasteObjects, pasteOffsetAtCursor } from "../src/object-clipboard";
import { rectangleParts } from "../src/primitive-geometry";
import { emptySketch, addPoint, addCircle, addConstraint, addSymbol, entity, point, clone, type Line, type Fill } from "../src/model";
import { defaultGradient, gradientPoints } from "../src/gradient-fill";
import { fillOutlines, buildPrims } from "../src/prims";
import { toScreen, type View } from "../src/render";

let solver: SketchSolver;
beforeAll(async () => { solver = new SketchSolver(await make_gcs_wrapper()); });
afterAll(() => solver.dispose());
afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const sk = emptySketch();
  const rect = rectangleParts(sk, [[1, 1], [5, 1], [5, 3], [1, 3]], "rectangle");
  rect.autos.forEach((c) => addConstraint(sk, c));
  const corners = rect.made.map((id) => (entity(sk, id) as Line).p1);
  addConstraint(sk, { type: "fixed", p: corners[0] });
  addConstraint(sk, { type: "distance", a: corners[0], b: corners[1], mode: "aligned", value: 4, offset: 1 });
  addSymbol(sk, { type: "fill", color: "#123456", gradient: defaultGradient("linear"), points: corners, curves: rect.made, arcs: [null, null, null, null], holes: [] });
  const center = addPoint(sk, 9, 2), circle = addCircle(sk, center.id, 1.5);
  addSymbol(sk, { type: "fill", circle: circle.id, color: "#abcdef", points: [], curves: [], arcs: [], holes: [] });
  return { sk, rect, circle };
}

describe("pasted group movement", () => {
  it.each(["fill", "edge", "corner"])("keeps the pasted selection intact when the initial press hits a %s", (part) => {
    const { sk, rect, circle } = fixture();
    const selected = pasteObjects(sk, copyObjects(sk, [...rect.made, circle.id])!, [20, 10]);
    const fill = sk.symbols.filter((s): s is Fill => s.type === "fill").slice(-2)[0];
    const view: View = { cx: 25, cy: 10, scale: 40, w: 800, h: 600 };
    vi.stubGlobal("document", { activeElement: null }); vi.stubGlobal("HTMLElement", class {});
    const app = Object.assign(Object.create(App.prototype), {
      sk, solver, view, selection: new Set(selected), tool: "select", editing: null,
      glyphs: [], prims: buildPrims(sk, 1, { editor: true }), lastPick: null, mm: () => 1,
      render: vi.fn(), touch: vi.fn(), screenPos: (e: { pos: [number, number] }) => e.pos,
      svg: { setPointerCapture: vi.fn() },
    }) as any;
    const start: [number, number] = part === "fill" ? [22, 11.5] : part === "edge" ? [23, 11] : [21, 11];
    app.onPointerDown({ pos: toScreen(view, start), pointerId: 1, button: 0, timeStamp: 1000 });
    expect(app.selection).toEqual(new Set(selected));
    expect(app.drag.kind).toBe("move");
    const targets = app.drag.targets.map((p: { id: string; x: number; y: number }) => ({ ...p }));
    app.onPointerMove({ pos: toScreen(view, [start[0] + 3, start[1] + 2]) });
    for (const p of targets) {
      expect(point(sk, p.id).x).toBeCloseTo(p.x + 3);
      expect(point(sk, p.id).y).toBeCloseTo(p.y + 2);
    }
    expect(fillOutlines(sk, fill, 1)).toHaveLength(1);
  });

  it.each([false, true])("drags an ordinary fill immediately, including its hole (already selected=%s)", (selected) => {
    const sk = emptySketch(), center = addPoint(sk, 5, 5), holeCenter = addPoint(sk, 6, 5);
    const circle = addCircle(sk, center.id, 4), hole = addCircle(sk, holeCenter.id, 1);
    const fill = addSymbol(sk, { type: "fill", circle: circle.id, color: "#abcdef", points: [], curves: [], arcs: [], holes: [hole.id] });
    const view: View = { cx: 5, cy: 5, scale: 40, w: 800, h: 600 };
    vi.stubGlobal("document", { activeElement: null }); vi.stubGlobal("HTMLElement", class {});
    const app = Object.assign(Object.create(App.prototype), {
      sk, solver, view, selection: new Set(selected ? [fill.id] : []), tool: "select", editing: null,
      glyphs: [], prims: buildPrims(sk, 1, { editor: true }), lastPick: null, mm: () => 1,
      render: vi.fn(), touch: vi.fn(), screenPos: (e: { pos: [number, number] }) => e.pos,
      svg: { setPointerCapture: vi.fn() },
    }) as any;
    app.onPointerDown({ pos: toScreen(view, [4, 6]), pointerId: 1, button: 0, timeStamp: 1000 });
    expect(app.selection).toEqual(new Set([fill.id]));
    expect(app.drag.kind).toBe("move");
    app.onPointerMove({ pos: toScreen(view, [7, 8]) });
    expect(center).toMatchObject({ x: 8, y: 7 });
    expect(holeCenter).toMatchObject({ x: 9, y: 7 });
    expect(circle.r).toBe(4); expect(hole.r).toBe(1);
  });

  it("centres each paste at the current pointer without accumulating offsets", async () => {
    const source = emptySketch(), center = addPoint(source, 4, 5), circle = addCircle(source, center.id, 2);
    const copied = copyObjects(source, [circle.id])!;
    const sk = emptySketch(), view: View = { cx: 10, cy: -5, scale: 40, w: 800, h: 600 };
    const app = Object.assign(Object.create(App.prototype), {
      sk, solver, view, tab: "sketch", copiedObjects: copied, result: solver.solve(sk),
      cursor: toScreen(view, [15, 7]), setTool: vi.fn(), commit: vi.fn(),
    }) as any;
    await app.pasteSelection();
    app.cursor = toScreen(view, [-3, -8]);
    await app.pasteSelection();
    await app.pasteSelection();
    const circles = sk.entities.filter((e) => e.type === "circle");
    for (const [i, expected] of [[15, 7], [-3, -8], [-3, -8]].entries()) {
      expect(point(sk, circles[i].c)).toMatchObject({ x: expected[0], y: expected[1] });
    }
    expect(app.selection).toEqual(new Set([circles[2].id]));
    expect(app.view).toEqual(view);
    const notes = emptySketch(), note = addSymbol(notes, { type: "note", x: 4, y: 6, text: "test" });
    expect(pasteOffsetAtCursor(copyObjects(notes, [note.id])!, [10, 12])).toEqual([6, 6]);
  });
  it("moves repeated independent pastes rigidly, retaining dimensions, radii and fills", () => {
    const { sk, rect, circle } = fixture();
    const source = clone(sk), clipboard = copyObjects(sk, [...rect.made, circle.id])!;
    for (const offset of [[20, 10], [40, 20]] as const) {
      const before = sk.entities.length;
      pasteObjects(sk, clipboard, [...offset]);
      expect(solver.solve(sk).ok).toBe(true);
      const image = sk.entities.slice(before), original = clone(sk);
      const targets: Drag[] = image.flatMap((e) => e.type === "point" ? [{ kind: "point" as const, id: e.id, x: e.x + 7, y: e.y - 4 }] : []);
      const constraints = clone(sk).constraints;
      const fills = sk.symbols.filter((s): s is Fill => s.type === "fill").slice(-2);
      const gradient = gradientPoints(fillOutlines(sk, fills[0], 1), fills[0].gradient!);
      expect(solveGroupMove(sk, solver, targets).ok).toBe(true);
      expect(solver.solve(sk).ok).toBe(true);
      for (const target of targets) if (target.kind === "point") {
        expect(point(sk, target.id).x).toBeCloseTo(target.x);
        expect(point(sk, target.id).y).toBeCloseTo(target.y);
      }
      const copiedCircle = image.find((e) => e.type === "circle")!;
      expect(copiedCircle).toMatchObject({ r: 1.5 });
      expect(gradientPoints(fillOutlines(sk, fills[0], 1), fills[0].gradient!)).toEqual(gradient.map(([x, y]) => [x + 7, y - 4]));
      expect(fillOutlines(sk, fills[1], 1)).not.toEqual(fillOutlines(original, fills[1], 1));
      expect(sk.constraints).toEqual(constraints);
      expect(sk.entities.slice(0, source.entities.length)).toEqual(source.entities);
    }
  });

  it("leaves the entire group unchanged if a real anchor blocks translation", () => {
    const { sk, rect, circle } = fixture(), before = clone(sk);
    const ids = new Set([...rect.made.flatMap((id) => { const l = entity(sk, id) as Line; return [l.p1, l.p2]; }), circle.c]);
    const drags: Drag[] = [...ids].map((id) => ({ kind: "point", id, x: point(sk, id).x + 3, y: point(sk, id).y + 2 }));
    expect(solveGroupMove(sk, solver, drags).ok).toBe(false);
    expect(sk).toEqual(before);
  });

  it("rejects a translation that violates an external dimension without moving any objects", () => {
    const sk = emptySketch(), a = addPoint(sk, 3, 0), b = addPoint(sk, 8, 2);
    addCircle(sk, a.id, 1); addCircle(sk, b.id, 2);
    addConstraint(sk, { type: "distance", a: "origin", b: a.id, mode: "aligned", value: 3, offset: 1 });
    const before = clone(sk);
    expect(solveGroupMove(sk, solver, [a, b].map((p) => ({ kind: "point", id: p.id, x: p.x + 5, y: p.y + 4 }))).ok).toBe(false);
    expect(sk).toEqual(before);
  });

  it.each([false, true])("uses real group dragging with snapping and Ctrl locking (Alt=%s), with Undo/Redo and a fixed camera", (altKey) => {
    const { sk, rect, circle } = fixture();
    const selected = pasteObjects(sk, copyObjects(sk, [...rect.made, circle.id])!, [20.2, 10.3]);
    sk.snapToGrid = true;
    const history = new History(); history.reset(sk);
    const view: View = { cx: 25, cy: 10, scale: 40, w: 800, h: 600 };
    const app = Object.assign(Object.create(App.prototype), {
      sk, solver, view: { ...view }, selection: new Set(selected), tool: "select",
      render: vi.fn(), touch: vi.fn(), screenPos: (e: { pos: [number, number] }) => e.pos,
      svg: { hasPointerCapture: () => false }, commit: () => history.commit(sk),
    }) as any;
    const before = clone(sk);
    app.drag = app.startMove(selected[0], toScreen(view, [21.2, 11.3]), false);
    const targets = app.drag.targets.map((p: { id: string; x: number; y: number }) => ({ ...p }));
    app.onPointerMove({ pos: toScreen(view, [23.44, 11.7]), ctrlKey: true, altKey });
    app.onPointerMove({ pos: toScreen(view, [24.44, 17.7]), ctrlKey: true, altKey });
    app.onPointerUp({ pointerId: 1 });
    const delta = point(sk, targets[0].id).x - targets[0].x;
    expect(delta).toBeCloseTo(altKey ? 3.24 : 2.8);
    for (const p of targets) {
      expect(point(sk, p.id).x).toBeCloseTo(p.x + delta);
      expect(point(sk, p.id).y).toBeCloseTo(p.y);
    }
    expect(app.view).toEqual(view);
    const after = clone(sk);
    expect(history.undo()).toEqual(before);
    expect(history.redo()).toEqual(after);
  });
});

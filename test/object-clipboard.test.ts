import { beforeAll, afterAll, afterEach, describe, it, expect, vi } from "vitest";
import { make_gcs_wrapper } from "@salusoft89/planegcs";
import { SketchSolver } from "../src/solver";
import { copyObjects, pasteObjects, readObjectClipboard } from "../src/object-clipboard";
import { rectangleParts } from "../src/primitive-geometry";
import { defaultGradient, gradientPoints } from "../src/gradient-fill";
import { fillOutlines } from "../src/prims";
import { emptySketch, addPoint, addCircle, addConstraint, addSymbol, entity, point, isLink, type Fill, type Line } from "../src/model";
import { App } from "../src/app";

let solver: SketchSolver;
beforeAll(async () => { solver = new SketchSolver(await make_gcs_wrapper()); });
afterAll(() => solver.dispose());
afterEach(() => vi.unstubAllGlobals());

describe("copy and paste objects", () => {
  it("pastes the in-app snapshot immediately without waiting for clipboard-read permissions", async () => {
    const source = emptySketch(), center = addPoint(source, 0, 0), circle = addCircle(source, center.id, 2);
    addSymbol(source, { type: "fill", circle: circle.id, color: "#1565c0", points: [], curves: [], arcs: [], holes: [] });
    const copied = copyObjects(source, [circle.id])!;
    const target = emptySketch(), commit = vi.fn(), readText = vi.fn();
    vi.stubGlobal("navigator", { clipboard: { readText } });
    const app = Object.assign(Object.create(App.prototype), {
      sk: target, tab: "sketch", copiedObjects: copied, pasteCount: 0, solver,
      result: solver.solve(target), view: { scale: 40 }, setTool: vi.fn(), commit,
    }) as { pasteSelection(): Promise<void> };
    await app.pasteSelection();
    expect(readText).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(target.symbols).toHaveLength(1);
    expect(target.entities.filter((e) => e.type === "circle")).toHaveLength(1);
  });
  it("copies the complete filled rectangle when a boundary edge is selected", () => {
    const sk = emptySketch();
    const rectangle = rectangleParts(sk, [[1, 1], [5, 1], [5, 3], [1, 3]], "rectangle");
    rectangle.autos.forEach((c) => addConstraint(sk, c));
    const points = rectangle.made.map((id) => (entity(sk, id) as Line).p1);
    const fill = addSymbol(sk, { type: "fill", color: "#1565c0", gradient: defaultGradient("linear"), points, curves: rectangle.made, arcs: [null, null, null, null], holes: [] });
    const copied = copyObjects(sk, [rectangle.made[0]])!;
    expect(copied.sketch.entities.filter((e) => e.type === "line")).toHaveLength(4);
    expect(copied.sketch.symbols).toContainEqual(fill);
    pasteObjects(sk, copied, [10, 2]);
    expect(solver.solve(sk).ok).toBe(true);
    const image = sk.symbols.find((s): s is Fill => s.type === "fill" && s.id !== fill.id)!;
    expect(image.gradient).toEqual(fill.gradient);
    expect(gradientPoints(fillOutlines(sk, image, 1), image.gradient!)).toEqual([[11, 4], [15, 4]]);
    expect(sk.constraints.filter(isLink)).toHaveLength(0);
    expect(image.curves.every((id) => !fill.curves.includes(id))).toBe(true);
    fill.color = "#ffffff";
    expect(image.color).toBe("#1565c0");
  });
  it("copies circular fills and their holes and pastes after the original is gone", () => {
    const sk = emptySketch(), a = addPoint(sk, 0, 0), b = addPoint(sk, 1, 0);
    const circle = addCircle(sk, a.id, 5), hole = addCircle(sk, b.id, 1);
    const fill = addSymbol(sk, { type: "fill", color: "#bfe3c4", circle: circle.id, points: [], curves: [], arcs: [], holes: [hole.id] });
    const snapshot = copyObjects(sk, [fill.id])!;
    const decoded = readObjectClipboard(JSON.stringify(snapshot))!;
    const destination = emptySketch();
    pasteObjects(destination, decoded, [2, -2]);
    const image = destination.symbols[0] as Fill;
    expect(image.holes).toHaveLength(1);
    expect(entity(destination, image.holes[0])?.type).toBe("circle");
    expect(fillOutlines(destination, image, 1)).toHaveLength(2);
    expect(solver.solve(destination).ok).toBe(true);
    expect(destination.entities.map((e) => e.id).length).toBe(new Set(destination.entities.map((e) => e.id)).size);
  });
  it("preserves center-rectangle helpers and internal dimensions", () => {
    const sk = emptySketch(), center = addPoint(sk, 3, 3);
    const rectangle = rectangleParts(sk, [[1, 1], [5, 1], [5, 5], [1, 5]], "rectcenter", {}, center.id);
    rectangle.autos.forEach((c) => addConstraint(sk, c));
    const line = entity(sk, rectangle.made[0]) as Line;
    addConstraint(sk, { type: "distance", a: line.p1, b: line.p2, value: 4, mode: "aligned", offset: 1 });
    const copied = copyObjects(sk, rectangle.made)!;
    expect(copied.sketch.constraints.some((c) => c.type === "midpoint")).toBe(true);
    const destination = emptySketch();
    pasteObjects(destination, copied, [20, 5]);
    expect(solver.solve(destination).ok).toBe(true);
    expect(destination.constraints.some((c) => c.type === "distance")).toBe(true);
    const midpoint = destination.constraints.find((c) => c.type === "midpoint")!;
    if (midpoint.type !== "midpoint") throw new Error("missing midpoint");
    expect(point(destination, midpoint.p).x).toBeCloseTo(23);
    expect(point(destination, midpoint.p).y).toBeCloseTo(8);
  });
  it("copies notes without adding an unused origin or changing ID-like text", () => {
    const sk = emptySketch(), note = addSymbol(sk, { type: "note", x: 1, y: 2, text: "p1", color: "#123456" });
    const copied = readObjectClipboard(JSON.stringify(copyObjects(sk, [note.id])))!;
    expect(copied.sketch.entities).toHaveLength(0);
    pasteObjects(sk, copied, [2, 3]);
    expect(sk.entities).toHaveLength(1);
    expect(sk.symbols[1]).toMatchObject({ text: "p1", x: 3, y: 5, color: "#123456" });
  });
  it("rejects plain text and broken clipboard references", () => {
    expect(readObjectClipboard("hello")).toBeNull();
    const sk = emptySketch();
    sk.entities.push({ id: "l1", type: "line", p1: "missing", p2: "origin" });
    expect(readObjectClipboard(JSON.stringify({ format: "mech-sketch-objects", version: 1, sketch: sk }))).toBeNull();
  });
  it("uses object shortcuts without taking copy/paste from text inputs", () => {
    vi.stubGlobal("document", { querySelector: () => null });
    const copy = vi.fn(), paste = vi.fn();
    const sk = emptySketch(), note = addSymbol(sk, { type: "note", x: 0, y: 0, text: "Copy" });
    const clipboard = copyObjects(sk, [note.id])!;
    const app = Object.assign(Object.create(App.prototype), { tab: "sketch", copySelection: copy, pasteSelection: paste }) as App;
    const key = (k: string, tag: string) => ({ key: k, ctrlKey: true, target: { tagName: tag, type: "text" }, preventDefault: vi.fn() }) as unknown as KeyboardEvent;
    const press = (app as unknown as { onKeyDown(e: KeyboardEvent): void; pasteClipboardEvent(e: ClipboardEvent): void });
    press.onKeyDown(key("c", "BODY"));
    const event = (tag: string) => ({ target: { tagName: tag }, clipboardData: { getData: () => JSON.stringify(clipboard) }, preventDefault: vi.fn() }) as unknown as ClipboardEvent;
    press.pasteClipboardEvent(event("BODY"));
    press.onKeyDown(key("c", "INPUT"));
    press.pasteClipboardEvent(event("INPUT"));
    expect(copy).toHaveBeenCalledTimes(1);
    expect(paste).toHaveBeenCalledTimes(1);
  });
});

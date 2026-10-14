import { describe, it, expect, vi } from "vitest";
import { App } from "../src/app";
import { PlotWorkspace } from "../src/plotwork";
import { History } from "../src/history";
import { emptySketch, addPoint, addLine, addConstraint, addSymbol, addFrame, serialize, deserialize, entity, type Note } from "../src/model";
import { buildPrims, symbolPrims, textBox, primDistance, type TextPrim } from "../src/prims";
import { textSize, setTextSize, textSizePanel } from "../src/text-size";
import { toSvg, toTikz } from "../src/export";
import { copyObjects, pasteObjects } from "../src/object-clipboard";
import { linearCopy } from "../src/pattern";
import { newPlot, plotPrims, annotationPrims, plotTikz } from "../src/plot";

function example() {
  const sk = emptySketch(), a = addPoint(sk, 0, 0), b = addPoint(sk, 10, 0);
  const arrow = addLine(sk, a.id, b.id); arrow.arrow = "none"; arrow.label = "F";
  const note = addSymbol(sk, { type: "note", x: 4, y: 3, text: "Hello $F_1$" });
  const balloon = addSymbol(sk, { type: "balloon", x: 1, y: 1, dx: 4, dy: 3, text: "100", frame: "box", end: "arrow" });
  const dimension = addConstraint(sk, { type: "distance", a: a.id, b: b.id, mode: "aligned", value: 10, offset: 2 });
  const frame = addFrame(sk, 4, 4);
  const datum = addSymbol(sk, { type: "datum", at: b.id, label: "A", dx: 1, dy: 1, color: "#123456" });
  const load = addSymbol(sk, { type: "load", at: a.id, angle: 0, value: 1, label: "P", color: "#123456" });
  return { sk, arrow, note, balloon, dimension, frame, datum, load };
}

describe("per-object text sizes", () => {
  it("scales text on each kind of sketch object without changing unrelated text or geometry", () => {
    const { sk, ...objects } = example();
    const before = buildPrims(sk, 10, { editor: true });
    for (const object of Object.values(objects)) setTextSize(object, 150);
    const after = buildPrims(sk, 10, { editor: true });
    const texts = after.filter((p): p is TextPrim => p.k === "text");
    for (const object of Object.values(objects)) {
      const text = texts.find((p) => p.ref === object.id)!;
      expect(text).toBeDefined(); expect(textSize(text)).toBe(1.5);
      const old = before.find((p): p is TextPrim => p.k === "text" && p.ref === object.id)!;
      const oldBox = textBox(old), newBox = textBox(text);
      expect(newBox.x1 - newBox.x0).toBeCloseTo((oldBox.x1 - oldBox.x0) * 1.5);
    }
    expect(entity(sk, objects.arrow.id)).toMatchObject({ p1: objects.arrow.p1, p2: objects.arrow.p2 });
    expect(after.filter((p) => p.k !== "text" && p.ref === objects.arrow.id)).toEqual(before.filter((p) => p.k !== "text" && p.ref === objects.arrow.id));
    setTextSize(objects.note, 100);
    expect(objects.note.textScale).toBeUndefined();
    expect(buildPrims(sk, 10, { editor: true }).filter((p) => p.k === "text" && p.ref === objects.note.id).every((p) => textSize(p as TextPrim) === 1)).toBe(true);
  });

  it("resizes balloon frames and text picking to fit enlarged text", () => {
    const { sk, balloon, note } = example();
    const originalFrame = symbolPrims(sk, balloon, 10).find((p) => p.k === "poly")!;
    setTextSize(balloon, 300); setTextSize(note, 200);
    const prims = buildPrims(sk, 10, { editor: true });
    const frame = prims.find((p) => p.ref === balloon.id && p.k === "poly")!;
    if (frame.k !== "poly" || originalFrame.k !== "poly") throw new Error("Missing balloon frame");
    expect(frame.pts[1][0] - frame.pts[0][0]).toBeGreaterThan(originalFrame.pts[1][0] - originalFrame.pts[0][0]);
    const text = prims.find((p): p is TextPrim => p.k === "text" && p.ref === note.id)!;
    const box = textBox(text);
    expect(primDistance(text, [box.x1 - 0.01, (box.y0 + box.y1) / 2])).toBe(0);
  });

  it("updates a multiple-object selection live, commits one edit, and restores the default at 100%", () => {
    const { sk, note, arrow } = example(), history = new History(); history.reset(sk);
    const app = Object.assign(Object.create(App.prototype), {
      sk, selection: new Set([note.id, arrow.id]), render: vi.fn(), commit: vi.fn(() => history.commit(sk)),
    }) as any;
    const out = { textContent: "" }, input = { dataset: { field: "text-size" }, value: "175", parentElement: { querySelector: () => out } };
    app.onPanelChange(input, true);
    expect(note.textScale).toBe(1.75); expect(arrow.textScale).toBe(1.75);
    expect(out.textContent).toBe("175%"); expect(app.commit).not.toHaveBeenCalled();
    app.onPanelChange(input);
    expect(app.commit).toHaveBeenCalledTimes(1);
    expect((history.undo()!.symbols.find((s) => s.id === note.id) as Note).textScale).toBeUndefined();
    expect((history.redo()!.symbols.find((s) => s.id === note.id) as Note).textScale).toBe(1.75);
    input.value = "100"; app.onPanelChange(input);
    expect(note.textScale).toBeUndefined(); expect(arrow.textScale).toBeUndefined();
    expect(textSizePanel(note)).toContain('value="100"');
    expect(textSize({ textScale: NaN })).toBe(1);
  });

  it("persists through Save/Open, clipboard copies and geometry patterns, and exports the scale", () => {
    const { sk, note, arrow } = example();
    const svg = toSvg(sk);
    setTextSize(note, 150); setTextSize(arrow, 200);
    sk.dimScale = 2;
    expect(toSvg(sk)).not.toBe(svg);
    expect(toTikz(sk)).toContain("scale=1.5"); expect(toTikz(sk)).toContain("scale=2");
    expect(deserialize(serialize(sk)).symbols.find((s) => s.id === note.id)).toMatchObject({ textScale: 1.5 });
    const target = emptySketch(); pasteObjects(target, copyObjects(sk, [note.id, arrow.id])!, [3, 4]);
    expect(target.symbols[0]).toMatchObject({ textScale: 1.5 });
    expect(target.entities.find((e) => e.type === "line")).toMatchObject({ textScale: 2 });
    const pattern = linearCopy(sk, [arrow.id], 2, [20, 0]);
    expect(typeof pattern).not.toBe("string");
    expect(sk.entities.filter((e) => e.type === "line").every((e) => e.textScale === 2)).toBe(true);
  });

  it("supports plot curve labels, notes, balloons and axis labels/ticks in SVG primitives and pgfplots", () => {
    const sk = emptySketch(), plot = newPlot(sk), curve = plot.curves[0];
    curve.label = "f"; curve.textScale = 1.5; curve.pieces = [{ expr: "x" }];
    plot.x.textScale = 2;
    plot.notes = [{ id: "note", x: 1, y: 2, text: "Test", textScale: 0.5 }];
    plot.balloons = [{ id: "balloon", x: 0, y: 0, dx: 20, dy: 20, text: "100", end: "arrow", textScale: 2 }];
    const texts = plotPrims(plot).filter((p): p is TextPrim => p.k === "text");
    expect(texts.find((p) => p.ref === curve.id)).toMatchObject({ textScale: 1.5 });
    expect(texts.filter((p) => p.part === "xlabel" || p.part === "xtick").every((p) => p.textScale === 2)).toBe(true);
    expect(annotationPrims(plot).find((p) => p.k === "text" && p.ref === "note")).toMatchObject({ textScale: 0.5 });
    const tikz = plotTikz(plot);
    expect(tikz).toContain("scale=1.5"); expect(tikz).toContain("scale=0.5"); expect(tikz).toContain("scale=2");
    const workspace = Object.assign(Object.create(PlotWorkspace.prototype), {
      host: { render: vi.fn(), commit: vi.fn() }, plot: () => plot, mark: () => ({ note: plot.notes![0] }),
    }) as any;
    workspace.change({ dataset: { pf: "text-size" }, value: "125" }, true);
    expect(plot.notes[0].textScale).toBe(1.25); expect(workspace.host.commit).not.toHaveBeenCalled();
    workspace.change({ dataset: { pf: "x.text-size" }, value: "100" });
    expect(plot.x.textScale).toBeUndefined(); expect(workspace.host.commit).toHaveBeenCalledTimes(1);
  });
});

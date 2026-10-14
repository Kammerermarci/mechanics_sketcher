import { describe, it, expect, vi } from "vitest";
import { App } from "../src/app";
import { emptySketch, addPoint, addLine, addSupport, addSymbol } from "../src/model";
import { buildPrims, printMm } from "../src/prims";
import { figurePrims } from "../src/export";

function example() {
  const sk = emptySketch(), a = addPoint(sk, 0, 0), b = addPoint(sk, 10, 0);
  addLine(sk, a.id, b.id);
  const pin = addSupport(sk, "pin", a.id);
  const note = addSymbol(sk, { type: "note", x: 5, y: 3, text: "Force" });
  const app = Object.assign(Object.create(App.prototype), {
    sk, preview: false, view: { cx: 0, cy: 0, scale: 40, w: 800, h: 600 },
  }) as any;
  return { sk, app, refs: new Set([pin.id, note.id]) };
}

describe("print proportions while sketching", () => {
  it("uses identical annotation primitives in sketching, preview and export at every zoom", () => {
    const { sk, app, refs } = example();
    const exported = figurePrims(sk).filter((p) => refs.has(p.ref!));
    for (const scale of [10, 40, 160]) for (const preview of [false, true]) {
      app.view.scale = scale; app.preview = preview;
      expect(app.mm()).toBe(printMm(sk));
      expect(buildPrims(sk, app.mm(), { editor: true }).filter((p) => refs.has(p.ref!))).toEqual(exported);
    }
    app.view.scale = 40;
    const pixelsPerAnnotationMm = app.view.scale / app.mm();
    app.view.scale = 80;
    expect(app.view.scale / app.mm()).toBe(pixelsPerAnnotationMm * 2);
  });

  it("updates the visible annotation size from print settings without changing editing mode or camera", () => {
    const { sk, app } = example();
    const camera = { ...app.view }, before = app.mm();
    Object.assign(app, { titleblock: { querySelector: () => null }, render: vi.fn(), setPreview: vi.fn() });
    app.setDimScale(150);
    expect(sk.dimScale).toBe(1.5);
    expect(app.mm()).toBeCloseTo(before / 1.5);
    expect(app.preview).toBe(false);
    expect(app.setPreview).not.toHaveBeenCalled();
    expect(app.view).toEqual(camera);
    sk.figureWidthMm *= 2;
    expect(app.mm()).toBeCloseTo(before * 2 / 1.5);
  });

  it("chooses the same initial load size regardless of zoom or preview mode", () => {
    const values: number[] = [];
    for (const scale of [10, 160]) for (const preview of [false, true]) {
      const { sk, app } = example();
      app.view.scale = scale; app.preview = preview;
      app.startLoadScale("force");
      values.push(sk.loadScale!.force!);
    }
    expect(values.every((value) => value === values[0])).toBe(true);
  });
});

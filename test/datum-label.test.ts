import { describe, it, expect, vi } from "vitest";
import { App } from "../src/app";
import { emptySketch, addPoint, addLine, addSymbol, serialize, deserialize, type Datum } from "../src/model";
import { symbolPrims } from "../src/prims";
import { toTikz } from "../src/export";
import { nextDatumName, linearCopy } from "../src/pattern";
import { copyObjects, pasteObjects } from "../src/object-clipboard";

describe("upright datum names", () => {
  it("creates uppercase names as plain text and exports them outside math mode", () => {
    const sk = emptySketch();
    const app = Object.assign(Object.create(App.prototype), {
      sk, tool: "datum", datumColor: "#d32f2f", finishDrawing: vi.fn(),
      snapAt: (pos: [number, number]) => ({ pos }), view: { cx: 0, cy: 0, scale: 40, w: 800, h: 600 },
    }) as any;
    app.symbolClick([0, 0]); app.symbolClick([100, 100]);
    const [a, b] = sk.symbols as Datum[];
    expect(a).toMatchObject({ label: "A", labelMode: "text" });
    expect(b).toMatchObject({ label: "B", labelMode: "text" });
    const text = symbolPrims(sk, a, 10).find((p) => p.k === "text");
    expect(text).toMatchObject({ tex: "\\text{A}", latex: "A" });
    expect(toTikz(sk)).toContain("{A};"); expect(toTikz(sk)).not.toContain("$A$");
  });

  it("continues the plain uppercase sequence after Z without introducing math syntax", () => {
    const sk = emptySketch(), p = addPoint(sk, 0, 0);
    for (let i = 0; i < 26; i++) addSymbol(sk, { type: "datum", at: p.id, color: "#123456", label: String.fromCharCode(65 + i), dx: 1, dy: 1, labelMode: "text" });
    expect(nextDatumName(sk, true)).toBe("A1");
    expect(nextDatumName(sk)).toBe("A_{1}");
  });

  it("preserves legacy math labels and allows changing the style without changing the name", () => {
    const sk = emptySketch(), p = addPoint(sk, 0, 0);
    const datum = addSymbol(sk, { type: "datum", at: p.id, color: "#123456", label: "A_1", dx: 1, dy: 1 });
    expect(symbolPrims(sk, datum, 10).find((p) => p.k === "text")).toMatchObject({ tex: "A_1" });
    const app = Object.assign(Object.create(App.prototype), { sk, selection: new Set([datum.id]), commit: vi.fn() }) as any;
    app.onPanelChange({ dataset: { field: "sym-label-mode" }, value: "text" });
    expect(datum.label).toBe("A_1");
    expect(symbolPrims(sk, datum, 10).find((p) => p.k === "text")).toMatchObject({ tex: "\\text{A\\_1}", latex: "A\\_1" });
    app.onPanelChange({ dataset: { field: "sym-label-mode" }, value: "math" });
    expect(symbolPrims(sk, datum, 10).find((p) => p.k === "text")).toMatchObject({ tex: "A_1" });
  });

  it("retains plain label styling and text size through Save/Open, clipboard copies and patterns", () => {
    const sk = emptySketch(), a = addPoint(sk, 0, 0), b = addPoint(sk, 4, 0), line = addLine(sk, a.id, b.id);
    const datum = addSymbol(sk, { type: "datum", at: b.id, color: "#123456", label: "A", dx: 1, dy: 1, labelMode: "text", textScale: 1.5 });
    expect(deserialize(serialize(sk)).symbols[0]).toEqual(datum);
    const destination = emptySketch(); pasteObjects(destination, copyObjects(sk, [line.id])!, [3, 4]);
    expect(destination.symbols[0]).toMatchObject({ labelMode: "text", textScale: 1.5 });
    expect(typeof linearCopy(sk, [line.id], 2, [8, 0])).not.toBe("string");
    expect(sk.symbols[1]).toMatchObject({ label: "B", labelMode: "text", textScale: 1.5 });
  });
});

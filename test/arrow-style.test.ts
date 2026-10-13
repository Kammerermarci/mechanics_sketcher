import { describe, it, expect, vi } from "vitest";
import { App } from "../src/app";
import { arrowHeadScale, arrowStylePanel } from "../src/arrow-style";
import { CustomPalette, PALETTE_COLORS, colorPanel } from "../src/custom-colors";
import { emptySketch, addPoint, addLine, addArc, addSymbol, serialize, deserialize, entity, type Line } from "../src/model";
import { buildPrims, arrowHeads, standardWeight, PAPER } from "../src/prims";
import { toSvg, toTikz } from "../src/export";
import { linearCopy } from "../src/pattern";
import { annotationPrims, newPlot } from "../src/plot";

function arrows() {
  const sk = emptySketch();
  const a = addPoint(sk, 0, 0), b = addPoint(sk, 4, 0), c = addPoint(sk, 0, 4);
  const line = addLine(sk, a.id, b.id), arc = addArc(sk, a.id, b.id, c.id);
  for (const arrow of [line, arc]) { arrow.arrow = "both"; arrow.label = "F"; }
  return { sk, line, arc };
}

describe("arrow appearance and shared colours", () => {
  it("preserves standard heads and adjusts both straight and curved arrows", () => {
    const { sk, line, arc } = arrows();
    for (const arrow of [line, arc]) {
      arrow.weight = standardWeight(arrow) * 4;
      arrow.headScale = 2;
      arrow.color = "#123456";
      const p = buildPrims(sk, 10, { editor: false }).find(p => p.ref === arrow.id && (p.k === "line" || p.k === "arc"));
      if (!p || (p.k !== "line" && p.k !== "arc")) throw new Error("Missing arrow");
      expect(p.head).toBe(PAPER.arrowScale * 4);
      expect(arrowHeads(p)).toHaveLength(2);
      expect(p.ink).toBe("#123456");
      expect(buildPrims(sk, 10, { editor: false }).find(p => p.ref === arrow.id && p.k === "text")?.ink).toBe("#123456");
    }
    delete line.headScale;
    expect(buildPrims(sk, 10, { editor: false }).find(p => p.ref === line.id && p.k === "line")).toMatchObject({ head: PAPER.arrowScale * 2 });
    expect(arrowHeadScale(1.13)).toBe(1.25);
    expect(arrowHeadScale(Infinity)).toBe(1);
    expect(arrowHeadScale(100)).toBe(3);
  });

  it("exports arrow colours and custom head sizes, and preserves them in copies", () => {
    const { sk, line } = arrows();
    line.color = "#123456"; line.headScale = 2;
    expect(toSvg(sk)).toContain('fill="#123456"');
    expect(toSvg(sk)).toContain('stroke="#123456"');
    expect(toTikz(sk)).toContain("red,18;green,52;blue,86");
    expect(toTikz(sk)).toContain("Stealth[length=5.4mm");
    expect(entity(deserialize(serialize(sk)), line.id)).toMatchObject({ color: "#123456", headScale: 2 });
    const copied = linearCopy(sk, [line.id], 2, [5, 0]);
    if (typeof copied === "string") throw new Error(copied);
    expect(sk.entities.filter(e => e.type === "line").every(e => (e as Line).color === "#123456" && (e as Line).headScale === 2)).toBe(true);
  });

  it("colours mixed text/math notes and carries colours into both exports", () => {
    const sk = emptySketch();
    const note = addSymbol(sk, { type: "note", x: 1, y: 2, text: "Force $F$", color: "#123456" });
    expect(buildPrims(sk, 10, { editor: false }).find(p => p.ref === note.id)).toMatchObject({ ink: "#123456" });
    expect(toSvg(sk)).toContain("#123456");
    expect(toTikz(sk)).toContain("red,18;green,52;blue,86");
    const plot = newPlot(sk);
    plot.notes = [{ id: "note", x: 0, y: 0, text: "Plot $F$", color: "#123456" }];
    expect(annotationPrims(plot).find(p => p.ref === "note")).toMatchObject({ ink: "#123456" });
  });

  it("keeps object colour controls compact while retaining saved palette colours", () => {
    const palette = new CustomPalette();
    palette.add("#12ab34");
    const colors = palette.colors();
    expect(colors).toEqual([...PALETTE_COLORS, "#12ab34"]);
    const { line } = arrows();
    for (let i = 0; i < 200; i++) palette.add(`#${i.toString(16).padStart(6, "0")}`);
    expect(palette.colors()).toHaveLength(PALETTE_COLORS.length + 201);
    expect(arrowStylePanel(line)).not.toContain('class="swatch"');
    for (const html of [colorPanel(undefined), colorPanel(undefined, true)]) {
      expect(html).toContain("Change colour");
      expect(html).toContain('aria-haspopup="dialog"');
      expect(html).not.toContain('class="swatch"');
    }
  });

  it("updates the selected arrow live and records one edit when the slider is released", () => {
    const { sk, line } = arrows();
    const app = Object.assign(Object.create(App.prototype), { sk, selection: new Set([line.id]), commit: vi.fn(), render: vi.fn() }) as {
      onPanelChange(input: HTMLInputElement, live?: boolean): void;
      commit: ReturnType<typeof vi.fn>; render: ReturnType<typeof vi.fn>;
    };
    const output = { textContent: "" };
    const input = { dataset: { field: "arrow-head-scale" }, value: "175", parentElement: { querySelector: () => output } } as unknown as HTMLInputElement;
    app.onPanelChange(input, true);
    expect(line.headScale).toBe(1.75);
    expect(output.textContent).toBe("175%");
    expect(app.commit).not.toHaveBeenCalled();
    app.onPanelChange(input);
    expect(app.commit).toHaveBeenCalledTimes(1);
  });
});

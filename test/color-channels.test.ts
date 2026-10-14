import { afterEach, describe, expect, it, vi } from "vitest";
import { channelsColor, colorAlpha, colorChannels, readColorMode, rememberColorMode, withAlpha, type ColorMode } from "../src/color-channels";
import { CustomPalette } from "../src/custom-colors";
import { primsToSvg, primsToTikz, tikzColor } from "../src/export";
import { tint, type Prim } from "../src/prims";
import { defaultGradient } from "../src/gradient-fill";
import { emptySketch, addCircle, addPoint, addSymbol, deserialize, serialize } from "../src/model";
import { setTexEngine, plainEngine } from "../src/tex";
import { createMathJaxEngine } from "../src/mathjax";

afterEach(() => { vi.unstubAllGlobals(); setTexEngine(plainEngine); });

describe("color channels and opacity", () => {
  it.each(["rgb", "hsl", "hsv"] as ColorMode[])("round trips %s channels without losing RGB or alpha", mode => {
    for (const color of ["#000000", "#ffffff", "#808080", "#ff0000", "#00ff00", "#0000ff", "#1565c080", "#ff008000"]) {
      expect(channelsColor(colorChannels(color, mode), mode, colorAlpha(color))).toBe(color);
    }
  });
  it("handles hue wrapping and channel limits", () => {
    expect(channelsColor([360, 100, 50], "hsl")).toBe("#ff0000");
    expect(channelsColor([-120, 100, 100], "hsv")).toBe("#0000ff");
    expect(channelsColor([300, -10, 0], "rgb")).toBe("#ff0000");
    expect(withAlpha("#1565c0", 0)).toBe("#1565c000");
    expect(withAlpha("#1565c080", 1)).toBe("#1565c0");
  });
  it("remembers the selected system across sessions and unavailable storage", () => {
    const stored = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key), setItem: (key: string, value: string) => stored.set(key, value) });
    rememberColorMode("hsl");
    expect(readColorMode()).toBe("hsl");
    expect(stored.get("mech-sketch.colorMode")).toBe("hsl");
    vi.stubGlobal("localStorage", { getItem: () => { throw Error(); }, setItem: () => { throw Error(); } });
    rememberColorMode("hsv");
    expect(readColorMode()).toBe("hsv");
  });
  it("saves translucent palette colors and preserves opacity in shaded colors", () => {
    const stored = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key), setItem: (key: string, value: string) => stored.set(key, value) });
    const palette = new CustomPalette();
    palette.add("#1565c080"); palette.add("#1565c080");
    expect(new CustomPalette().colors([])).toEqual(["#1565c080"]);
    expect(tint("#00000080", 0.5)).toBe("#80808080");
    expect(tikzColor("#1565c080")).toBe(tikzColor("#1565c0"));
  });
  it("exports independent fill, stroke, and text alpha for SVG/PDF and TikZ", () => {
    setTexEngine(createMathJaxEngine());
    const prims: Prim[] = [
      { k: "line", a: [0, 0], b: [20, 0], stroke: "arrow", layer: "geom", arrowB: true, ink: "#1565c080" },
      { k: "circle", c: [3, 3], r: 1, stroke: "symbol", layer: "sym", fill: "ink", color: "#ff000040" },
      { k: "text", at: [10, 5], tex: "F_1", anchor: "c", layer: "sym", ink: "#1565c080" },
    ];
    const svg = primsToSvg(prims)!;
    expect(svg).toContain('stroke="#1565c0" stroke-opacity="0.501961"');
    expect(svg).toContain('fill="#ff0000" fill-opacity="0.250980"');
    expect(svg).toContain('fill="#1565c0" fill-opacity="0.501961"');
    expect(svg).not.toContain("#1565c080");
    const tikz = primsToTikz(prims);
    expect(tikz).toContain("draw opacity=0.501961");
    expect(tikz).toContain("fill opacity=0.25098");
    expect(tikz).toContain("text opacity=0.501961");
  });
  it.each(["linear", "radial"] as const)("keeps %s endpoint alpha in sketch files and gradient exports", type => {
    const sk = emptySketch(), center = addPoint(sk, 0, 0), circle = addCircle(sk, center.id, 4);
    addSymbol(sk, { type: "fill", circle: circle.id, color: "#1565c080", gradient: { ...defaultGradient(type), color: "#ffffff00" }, points: [], arcs: [], curves: [], holes: [] });
    expect(deserialize(serialize(sk)).symbols).toEqual(sk.symbols);
    const prims: Prim[] = [{ k: "region", layer: "fill", color: "#1565c080", gradient: { ...defaultGradient(type), color: "#ffffff00" }, outlines: [{ kind: "circle", c: [0, 0], r: 4 }] }];
    const svg = primsToSvg(prims)!;
    expect(svg).toContain('stop-opacity="0.501961"');
    expect(svg).toContain('stop-opacity="0.000000"');
    const tikz = primsToTikz(prims);
    expect(tikz).toContain("fill opacity=");
    expect(tikz).not.toMatch(/NaN|Infinity/);
    if (type === "radial") expect(tikz).toMatch(/circle\[radius=[\d.]+\] \([\d.,-]+\) circle\[radius=/);
  });
});

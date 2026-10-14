import { afterEach, describe, it, expect, vi } from "vitest";
import { labelTex, preserveMathSpaces, setPreserveMathSpaces } from "../src/math-labels";
import { emptySketch, addPoint, addSymbol } from "../src/model";
import { buildPrims } from "../src/prims";
import { toSvg, toTikz } from "../src/export";
import { newPlot, plotPrims, plotTikz } from "../src/plot";

afterEach(() => { vi.unstubAllGlobals(); setPreserveMathSpaces(true); });

describe("math label spacing preference", () => {
  it("can switch between visible typed gaps and standard LaTeX without changing explicit spacing", () => {
    expect(preserveMathSpaces()).toBe(true);
    expect(labelTex("F = 10")).toBe("F\\ =\\ 10");
    setPreserveMathSpaces(false);
    expect(labelTex("F = 10")).toBe("F = 10");
    expect(labelTex("\\alpha b")).toBe("\\alpha b");
    expect(labelTex("a\\ b\\,c\\quad d")).toBe("a\\ b\\,c\\quad d");
    setPreserveMathSpaces(true);
    expect(labelTex("\\alpha b")).toBe("\\alpha b");
    expect(labelTex("a\\ b\\,c\\quad d")).toBe("a\\ b\\,c\\quad d");
  });

  it("updates existing sketch and plot labels in previews and exports without altering their stored text", () => {
    const sk = emptySketch(), at = addPoint(sk, 1, 2);
    const datum = addSymbol(sk, { type: "datum", at: at.id, label: "F = 10", dx: 1, dy: 1, color: "#123456" });
    const plot = newPlot(sk); plot.x.label = "x axis";
    const svg = toSvg(sk);
    for (const enabled of [false, true]) {
      setPreserveMathSpaces(enabled);
      const expected = enabled ? "F\\ =\\ 10" : "F = 10";
      expect(buildPrims(sk, 10, { editor: true }).some((p) => p.k === "text" && p.tex === expected)).toBe(true);
      expect(toTikz(sk)).toContain(expected);
      const axis = enabled ? "x\\ axis" : "x axis";
      expect(plotPrims(plot).some((p) => p.k === "text" && p.tex === axis)).toBe(true);
      expect(plotTikz(plot)).toContain(axis);
    }
    setPreserveMathSpaces(false);
    expect(toSvg(sk)).not.toBe(svg);
    expect(datum.label).toBe("F = 10"); expect(plot.x.label).toBe("x axis");
  });

  it("remembers the preference in this browser and restores it on the next load", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
    setPreserveMathSpaces(false);
    expect(values.get("mech-sketch.preserveMathSpaces")).toBe("false");
    vi.resetModules();
    const restored = await import("../src/math-labels");
    expect(restored.preserveMathSpaces()).toBe(false);
    expect(restored.labelTex("a b")).toBe("a b");
  });
});

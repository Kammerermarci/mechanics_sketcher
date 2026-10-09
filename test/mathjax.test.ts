import { describe, it, expect } from "vitest";
import { createMathJaxEngine } from "../src/mathjax";

describe("MathJax labels", () => {
  const mj = createMathJaxEngine();

  it("measures labels in em", () => {
    const a = mj.measure("a"), wide = mj.measure("F_{12}"), tall = mj.measure("\\frac{a}{2}");
    expect(a.w).toBeGreaterThan(0.3);
    expect(a.w).toBeLessThan(0.8);
    expect(a.asc).toBeGreaterThan(0.3);
    expect(wide.w).toBeGreaterThan(a.w * 2);
    expect(wide.desc).toBeGreaterThan(0.1); // the subscript hangs below the baseline
    expect(tall.asc + tall.desc).toBeGreaterThan(a.asc + a.desc + 0.4); // an inline fraction
  });

  it("produces self-contained SVG paths", () => {
    const svg = mj.svg("\\alpha", 10, 20, 12, "tex");
    expect(svg).toMatch(/^<svg class="tex" x="10.00" y="20.00"/);
    expect(svg).toContain("<path");
    expect(svg).not.toContain("<use"); // no references to a shared font cache
    expect(svg).toContain("currentColor");
  });

  it("copes with broken TeX and unknown commands", () => {
    expect(() => mj.measure("F_{1")).not.toThrow();
    expect(mj.measure("\\notacommand").w).toBeGreaterThan(0);
    expect(mj.measure("").w).toBeLessThan(0.05);
  });
});

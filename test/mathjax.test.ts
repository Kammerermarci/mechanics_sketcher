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

  it("draws accented letters from its own font, in math and in text", () => {
    // Every Hungarian letter, as a letter with an accent over it: no text left for the browser's font to draw.
    for (const tex of ["árvíztűrő\\ tükörfúrógép", "ÁRVÍZTŰRŐ\\ TÜKÖRFÚRÓGÉP", "\\text{árvíztűrő tükörfúrógép ÁRVÍZTŰRŐ TÜKÖRFÚRÓGÉP}", "F_{eredő}", "\\mathrm{erő}", "\\textbf{űr}", "\\text{„idézet”}"]) {
      const svg = mj.svg(tex, 0, 0, 10, "tex");
      expect(svg, tex).toContain("<path");
      expect(svg, tex).not.toContain("<text");
      expect(svg, tex).not.toContain("merror");
    }
    // An accent adds height and no width: é is as wide as e, and a word is as wide as it is without its accents.
    const e = mj.measure("e"), acute = mj.measure("é");
    expect(acute.w).toBeCloseTo(e.w, 2);
    expect(acute.asc).toBeGreaterThan(e.asc + 0.1);
    expect(mj.measure("\\text{erő}").w).toBeCloseTo(mj.measure("\\text{ero}").w, 2);
    expect(mj.measure("\\text{tűrő}").w).toBeCloseTo(mj.measure("\\text{turo}").w, 2);
    // An i loses its dot under the accent.
    expect(mj.svg("í", 0, 0, 10, "tex")).toContain('data-c="131"');
    expect(mj.svg("\\text{í}", 0, 0, 10, "tex")).toContain('data-c="131"');
    // The accent commands of TeX still work beside them.
    expect(mj.svg("\\acute{e}\\ddot{o}\\text{\\'e}", 0, 0, 10, "tex")).not.toContain("<text");
  });

  it("copes with signs it has no place for", () => {
    for (const tex of ["5€", "\\text{5 €}", "ç", "😀", "a\u0301"]) expect(() => mj.measure(tex), tex).not.toThrow();
    expect(mj.measure("5€").w).toBeGreaterThan(mj.measure("5").w);
  });

  it("copes with broken TeX and unknown commands", () => {
    expect(() => mj.measure("F_{1")).not.toThrow();
    expect(mj.measure("\\notacommand").w).toBeGreaterThan(0);
    expect(mj.measure("").w).toBeLessThan(0.05);
  });
});

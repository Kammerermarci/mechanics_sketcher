import { describe, it, expect } from "vitest";
import { splitAccent, latexAccents, ACCENTED } from "../src/accents";
import { labelTex, noteTex, noteLatex } from "../src/prims";

describe("accented letters", () => {
  it("takes a letter and its accent apart", () => {
    expect(splitAccent("é")).toEqual({ base: "e", mark: "\u0301", math: "\\acute" });
    expect(splitAccent("Ö")).toMatchObject({ base: "O", math: "\\ddot" });
    expect(splitAccent("ű")).toMatchObject({ base: "u", mark: "\u030B" });
    // Plain letters, and letters TeX has no accent command for, are left alone.
    for (const ch of ["e", "ß", "ç", "ø", "α", "1", "€"]) expect(splitAccent(ch), ch).toBeNull();
    // All of Hungarian is covered, among others.
    for (const ch of "áéíóöőúüűÁÉÍÓÖŐÚÜŰ") expect(ACCENTED, ch).toContain(ch);
    expect(ACCENTED).toContain("č");
    expect(ACCENTED).not.toContain("ß");
  });

  it("turns them into accent commands where LaTeX is in math mode", () => {
    expect(latexAccents("erő", "math")).toBe("er\\mathaccent\"707D{o}");
    expect(latexAccents("árvíz", "math")).toBe("\\acute{a}rv\\acute{\\imath}z");
    expect(latexAccents("ÖÜ", "math")).toBe("\\ddot{O}\\ddot{U}");
    // What follows _ or ^, or a command, is one piece: the accent is wrapped up to stay one.
    expect(latexAccents("F_é", "math")).toBe("F_{\\acute{e}}");
    expect(latexAccents("x^ő_{é}", "math")).toBe("x^{\\mathaccent\"707D{o}}_{\\acute{e}}");
    expect(latexAccents("\\vec é", "math")).toBe("\\vec {\\acute{e}}");
    expect(latexAccents("\\vec{é}", "math")).toBe("\\vec{\\acute{e}}");
    expect(latexAccents("2\\,é", "math")).toBe("2\\,\\acute{e}");
    // Nothing to do: nothing changed.
    for (const tex of ["F_1 = 2a", "\\frac{a}{2}\\ \\alpha", "\\'e", ""]) expect(latexAccents(tex, "math")).toBe(tex);
  });

  it("leaves text as typed, and knows text from math", () => {
    expect(latexAccents("erő", "text")).toBe("erő");
    expect(latexAccents("\\text{erő} + ő", "math")).toBe("\\text{erő} + \\mathaccent\"707D{o}");
    expect(latexAccents("\\mathrm{erő}", "math")).toBe("\\mathrm{er\\mathaccent\"707D{o}}");
    expect(latexAccents("\\textbf {é}é", "math")).toBe("\\textbf {é}\\acute{e}");
    // Math inside text inside math, and back out again.
    expect(latexAccents("\\text{é $é$ é}é", "math")).toBe("\\text{é $\\acute{e}$ é}\\acute{e}");
    expect(latexAccents("é $é_{é}$ é \\(é\\) é", "text")).toBe("é $\\acute{e}_{\\acute{e}}$ é \\(\\acute{e}\\) é");
    // An escaped dollar sign is a dollar sign.
    expect(latexAccents("é \\$ é", "text")).toBe("é \\$ é");
    // Braces that do not pair up do no harm.
    expect(latexAccents("}é{", "math")).toBe("}\\acute{e}{");
  });

  it("reads a letter typed as two characters as the one it is", () => {
    expect(labelTex("e\u0301")).toBe("é");
    expect(noteTex("o\u030B")).toBe("\\text{ő}");
    expect(noteLatex("o\u030B $u\u030B$").latex).toBe("ő $ű$");
  });
});

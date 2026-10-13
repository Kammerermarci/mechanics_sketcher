import { afterEach, describe, it, expect, vi } from "vitest";
import { CustomPalette, normalizeColor } from "../src/custom-colors";

afterEach(() => vi.unstubAllGlobals());

describe("custom annotation palettes", () => {
  it("normalizes hex colours and rejects invalid values", () => {
    expect(normalizeColor(" #AbC ")).toBe("#aabbcc");
    expect(normalizeColor("12AB34")).toBe("#12ab34");
    expect(normalizeColor("red")).toBeNull();
    expect(normalizeColor("#12345678")).toBeNull();
  });
  it("saves added colours for new sessions without duplicate swatches", () => {
    const stored = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) });
    const palette = new CustomPalette();
    expect(palette.colors(["#1565c0"])).toEqual(["#1565c0"]);
    palette.add("#12AB34");
    palette.add("12ab34");
    expect(new CustomPalette().colors(["#1565c0"])).toEqual(["#1565c0", "#12ab34"]);
    expect(palette.colors(["#12ab34"])).toEqual(["#12ab34"]);
  });
  it("filters damaged preferences and retains additions when storage is unavailable", () => {
    vi.stubGlobal("localStorage", { getItem: () => '["#abc",null,5,"bad value","#AABBCC"]', setItem: () => { throw new Error("storage unavailable"); } });
    const palette = new CustomPalette();
    expect(palette.colors([])).toEqual(["#aabbcc"]);
    palette.add("#fedcba");
    expect(palette.colors([])).toEqual(["#aabbcc", "#fedcba"]);
    palette.add("invalid");
    expect(palette.colors([])).toHaveLength(2);
  });
});

import { describe, it, expect } from "vitest";
import { backgroundPattern } from "../src/background";
import { emptySketch, serialize, deserialize } from "../src/model";
import type { View } from "../src/render";

const view: View = { cx: 2.3, cy: -1.7, scale: 40, w: 800, h: 600 };
const attributes = (markup: string, id: string) => {
  const tag = markup.match(new RegExp(`<pattern id="${id}"[^>]*>`))![0];
  return Object.fromEntries([...tag.matchAll(/(width|height|x|y)="([^"]+)"/g)].map((m) => [m[1], Number(m[2])]));
};

describe("sketch background", () => {
  it("keeps minor and tenth lines at the origin through pan and zoom", () => {
    const sk = { ...emptySketch(), backgroundStyle: "grid" as const, backgroundSpacingMm: 2.5 };
    for (const v of [view, { ...view, cx: -11.1, cy: 7.6, scale: 13 }]) {
      const markup = backgroundPattern(v, sk);
      for (const [id, multiplier] of [["grid", 1], ["grid-major", 10]] as const) {
        const a = attributes(markup, id);
        expect(a.width).toBe(2.5 * v.scale * multiplier);
        expect(a.height).toBe(a.width);
        const origin = [v.w / 2 - v.cx * v.scale, v.h / 2 + v.cy * v.scale];
        for (const [offset, coordinate] of [[a.x, origin[0]], [a.y, origin[1]]]) {
          const periods = (coordinate - offset - a.width / 2) / a.width;
          expect(periods).toBeCloseTo(Math.round(periods));
        }
      }
    }
  });

  it("omits only the unreadably dense layer", () => {
    const sk = { ...emptySketch(), backgroundStyle: "grid" as const, backgroundSpacingMm: 0.1 };
    const markup = backgroundPattern({ ...view, scale: 10 }, sk);
    expect(markup).not.toContain('id="grid"');
    expect(markup).toContain('id="grid-major"');
  });

  it("defaults to dots and preserves settings in saved sketches", () => {
    expect(backgroundPattern(view, emptySketch())).toContain('class="grid-dot"');
    const sk = { ...emptySketch(), backgroundStyle: "grid" as const, backgroundSpacingMm: 0.25 };
    expect(deserialize(serialize(sk))).toMatchObject({ backgroundStyle: "grid", backgroundSpacingMm: 0.25 });
    for (const value of [0, -1, 0.01, 1001, "2", null]) {
      const loaded = deserialize(JSON.stringify({ ...sk, backgroundSpacingMm: value }));
      expect(loaded.backgroundSpacingMm).toBeUndefined();
    }
  });
});

import { describe, expect, it, vi } from "vitest";
import { arrowFoot } from "../src/arrow-foot";
import { type ArcPrim, buildPrims, PAPER } from "../src/prims";
import { emptySketch, addPoint, addLine, addArc, entity, serialize, deserialize } from "../src/model";
import { toSvg, toTikz, figureBounds } from "../src/export";
import { mirrorCopy, linearCopy } from "../src/pattern";
import { copyObjects, pasteObjects } from "../src/object-clipboard";
import { App } from "../src/app";
import { History } from "../src/history";
import type { V } from "../src/geom";

const center = (a: V, b: V): V => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
function fixture() {
  const sk = emptySketch(), a = addPoint(sk, 0, 0), b = addPoint(sk, 4, 0), c = addPoint(sk, 0, 4);
  const line = addLine(sk, a.id, b.id), arc = addArc(sk, a.id, b.id, c.id);
  line.arrow = "end"; arc.arrow = "end"; line.foot = true; arc.foot = true;
  return { sk, line, arc };
}

describe("arrow tail feet", () => {
  it("puts a perpendicular bar at the unheaded end of a straight arrow", () => {
    const p = { k: "line" as const, layer: "geom" as const, stroke: "arrow" as const, a: [0, 0] as V, b: [4, 4] as V, arrowB: true };
    const foot = arrowFoot(p, true, 2)!;
    expect(center(foot.a, foot.b)).toEqual(p.a);
    expect((foot.b[0] - foot.a[0]) * 4 + (foot.b[1] - foot.a[1]) * 4).toBeCloseTo(0);
    expect(Math.hypot(foot.b[0] - foot.a[0], foot.b[1] - foot.a[1])).toBeCloseTo(2);
    const reversed = arrowFoot({ ...p, arrowB: false, arrowA: true }, true, 2)!;
    expect(center(reversed.a, reversed.b)).toEqual(p.b);
  });
  it.each([false, true])("uses the radial normal at the curved arrow's tail (reverse=%s)", (reverse) => {
    const p: ArcPrim = { k: "arc", layer: "geom", stroke: "arrow", c: [2, 3], r: 5, a0: 0.3, a1: 2.1, arrowA: reverse, arrowB: !reverse };
    const foot = arrowFoot(p, true, 2)!;
    const angle = reverse ? p.a1 : p.a0, tail = center(foot.a, foot.b);
    expect(tail[0]).toBeCloseTo(2 + 5 * Math.cos(angle)); expect(tail[1]).toBeCloseTo(3 + 5 * Math.sin(angle));
    expect((foot.b[0] - foot.a[0]) * -Math.sin(angle) + (foot.b[1] - foot.a[1]) * Math.cos(angle)).toBeCloseTo(0);
  });
  it("inherits color and stroke width, grows with head size, and contributes to export bounds", () => {
    const { sk, line } = fixture(); line.color = "#1565c080"; line.weight = 1.2;
    const get = () => buildPrims(sk, 1, { editor: false }).find((p) => p.ref === line.id && p.part === "foot")!;
    const foot = get(); if (foot.k !== "line") throw new Error("Missing foot");
    expect(foot.ink).toBe(line.color); expect(foot.width).toBeCloseTo(1.2 * 0.3515);
    const size = Math.hypot(foot.b[0] - foot.a[0], foot.b[1] - foot.a[1]);
    line.headScale = 2; const bigger = get(); if (bigger.k !== "line") throw new Error("Missing foot");
    expect(Math.hypot(bigger.b[0] - bigger.a[0], bigger.b[1] - bigger.a[1])).toBeCloseTo(size * 2);
    const box = figureBounds([bigger]); expect(box.y0).toBeLessThan(bigger.a[1]); expect(box.y1).toBeGreaterThan(bigger.b[1]);
    expect(toSvg(sk)).toContain('stroke="#1565c0" stroke-opacity="0.501961"');
    expect(toTikz(sk)).toContain("draw opacity=0.501961");
    expect(PAPER.arrowWidth).toBeGreaterThan(0);
  });
  it("omits disabled feet, zero-width arrows, construction arrows, and arrows with no unique tail", () => {
    const { sk, line, arc } = fixture();
    for (const arrow of [line, arc]) {
      arrow.arrow = "both";
      expect(buildPrims(sk, 1, { editor: false }).some((p) => p.ref === arrow.id && p.part === "foot")).toBe(false);
      arrow.arrow = "none";
      expect(buildPrims(sk, 1, { editor: false }).some((p) => p.ref === arrow.id && p.part === "foot")).toBe(false);
      arrow.arrow = "end"; arrow.weight = 0;
      expect(buildPrims(sk, 1, { editor: false }).some((p) => p.ref === arrow.id && p.part === "foot")).toBe(false);
      delete arrow.weight; arrow.construction = true;
      expect(buildPrims(sk, 1, { editor: true }).some((p) => p.ref === arrow.id && p.part === "foot")).toBe(false);
      delete arrow.construction; delete arrow.foot;
      expect(buildPrims(sk, 1, { editor: false }).some((p) => p.ref === arrow.id && p.part === "foot")).toBe(false);
    }
  });
  it("saves and preserves feet in patterns and independent pasted copies", () => {
    const { sk, line, arc } = fixture();
    expect(entity(deserialize(serialize(sk)), line.id)).toHaveProperty("foot", true);
    const axis = addLine(sk, addPoint(sk, -2, -2).id, addPoint(sk, -2, 7).id);
    expect(typeof mirrorCopy(sk, [arc.id], axis.id)).not.toBe("string");
    expect(sk.entities.filter((e) => e.type === "arc").every((e) => e.foot)).toBe(true);
    expect(typeof linearCopy(sk, [line.id], 2, [10, 0])).not.toBe("string");
    const pasted = emptySketch(); pasteObjects(pasted, copyObjects(sk, [line.id, arc.id])!, [20, 0]);
    expect(pasted.entities.filter((e) => e.type !== "point").every((e) => e.type !== "spline" && e.type !== "circle" && e.foot)).toBe(true);
  });
  it("exports both feet as vector strokes in SVG and TikZ", () => {
    const { sk, line, arc } = fixture();
    const svgWithFeet = toSvg(sk)!, tikzWithFeet = toTikz(sk)!;
    expect(svgWithFeet.match(/<line /g)).toHaveLength(3);
    expect(tikzWithFeet.match(/\\draw\[arrow\]/g)).toHaveLength(2);
    delete line.foot; delete arc.foot;
    expect(toSvg(sk)!.match(/<line /g)).toHaveLength(1);
    expect(toTikz(sk)).not.toContain("\\draw[arrow]");
  });
  it("toggles the foot through the panel as one undoable edit", () => {
    const { sk, line } = fixture(); delete line.foot;
    const history = new History(); history.reset(sk);
    const app = Object.assign(Object.create(App.prototype), { sk, selection: new Set([line.id]), commit: vi.fn(() => history.commit(sk)) });
    app.onPanelChange({ dataset: { field: "arrow-foot" }, checked: true });
    expect(line.foot).toBe(true); expect(app.commit).toHaveBeenCalledOnce();
    expect(entity(history.undo()!, line.id)).not.toHaveProperty("foot");
    expect(entity(history.redo()!, line.id)).toHaveProperty("foot", true);
    app.onPanelChange({ dataset: { field: "arrow-foot" }, checked: false }); expect(line.foot).toBeUndefined();
  });
});

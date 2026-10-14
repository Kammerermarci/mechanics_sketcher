import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/app";
import { addPoint, addSupport, deserialize, emptySketch, serialize } from "../src/model";
import { buildPrims, primDistance } from "../src/prims";
import { customSupportPrims } from "../src/custom-supports";
import { CUSTOM_SUPPORT_SHAPES } from "../src/custom-support-shapes";
import { SupportModes } from "../src/support-menus";
import { toSvg, toTikz } from "../src/export";
import { copyObjects, pasteObjects } from "../src/object-clipboard";
import { linearCopy } from "../src/pattern";

afterEach(() => vi.unstubAllGlobals());

describe("custom filled supports", () => {
  it.each(["pin", "roller", "fixed"] as const)("renders %s as filled vector artwork and exports the same colours", (kind) => {
    const sk = emptySketch(), p = addPoint(sk, 2, 3), s = addSupport(sk, kind, p.id);
    s.style = "custom";
    const prims = buildPrims(sk, 10, { editor: false }).filter((p) => p.ref === s.id);
    const ground = prims.find((p) => p.k === "poly" && p.color === "#dbdbe3");
    expect(ground).toMatchObject({ fill: "ink", width: 0, layer: "sym" });
    expect(primDistance(ground!, [20, kind === "fixed" ? 29 : kind === "pin" ? 26 : 25])).toBe(0);
    expect(toSvg(sk)).toContain('fill="#dbdbe3"');
    expect(toTikz(sk)).toContain("red,219;green,219;blue,227");
    if (kind !== "fixed") {
      expect(prims).toContainEqual(expect.objectContaining({ k: "circle", c: [20, 30], color: "#aeaeae" }));
      // Filled body outline stays open, exactly as in the source SVG.
      const body = CUSTOM_SUPPORT_SHAPES[kind].find((x) => x.kind === "path" && x.fill === "#e5e5e5")!;
      expect(body.kind).toBe("path");
      if (body.kind === "path") expect(prims).toContainEqual(expect.objectContaining({ k: "path",
        pts: body.points.map(([x, y]) => [20 + x, 30 + y]) }));
    }
  });

  it("rotates around the joint and obeys support size independently of drawing scale", () => {
    const sk = emptySketch(), p = addPoint(sk, 2, 3), s = addSupport(sk, "pin", p.id);
    const original = customSupportPrims(sk, s, 10);
    s.angle = Math.PI / 2; sk.supportScale = 2;
    const changed = customSupportPrims(sk, s, 4);
    const a = original.find((x) => x.k === "circle")!, b = changed.find((x) => x.k === "circle")!;
    expect(a.k === "circle" && b.k === "circle" && b.r).toBeCloseTo(a.k === "circle" ? a.r * 2 : 0);
    expect(b).toMatchObject({ c: [8, 12] });
    const ground = changed[0];
    expect(ground.k === "poly" && ground.pts[0][0]).toBeCloseTo(8 + 2 * 3.602011);
    expect(ground.k === "poly" && ground.pts[0][1]).toBeCloseTo(12 - 2 * 4.182569);
  });

  it("preserves style through saves, paste and patterns, and keeps classic as the default", () => {
    const sk = emptySketch(), p = addPoint(sk, 2, 3), s = addSupport(sk, "roller", p.id);
    expect(s.style).toBeUndefined(); s.style = "custom";
    expect(deserialize(serialize(sk)).symbols[0]).toMatchObject({ style: "custom" });
    const target = emptySketch();
    pasteObjects(target, copyObjects(sk, [s.id])!, [5, 0]);
    expect(target.symbols[0]).toMatchObject({ style: "custom", kind: "roller" });
    expect(typeof linearCopy(sk, [p.id, s.id], 2, [5, 0])).not.toBe("string");
    expect(sk.symbols.length).toBeGreaterThan(1);
    expect(sk.symbols.every((x) => x.type === "support" && x.style === "custom")).toBe(true);
  });

  it("remembers dropdown styles separately and allows changing an existing support", () => {
    const memory = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value) });
    const modes = new SupportModes();
    expect(modes.style("pin")).toBe("classic");
    expect(modes.select("pin:custom")).toBe("pin");
    expect(modes.select("pin:unknown")).toBeNull();
    expect(new SupportModes().style("pin")).toBe("custom");
    expect(modes.style("roller")).toBe("classic");
    expect(modes.button("pin")).toContain('data-support-mode="pin:custom" aria-checked="true"');
    expect(modes.button("wall")).toContain('aria-label="Fixed styles"');
    const sk = emptySketch(), s = addSupport(sk, "fixed", addPoint(sk, 0, 0).id);
    const app = Object.assign(Object.create(App.prototype), { sk, selection: new Set([s.id]), commit: vi.fn() }) as any;
    app.onPanelChange({ dataset: { field: "sym-support-style" }, value: "custom" });
    expect(s.style).toBe("custom");
    app.onPanelChange({ dataset: { field: "sym-support-style" }, value: "classic" });
    expect(s.style).toBeUndefined();
  });

  it.each(["pin", "roller", "wall"] as const)("places the chosen custom %s style at a joint", (tool) => {
    const sk = emptySketch(), p = addPoint(sk, 2, 3), modes = new SupportModes();
    modes.select(`${tool}:custom`);
    const app = Object.assign(Object.create(App.prototype), {
      sk, tool, supportModes: modes, view: { cx: 0, cy: 0, scale: 40, w: 800, h: 600 },
      snapAt: () => ({ pos: [2, 3], pointId: p.id }), materialize: () => p.id,
      supportAngle: () => 0.7, finishDrawing: vi.fn(),
    }) as any;
    app.symbolClick([480, 180]);
    expect(sk.symbols).toHaveLength(1);
    expect(sk.symbols[0]).toMatchObject({ type: "support", kind: tool === "wall" ? "fixed" : tool,
      at: p.id, angle: 0.7, style: "custom" });
    expect(app.finishDrawing).toHaveBeenCalledOnce();
  });
});

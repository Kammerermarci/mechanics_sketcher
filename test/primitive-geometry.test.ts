import { beforeAll, afterAll, afterEach, describe, it, expect, vi } from "vitest";
import { make_gcs_wrapper } from "@salusoft89/planegcs";
import { SketchSolver } from "../src/solver";
import { emptySketch, addPoint, addConstraint, point, entity, type Line } from "../src/model";
import { type V, sub, dot, cross, dist, angleOf, inSweep } from "../src/geom";
import { rectangleCorners, rectangleParts, arcThrough, threePointArc } from "../src/primitive-geometry";
import { PrimitiveModes } from "../src/primitive-menus";
import { App } from "../src/app";

let solver: SketchSolver;
beforeAll(async () => { solver = new SketchSolver(await make_gcs_wrapper()); });
afterAll(() => solver.dispose());
afterEach(() => vi.unstubAllGlobals());

describe("rectangle drawing", () => {
  it("uses opposite corners in either drawing direction", () => {
    expect(rectangleCorners("rectangle", [4, 3], [1, -2])).toEqual([[4, 3], [1, 3], [1, -2], [4, -2]]);
    expect(rectangleCorners("rectangle", [1, 1], [1, 5])).toBeNull();
  });
  it("keeps the chosen center at the midpoint when dimensioned", () => {
    const sk = emptySketch(), center = addPoint(sk, 3, -2);
    addConstraint(sk, { type: "fixed", p: center.id });
    const corners = rectangleCorners("rectcenter", [3, -2], [6, 2])!;
    const parts = rectangleParts(sk, corners, "rectcenter", {}, center.id);
    parts.autos.forEach((c) => addConstraint(sk, c));
    const first = entity(sk, parts.made[0]) as Line;
    addConstraint(sk, { type: "distance", a: first.p1, b: first.p2, mode: "aligned", value: 10, offset: 1 });
    const result = solver.solve(sk);
    expect(result.ok).toBe(true);
    expect(result.redundant).toEqual([]);
    const p = point(sk, first.p1), q = point(sk, (entity(sk, parts.made[1]) as Line).p2);
    expect((p.x + q.x) / 2).toBeCloseTo(3);
    expect((p.y + q.y) / 2).toBeCloseTo(-2);
    expect(sk.entities.filter((e) => e.type === "line" && e.construction)).toHaveLength(1);
  });
  it.each([3, -3])("makes a rotated rectangle with signed width %s and reusable corners", (width) => {
    const sk = emptySketch(), a: V = [1, 2], b: V = [4, 6];
    const normal: V = [-0.8, 0.6];
    const third: V = [b[0] + width * normal[0] + 9 * 0.6, b[1] + width * normal[1] + 9 * 0.8];
    const corners = rectangleCorners("rect3", a, b, third)!;
    const start = addPoint(sk, ...a), end = addPoint(sk, ...b);
    const parts = rectangleParts(sk, corners, "rect3", { 0: start.id, 1: end.id }, undefined, true);
    parts.autos.forEach((c) => addConstraint(sk, c));
    expect(solver.solve(sk).ok).toBe(true);
    const edges = parts.made.map((id) => entity(sk, id) as Line);
    const vectors = edges.map((line) => {
      const p = point(sk, line.p1), q = point(sk, line.p2);
      return sub([q.x, q.y], [p.x, p.y]);
    });
    expect(dot(vectors[0], vectors[1])).toBeCloseTo(0);
    expect(cross(vectors[0], vectors[2])).toBeCloseTo(0);
    expect(cross(vectors[1], vectors[3])).toBeCloseTo(0);
    expect(Math.hypot(...vectors[1])).toBeCloseTo(Math.abs(width));
    expect(edges.every((line) => line.construction)).toBe(true);
    expect(edges[0].p1).toBe(start.id);
    expect(edges[0].p2).toBe(end.id);
  });
});

describe("three-point arcs", () => {
  it.each(([ [0, 1], [Math.SQRT1_2, -Math.SQRT1_2], [-1, 0] ] as V[]).map((through) => ({ through })))("chooses the sweep through $through", ({ through }) => {
    const a: V = [1, 0], b: V = [0, -1], shape = arcThrough(a, b, through)!;
    expect(dist(a, shape.c)).toBeCloseTo(shape.r);
    expect(dist(b, shape.c)).toBeCloseTo(shape.r);
    expect(dist(through, shape.c)).toBeCloseTo(shape.r);
    expect(inSweep(angleOf(sub(through, shape.c)), shape.a0, shape.a1)).toBe(true);
  });
  it("rejects repeated or collinear points before creating geometry", () => {
    expect(arcThrough([0, 0], [1, 0], [2, 0])).toBeNull();
    expect(arcThrough([0, 0], [0, 0], [0, 1])).toBeNull();
  });
  it("keeps the third point on the curve after a radius change", () => {
    const sk = emptySketch(), a: V = [1, 0], b: V = [-1, 0], through: V = [0, 1];
    const ids = [a, b, through].map((p) => addPoint(sk, ...p).id);
    const made = threePointArc(sk, ids[0], ids[1], ids[2], arcThrough(a, b, through)!, true);
    made.autos.forEach((c) => addConstraint(sk, c));
    addConstraint(sk, { type: "radius", target: made.arc.id, value: 3, angle: 0 });
    expect(solver.solve(sk).ok).toBe(true);
    const center = point(sk, made.arc.c);
    for (const id of ids) {
      const p = point(sk, id);
      expect(Math.hypot(p.x - center.x, p.y - center.y)).toBeCloseTo(3);
    }
    expect(made.arc.construction).toBe(true);
  });
});

describe("drawing mode defaults", () => {
  it("remembers each group independently and makes it the main button", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
    const modes = new PrimitiveModes();
    expect(modes.rectangle).toBe("rectangle");
    expect(modes.arc).toBe("arc");
    modes.select("rect3");
    modes.select("arc3");
    const restored = new PrimitiveModes();
    expect(restored.rectangle).toBe("rect3");
    expect(restored.arc).toBe("arc3");
    expect(restored.button("rectangle")).toContain('class="tool" data-tool="rect3"');
    expect(restored.button("arc")).toContain('class="tool" data-tool="arc3"');
    expect(modes.select("invalid")).toBe(false);
  });
});

describe("drawing tool integration", () => {
  function drawingApp(tool: string) {
    const sk = emptySketch();
    return Object.assign(Object.create(App.prototype), {
      sk, solver, tool, pending: null, constructing: false,
      view: { cx: 0, cy: 0, scale: 40, w: 800, h: 600 },
      selection: new Set(), result: solver.solve(sk), commit: vi.fn(), toast: vi.fn(),
      snapAt: (pos: V) => {
        const existing = sk.entities.find((e) => e.type === "point" && Math.hypot(e.x - pos[0], e.y - pos[1]) < 1e-9);
        return { pos, ...(existing ? { pointId: existing.id } : {}) };
      },
    }) as { sk: ReturnType<typeof emptySketch>; pending: unknown; commit: ReturnType<typeof vi.fn>; toolClick(pos: V): void };
  }
  it.each([
    { tool: "rectangle", clicks: [[0, 0], [3, 2]] as V[], constraints: 4 },
    { tool: "rectcenter", clicks: [[0, 0], [3, 2]] as V[], constraints: 5 },
    { tool: "rect3", clicks: [[0, 0], [3, 2], [-1, 3]] as V[], constraints: 3 },
  ])("creates $tool with one commit and reuses the origin", ({ tool, clicks, constraints }) => {
    const app = drawingApp(tool);
    clicks.slice(0, -1).forEach((p) => app.toolClick(p));
    expect(app.sk.entities).toHaveLength(1);
    app.toolClick(clicks[clicks.length - 1]);
    expect(app.pending).toBeNull();
    expect(app.commit).toHaveBeenCalledTimes(1);
    expect(app.sk.entities.filter((e) => e.type === "line" && !e.construction)).toHaveLength(4);
    expect(app.sk.constraints).toHaveLength(constraints);
    expect(solver.solve(app.sk).conflicting).toEqual([]);
  });
  it("rejects a collinear third arc click, then completes without losing its endpoints", () => {
    const app = drawingApp("arc3");
    app.toolClick([0, 0]);
    app.toolClick([3, 0]);
    app.toolClick([1, 0]);
    expect(app.commit).not.toHaveBeenCalled();
    expect(app.sk.entities).toHaveLength(1);
    app.toolClick([1, 2]);
    expect(app.pending).toBeNull();
    expect(app.commit).toHaveBeenCalledTimes(1);
    expect(app.sk.entities.filter((e) => e.type === "arc")).toHaveLength(1);
    expect(app.sk.constraints).toHaveLength(1);
    expect(solver.solve(app.sk).conflicting).toEqual([]);
  });
});

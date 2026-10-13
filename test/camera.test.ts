import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { make_gcs_wrapper } from "@salusoft89/planegcs";
import { App } from "../src/app";
import { PlotWorkspace } from "../src/plotwork";
import { SketchSolver } from "../src/solver";
import { ORIGIN, emptySketch, addPoint, addLine, addCircle, addConstraint, constraint, point, type Sketch } from "../src/model";
import { circularCopy } from "../src/pattern";
import { newPlot } from "../src/plot";
import type { View } from "../src/render";

let solver: SketchSolver;
beforeAll(async () => { solver = new SketchSolver(await make_gcs_wrapper()); });
afterAll(() => solver.dispose());

// Exercise the real editing methods and solver without constructing browser chrome.
function editingApp(sk: Sketch) {
  const app = Object.assign(Object.create(App.prototype), {
    sk, solver, result: solver.solve(sk),
    view: { cx: 2, cy: -3, scale: 40, w: 800, h: 600 },
    commit: vi.fn(), touch: vi.fn(), toast: vi.fn(), fit: vi.fn(),
  }) as {
    sk: Sketch; view: View; fit: ReturnType<typeof vi.fn>;
    setDimValue(id: string, value: string): boolean;
    setTurnAngle(id: string, degrees: number): void;
  };
  return app;
}

describe("camera stays fixed during edits", () => {
  it.each([0.1, 100])("changes a length to %s without fitting the view", (value) => {
    const sk = emptySketch();
    const end = addPoint(sk, 2, 0);
    addLine(sk, ORIGIN, end.id);
    addConstraint(sk, { type: "horizontal", a: ORIGIN, b: end.id });
    const dim = addConstraint(sk, { type: "distance", a: ORIGIN, b: end.id, mode: "aligned", value: 2, offset: 1 });
    const app = editingApp(sk), camera = { ...app.view };
    expect(app.setDimValue(dim.id, String(value))).toBe(true);
    expect(point(app.sk, end.id).x).toBeCloseTo(value);
    expect(app.view).toEqual(camera);
    expect(app.fit).not.toHaveBeenCalled();
  });

  it("changes a radius beyond the viewport without fitting", () => {
    const sk = emptySketch();
    const circle = addCircle(sk, ORIGIN, 2);
    const dim = addConstraint(sk, { type: "radius", target: circle.id, value: 2, angle: 0 });
    const app = editingApp(sk), camera = { ...app.view };
    expect(app.setDimValue(dim.id, "100")).toBe(true);
    expect(circle.r).toBeCloseTo(100);
    expect(app.view).toEqual(camera);
    expect(app.fit).not.toHaveBeenCalled();
  });

  it("changes a circular pattern angle without fitting", () => {
    const sk = emptySketch();
    const end = addPoint(sk, 2, 0), line = addLine(sk, ORIGIN, end.id);
    const copy = circularCopy(sk, [line.id], ORIGIN, 3, Math.PI / 3);
    if (typeof copy === "string") throw new Error(copy);
    const app = editingApp(sk), camera = { ...app.view };
    app.setTurnAngle(copy.link, 90);
    expect(constraint(sk, copy.link)).toMatchObject({ angle: Math.PI / 2 });
    expect(app.view).toEqual(camera);
    expect(app.fit).not.toHaveBeenCalled();
  });

  it("keeps the graph camera fixed through range edits, axis flips and range tools", () => {
    const sk = emptySketch(), plot = newPlot(sk);
    plot.curves[0].pieces = [{ expr: "100*x" }];
    const workspace = Object.assign(Object.create(PlotWorkspace.prototype), {
      host: { sketch: () => sk, commit: vi.fn(), touch: vi.fn(), render: vi.fn(), toast: vi.fn() },
      current: plot.id, selected: null,
      gv: { cx: 4, cy: -2, sx: 35, sy: 50 },
      G: { x: 0, y: 0, w: 400, h: 600 }, fit: vi.fn(),
    }) as Pick<PlotWorkspace, "change" | "act"> & { gv: object; fit: ReturnType<typeof vi.fn> };
    const camera = { ...workspace.gv };
    workspace.change({ dataset: { pf: "x.max" }, value: "1000" } as unknown as HTMLInputElement);
    expect(plot.x.max).toBe(1000);
    for (const action of ["flip", "equal", "fit-y"]) workspace.act(action, {});
    expect(workspace.gv).toEqual(camera);
    expect(workspace.fit).not.toHaveBeenCalled();
  });
});

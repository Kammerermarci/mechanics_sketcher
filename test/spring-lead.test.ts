import { describe, it, expect, vi } from "vitest";
import { App } from "../src/app";
import { History } from "../src/history";
import { emptySketch, addPoint, addLine, addArc, serialize, deserialize, type Line } from "../src/model";
import { springLead, springTurns, elementPaths } from "../src/element";
import { copyObjects, pasteObjects } from "../src/object-clipboard";
import { toSvg, toTikz } from "../src/export";

function example() {
  const sk = emptySketch(), line = addLine(sk, addPoint(sk, 0, 0).id, addPoint(sk, 20, 0).id);
  line.element = "spring"; line.look = { across: 2, pitch: 1 };
  return { sk, line };
}

describe("spring straight ends", () => {
  it.each([false, true])("extends both ends while preserving endpoints and width (coil=%s)", (coil) => {
    const { sk, line } = example();
    line.look!.coil = coil;
    const turns = springTurns(20, line.look!);
    line.look!.lead = 5;
    const [run] = elementPaths(sk, line);
    expect(run[0]).toEqual([0, 0]); expect(run[1]).toEqual([5, 0]);
    expect(run.at(-2)).toEqual([15, 0]); expect(run.at(-1)).toEqual([20, 0]);
    expect(springTurns(20, line.look!)).toBeLessThan(turns);
    for (const [x, y] of run) {
      expect(Math.abs(y)).toBeLessThanOrEqual(1);
      if (x < 5 || x > 15) expect(y).toBe(0);
    }
  });

  it("supports zero ends, caps oversized ends, and retains the legacy automatic look", () => {
    const look = { across: 2, pitch: 1, lead: 0 };
    expect(springLead(20, look)).toBe(0);
    expect(springLead(4, { ...look, lead: 10 })).toBe(1.8);
    expect(springTurns(4, { ...look, lead: 10 })).toBe(1);
    for (const lead of [undefined, -1, NaN, Infinity]) expect(springLead(20, { ...look, lead })).toBe(1.2);
  });

  it("measures end length along curved springs", () => {
    const sk = emptySketch();
    const arc = addArc(sk, addPoint(sk, 0, 0).id, addPoint(sk, 10, 0).id, addPoint(sk, 0, 10).id);
    arc.element = "spring"; arc.look = { across: 2, pitch: 1, lead: 4 };
    const [run] = elementPaths(sk, arc);
    const endOfLead = run.findIndex((p) => Math.abs(Math.atan2(p[1], p[0]) - 0.4) < 1e-9);
    expect(endOfLead).toBeGreaterThan(1);
    run.slice(0, endOfLead + 1).forEach((p) => expect(Math.hypot(...p)).toBeCloseTo(10));
    expect(run[0]).toEqual([10, 0]);
    expect(run.at(-1)![0]).toBeCloseTo(0); expect(run.at(-1)![1]).toBeCloseTo(10);
  });

  it("updates the slider live and records one edit with Undo/Redo", () => {
    const { sk, line } = example(), history = new History(); history.reset(sk);
    const output = { textContent: "" };
    const app = Object.assign(Object.create(App.prototype), {
      sk, selectedElements: () => [line], render: vi.fn(), commit: vi.fn(() => history.commit(sk)),
    }) as any;
    expect(app.elementPanel()).toContain('data-field="el-lead"');
    const input = { dataset: { field: "el-lead" }, value: "25", parentElement: { querySelector: () => output } };
    app.onPanelChange(input, true);
    expect(line.look!.lead).toBe(5); expect(output.textContent).toBe("5");
    expect(app.commit).not.toHaveBeenCalled();
    app.onPanelChange(input);
    expect(app.commit).toHaveBeenCalledTimes(1);
    expect((history.undo()!.entities.find((e) => e.id === line.id) as Line).look!.lead).toBeUndefined();
    expect((history.redo()!.entities.find((e) => e.id === line.id) as Line).look!.lead).toBe(5);
  });

  it("preserves the setting in saved files and copies and exports the changed paths", () => {
    const { sk, line } = example(), svg = toSvg(sk), tikz = toTikz(sk);
    line.look!.lead = 5;
    expect(toSvg(sk)).not.toBe(svg); expect(toTikz(sk)).not.toBe(tikz);
    const reopened = deserialize(serialize(sk));
    expect((reopened.entities.find((e) => e.id === line.id) as Line).look!.lead).toBe(5);
    const destination = emptySketch();
    const ids = pasteObjects(destination, copyObjects(sk, [line.id])!, [0, 0]);
    const image = destination.entities.find((e) => e.id === ids[0]) as Line;
    expect(image.look!.lead).toBe(5);
    expect(elementPaths(destination, image)).toEqual(elementPaths(sk, line));
  });
});

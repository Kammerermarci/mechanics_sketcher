import { afterEach, describe, it, expect, vi } from "vitest";
import { App } from "../src/app";
import { History } from "../src/history";
import { emptySketch, addPoint, addLine, addCircle, addSymbol, serialize, deserialize, type Balloon } from "../src/model";
import { balloonAnchor } from "../src/prims";
import { balloonTipGrip, moveBalloonTip } from "../src/balloon-tip";
import { toScreen, type View } from "../src/render";
import { toSvg, toTikz } from "../src/export";
import type { V } from "../src/geom";

afterEach(() => vi.unstubAllGlobals());
const view: View = { cx: 0, cy: 0, scale: 40, w: 800, h: 600 };
function example() {
  const sk = emptySketch(), a = addPoint(sk, 1, 1), b = addPoint(sk, 6, 4);
  const balloon = addSymbol(sk, { type: "balloon", text: "1", at: a.id, x: 1, y: 1, dx: 2, dy: 3, end: "arrow" });
  const history = new History(); history.reset(sk);
  vi.stubGlobal("document", { activeElement: null }); vi.stubGlobal("HTMLElement", class {});
  const app = Object.assign(Object.create(App.prototype), {
    sk, view: { ...view }, selection: new Set([balloon.id]), editing: null, tool: "select",
    render: vi.fn(), touch: vi.fn(), screenPos: (e: { pos: V }) => e.pos,
    svg: { setPointerCapture: vi.fn(), hasPointerCapture: () => false },
    commit: vi.fn(() => history.commit(sk)),
  }) as any;
  const start = () => app.onPointerDown({ pos: toScreen(view, [1, 1]), pointerId: 1, button: 0 });
  const move = (pos: V, altKey = false, ctrlKey = false) => app.onPointerMove({ pos: toScreen(view, pos), altKey, ctrlKey });
  return { sk, a, b, balloon, history, app, start, move };
}

describe("sketch balloon leader tip", () => {
  it("grabs the selected tip before the underlying joint and reattaches without moving the bubble or geometry", () => {
    const { sk, b, balloon, app, start, move } = example();
    const geometry = structuredClone(sk.entities);
    expect(app.grips(app.mm())).toEqual([toScreen(view, [1, 1])]);
    start(); expect(app.drag.kind).toBe("balloon-tip");
    move([6.05, 4.05]);
    expect(balloon.at).toBe(b.id); expect(balloon.on).toBeUndefined();
    expect(balloonAnchor(sk, balloon)).toEqual([6, 4]);
    expect([balloon.x + balloon.dx, balloon.y + balloon.dy]).toEqual([3, 4]);
    expect(sk.entities).toEqual(geometry); expect(app.view).toEqual(view);
    expect(app.commit).not.toHaveBeenCalled();
  });

  it("can reattach to a line and a circle, then detach freely while preserving the bubble", () => {
    const { sk, balloon } = example();
    const line = addLine(sk, addPoint(sk, 0, 5).id, addPoint(sk, 8, 5).id);
    const circle = addCircle(sk, addPoint(sk, 10, 10).id, 2);
    moveBalloonTip(sk, balloon, { pos: [2, 5], curveId: line.id }, [3, 4]);
    expect(balloon.at).toBeUndefined(); expect(balloon.on).toBe(line.id); expect(balloon.t).toBe(0.25);
    expect(balloonAnchor(sk, balloon)).toEqual([2, 5]);
    moveBalloonTip(sk, balloon, { pos: [12, 10], curveId: circle.id }, [3, 4]);
    expect(balloon.on).toBe(circle.id); expect(balloon.t).toBeCloseTo(0);
    expect(balloonAnchor(sk, balloon)).toEqual([12, 10]);
    moveBalloonTip(sk, balloon, { pos: [2, 2] }, [3, 4]);
    expect(balloon).toMatchObject({ x: 2, y: 2, dx: 1, dy: 2 });
    expect(balloon.at).toBeUndefined(); expect(balloon.on).toBeUndefined(); expect(balloon.t).toBeUndefined();
  });

  it("snaps to the grid and supports Alt and Ctrl axis locking", () => {
    const { sk, balloon, start, move } = example(); sk.snapToGrid = true;
    start(); move([3.3, 2.7]); expect(balloonAnchor(sk, balloon)).toEqual([3, 3]);
    move([6.05, 4.05], true);
    expect(balloon.at).toBeUndefined();
    expect(balloon.x).toBeCloseTo(6.05); expect(balloon.y).toBeCloseTo(4.05);
    move([4.3, 1.3], false, true);
    expect(balloonAnchor(sk, balloon)).toEqual([4, 1]);
    move([3.2, 6.8], true, true);
    expect(balloon.x).toBeCloseTo(3.2); expect(balloon.y).toBe(1);
  });

  it("records one undo step and saves/exports the new attachment", () => {
    const { sk, balloon, app, history, start, move } = example();
    const oldSvg = toSvg(sk), oldTikz = toTikz(sk);
    start(); move([8, 7], true); move([9, 8], true);
    app.onPointerUp({ pointerId: 1, type: "pointerup" });
    expect(app.commit).toHaveBeenCalledTimes(1);
    expect((history.undo()!.symbols[0] as Balloon).at).toBeDefined();
    expect((history.redo()!.symbols[0] as Balloon).x).toBe(9);
    const saved = deserialize(serialize(sk));
    expect(saved.symbols[0]).toEqual(balloon);
    expect(toSvg(saved)).not.toBe(oldSvg); expect(toTikz(saved)).not.toBe(oldTikz);
  });

  it("does not commit a tip click or cover the bubble with a handle when there is no leader", () => {
    const { sk, balloon, app, start } = example(); start();
    app.onPointerUp({ pointerId: 1, type: "pointerup" });
    expect(app.commit).not.toHaveBeenCalled();
    balloon.dx = 0; balloon.dy = 0;
    expect(balloonTipGrip(sk, balloon, view.scale)).toBeNull();
    expect(app.grips(app.mm())).toEqual([]);
  });
});

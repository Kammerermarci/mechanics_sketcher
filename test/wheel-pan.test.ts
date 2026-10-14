import { afterEach, describe, it, expect, vi } from "vitest";
import { wheelPanDelta } from "../src/wheel-pan";
import { App } from "../src/app";
import { PlotWorkspace } from "../src/plotwork";
import { emptySketch, addPoint } from "../src/model";
import { toModel } from "../src/render";

afterEach(() => vi.unstubAllGlobals());
const wheel = (more = {}) => ({ deltaX: 24, deltaY: 16, deltaMode: 0, ctrlKey: false, shiftKey: false, preventDefault: vi.fn(), ...more }) as unknown as WheelEvent;

describe("Shift and two-finger panning", () => {
  it.each([false, true])("pans both sketch axes simultaneously without zooming or changing geometry (preview=%s)", (preview) => {
    const sk = emptySketch(); addPoint(sk, 5, 6);
    const saved = structuredClone(sk);
    const app = Object.assign(Object.create(App.prototype), {
      sk, preview, spaceKey: true, view: { cx: 3, cy: 4, scale: 8, w: 800, h: 600 }, render: vi.fn(),
    }) as any;
    const event = wheel({ shiftKey: true });
    app.onWheel(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(app.view).toEqual({ cx: 6, cy: 2, scale: 8, w: 800, h: 600 });
    expect(sk).toEqual(saved);
    app.spaceKey = false;
    app.screenPos = () => [400, 300];
    app.onWheel(wheel({ deltaY: 100 }));
    expect(app.view.scale).toBeLessThan(8);
  });

  it.each([false, true])("keeps mouse-wheel zoom anchored at the pointer without Shift, even with Space held (Ctrl=%s)", (ctrlKey) => {
    const app = Object.assign(Object.create(App.prototype), {
      spaceKey: true, view: { cx: 3, cy: 4, scale: 8, w: 800, h: 600 },
      screenPos: () => [123, 234], render: vi.fn(),
    }) as any;
    const before = toModel(app.view, [123, 234]);
    app.onWheel(wheel({ ctrlKey, deltaX: 0, deltaY: 120 }));
    expect(app.view.scale).toBeLessThan(8);
    const after = toModel(app.view, [123, 234]);
    expect(after[0]).toBeCloseTo(before[0]); expect(after[1]).toBeCloseTo(before[1]);
  });

  it("normalizes diagonal pixel, line and page scrolling without locking either axis", () => {
    expect(wheelPanDelta(wheel({ shiftKey: true }), [800, 600])).toEqual([24, 16]);
    expect(wheelPanDelta(wheel({ shiftKey: true, deltaMode: 1, deltaX: 2, deltaY: -3 }), [800, 600])).toEqual([64, -96]);
    expect(wheelPanDelta(wheel({ shiftKey: true, deltaMode: 2, deltaX: 1, deltaY: -1 }), [800, 600])).toEqual([800, -600]);
    expect(wheelPanDelta(wheel({ ctrlKey: true }), [800, 600])).toBeNull();
  });

  it("pans the plot's graph with separate scales, keeping its ranges and zoom fixed", () => {
    const plot = { x: { min: -1, max: 5 }, y: { min: -2, max: 6 } };
    const workspace = Object.assign(Object.create(PlotWorkspace.prototype), {
      host: { render: vi.fn(), commit: vi.fn() }, plot: () => plot,
      paneAt: () => "graph", screenPos: () => [100, 100],
      G: { x: 0, y: 0, w: 600, h: 400 }, gv: { cx: 1, cy: 2, sx: 4, sy: 8 },
    }) as any;
    const before = structuredClone(plot);
    workspace.onWheel(wheel({ shiftKey: true }));
    expect(workspace.gv).toEqual({ cx: 7, cy: 0, sx: 4, sy: 8 });
    expect(plot).toEqual(before);
    expect(workspace.host.commit).not.toHaveBeenCalled();
    workspace.paneAt = () => "print";
    workspace.onWheel(wheel({ shiftKey: true }));
    expect(workspace.gv).toEqual({ cx: 7, cy: 0, sx: 4, sy: 8 });
  });

  it.each(["sketch", "plot"])("enables Space navigation in %s without intercepting typed spaces", (tab) => {
    vi.stubGlobal("document", { querySelector: () => null });
    const app = Object.assign(Object.create(App.prototype), { tab, spaceKey: false, render: vi.fn() }) as any;
    const key = (tagName: string) => ({ key: " ", code: "Space", target: { tagName, type: "text" }, preventDefault: vi.fn() });
    app.onKeyDown(key("INPUT"));
    expect(app.spaceKey).toBe(false);
    app.onKeyDown(key("BUTTON"));
    expect(app.spaceKey).toBe(false);
    const event = key("BODY");
    app.onKeyDown(event);
    expect(app.spaceKey).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
  });
});

// The Plot workspace: a canvas of its own beside the sketcher, where functions
// are plotted. It draws one plot of the sketch's plots at a time, with handles
// to drag its size on paper, and a side panel for its functions and axes.

import { type Sketch, type Plot, type PlotCurve, type PlotAxis, type PlotDash, type Id } from "./model";
import { type V, dist } from "./geom";
import { type Prim, primDistance } from "./prims";
import { type View, toScreen, toModel, drawPrims } from "./render";
import { figureBounds } from "./export";
import {
  PLOT, PLOT_COLORS, plotPrims, plotSvg, plotTikz, newPlot, newCurve, copyPlot, fitY, pieceError, toData, toPaper, curveLabelAt, stretches, tickStep,
} from "./plot";
import { icon } from "./icons";

/** What the workspace needs from the app around it. */
export interface PlotHost {
  sketch(): Sketch;
  /** Records the sketch as an undo step, saves it and redraws everything. */
  commit(): void;
  /** Redraws the canvas. */
  render(): void;
  /** Redraws the canvas and the panels. */
  touch(): void;
  toast(message: string): void;
}

/** A handle on the axis box: which of its sides it moves. */
interface Handle { x: -1 | 0 | 1; y: -1 | 0 | 1 }
const HANDLES: Handle[] = [
  { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 }, { x: -1, y: 0 }, { x: 1, y: 0 }, { x: -1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 1 },
];

type Hit =
  | { kind: "handle"; h: Handle }
  | { kind: "name"; id: Id }
  | { kind: "curve"; id: Id }
  | { kind: "axis-label"; axis: "x" | "y" }
  | { kind: "inside" }
  | { kind: "none" };

type Drag =
  | { kind: "view"; last: V }
  /** `start` is where the press was, on screen; the rest is how things stood then. */
  | { kind: "size"; h: Handle; start: V; width: number; height: number; cx: number; cy: number; moved: boolean }
  /** A handle pulling the ends of the axes on its side out or in. `gx` and `gy` are the steps the ends move in. */
  | { kind: "ends"; h: Handle; start: V; x: [number, number]; y: [number, number]; gx: number; gy: number; moved: boolean }
  /** Moving what the plot shows. `click` is what a press that does not move selects. */
  | { kind: "range"; start: V; x: [number, number]; y: [number, number]; moved: boolean; click: Id | null }
  | { kind: "name"; id: Id; offset: V; moved: boolean }
  | { kind: "press"; start: V; field: string | null; moved: boolean };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n2 = (v: number) => v.toFixed(2);
/** A number as it is shown in a field: no more digits than mean something. */
const shown = (v: number) => String(Number(v.toPrecision(7)));
/** A number typed with a decimal point or a decimal comma; NaN for anything else. */
function typed(text: string): number {
  const t = text.trim().replace(",", ".");
  return t === "" ? NaN : Number(t);
}
/** A value moved onto a grid a hundred times finer than the size of `span`, so ranges keep short numbers. */
function tidy(v: number, span: number): number {
  const g = 10 ** Math.floor(Math.log10(span)) / 100;
  return Number((Math.round(v / g) * g).toPrecision(12));
}

const WEIGHT_MIN = 0.1, WEIGHT_MAX = 3;
const VIEW_MIN = 0.8, VIEW_MAX = 60;

export class PlotWorkspace {
  /** The plot on show, and the function selected in it. */
  private current: Id | null = null;
  private selected: Id | null = null;
  private hover: Hit = { kind: "none" };
  /** Paper mm at the centre of the canvas, and screen pixels per mm. */
  private view: View = { cx: 0, cy: 0, scale: 6, w: 800, h: 600 };
  private fitted: Id | null = null;
  private drag: Drag | null = null;
  private prims: Prim[] = [];
  private cursor: V = [0, 0];
  private wheelTimer = 0;
  /** A field to put the cursor in once the panel has been drawn: its name, a bar, and the number of its piece if it has one. */
  private focusNext: string | null = null;

  constructor(private host: PlotHost, private svg: SVGSVGElement, private panel: HTMLElement, private empty: HTMLElement) {
    svg.addEventListener("pointerdown", (e) => this.onDown(e));
    svg.addEventListener("pointermove", (e) => this.onMove(e));
    svg.addEventListener("pointerup", (e) => this.onUp(e));
    svg.addEventListener("pointercancel", (e) => this.onUp(e));
    svg.addEventListener("pointerleave", () => { if (!this.drag) { this.hover = { kind: "none" }; this.host.render(); } });
    svg.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    svg.addEventListener("contextmenu", (e) => e.preventDefault());
    svg.addEventListener("mousedown", (e) => { if (e.button === 1) e.preventDefault(); });
    svg.addEventListener("auxclick", (e) => e.preventDefault());
  }

  // ---- what is on show ------------------------------------------------------------

  private plots(): Plot[] {
    return this.host.sketch().plots ?? [];
  }

  /** The plot on show: the one chosen, or the first there is. */
  plot(): Plot | null {
    const plots = this.plots();
    const p = plots.find((x) => x.id === this.current) ?? plots[0] ?? null;
    this.current = p?.id ?? null;
    return p;
  }

  private curve(): PlotCurve | null {
    return this.plot()?.curves.find((c) => c.id === this.selected) ?? null;
  }

  /** After the sketch was swapped for another (undo, a file opened): what was on show may be gone. */
  sync(): void {
    const p = this.plot();
    if (!p?.curves.some((c) => c.id === this.selected)) this.selected = p?.curves[0]?.id ?? null;
    this.drag = null;
    this.hover = { kind: "none" };
  }

  /** Puts a plot on show, for when the workspace is next on screen. */
  show(id: Id): void {
    this.current = id;
  }

  /** The workspace comes on screen. */
  enter(): void {
    this.sync();
    const p = this.plot();
    if (p && this.fitted !== p.id) this.fit();
  }

  resize(w: number, h: number): void {
    this.view.w = w;
    this.view.h = h;
    this.svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  }

  /** Zooms the view so the whole plot, labels and all, is on screen. */
  fit(): void {
    const p = this.plot();
    if (!p) return;
    const b = figureBounds(plotPrims(p));
    const x0 = Math.min(b.x0, 0), x1 = Math.max(b.x1, p.width), y0 = Math.min(b.y0, 0), y1 = Math.max(b.y1, p.height);
    const pad = 48;
    const scale = Math.min((this.view.w - 2 * pad) / (x1 - x0), (this.view.h - 2 * pad) / (y1 - y0));
    this.view.scale = Math.max(VIEW_MIN, Math.min(10, scale));
    this.view.cx = (x0 + x1) / 2;
    this.view.cy = (y0 + y1) / 2;
    this.fitted = p.id;
    this.host.render();
  }

  // ---- drawing ------------------------------------------------------------------------

  draw(): void {
    const p = this.plot();
    this.empty.hidden = !!p;
    if (!p) {
      this.svg.innerHTML = "";
      this.prims = [];
      return;
    }
    this.prims = plotPrims(p);
    const none = new Set<Id>();
    const S = (q: V) => toScreen(this.view, q);
    const lit = this.hover.kind === "curve" || this.hover.kind === "name" ? this.hover.id : null;
    let html = drawPrims({ view: this.view, mm: 1, prims: this.prims, selection: none, related: none, hover: lit, conflicting: none, redundant: none, freeIds: none });
    // The axis box and its handles: what is dragged to pull the ends of the axes out or in, or with Shift to set the size on paper.
    const a = S([0, 0]), b = S([p.width, p.height]);
    html += `<rect class="plot-box" x="${n2(a[0])}" y="${n2(b[1])}" width="${n2(b[0] - a[0])}" height="${n2(a[1] - b[1])}"/>`;
    for (const h of HANDLES) {
      const c = this.handleAt(p, h);
      const on = (this.hover.kind === "handle" && this.hover.h === h) || ((this.drag?.kind === "size" || this.drag?.kind === "ends") && this.drag.h === h);
      html += `<rect class="plot-handle${on ? " on" : ""}" x="${n2(c[0] - 4.5)}" y="${n2(c[1] - 4.5)}" width="9" height="9" rx="1.5"/>`;
    }
    if (this.drag?.kind === "size" || this.drag?.kind === "ends") {
      // What is being set, over the plot: its size on paper, or where the axes being pulled now end.
      const h = this.drag.h;
      const said = this.drag.kind === "size" ? `${shown(p.width / 10)} × ${shown(p.height / 10)} cm`
        : [h.x ? `x ${shown(p.x.min)} … ${shown(p.x.max)}` : "", h.y ? `y ${shown(p.y.min)} … ${shown(p.y.max)}` : ""].filter(Boolean).join("     ");
      const at = S([p.width / 2, p.height]);
      html += `<text class="plot-size" x="${n2(at[0])}" y="${n2(at[1] - 12)}" text-anchor="middle">${said}</text>`;
    }
    this.svg.innerHTML = html;
    const h = this.drag?.kind === "size" || this.drag?.kind === "ends" ? this.drag.h : this.hover.kind === "handle" ? this.hover.h : null;
    this.svg.dataset.over = h ? (h.x && h.y ? (h.x === h.y ? "nesw" : "nwse") : h.x ? "ew" : "ns")
      : this.drag?.kind === "view" || this.drag?.kind === "range" ? "grab"
        : this.hover.kind === "name" ? "move" : this.hover.kind === "curve" || this.hover.kind === "axis-label" ? "pointer" : "";
  }

  /** Where a handle is on screen. */
  private handleAt(p: Plot, h: Handle): V {
    return toScreen(this.view, [((h.x + 1) / 2) * p.width, ((h.y + 1) / 2) * p.height]);
  }

  /** What the status bar says about what the pointer is over. */
  hint(): string {
    if (!this.plot()) return "No plot yet. New plot makes one.";
    switch (this.drag?.kind ?? this.hover.kind) {
      case "handle": case "ends": return "Drag to pull the axis out on this side, or push it in: the plot shows more, or less. Hold Shift while dragging to change the size on paper instead.";
      case "size": return "Sets the size of the plot on paper, in whole millimetres. Hold Alt for any size.";
      case "name": return "Drag the name of the function to where it should stand.";
      case "curve": return "Click to select this function; its formula is in the side panel.";
      case "axis-label": return "Click to change the name of the axis.";
      case "inside": case "range": return "Drag to move what the plot shows; the wheel zooms it (Shift: sideways only, Alt: up and down only).";
      default: return "Drag a handle to pull an axis further out or in. Inside the plot, drag and wheel move and zoom what it shows; outside, they move and zoom the view.";
    }
  }

  /** The pointer's place in the plot's own coordinates, or the size of the plot when it is outside. */
  coords(): string {
    const p = this.plot();
    if (!p) return "";
    const q = toModel(this.view, this.cursor);
    if (q[0] < 0 || q[0] > p.width || q[1] < 0 || q[1] > p.height) return `${shown(p.width / 10)} × ${shown(p.height / 10)} cm`;
    const [x, y] = toData(p, q);
    const short = (v: number, a: PlotAxis) => String(Number(v.toFixed(Math.max(0, 2 - Math.floor(Math.log10(a.max - a.min))))));
    return `x ${short(x, p.x)}   y ${short(y, p.y)}`;
  }

  // ---- the pointer ----------------------------------------------------------------------

  private screenPos(ev: PointerEvent | WheelEvent): V {
    const r = this.svg.getBoundingClientRect();
    return [ev.clientX - r.left, ev.clientY - r.top];
  }

  private hit(sp: V): Hit {
    const p = this.plot();
    if (!p) return { kind: "none" };
    for (const h of HANDLES) if (dist(this.handleAt(p, h), sp) < 9) return { kind: "handle", h };
    const q = toModel(this.view, sp);
    const px = (prim: Prim) => primDistance(prim, q) * this.view.scale;
    for (const prim of this.prims) {
      if (prim.k !== "text" || px(prim) > 4) continue;
      if (prim.part === "label" && prim.ref) return { kind: "name", id: prim.ref };
      if (prim.part === "xlabel" || prim.part === "ylabel") return { kind: "axis-label", axis: prim.part === "xlabel" ? "x" : "y" };
    }
    // The nearest curve, the selected one first where two run together.
    let best: { id: Id; d: number } | null = null;
    for (const prim of this.prims) {
      if (prim.k !== "path" || !prim.ref) continue;
      const d = px(prim) - (prim.ref === this.selected ? 1.5 : 0);
      if (d < 6 && (!best || d < best.d)) best = { id: prim.ref, d };
    }
    if (best) return { kind: "curve", id: best.id };
    return q[0] >= 0 && q[0] <= p.width && q[1] >= 0 && q[1] <= p.height ? { kind: "inside" } : { kind: "none" };
  }

  private onDown(ev: PointerEvent): void {
    const p = this.plot();
    if (!p) return;
    (document.activeElement as HTMLElement | null)?.blur?.();
    const sp = this.screenPos(ev);
    this.cursor = sp;
    this.svg.setPointerCapture(ev.pointerId);
    if (ev.button !== 0) {
      this.drag = { kind: "view", last: sp };
      return this.host.render();
    }
    const hit = this.hit(sp);
    const q = toModel(this.view, sp);
    if (hit.kind === "handle" && ev.shiftKey) {
      this.drag = { kind: "size", h: hit.h, start: sp, width: p.width, height: p.height, cx: this.view.cx, cy: this.view.cy, moved: false };
    } else if (hit.kind === "handle") {
      // The ends move in tenths of the distance between ticks, so they land on round numbers.
      this.drag = { kind: "ends", h: hit.h, start: sp, x: [p.x.min, p.x.max], y: [p.y.min, p.y.max], gx: tickStep(p.x, p.width) / 10, gy: tickStep(p.y, p.height) / 10, moved: false };
    } else if (hit.kind === "name") {
      const c = p.curves.find((x) => x.id === hit.id);
      const at = c ? curveLabelAt(p, c) : null;
      if (!c || !at) return;
      this.select(c.id);
      const on = toPaper(p, at);
      this.drag = { kind: "name", id: c.id, offset: [on[0] - q[0], on[1] - q[1]], moved: false };
    } else if (hit.kind === "curve" || hit.kind === "inside") {
      this.drag = { kind: "range", start: sp, x: [p.x.min, p.x.max], y: [p.y.min, p.y.max], moved: false, click: hit.kind === "curve" ? hit.id : null };
    } else {
      this.drag = { kind: "press", start: sp, field: hit.kind === "axis-label" ? `${hit.axis}.label` : null, moved: false };
    }
    this.host.render();
  }

  private onMove(ev: PointerEvent): void {
    const sp = this.screenPos(ev);
    this.cursor = sp;
    const p = this.plot();
    const d = this.drag;
    if (!p) return;
    if (!d) {
      this.hover = this.hit(sp);
      return this.host.render();
    }
    const q = toModel(this.view, sp);
    if (d.kind === "view" || (d.kind === "press" && !d.field && (d.moved || dist(sp, d.start) > 3))) {
      // Outside the plot, a drag moves the view, as the middle button does anywhere.
      const last = d.kind === "view" ? d.last : d.start;
      this.view.cx -= (sp[0] - last[0]) / this.view.scale;
      this.view.cy += (sp[1] - last[1]) / this.view.scale;
      if (d.kind === "view") d.last = sp;
      else { d.start = sp; d.moved = true; }
    } else if (d.kind === "size") {
      const whole = (v: number) => Math.max(PLOT.minSize, Math.min(PLOT.maxSize, ev.altKey ? Number(v.toFixed(2)) : Math.round(v)));
      const dx = (sp[0] - d.start[0]) / this.view.scale, dy = (d.start[1] - sp[1]) / this.view.scale;
      // The side across from the handle stays where it is on screen: for the left and bottom handles the view moves along.
      if (d.h.x) {
        p.width = whole(d.width + d.h.x * dx);
        if (d.h.x < 0) this.view.cx = d.cx + (p.width - d.width);
      }
      if (d.h.y) {
        p.height = whole(d.height + d.h.y * dy);
        if (d.h.y < 0) this.view.cy = d.cy + (p.height - d.height);
      }
      d.moved = d.moved || p.width !== d.width || p.height !== d.height;
    } else if (d.kind === "ends") {
      // The plot keeps its size on paper: pulled outwards a handle takes the end of its axis along, at the
      // scale the plot had when it was grabbed, and what the plot shows closes up to make room.
      const pull = (from: [number, number], side: -1 | 0 | 1, px: number, length: number, g: number): [number, number] => {
        if (!side) return from;
        const moved = (px / this.view.scale / length) * (from[1] - from[0]);
        const land = (v: number) => (ev.altKey ? Number(v.toPrecision(6)) : Number((Math.round(v / g) * g).toPrecision(12)));
        // The two ends stay apart by a step at the least.
        const apart = (v: number) => Number(v.toPrecision(12));
        return side < 0 ? [Math.min(land(from[0] + moved), apart(from[1] - g)), from[1]] : [from[0], Math.max(land(from[1] + moved), apart(from[0] + g))];
      };
      [p.x.min, p.x.max] = pull(d.x, d.h.x, sp[0] - d.start[0], p.width, d.gx);
      [p.y.min, p.y.max] = pull(d.y, d.h.y, d.start[1] - sp[1], p.height, d.gy);
      d.moved = d.moved || p.x.min !== d.x[0] || p.x.max !== d.x[1] || p.y.min !== d.y[0] || p.y.max !== d.y[1];
    } else if (d.kind === "range") {
      if (!d.moved && dist(sp, d.start) < 4) return;
      d.moved = true;
      const dx = ((sp[0] - d.start[0]) / this.view.scale / p.width) * (d.x[1] - d.x[0]);
      const dy = ((d.start[1] - sp[1]) / this.view.scale / p.height) * (d.y[1] - d.y[0]);
      const sx = tidy(dx, d.x[1] - d.x[0]), sy = tidy(dy, d.y[1] - d.y[0]);
      p.x.min = Number((d.x[0] - sx).toPrecision(12));
      p.x.max = Number((d.x[1] - sx).toPrecision(12));
      p.y.min = Number((d.y[0] - sy).toPrecision(12));
      p.y.max = Number((d.y[1] - sy).toPrecision(12));
    } else if (d.kind === "name") {
      const c = p.curves.find((x) => x.id === d.id);
      if (!c) return;
      const [x, y] = toData(p, [q[0] + d.offset[0], q[1] + d.offset[1]]);
      c.lx = Number(x.toPrecision(6));
      c.ly = Number(y.toPrecision(6));
      d.moved = true;
    } else if (d.kind === "press" && dist(sp, d.start) > 3) {
      d.moved = true;
    }
    this.host.render();
  }

  private onUp(ev: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    if (this.svg.hasPointerCapture(ev.pointerId)) this.svg.releasePointerCapture(ev.pointerId);
    if (!d) return;
    this.hover = this.hit(this.screenPos(ev));
    if (d.kind === "view") return this.host.render();
    if (d.kind === "press") {
      if (d.moved) return this.host.render();
      // A click on the name of an axis goes to its field; a click on nothing lets go of the function.
      if (d.field) this.focusNext = `${d.field}|`;
      else this.selected = null;
      return this.host.touch();
    }
    if (d.kind === "range" && !d.moved) {
      this.selected = d.click;
      return this.host.touch();
    }
    if (d.moved) return this.host.commit();
    this.host.touch();
  }

  private onWheel(ev: WheelEvent): void {
    ev.preventDefault();
    const p = this.plot();
    if (!p) return;
    const sp = this.screenPos(ev);
    const q = toModel(this.view, sp);
    // With Shift held, some browsers report the turn of the wheel as sideways.
    const turn = (ev.deltaY || ev.deltaX) * (ev.deltaMode === 1 ? 32 : 1);
    if (q[0] < 0 || q[0] > p.width || q[1] < 0 || q[1] > p.height) {
      const scale = Math.max(VIEW_MIN, Math.min(VIEW_MAX, this.view.scale * Math.exp(-turn * 0.0016)));
      // The point under the pointer stays under it.
      this.view.cx = q[0] - (sp[0] - this.view.w / 2) / scale;
      this.view.cy = q[1] + (sp[1] - this.view.h / 2) / scale;
      this.view.scale = scale;
      return this.host.render();
    }
    const f = Math.exp(turn * 0.0016);
    const [x, y] = toData(p, q);
    const zoom = (a: PlotAxis, at: number) => {
      const span = (a.max - a.min) * f;
      if (!(span > 1e-9 && span < 1e12)) return;
      const min = tidy(at - (at - a.min) * f, span), max = tidy(at + (a.max - at) * f, span);
      if (max > min) { a.min = min; a.max = max; }
    };
    if (!ev.altKey) zoom(p.x, x);
    if (!ev.shiftKey) zoom(p.y, y);
    // One undo step for a run of the wheel, not one for every notch.
    clearTimeout(this.wheelTimer);
    this.wheelTimer = window.setTimeout(() => this.host.commit(), 350);
    this.host.touch();
  }

  /** A key pressed while no field has the keyboard. True when it was taken. */
  key(e: KeyboardEvent): boolean {
    if (e.key === "Escape") {
      this.selected = null;
      this.host.touch();
      return true;
    }
    if (e.key === "0" || e.key === "Home") {
      this.fit();
      return true;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && this.curve()) {
      this.act("del-curve", {});
      return true;
    }
    return false;
  }

  private select(id: Id | null): void {
    if (this.selected === id) return;
    this.selected = id;
    this.host.touch();
  }

  // ---- the ribbon and the side panel ------------------------------------------------

  ribbonHtml(): string {
    const p = this.plot();
    const off = p ? "" : " disabled";
    const tool = (act: string, name: string, label: string, title: string, extra = "") =>
      `<button type="button" class="tool" data-pact="${act}" aria-label="${title}" title="${title}"${extra}>${icon(name, 22)}<span>${label}</span></button>`;
    return tool("new-plot", "plotnew", "New plot", "Start a new plot") +
      tool("add-curve", "curve", "Function", "Add a function to this plot", off) +
      `<span class="ribbon-rule"></span>` +
      tool("fit-y", "fity", "Fit range", "Set the vertical range so all of every function shows", off) +
      tool("fit-view", "fit", "Zoom to fit", "Bring the whole plot into view (0)", off) +
      `<span class="ribbon-rule"></span>` +
      tool("copy-plot", "copy", "Duplicate", "Make a copy of this plot", off) +
      tool("del-plot", "trash", "Delete", "Delete this plot", off);
  }

  drawPanel(): void {
    const active = document.activeElement as HTMLInputElement | null;
    const key = (el: HTMLElement | null) => (el?.dataset?.pf ? `${el.dataset.pf}|${el.dataset.i ?? ""}` : null);
    const had = this.panel.contains(active) ? key(active) : null;
    const caret = had && active && active.type === "text" ? [active.selectionStart, active.selectionEnd] : null;
    this.panel.innerHTML = this.panelHtml();
    const want = this.focusNext ?? had;
    this.focusNext = null;
    if (!want) return;
    const el = [...this.panel.querySelectorAll<HTMLInputElement>("[data-pf]")].find((x) => key(x) === want);
    if (!el) return;
    el.focus();
    if (want !== had) el.select?.();
    else if (caret && caret[0] !== null) el.setSelectionRange(caret[0], caret[1]);
  }

  private panelHtml(): string {
    const p = this.plot();
    if (!p) {
      return `<h2>Plot</h2><p class="muted">A plot draws functions over a pair of axes: an internal force diagram, a path over time. It is a figure of its own, exported on its own.</p>` +
        `<button type="button" class="plain" data-pact="new-plot">New plot</button>`;
    }
    const text = (label: string, pf: string, value: string, note = "", placeholder = "") =>
      `<label class="field"><span>${label}</span><input data-pf="${pf}" type="text" spellcheck="false" autocomplete="off" value="${esc(value)}"${placeholder ? ` placeholder="${esc(placeholder)}"` : ""}>${note ? `<small>${note}</small>` : ""}</label>`;
    const choice = (label: string, act: string, options: [string, string, boolean][]) =>
      `<div class="field"><span id="pl-${act}">${label}</span><div class="segmented" role="group" aria-labelledby="pl-${act}">${options.map(([v, name, on]) =>
        `<button type="button" data-pact="${act}" data-v="${v}" aria-pressed="${on}">${name}</button>`).join("")}</div></div>`;
    const pair = (label: string, a: string, b: string, va: string, vb: string, mid = "to") =>
      `<div class="field"><span>${label}</span><span class="pair"><input data-pf="${a}" type="text" inputmode="decimal" autocomplete="off" value="${esc(va)}" aria-label="${label}: from">` +
      `<span>${mid}</span><input data-pf="${b}" type="text" inputmode="decimal" autocomplete="off" value="${esc(vb)}" aria-label="${label}: to"></span></div>`;

    let html = `<h2>Plot</h2>`;
    const plots = this.plots();
    if (plots.length > 1) {
      html += `<label class="field"><span>Shown</span><select data-pf="current">${plots.map((x) =>
        `<option value="${x.id}"${x.id === p.id ? " selected" : ""}>${esc(x.name || "Plot")}</option>`).join("")}</select></label>`;
    }
    html += text("Name", "name", p.name, "For telling plots apart here; it is not part of the figure.");

    html += `<h3>Functions</h3>`;
    p.curves.forEach((c, i) => {
      const open = c.id === this.selected;
      const first = c.pieces.find((x) => x.expr.trim())?.expr.trim();
      const title = first ? `${first}${c.pieces.length > 1 ? " …" : ""}` : `Function ${i + 1}`;
      html += `<section class="fn${open ? " open" : ""}">` +
        `<button type="button" class="fn-head" data-pact="select-curve" data-id="${c.id}" aria-expanded="${open}"><span class="fn-dot" style="background:${esc(c.color)}"></span><span class="fn-title">${esc(title)}</span></button>`;
      if (open) html += this.curveHtml(p, c);
      html += `</section>`;
    });
    html += `<button type="button" class="plain" data-pact="add-curve">Add a function</button>`;

    html += `<h3>Axes</h3>`;
    html += text("Name of the horizontal axis", "x.label", p.x.label, "", "x");
    html += pair("It runs from", "x.min", "x.max", shown(p.x.min), shown(p.x.max)) +
      `<small class="under">Dragging a handle on the plot pulls the axis out or in on that side.</small>`;
    html += text("Name of the vertical axis", "y.label", p.y.label, "Names are written as TeX math, such as M_h or v\\,[\\mathrm{m/s}]. Leave one empty for none.", "y");
    html += pair("It runs from", "y.min", "y.max", shown(p.y.min), shown(p.y.max));
    html += `<button type="button" class="plain" data-pact="fit-y">Fit it to the functions</button>`;
    html += choice("Drawn as", "frame", [["cross", "Arrows", p.frame !== "box"], ["box", "Box", p.frame === "box"]]);
    html += choice("Ticks", "ticks", [["numbers", "Numbers", p.ticks === undefined], ["marks", "Marks", p.ticks === "marks"], ["none", "None", p.ticks === "none"]]);
    html += pair("A tick every", "x.step", "y.step", p.x.step === undefined ? "" : shown(p.x.step), p.y.step === undefined ? "" : shown(p.y.step), "across,") +
      `<small class="under">up. Leave empty for a spacing that suits the size of the plot.</small>`;
    html += choice("Grid", "grid", [["none", "None", p.grid === undefined], ["lines", "Lines", p.grid === "lines"], ["dots", "Dots", p.grid === "dots"]]);

    html += `<h3>Size on paper</h3>`;
    html += pair("Width and height (cm)", "width", "height", shown(p.width / 10), shown(p.height / 10), "×") +
      `<small class="under">Of the axes, without their labels. Dragging a handle on the plot with Shift held sets it too. Text is 10 pt at any size.</small>`;
    html += `<button type="button" class="danger" data-pact="del-plot">Delete this plot</button>`;
    return html;
  }

  private curveHtml(p: Plot, c: PlotCurve): string {
    let html = "";
    c.pieces.forEach((piece, i) => {
      const err = pieceError(piece);
      const range = c.pieces.length > 1 || piece.from !== undefined || piece.to !== undefined;
      html += `<div class="piece">` +
        `<input data-pf="expr" data-i="${i}" type="text" spellcheck="false" autocomplete="off" autocapitalize="off" class="${err ? "bad" : ""}" value="${esc(piece.expr)}" placeholder="2x + 1, sin(x), -5x^2/2" aria-label="Formula${c.pieces.length > 1 ? ` of piece ${i + 1}` : ""}">` +
        (range ? `<span class="pair small"><span>from</span><input data-pf="from" data-i="${i}" type="text" inputmode="decimal" autocomplete="off" value="${piece.from === undefined ? "" : shown(piece.from)}" placeholder="${shown(p.x.min)}" aria-label="Piece ${i + 1} starts at">` +
          `<span>to</span><input data-pf="to" data-i="${i}" type="text" inputmode="decimal" autocomplete="off" value="${piece.to === undefined ? "" : shown(piece.to)}" placeholder="${shown(p.x.max)}" aria-label="Piece ${i + 1} ends at">` +
          (c.pieces.length > 1 ? `<button type="button" class="icon-btn" data-pact="del-piece" data-i="${i}" aria-label="Remove piece ${i + 1}" title="Remove this piece">${icon("close", 16)}</button>` : "") + `</span>` : "") +
        `<small class="piece-msg${err ? " bad" : ""}">${esc(err ?? "")}</small></div>`;
    });
    html += `<button type="button" class="plain" data-pact="add-piece">${c.pieces.length > 1 ? "Add a piece" : "Split into pieces"}</button>`;
    html += `<p class="muted note-block">The variable is x (or t). Use + - * / ^ and brackets; sin, cos, tan, exp, ln, lg, sqrt, abs and pi are known. A function in pieces has one formula for each stretch of the axis, as an internal force diagram does.</p>`;
    html += `<label class="field"><span>Name</span><input data-pf="label" type="text" spellcheck="false" autocomplete="off" value="${esc(c.label ?? "")}" placeholder="M(x), v_1">` +
      `<small>Written as TeX math and set beside the curve; drag it on the plot to move it.${c.lx !== undefined ? ` <button type="button" class="linkish" data-pact="name-back">Put it back beside the curve</button>` : ""}</small></label>`;
    html += `<div class="field"><span id="pl-colour">Colour</span><div class="swatches" role="group" aria-labelledby="pl-colour">${PLOT_COLORS.map((col) =>
      `<button type="button" class="swatch" data-pact="color" data-v="${col}" aria-pressed="${c.color === col}" aria-label="Colour ${col}" title="${col}" style="background:${col}"></button>`).join("")}` +
      `<label class="swatch custom" title="Another colour"><input data-pf="color" type="color" value="${esc(c.color)}" aria-label="Another colour"></label></div></div>`;
    const weight = c.weight ?? PLOT.weight;
    html += `<label class="field"><span>Line thickness</span><span class="slider-row"><input data-pf="weight" type="range" min="${WEIGHT_MIN}" max="${WEIGHT_MAX}" step="0.1" value="${weight}"><output>${shown(weight)} pt</output></span></label>`;
    html += `<div class="field"><span id="pl-dash">Line</span><div class="segmented" role="group" aria-labelledby="pl-dash">${([["solid", "Solid"], ["dashed", "Dashed"], ["dotted", "Dotted"]] as const).map(([v, name]) =>
      `<button type="button" data-pact="dash" data-v="${v}" aria-pressed="${(c.dash ?? "solid") === v}">${name}</button>`).join("")}</div></div>`;
    html += `<label class="check"><input data-pf="fill" type="checkbox"${c.fill ? " checked" : ""}><span>Shade down to the axis</span></label>`;
    if (c.pieces.length > 1) html += `<label class="check"><input data-pf="join" type="checkbox"${c.join !== false ? " checked" : ""}><span>Draw the jumps between pieces</span></label>`;
    html += `<button type="button" class="danger" data-pact="del-curve">Delete this function</button>`;
    return html;
  }

  // ---- buttons ------------------------------------------------------------------------------

  /** A button of the ribbon or the panel was pressed. */
  act(act: string, ds: DOMStringMap): void {
    const sk = this.host.sketch();
    if (act === "new-plot") {
      const p = newPlot(sk);
      this.current = p.id;
      this.selected = p.curves[0].id;
      this.focusNext = "expr|0";
      this.host.commit();
      return this.fit();
    }
    const p = this.plot();
    if (!p) return;
    const c = this.curve();
    switch (act) {
      case "select-curve":
        this.selected = this.selected === ds.id ? null : ds.id ?? null;
        return this.host.touch();
      case "add-curve":
        this.selected = newCurve(sk, p).id;
        this.focusNext = "expr|0";
        return this.host.commit();
      case "del-curve":
        if (!c) return;
        p.curves = p.curves.filter((x) => x !== c);
        this.selected = null;
        return this.host.commit();
      case "add-piece": {
        if (!c) return;
        // The new piece takes over where the last one ends; a piece with no end is cut in the middle of what it covers.
        const last = c.pieces[c.pieces.length - 1];
        const from = Math.max(last.from ?? p.x.min, p.x.min);
        if (last.to === undefined || last.to >= p.x.max) last.to = tidy((from + p.x.max) / 2, p.x.max - p.x.min);
        if (last.from === undefined) last.from = p.x.min;
        c.pieces.push({ expr: "", from: last.to, ...(p.x.max > last.to ? { to: p.x.max } : {}) });
        this.focusNext = `expr|${c.pieces.length - 1}`;
        return this.host.commit();
      }
      case "del-piece": {
        const i = Number(ds.i);
        if (!c || c.pieces.length < 2 || !c.pieces[i]) return;
        c.pieces.splice(i, 1);
        return this.host.commit();
      }
      case "name-back":
        if (!c) return;
        delete c.lx;
        delete c.ly;
        return this.host.commit();
      case "color":
        if (!c || !ds.v) return;
        c.color = ds.v;
        return this.host.commit();
      case "dash":
        if (!c) return;
        if (ds.v === "solid") delete c.dash;
        else c.dash = ds.v as PlotDash;
        return this.host.commit();
      case "frame":
        if (ds.v === "box") p.frame = "box";
        else delete p.frame;
        this.host.commit();
        return this.fit();
      case "ticks":
        if (ds.v === "numbers") delete p.ticks;
        else p.ticks = ds.v as "marks" | "none";
        return this.host.commit();
      case "grid":
        if (ds.v === "none") delete p.grid;
        else p.grid = ds.v as "lines" | "dots";
        return this.host.commit();
      case "fit-y": {
        const range = fitY(p);
        if (!range) return this.host.toast(p.curves.some((x) => stretches(p, x).length) ? "These functions have no values to fit the range to." : "There is no function to fit the range to yet.");
        [p.y.min, p.y.max] = range;
        return this.host.commit();
      }
      case "fit-view": return this.fit();
      case "copy-plot": {
        const copy = copyPlot(sk, p);
        this.current = copy.id;
        this.selected = copy.curves[0]?.id ?? null;
        this.host.commit();
        return this.fit();
      }
      case "del-plot":
        sk.plots = this.plots().filter((x) => x !== p);
        if (!sk.plots.length) delete sk.plots;
        // The diagrams that laid it along a member have nothing to draw any more.
        sk.symbols = sk.symbols.filter((x) => x.type !== "diagram" || x.plot !== p.id);
        this.current = null;
        this.sync();
        this.host.commit();
        return this.fit();
    }
  }

  // ---- fields -----------------------------------------------------------------------------

  /**
   * A field of the panel changed. `live` is a change still under way (typing,
   * a slider on the move): it shows at once, and is recorded when it is done.
   */
  change(input: HTMLInputElement | HTMLSelectElement, live = false): void {
    const pf = input.dataset.pf;
    const p = this.plot();
    if (!pf || !p) return;
    const done = () => (live ? this.host.render() : this.host.commit());
    /** Puts back what the field held and says why. */
    const refuse = (why: string) => { if (!live) { this.host.toast(why); this.host.touch(); } };
    const label = input.value.trim().replace(/^\$+|\$+$/g, "");
    const v = typed(input.value);

    if (pf === "current") {
      this.current = input.value;
      this.sync();
      this.host.touch();
      return this.fit();
    }
    if (pf === "name") { p.name = input.value.trim() || "Plot"; return done(); }
    if (pf === "x.label") { p.x.label = label; return done(); }
    if (pf === "y.label") { p.y.label = label; return done(); }
    const m = /^([xy])\.(min|max|step)$/.exec(pf);
    if (m) {
      if (live) return;
      const a = p[m[1] as "x" | "y"];
      if (m[2] === "step") {
        if (!input.value.trim()) delete a.step;
        else if (!(v > 0)) return refuse("The distance between ticks is a number above zero. Leave it empty for a suitable one.");
        else if ((a.max - a.min) / v > 80) return refuse("That is too many ticks to draw. Choose a larger distance between them.");
        else a.step = v;
        return done();
      }
      const [min, max] = m[2] === "min" ? [v, a.max] : [a.min, v];
      if (!Number.isFinite(v)) return refuse("The ends of an axis are numbers.");
      if (!(max > min)) return refuse("An axis runs from a smaller number to a larger one.");
      a.min = min;
      a.max = max;
      return done();
    }
    if (pf === "width" || pf === "height") {
      if (live) return;
      const mm = v * 10;
      if (!(mm >= PLOT.minSize && mm <= PLOT.maxSize)) return refuse(`A plot is between ${PLOT.minSize / 10} and ${PLOT.maxSize / 10} cm wide and high.`);
      p[pf] = Number(mm.toFixed(2));
      this.host.commit();
      return this.fit();
    }

    const c = this.curve();
    if (!c) return;
    const piece = c.pieces[Number(input.dataset.i)];
    if (pf === "expr" && piece) {
      piece.expr = input.value;
      // While it is typed, what is wrong with it shows under the field, which is left alone.
      const err = pieceError(piece);
      input.classList.toggle("bad", !!err);
      const msg = input.parentElement?.querySelector(".piece-msg");
      if (msg) { msg.textContent = err ?? ""; msg.classList.toggle("bad", !!err); }
      return done();
    }
    if ((pf === "from" || pf === "to") && piece) {
      if (live) return;
      if (!input.value.trim()) delete piece[pf];
      else if (!Number.isFinite(v)) return refuse("Where a piece starts and ends are numbers. Leave one empty for the end of the axis.");
      else piece[pf] = v;
      return done();
    }
    if (pf === "label") {
      if (label) c.label = label;
      else delete c.label;
      return done();
    }
    if (pf === "color") { c.color = input.value; return done(); }
    if (pf === "weight") {
      const w = Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, Number(input.value)));
      if (!Number.isFinite(w)) return;
      if (Math.abs(w - PLOT.weight) < 1e-9) delete c.weight;
      else c.weight = Number(w.toFixed(2));
      const out = input.parentElement?.querySelector("output");
      if (out) out.textContent = `${shown(w)} pt`;
      return done();
    }
    if (pf === "fill" && input instanceof HTMLInputElement) {
      if (input.checked) c.fill = true;
      else delete c.fill;
      return done();
    }
    if (pf === "join" && input instanceof HTMLInputElement) {
      if (input.checked) delete c.join;
      else c.join = false;
      return done();
    }
  }

  // ---- export ---------------------------------------------------------------------------------

  /** The plot on show as a file of the given kind, or null when there is none. */
  exported(how: "svg" | "tikz"): string | null {
    const p = this.plot();
    if (!p) return null;
    return how === "svg" ? plotSvg(p) : plotTikz(p);
  }

  /** A name to offer for the exported file. */
  fileName(): string {
    return (this.plot()?.name ?? "plot").trim().toLowerCase().replace(/[\\/:*?"<>|\s]+/g, "-") || "plot";
  }
}

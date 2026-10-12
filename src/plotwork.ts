// The Plot workspace: a canvas of its own beside the sketcher, where functions
// are plotted. It is split in two. On the graph, the functions run over as
// much of the plane as is in view, which is moved and zoomed freely; a dashed
// frame on it is the range that is exported, and it is dragged to set it. The
// print beside it is the plot as it comes out on paper: its size is set there,
// and notes, balloons and the names of the functions are put on it. A side
// panel holds the functions and the axes.

import { type Sketch, type Plot, type PlotCurve, type PlotDash, type PlotNote, type PlotBalloon, type LeaderEnd, type BalloonFrame, type Id, newId } from "./model";
import { type V, dist, distToSegment } from "./geom";
import { type Prim, PAPER, primDistance } from "./prims";
import { type View, toScreen, toModel, drawPrims } from "./render";
import { figureBounds } from "./export";
import {
  PLOT, PLOT_COLORS, PARAM_RANGE, plotPrims, plotSvg, plotTikz, newPlot, newCurve, copyPlot, fitX, fitY, equalScales, pieceError, formulaError, readFormula,
  toData, toPaper, curveLabelAt, curveRuns, drawable, tickStep, tickText, balloonPlace, nextBalloonText,
} from "./plot";
import { evaluate, degree } from "./expr";
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

/** The two halves of the canvas. */
type Pane = "graph" | "print";

/** A part of the canvas, in screen pixels from its top left corner. */
interface Rect { x: number; y: number; w: number; h: number }

/** What the graph shows: the point of the plane at its middle, and screen pixels for one unit along either axis. */
interface GraphView { cx: number; cy: number; sx: number; sy: number }

/** A handle on a frame: which of its sides it moves. */
interface Handle { x: -1 | 0 | 1; y: -1 | 0 | 1 }
const HANDLES: Handle[] = [
  { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 }, { x: -1, y: 0 }, { x: 1, y: 0 }, { x: -1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 1 },
];

type Hit =
  /** On the graph: a handle of the frame round the exported range, the frame itself, a curve, or anywhere else. */
  | { kind: "frame"; h: Handle }
  | { kind: "frame-edge" }
  | { kind: "graph-curve"; id: Id }
  | { kind: "graph" }
  /** On the print: a handle that sets the size on paper, and what is drawn there. */
  | { kind: "size"; h: Handle }
  | { kind: "name"; id: Id }
  | { kind: "curve"; id: Id }
  | { kind: "axis-label"; axis: "x" | "y" }
  /** A note, or a balloon: by its body, or by the tip of its leader. */
  | { kind: "note"; id: Id }
  | { kind: "balloon"; id: Id; tip: boolean }
  | { kind: "none" };

type Drag =
  /** Moving the graph. A press with the left button that does not move selects what it was on: `click`, or nothing. */
  | { kind: "pan"; last: V; start: V; moved: boolean; select: boolean; click: Id | null }
  /** A handle of the frame pulling the ends of the range on its side. `gx` and `gy` are the steps the ends land on. */
  | { kind: "frame"; h: Handle; x: [number, number]; y: [number, number]; gx: number; gy: number; moved: boolean }
  /** The whole frame moved: `start` is where it was grabbed, in the plot's own coordinates. */
  | { kind: "shift"; start: V; x: [number, number]; y: [number, number]; gx: number; gy: number; moved: boolean }
  /** The size on paper. The print keeps its scale while it is dragged; `cx` and `cy` are where its view was. */
  | { kind: "size"; h: Handle; start: V; width: number; height: number; cx: number; cy: number; moved: boolean }
  | { kind: "name"; id: Id; offset: V; moved: boolean }
  /** Moving a note or a balloon, or the tip of a balloon's leader; `offset` is from the pointer to what moves, `centre` where the balloon was. */
  | { kind: "mark"; id: Id; tip: boolean; offset: V; centre: V; moved: boolean }
  /** A press on the print: on a curve it selects it, on the name of an axis it goes to its field, on nothing it lets go. */
  | { kind: "press"; start: V; field: string | null; click: Id | null; moved: boolean };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n2 = (v: number) => v.toFixed(2);
/** A number as it is shown in a field: no more digits than mean something. */
const shown = (v: number) => String(Number(v.toPrecision(7)));
/** A number typed with a decimal point or a decimal comma; NaN for anything else. */
function typed(text: string): number {
  const t = text.trim().replace(",", ".");
  return t === "" ? NaN : Number(t);
}
/**
 * Where a parameter starts or ends, as typed: a number, or a formula with no
 * variable in it such as 2pi or pi/2. NaN for anything else.
 */
function typedConstant(text: string): number {
  const plain = typed(text);
  if (Number.isFinite(plain) || !text.trim()) return plain;
  const got = readFormula(text);
  return typeof got === "string" || degree(got) > 0 ? NaN : evaluate(got, 0);
}
/** A value of a parameter as it is shown in its field: a round share of pi is written with pi, so that it reads back exactly. */
function shownConstant(v: number): string {
  const twelfths = (v / Math.PI) * 12;
  if (v !== 0 && Math.abs(twelfths - Math.round(twelfths)) < 1e-9 && Math.abs(twelfths) <= 12 * 64) {
    const k = Math.round(twelfths), g = gcd(Math.abs(k), 12);
    const top = k / g, bottom = 12 / g;
    return `${top === 1 ? "" : top === -1 ? "-" : top}pi${bottom === 1 ? "" : `/${bottom}`}`;
  }
  return shown(v);
}
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
/** A value moved onto a grid a hundred times finer than the size of `span`, so ranges keep short numbers. */
function tidy(v: number, span: number): number {
  const g = 10 ** Math.floor(Math.log10(span)) / 100;
  return Number((Math.round(v / g) * g).toPrecision(12));
}
/** A round step, 1, 2 or 5 times a power of ten, at least `px` screen pixels long at `perUnit` pixels a unit. */
function gridStep(perUnit: number, px: number): number {
  const raw = px / perUnit;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const m = raw / pow;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * pow;
}
const inside = (r: Rect, [x, y]: V) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

const WEIGHT_MIN = 0.1, WEIGHT_MAX = 3;
/** Below this width the graph goes above the print instead of beside it. */
const SIDE_BY_SIDE = 760;
/** Room left round the page on the print, and the most screen pixels a millimetre of it is shown at. */
const PRINT_PAD = 28, PRINT_MAX = 14;
/** White round the figure on the page, in mm. */
const PAGE_MARGIN = 3;

export class PlotWorkspace {
  /** The plot on show, and the function selected in it. */
  private current: Id | null = null;
  private selected: Id | null = null;
  private hover: Hit = { kind: "none" };
  /** The whole canvas, and the two parts it is split into. */
  private size: V = [800, 600];
  private G: Rect = { x: 0, y: 0, w: 450, h: 600 };
  private P: Rect = { x: 451, y: 0, w: 349, h: 600 };
  /** What the graph shows; the plot whose range it was last fitted to. */
  private gv: GraphView = { cx: 5, cy: 0, sx: 40, sy: 40 };
  private fitted: Id | null = null;
  /** How the print is shown: paper mm at the middle of its part of the canvas, and screen pixels per mm. */
  private pv: View = { cx: 0, cy: 0, scale: 5, w: 349, h: 600 };
  /** The page round the figure on the print, in mm. */
  private page = { x0: 0, y0: 0, x1: 70, y1: 45 };
  private drag: Drag | null = null;
  private prims: Prim[] = [];
  /** The curves as drawn on the graph, in screen pixels: what a click on one finds. */
  private paths: { id: Id; pts: V[] }[] = [];
  private cursor: V = [-1, -1];
  /** A field to put the cursor in once the panel has been drawn: its name, a bar, and the number of its piece if it has one. */
  private focusNext: string | null = null;
  /** What a click on the plot puts down, if anything: a note, or a balloon. */
  private tool: "note" | "balloon" | null = null;
  /** The spot a balloon being placed points at, in the plot's own coordinates, until its second click says where the balloon goes. */
  private pending: V | null = null;

  constructor(private host: PlotHost, private svg: SVGSVGElement, private panel: HTMLElement, private empty: HTMLElement) {
    svg.addEventListener("pointerdown", (e) => this.onDown(e));
    svg.addEventListener("pointermove", (e) => this.onMove(e));
    svg.addEventListener("pointerup", (e) => this.onUp(e));
    svg.addEventListener("pointercancel", (e) => this.onUp(e));
    svg.addEventListener("pointerleave", () => { if (!this.drag) { this.hover = { kind: "none" }; this.cursor = [-1, -1]; this.host.render(); } });
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

  /** The selected note or balloon. */
  private mark(): { note: PlotNote } | { balloon: PlotBalloon } | null {
    const p = this.plot();
    const note = p?.notes?.find((n) => n.id === this.selected);
    if (note) return { note };
    const balloon = p?.balloons?.find((b) => b.id === this.selected);
    return balloon ? { balloon } : null;
  }

  /** Takes the selected note or balloon out of its plot. */
  private removeMark(): void {
    const p = this.plot();
    if (!p) return;
    p.notes = p.notes?.filter((n) => n.id !== this.selected);
    p.balloons = p.balloons?.filter((b) => b.id !== this.selected);
    if (!p.notes?.length) delete p.notes;
    if (!p.balloons?.length) delete p.balloons;
    this.selected = null;
  }

  /** After the sketch was swapped for another (undo, a file opened): what was on show may be gone. */
  sync(): void {
    const p = this.plot();
    if (!p?.curves.some((c) => c.id === this.selected) && !this.mark()) this.selected = p?.curves[0]?.id ?? null;
    this.drag = null;
    this.hover = { kind: "none" };
    this.pending = null;
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
    this.size = [w, h];
    this.svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    // Side by side, the graph gets the larger share; on a narrow screen it goes above the print.
    if (w >= SIDE_BY_SIDE) {
      const gw = Math.round(w * 0.56);
      this.G = { x: 0, y: 0, w: gw, h };
      this.P = { x: gw + 1, y: 0, w: w - gw - 1, h };
    } else {
      const gh = Math.round(h * 0.55);
      this.G = { x: 0, y: 0, w, h: gh };
      this.P = { x: 0, y: gh + 1, w, h: h - gh - 1 };
    }
  }

  /** Zooms the graph so the frame of the exported range is in the middle of it, as wide against its height as the plot is on paper. */
  fit(): void {
    const p = this.plot();
    if (!p) return;
    const G = this.G, pad = Math.max(36, Math.min(G.w, G.h) * 0.12);
    const room: V = [Math.max(40, G.w - 2 * pad), Math.max(40, G.h - 2 * pad)];
    let w = room[0], h = (w * p.height) / p.width;
    if (h > room[1]) { h = room[1]; w = (h * p.width) / p.height; }
    this.gv = { cx: (p.x.min + p.x.max) / 2, cy: (p.y.min + p.y.max) / 2, sx: w / (p.x.max - p.x.min), sy: h / (p.y.max - p.y.min) };
    this.fitted = p.id;
    this.host.render();
  }

  /** Brings the frame back into view when its range was changed so that it is not all on the graph any more. */
  private keepFrame(): void {
    const p = this.plot();
    if (!p) return;
    const a = this.gs([p.x.min, p.y.max]), b = this.gs([p.x.max, p.y.min]);
    if (!inside(this.G, a) || !inside(this.G, b)) this.fit();
  }

  // ---- where things are --------------------------------------------------------------

  /** Where a point of the plot's own coordinates is on the graph, in screen pixels. */
  private gs([x, y]: V): V {
    const { G, gv } = this;
    return [G.x + G.w / 2 + (x - gv.cx) * gv.sx, G.y + G.h / 2 - (y - gv.cy) * gv.sy];
  }
  /** And the other way round. */
  private gd([X, Y]: V): V {
    const { G, gv } = this;
    return [gv.cx + (X - G.x - G.w / 2) / gv.sx, gv.cy - (Y - G.y - G.h / 2) / gv.sy];
  }
  /** A point of the canvas in the print's own screen pixels, from the top left corner of its part. */
  private local([X, Y]: V): V {
    return [X - this.P.x, Y - this.P.y];
  }
  /** Which part of the canvas a point is in. */
  private paneAt(sp: V): Pane | null {
    return inside(this.G, sp) ? "graph" : inside(this.P, sp) ? "print" : null;
  }

  /** Where a handle of the frame is on the graph. */
  private frameHandle(p: Plot, h: Handle): V {
    const a = this.gs([p.x.min, p.y.min]), b = this.gs([p.x.max, p.y.max]);
    return [a[0] + ((h.x + 1) / 2) * (b[0] - a[0]), a[1] + ((h.y + 1) / 2) * (b[1] - a[1])];
  }
  /** Where a handle of the axis box is on the print, in the print's own pixels. */
  private sizeHandle(p: Plot, h: Handle): V {
    return toScreen(this.pv, [((h.x + 1) / 2) * p.width, ((h.y + 1) / 2) * p.height]);
  }

  /** The print's view: the page as large as its part of the canvas holds, a little above the middle to leave room for its size under it. */
  private fitPrint(p: Plot): View {
    const b = figureBounds(this.prims);
    const x0 = Math.min(b.x0, 0) - PAGE_MARGIN, x1 = Math.max(b.x1, p.width) + PAGE_MARGIN;
    const y0 = Math.min(b.y0, 0) - PAGE_MARGIN, y1 = Math.max(b.y1, p.height) + PAGE_MARGIN;
    this.page = { x0, y0, x1, y1 };
    const { P } = this, below = 26;
    const scale = Math.max(0.5, Math.min(PRINT_MAX, (P.w - 2 * PRINT_PAD) / (x1 - x0), (P.h - 2 * PRINT_PAD - below) / (y1 - y0)));
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 - below / 2 / scale, scale, w: P.w, h: P.h };
  }

  // ---- drawing ------------------------------------------------------------------------

  draw(): void {
    const p = this.plot();
    this.empty.hidden = !!p;
    if (!p) {
      this.svg.innerHTML = "";
      this.prims = [];
      this.paths = [];
      return;
    }
    this.prims = plotPrims(p);
    if (this.drag?.kind !== "size") this.pv = this.fitPrint(p);
    else {
      // While the size is dragged the print keeps its scale; the page grows round the figure.
      const b = figureBounds(this.prims);
      this.page = { x0: Math.min(b.x0, 0) - PAGE_MARGIN, y0: Math.min(b.y0, 0) - PAGE_MARGIN, x1: Math.max(b.x1, p.width) + PAGE_MARGIN, y1: Math.max(b.y1, p.height) + PAGE_MARGIN };
    }
    const { G, P } = this;
    const rect = (r: Rect) => `x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"`;
    const a = this.gs([p.x.min, p.y.max]), b = this.gs([p.x.max, p.y.min]);
    let html = `<defs><clipPath id="pw-graph-clip"><rect ${rect(G)}/></clipPath><clipPath id="pw-print-clip"><rect ${rect(P)}/></clipPath>` +
      `<clipPath id="pw-frame-clip"><rect x="${n2(a[0])}" y="${n2(a[1])}" width="${n2(Math.max(0, b[0] - a[0]))}" height="${n2(Math.max(0, b[1] - a[1]))}"/></clipPath></defs>`;
    html += `<g clip-path="url(#pw-graph-clip)">${this.graphHtml(p)}</g>`;
    html += `<g clip-path="url(#pw-print-clip)">${this.printHtml(p)}</g>`;
    html += this.size[0] >= SIDE_BY_SIDE
      ? `<line class="pw-divider" x1="${G.w + 0.5}" y1="0" x2="${G.w + 0.5}" y2="${this.size[1]}"/>`
      : `<line class="pw-divider" x1="0" y1="${G.h + 0.5}" x2="${this.size[0]}" y2="${G.h + 0.5}"/>`;
    this.svg.innerHTML = html;
    this.svg.dataset.over = this.cursorKind();
  }

  /** The curve the pointer is over, on either side: it is lit up on both. */
  private lit(): Id | null {
    const h = this.hover;
    return h.kind === "curve" || h.kind === "graph-curve" || h.kind === "name" || h.kind === "note" || h.kind === "balloon" ? h.id : null;
  }

  /** The graph: a grid over the plane, the axes, the curves, and the frame of what is exported. */
  private graphHtml(p: Plot): string {
    const { G, gv } = this;
    const [x0, y1] = this.gd([G.x, G.y]), [x1, y0] = this.gd([G.x + G.w, G.y + G.h]);
    const a = this.gs([p.x.min, p.y.max]), b = this.gs([p.x.max, p.y.min]);
    let html = `<rect class="pw-graph" x="${G.x}" y="${G.y}" width="${G.w}" height="${G.h}"/>`;
    html += `<rect class="pw-frame-fill" x="${n2(a[0])}" y="${n2(a[1])}" width="${n2(Math.max(0, b[0] - a[0]))}" height="${n2(Math.max(0, b[1] - a[1]))}"/>`;

    // The grid, with a number at every line along the axes; where an axis is out of view, along the edge it is beyond.
    const sx = gridStep(gv.sx, 64), sy = gridStep(gv.sy, 48);
    const o = this.gs([0, 0]);
    const rowY = Math.max(G.y + 14, Math.min(G.y + G.h - 6, o[1] + 15));
    const colX = Math.max(G.x + 6, Math.min(G.x + G.w - 6, o[0] - 6));
    const yAnchor = o[0] - 6 < G.x + 40 ? "start" : "end";
    let grid = "", nums = "";
    for (let k = Math.ceil(x0 / sx); k * sx <= x1; k++) {
      const v = Number((k * sx).toPrecision(12)), X = this.gs([v, 0])[0];
      grid += `M${n2(X)} ${G.y}V${G.y + G.h}`;
      if (k !== 0) nums += `<text class="pw-num" x="${n2(X)}" y="${n2(rowY)}" text-anchor="middle">${tickText(v, sx)}</text>`;
    }
    for (let k = Math.ceil(y0 / sy); k * sy <= y1; k++) {
      const v = Number((k * sy).toPrecision(12)), Y = this.gs([0, v])[1];
      grid += `M${G.x} ${n2(Y)}H${G.x + G.w}`;
      if (k !== 0) nums += `<text class="pw-num" x="${n2(yAnchor === "start" ? G.x + 6 : colX)}" y="${n2(Y + 4)}" text-anchor="${yAnchor}">${tickText(v, sy)}</text>`;
    }
    html += `<path class="pw-grid" d="${grid}"/>`;
    let axes = "";
    if (o[1] >= G.y && o[1] <= G.y + G.h) axes += `M${G.x} ${n2(o[1])}H${G.x + G.w}`;
    if (o[0] >= G.x && o[0] <= G.x + G.w) axes += `M${n2(o[0])} ${G.y}V${G.y + G.h}`;
    if (axes) html += `<path class="pw-axis" d="${axes}"/>`;
    if (inside(G, o)) nums += `<text class="pw-num" x="${n2(o[0] - 6)}" y="${n2(o[1] + 15)}" text-anchor="end">0</text>`;
    html += nums;

    // The curves over all of the graph: faint outside the frame, as they are inside it.
    const view: Plot = { ...p, x: { ...p.x, min: x0, max: x1 }, y: { ...p.y, min: y0, max: y1 }, width: G.w, height: G.h };
    const lit = this.lit();
    this.paths = [];
    let curves = "";
    for (const c of p.curves) {
      if (!drawable(p, c)) continue;
      const on = c.id === this.selected || c.id === lit;
      const dash = c.dash === "dashed" ? ` stroke-dasharray="8 5"` : c.dash === "dotted" ? ` stroke-dasharray="0.1 5"` : "";
      for (const run of curveRuns(view, c)) {
        const pts = run.map((q) => this.gs(q));
        this.paths.push({ id: c.id, pts });
        curves += `<path class="pw-curve" d="M${pts.map((q) => `${n2(q[0])} ${n2(q[1])}`).join("L")}" stroke="${esc(c.color)}" stroke-width="${on ? 3.2 : 2}"${dash}/>`;
      }
    }
    html += `<g class="pw-fade">${curves}</g><g clip-path="url(#pw-frame-clip)">${curves}</g>`;

    // The frame, and its handles.
    html += `<rect class="pw-frame" x="${n2(a[0])}" y="${n2(a[1])}" width="${n2(Math.max(0, b[0] - a[0]))}" height="${n2(Math.max(0, b[1] - a[1]))}"/>`;
    const held = this.drag?.kind === "frame" ? this.drag.h : this.hover.kind === "frame" && !this.tool ? this.hover.h : null;
    for (const h of HANDLES) {
      const c = this.frameHandle(p, h);
      html += `<rect class="plot-handle${held === h ? " on" : ""}" x="${n2(c[0] - 4.5)}" y="${n2(c[1] - 4.5)}" width="9" height="9" rx="1.5"/>`;
    }
    if (this.drag?.kind === "frame" || this.drag?.kind === "shift") {
      const said = `x ${shown(p.x.min)} … ${shown(p.x.max)}     y ${shown(p.y.min)} … ${shown(p.y.max)}`;
      html += `<text class="plot-size" x="${n2((a[0] + b[0]) / 2)}" y="${n2(Math.max(G.y + 34, a[1] - 12))}" text-anchor="middle">${said}</text>`;
    }
    if (this.tool === "balloon" && this.pending && this.paneAt(this.cursor) === "graph") {
      const from = this.gs(this.pending), to = this.cursor;
      html += `<line class="preview" x1="${n2(from[0])}" y1="${n2(from[1])}" x2="${n2(to[0])}" y2="${n2(to[1])}"/><circle class="preview" cx="${n2(to[0])}" cy="${n2(to[1])}" r="9"/>`;
    }
    html += `<text class="pw-pane" x="${G.x + 12}" y="${G.y + 20}">Graph</text>`;
    return html;
  }

  /** The print: the plot on its page, as it is exported, with the handles that set its size on paper. */
  private printHtml(p: Plot): string {
    const { P, pv } = this;
    const S = (q: V) => toScreen(pv, q);
    const none = new Set<Id>();
    // A selected note or balloon is lit up; a selected function is not: it shows in the side panel.
    const chosen = this.mark() && this.selected ? new Set<Id>([this.selected]) : none;
    const pa = S([this.page.x0, this.page.y1]), pb = S([this.page.x1, this.page.y0]);
    let inner = `<rect class="pw-page" x="${n2(pa[0])}" y="${n2(pa[1])}" width="${n2(pb[0] - pa[0])}" height="${n2(pb[1] - pa[1])}"/>`;
    inner += drawPrims({ view: pv, mm: 1, prims: this.prims, selection: chosen, related: none, hover: this.lit(), conflicting: none, redundant: none, freeIds: none });
    const a = S([0, 0]), b = S([p.width, p.height]);
    inner += `<rect class="plot-box" x="${n2(a[0])}" y="${n2(b[1])}" width="${n2(b[0] - a[0])}" height="${n2(a[1] - b[1])}"/>`;
    const held = this.drag?.kind === "size" ? this.drag.h : this.hover.kind === "size" && !this.tool ? this.hover.h : null;
    for (const h of HANDLES) {
      const c = this.sizeHandle(p, h);
      inner += `<rect class="plot-handle${held === h ? " on" : ""}" x="${n2(c[0] - 4.5)}" y="${n2(c[1] - 4.5)}" width="9" height="9" rx="1.5"/>`;
    }
    if (this.drag?.kind === "size") {
      inner += `<text class="plot-size" x="${n2((a[0] + b[0]) / 2)}" y="${n2(b[1] - 12)}" text-anchor="middle">${shown(p.width / 10)} × ${shown(p.height / 10)} cm</text>`;
    }
    if (this.tool === "balloon" && this.pending && this.paneAt(this.cursor) === "print") {
      const from = S(toPaper(p, this.pending)), to = this.local(this.cursor);
      inner += `<line class="preview" x1="${n2(from[0])}" y1="${n2(from[1])}" x2="${n2(to[0])}" y2="${n2(to[1])}"/>` +
        `<circle class="preview" cx="${n2(to[0])}" cy="${n2(to[1])}" r="${n2(PAPER.balloonRadius * pv.scale)}"/>`;
    }
    // Under the page: its size, and how much larger than on paper it is shown.
    const times = pv.scale / (96 / 25.4);
    inner += `<text class="pw-note" x="${n2((pa[0] + pb[0]) / 2)}" y="${n2(Math.min(P.h - 8, pb[1] + 20))}" text-anchor="middle">${shown(p.width / 10)} × ${shown(p.height / 10)} cm` +
      `${Math.abs(times - 1) > 0.05 ? ` · shown ${times > 1 ? `${times.toFixed(1)}× enlarged` : `at ${Math.round(times * 100)} %`}` : " · actual size"}</text>`;
    return `<rect class="pw-print" x="${P.x}" y="${P.y}" width="${P.w}" height="${P.h}"/>` +
      `<g transform="translate(${P.x} ${P.y})">${inner}</g>` +
      `<text class="pw-pane" x="${P.x + 12}" y="${P.y + 20}">Print</text>`;
  }

  /** The pointer to show for what it is over, or what is being dragged. */
  private cursorKind(): string {
    if (this.tool) return "place";
    const d = this.drag, h = d?.kind === "frame" || d?.kind === "size" ? d.h
      : !d && (this.hover.kind === "frame" || this.hover.kind === "size") ? this.hover.h : null;
    if (h) return h.x && h.y ? (h.x === h.y ? "nesw" : "nwse") : h.x ? "ew" : "ns";
    if (d?.kind === "pan" && d.moved) return "grab";
    if (d?.kind === "shift" || d?.kind === "name" || d?.kind === "mark") return "move";
    if (d) return "";
    switch (this.hover.kind) {
      case "frame-edge": case "name": case "note": case "balloon": return "move";
      case "graph-curve": case "curve": case "axis-label": return "pointer";
      case "graph": return "pan";
      default: return "";
    }
  }

  /** What the status bar says about what the pointer is over. */
  hint(): string {
    if (!this.plot()) return "No plot yet. New plot makes one.";
    if (this.tool === "note") return "Click where the note should start, on the graph or on the print, then type it in the side panel. Esc puts the tool down.";
    if (this.tool === "balloon") return this.pending ? "Click where the balloon should sit. Clicking the same spot again leaves out the leader." : "Click what the balloon points at, on the graph or on the print. Esc puts the tool down.";
    switch (this.drag?.kind ?? this.hover.kind) {
      case "frame": return "Drag to pull this side of the frame out or in: it is the range that is exported. Hold Alt to leave the round numbers.";
      case "frame-edge": case "shift": return "Drag the frame to move the range that is exported.";
      case "graph-curve": return "Click to select this function; its formula is in the side panel. Drag to move around the graph.";
      case "graph": case "pan": return "Drag to move around the graph; the wheel zooms it (Shift: sideways only, Alt: up and down only). The dashed frame is what is exported; 0 brings it back into view.";
      case "size": return this.drag ? "Sets the size of the plot on paper, in whole millimetres. Hold Alt for any size." : "Drag to set the size of the plot on paper.";
      case "note": return "Drag the note to move it; click it to change its text in the side panel.";
      case "balloon": return this.hover.kind === "balloon" && this.hover.tip ? "Drag the tip of the leader to what the balloon points at." : "Drag the balloon to move it; click it to change its text in the side panel.";
      case "mark": return "Let go where it should stay.";
      case "name": return "Drag the name of the function to where it should stand.";
      case "curve": return "Click to select this function; its formula is in the side panel.";
      case "axis-label": return "Click to change the name of the axis.";
      default: return "The print is the plot as it is exported: drag its handles to set its size on paper, and put notes and balloons on it. Move around on the graph beside it.";
    }
  }

  /** The pointer's place in the plot's own coordinates, or the size of the plot when it is on neither. */
  coords(): string {
    const p = this.plot();
    if (!p) return "";
    const short = (v: number, span: number) => String(Number(v.toFixed(Math.max(0, 2 - Math.floor(Math.log10(span))))));
    const pane = this.paneAt(this.cursor);
    if (pane === "graph") {
      const [x, y] = this.gd(this.cursor);
      return `x ${short(x, this.G.w / this.gv.sx)}   y ${short(y, this.G.h / this.gv.sy)}`;
    }
    if (pane === "print") {
      const q = toModel(this.pv, this.local(this.cursor));
      if (q[0] >= 0 && q[0] <= p.width && q[1] >= 0 && q[1] <= p.height) {
        const [x, y] = toData(p, q);
        return `x ${short(x, p.x.max - p.x.min)}   y ${short(y, p.y.max - p.y.min)}`;
      }
    }
    return `${shown(p.width / 10)} × ${shown(p.height / 10)} cm`;
  }

  // ---- the pointer ----------------------------------------------------------------------

  private screenPos(ev: PointerEvent | WheelEvent): V {
    const r = this.svg.getBoundingClientRect();
    return [ev.clientX - r.left, ev.clientY - r.top];
  }

  private hit(sp: V): Hit {
    const p = this.plot();
    if (!p) return { kind: "none" };
    const pane = this.paneAt(sp);
    if (pane === "graph") return this.graphHit(p, sp);
    if (pane === "print") return this.printHit(p, this.local(sp));
    return { kind: "none" };
  }

  private graphHit(p: Plot, sp: V): Hit {
    for (const h of HANDLES) if (dist(this.frameHandle(p, h), sp) < 9) return { kind: "frame", h };
    // The nearest curve, the selected one first where two run together.
    let best: { id: Id; d: number } | null = null;
    for (const path of this.paths) {
      let d = Infinity;
      for (let i = 1; i < path.pts.length; i++) d = Math.min(d, distToSegment(sp, path.pts[i - 1], path.pts[i]));
      d -= path.id === this.selected ? 1.5 : 0;
      if (d < 6 && (!best || d < best.d)) best = { id: path.id, d };
    }
    if (best) return { kind: "graph-curve", id: best.id };
    const a = this.gs([p.x.min, p.y.max]), b = this.gs([p.x.max, p.y.min]);
    const near = (v: number, at: number) => Math.abs(v - at) < 5;
    const across = sp[0] > a[0] - 5 && sp[0] < b[0] + 5, along = sp[1] > a[1] - 5 && sp[1] < b[1] + 5;
    if ((across && (near(sp[1], a[1]) || near(sp[1], b[1]))) || (along && (near(sp[0], a[0]) || near(sp[0], b[0])))) return { kind: "frame-edge" };
    return { kind: "graph" };
  }

  /** What is under a point of the print, given in its own pixels. */
  private printHit(p: Plot, lp: V): Hit {
    for (const h of HANDLES) if (dist(this.sizeHandle(p, h), lp) < 9) return { kind: "size", h };
    const q = toModel(this.pv, lp);
    const px = (prim: Prim) => primDistance(prim, q) * this.pv.scale;
    // Notes and balloons lie over everything else. The tip of a balloon's leader is a handle of its own.
    for (const b of [...(p.balloons ?? [])].reverse()) {
      const { anchor } = balloonPlace(p, b);
      if (Math.hypot(b.dx, b.dy) > PAPER.balloonRadius && dist(toScreen(this.pv, anchor), lp) < 7) return { kind: "balloon", id: b.id, tip: true };
    }
    for (let i = this.prims.length - 1; i >= 0; i--) {
      const prim = this.prims[i];
      if ((prim.part !== "note" && prim.part !== "balloon") || !prim.ref || px(prim) > 4) continue;
      return prim.part === "note" ? { kind: "note", id: prim.ref } : { kind: "balloon", id: prim.ref, tip: false };
    }
    for (const prim of this.prims) {
      if (prim.k !== "text" || px(prim) > 4) continue;
      if (prim.part === "label" && prim.ref) return { kind: "name", id: prim.ref };
      if (prim.part === "xlabel" || prim.part === "ylabel") return { kind: "axis-label", axis: prim.part === "xlabel" ? "x" : "y" };
    }
    let best: { id: Id; d: number } | null = null;
    for (const prim of this.prims) {
      if (prim.k !== "path" || !prim.ref) continue;
      const d = px(prim) - (prim.ref === this.selected ? 1.5 : 0);
      if (d < 6 && (!best || d < best.d)) best = { id: prim.ref, d };
    }
    if (best) return { kind: "curve", id: best.id };
    return { kind: "none" };
  }

  private onDown(ev: PointerEvent): void {
    const p = this.plot();
    if (!p) return;
    (document.activeElement as HTMLElement | null)?.blur?.();
    const sp = this.screenPos(ev);
    this.cursor = sp;
    const pane = this.paneAt(sp);
    if (!pane) return;
    this.svg.setPointerCapture(ev.pointerId);
    if (ev.button !== 0) {
      // Any other button moves the graph, wherever on it it is pressed.
      if (pane === "graph") this.drag = { kind: "pan", last: sp, start: sp, moved: true, select: false, click: null };
      return this.host.render();
    }
    if (this.tool) return this.place(p, pane, sp);
    const hit = this.hit(sp);
    // The ends of the range land on tenths of the distance between the ticks on paper, so that they are round numbers.
    const gx = tickStep(p.x, p.width) / 10, gy = tickStep(p.y, p.height) / 10;
    const lq = toModel(this.pv, this.local(sp));
    switch (hit.kind) {
      case "frame":
        this.drag = { kind: "frame", h: hit.h, x: [p.x.min, p.x.max], y: [p.y.min, p.y.max], gx, gy, moved: false };
        break;
      case "frame-edge":
        this.drag = { kind: "shift", start: this.gd(sp), x: [p.x.min, p.x.max], y: [p.y.min, p.y.max], gx, gy, moved: false };
        break;
      case "graph": case "graph-curve":
        this.drag = { kind: "pan", last: sp, start: sp, moved: false, select: true, click: hit.kind === "graph-curve" ? hit.id : null };
        break;
      case "size":
        this.drag = { kind: "size", h: hit.h, start: sp, width: p.width, height: p.height, cx: this.pv.cx, cy: this.pv.cy, moved: false };
        break;
      case "note": case "balloon": {
        const note = p.notes?.find((n) => n.id === hit.id), balloon = p.balloons?.find((b) => b.id === hit.id);
        const at = note ? toPaper(p, [note.x, note.y]) : balloon ? balloonPlace(p, balloon)[hit.kind === "balloon" && hit.tip ? "anchor" : "centre"] : lq;
        const centre = balloon ? balloonPlace(p, balloon).centre : lq;
        this.drag = { kind: "mark", id: hit.id, tip: hit.kind === "balloon" && hit.tip, offset: [at[0] - lq[0], at[1] - lq[1]], centre, moved: false };
        break;
      }
      case "name": {
        const c = p.curves.find((x) => x.id === hit.id);
        const at = c ? curveLabelAt(p, c) : null;
        if (!c || !at) return;
        this.select(c.id);
        const on = toPaper(p, at);
        this.drag = { kind: "name", id: c.id, offset: [on[0] - lq[0], on[1] - lq[1]], moved: false };
        break;
      }
      default:
        this.drag = { kind: "press", start: sp, field: hit.kind === "axis-label" ? `${hit.axis}.label` : null, click: hit.kind === "curve" ? hit.id : null, moved: false };
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
      this.hover = this.tool ? { kind: "none" } : this.hit(sp);
      return this.host.render();
    }
    const lq = toModel(this.pv, this.local(sp));
    /** A value on the steps the range moves in, or, with Alt held, wherever it is. */
    const land = (v: number, g: number) => (ev.altKey ? Number(v.toPrecision(6)) : Number((Math.round(v / g) * g).toPrecision(12)));
    if (d.kind === "pan") {
      if (!d.moved && dist(sp, d.start) < 4) return;
      d.moved = true;
      this.gv.cx -= (sp[0] - d.last[0]) / this.gv.sx;
      this.gv.cy += (sp[1] - d.last[1]) / this.gv.sy;
      d.last = sp;
    } else if (d.kind === "frame") {
      // The side follows the pointer; the two ends of an axis stay a step apart at the least.
      const [x, y] = this.gd(sp);
      const apart = (v: number) => Number(v.toPrecision(12));
      if (d.h.x < 0) p.x.min = Math.min(land(x, d.gx), apart(d.x[1] - d.gx));
      if (d.h.x > 0) p.x.max = Math.max(land(x, d.gx), apart(d.x[0] + d.gx));
      if (d.h.y < 0) p.y.min = Math.min(land(y, d.gy), apart(d.y[1] - d.gy));
      if (d.h.y > 0) p.y.max = Math.max(land(y, d.gy), apart(d.y[0] + d.gy));
      d.moved = d.moved || p.x.min !== d.x[0] || p.x.max !== d.x[1] || p.y.min !== d.y[0] || p.y.max !== d.y[1];
    } else if (d.kind === "shift") {
      const [x, y] = this.gd(sp);
      const dx = land(x - d.start[0], d.gx), dy = land(y - d.start[1], d.gy);
      p.x.min = Number((d.x[0] + dx).toPrecision(12));
      p.x.max = Number((d.x[1] + dx).toPrecision(12));
      p.y.min = Number((d.y[0] + dy).toPrecision(12));
      p.y.max = Number((d.y[1] + dy).toPrecision(12));
      d.moved = d.moved || dx !== 0 || dy !== 0;
    } else if (d.kind === "size") {
      const whole = (v: number) => Math.max(PLOT.minSize, Math.min(PLOT.maxSize, ev.altKey ? Number(v.toFixed(2)) : Math.round(v)));
      const dx = (sp[0] - d.start[0]) / this.pv.scale, dy = (d.start[1] - sp[1]) / this.pv.scale;
      // The side across from the handle stays where it is on screen: for the left and bottom handles the view moves along.
      if (d.h.x) {
        p.width = whole(d.width + d.h.x * dx);
        if (d.h.x < 0) this.pv.cx = d.cx + (p.width - d.width);
      }
      if (d.h.y) {
        p.height = whole(d.height + d.h.y * dy);
        if (d.h.y < 0) this.pv.cy = d.cy + (p.height - d.height);
      }
      d.moved = d.moved || p.width !== d.width || p.height !== d.height;
    } else if (d.kind === "name") {
      const c = p.curves.find((x) => x.id === d.id);
      if (!c) return;
      const [x, y] = toData(p, [lq[0] + d.offset[0], lq[1] + d.offset[1]]);
      c.lx = Number(x.toPrecision(6));
      c.ly = Number(y.toPrecision(6));
      d.moved = true;
    } else if (d.kind === "mark") {
      const to: V = [lq[0] + d.offset[0], lq[1] + d.offset[1]];
      const note = p.notes?.find((n) => n.id === d.id), balloon = p.balloons?.find((b) => b.id === d.id);
      const at = (v: V): V => { const [x, y] = toData(p, v); return [Number(x.toPrecision(6)), Number(y.toPrecision(6))]; };
      const mm = (v: number) => Number(v.toFixed(3));
      if (note) [note.x, note.y] = at(to);
      else if (balloon && d.tip) {
        // The tip moves; the balloon stays where it is on paper.
        [balloon.x, balloon.y] = at(to);
        const anchor = toPaper(p, [balloon.x, balloon.y]);
        balloon.dx = mm(d.centre[0] - anchor[0]);
        balloon.dy = mm(d.centre[1] - anchor[1]);
      } else if (balloon) {
        const { anchor } = balloonPlace(p, balloon);
        balloon.dx = mm(to[0] - anchor[0]);
        balloon.dy = mm(to[1] - anchor[1]);
      }
      d.moved = true;
    } else if (d.kind === "press" && dist(sp, d.start) > 3) {
      d.moved = true;
    }
    this.host.render();
  }

  /**
   * A click while the Note or the Balloon tool is held, on either side: puts
   * one down, or for a balloon first the spot it points at.
   */
  private place(p: Plot, pane: Pane, sp: V): void {
    const sk = this.host.sketch();
    const round = (q: V): V => [Number(q[0].toPrecision(6)), Number(q[1].toPrecision(6))];
    const at = round(pane === "graph" ? this.gd(sp) : toData(p, toModel(this.pv, this.local(sp))));
    if (this.tool === "note") {
      const note: PlotNote = { id: newId(sk, "mark"), x: at[0], y: at[1], text: "Text" };
      (p.notes ??= []).push(note);
      this.selected = note.id;
    } else {
      if (!this.pending) {
        this.pending = at;
        return this.host.render();
      }
      const anchor = toPaper(p, this.pending);
      const centre = pane === "graph" ? toPaper(p, this.gd(sp)) : toModel(this.pv, this.local(sp));
      // Clicked again on the spot it points at: the balloon sits there, with no leader.
      const spot = pane === "graph" ? this.gs(this.pending) : toScreen(this.pv, anchor);
      const same = dist(spot, pane === "graph" ? sp : this.local(sp)) < 4;
      const balloon: PlotBalloon = {
        id: newId(sk, "mark"), x: this.pending[0], y: this.pending[1],
        dx: same ? 0 : Number((centre[0] - anchor[0]).toFixed(3)), dy: same ? 0 : Number((centre[1] - anchor[1]).toFixed(3)),
        text: nextBalloonText(p), end: "arrow",
      };
      (p.balloons ??= []).push(balloon);
      this.selected = balloon.id;
    }
    // One at a time: the tool is put down, and the text is ready to be typed over in the side panel.
    this.tool = null;
    this.pending = null;
    this.focusNext = "atext|";
    this.host.commit();
  }

  private onUp(ev: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    if (this.svg.hasPointerCapture(ev.pointerId)) this.svg.releasePointerCapture(ev.pointerId);
    if (!d) return;
    this.hover = this.hit(this.screenPos(ev));
    if (d.kind === "pan") {
      if (d.moved || !d.select) return this.host.render();
      // A click on the graph: on a curve it selects it, on nothing it lets go of what was selected.
      this.selected = d.click;
      return this.host.touch();
    }
    if (d.kind === "press") {
      if (d.moved) return this.host.render();
      if (d.field) this.focusNext = `${d.field}|`;
      else this.selected = d.click;
      return this.host.touch();
    }
    if (d.kind === "mark") {
      this.selected = d.id;
      if (!d.moved) {
        // A click on a note or a balloon goes to its text.
        this.focusNext = "atext|";
        return this.host.touch();
      }
    }
    if (d.moved) return this.host.commit();
    this.host.touch();
  }

  private onWheel(ev: WheelEvent): void {
    ev.preventDefault();
    const sp = this.screenPos(ev);
    // The print is always shown whole; the wheel zooms the graph only.
    if (!this.plot() || this.paneAt(sp) !== "graph") return;
    const q = this.gd(sp);
    // With Shift held, some browsers report the turn of the wheel as sideways.
    const turn = (ev.deltaY || ev.deltaX) * (ev.deltaMode === 1 ? 32 : 1);
    const f = Math.exp(-turn * 0.0016);
    const { G, gv } = this;
    const ok = (s: number, px: number) => px / s > 1e-9 && px / s < 1e12;
    if (!ev.altKey && ok(gv.sx * f, G.w)) gv.sx *= f;
    if (!ev.shiftKey && ok(gv.sy * f, G.h)) gv.sy *= f;
    // The point under the pointer stays under it.
    gv.cx = q[0] - (sp[0] - G.x - G.w / 2) / gv.sx;
    gv.cy = q[1] + (sp[1] - G.y - G.h / 2) / gv.sy;
    this.host.render();
  }

  /** A key pressed while no field has the keyboard. True when it was taken. */
  key(e: KeyboardEvent): boolean {
    if (e.key === "Escape") {
      // A tool in hand is put down first, then what is selected let go of.
      if (this.tool) { this.tool = null; this.pending = null; }
      else this.selected = null;
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
    if ((e.key === "Delete" || e.key === "Backspace") && this.mark()) {
      this.act("del-mark", {});
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
      tool("add-curve", "curve", "Function", "Add a function of x to this plot", off) +
      tool("add-param", "param", "Parametric", "Add a curve given by x(t) and y(t): a circle, a path, a phase portrait", off) +
      `<span class="ribbon-rule"></span>` +
      tool("tool-note", "note", "Note", "Put text on the plot: click where it should start", `${off} aria-pressed="${this.tool === "note"}"`) +
      tool("tool-balloon", "balloon", "Balloon", "Put a balloon on the plot: click what it points at, then where it sits", `${off} aria-pressed="${this.tool === "balloon"}"`) +
      `<span class="ribbon-rule"></span>` +
      tool("fit-y", "fity", "Fit range", "Set the vertical range so all of every function shows", off) +
      tool("fit-view", "fit", "Zoom to fit", "Bring the frame of the exported range into the middle of the graph (0)", off) +
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

    html += `<h3>Functions and curves</h3>`;
    p.curves.forEach((c, i) => {
      const open = c.id === this.selected;
      const first = c.pieces.find((x) => x.expr.trim())?.expr.trim();
      const title = c.param
        ? (c.pieces[0]?.x?.trim() || first ? `(${c.pieces[0]?.x?.trim() || "…"}; ${first ?? "…"})` : `Curve ${i + 1}`)
        : first ? `${first}${c.pieces.length > 1 ? " …" : ""}` : `Function ${i + 1}`;
      html += `<section class="fn${open ? " open" : ""}">` +
        `<button type="button" class="fn-head" data-pact="select-curve" data-id="${c.id}" aria-expanded="${open}"><span class="fn-dot" style="background:${esc(c.color)}"></span><span class="fn-title">${esc(title)}</span></button>`;
      if (open) html += this.curveHtml(p, c);
      html += `</section>`;
    });
    html += `<div class="btn-row"><button type="button" class="plain" data-pact="add-curve">Add a function</button>` +
      `<button type="button" class="plain" data-pact="add-param" title="A curve given by x(t) and y(t)">Add a parametric curve</button></div>`;

    const marks: (PlotNote | PlotBalloon)[] = [...(p.notes ?? []), ...(p.balloons ?? [])];
    if (marks.length) {
      html += `<h3>Notes and balloons</h3>`;
      for (const m of marks) {
        const open = m.id === this.selected, balloon = "end" in m;
        const title = `${balloon ? "Balloon" : "Note"}${m.text.trim() ? `: ${m.text.trim()}` : ""}`;
        html += `<section class="fn${open ? " open" : ""}">` +
          `<button type="button" class="fn-head" data-pact="select-mark" data-id="${m.id}" aria-expanded="${open}"><span class="fn-title plain-title">${esc(title)}</span></button>`;
        if (open) html += this.markHtml(m);
        html += `</section>`;
      }
    }

    html += `<h3>Axes</h3>`;
    html += text("Name of the horizontal axis", "x.label", p.x.label, "", "x");
    html += pair("It runs from", "x.min", "x.max", shown(p.x.min), shown(p.x.max)) +
      `<small class="under">The dashed frame on the graph is this range: drag its handles to pull it out or in, or its edge to move it.</small>`;
    html += text("Name of the vertical axis", "y.label", p.y.label, "Names are written as TeX math, such as M_h or v\\,[\\mathrm{m/s}]. Leave one empty for none.", "y");
    html += pair("It runs from", "y.min", "y.max", shown(p.y.min), shown(p.y.max));
    html += `<div class="btn-row"><button type="button" class="plain" data-pact="fit-y">Fit it to the functions</button>` +
      `<button type="button" class="plain" data-pact="equal" title="The same length on paper for one unit on either axis, so that a circle is round">Same scale on both</button></div>`;
    html += choice("Drawn as", "frame", [["cross", "Arrows", p.frame !== "box"], ["box", "Box", p.frame === "box"]]);
    html += choice("Ticks", "ticks", [["numbers", "Numbers", p.ticks === undefined], ["marks", "Marks", p.ticks === "marks"], ["none", "None", p.ticks === "none"]]);
    html += pair("A tick every", "x.step", "y.step", p.x.step === undefined ? "" : shown(p.x.step), p.y.step === undefined ? "" : shown(p.y.step), "across,") +
      `<small class="under">up. Leave empty for a spacing that suits the size of the plot.</small>`;
    html += choice("Grid", "grid", [["none", "None", p.grid === undefined], ["lines", "Lines", p.grid === "lines"], ["dots", "Dots", p.grid === "dots"]]);

    html += `<h3>Size on paper</h3>`;
    html += pair("Width and height (cm)", "width", "height", shown(p.width / 10), shown(p.height / 10), "×") +
      `<small class="under">Of the axes, without their labels. Dragging a handle on the print sets it too. Text is 10 pt at any size.</small>`;
    html += `<button type="button" class="danger" data-pact="del-plot">Delete this plot</button>`;
    return html;
  }

  /** The fields of a note or a balloon. */
  private markHtml(m: PlotNote | PlotBalloon): string {
    const field = (note: string) =>
      `<label class="field"><span>Text</span><input data-pf="atext" type="text" spellcheck="false" autocomplete="off" value="${esc(m.text)}"><small>${note}</small></label>`;
    const choice = (label: string, act: string, options: [string, string, boolean][]) =>
      `<div class="field"><span id="pl-${act}">${label}</span><div class="segmented wrap" role="group" aria-labelledby="pl-${act}">${options.map(([v, name, on]) =>
        `<button type="button" data-pact="${act}" data-v="${v}" aria-pressed="${on}">${name}</button>`).join("")}</div></div>`;
    if (!("end" in m)) {
      return field("Plain text, set in the document's font. Put math between dollar signs, as in $M_{max}$, and \\\\ where a new line starts. Drag the note on the plot to move it.") +
        `<button type="button" class="danger" data-pact="del-mark">Delete this note</button>`;
    }
    const frame = m.frame ?? "circle";
    return field("Written as TeX math. Drag the balloon to move it, and the tip of its leader to what it points at.") +
      choice("Frame", "aframe", [["circle", "Circle", frame === "circle"], ["box", "Box", frame === "box"], ["underline", "Underline", frame === "underline"], ["none", "None", frame === "none"]]) +
      choice("Leader ends with", "aend", [["arrow", "Arrow", m.end === "arrow"], ["dot", "Dot", m.end === "dot"], ["none", "Nothing", m.end === "none"]]) +
      `<button type="button" class="danger" data-pact="del-mark">Delete this balloon</button>`;
  }

  /** The fields of a curve given by a parameter: its two formulas and what the parameter runs over. */
  private paramHtml(c: PlotCurve): string {
    const piece = c.pieces[0];
    const bad = { x: formulaError(piece.x ?? ""), y: formulaError(piece.expr) };
    const err = pieceError(piece, true);
    const formula = (name: string, pf: string, value: string, wrong: string | null, hint: string) =>
      `<label class="pair formula"><span>${name}</span><input data-pf="${pf}" data-i="0" type="text" spellcheck="false" autocomplete="off" autocapitalize="off" class="${wrong ? "bad" : ""}" value="${esc(value)}" placeholder="${hint}" aria-label="${name.replace(" =", "")}"></label>`;
    return `<div class="piece">` +
      formula("x(t) =", "xexpr", piece.x ?? "", bad.x, "3cos(t)") +
      formula("y(t) =", "expr", piece.expr, bad.y, "3sin(t)") +
      `<span class="pair small"><span>t from</span><input data-pf="from" data-i="0" type="text" autocomplete="off" value="${shownConstant(piece.from ?? PARAM_RANGE[0])}" aria-label="The parameter starts at">` +
      `<span>to</span><input data-pf="to" data-i="0" type="text" autocomplete="off" value="${shownConstant(piece.to ?? PARAM_RANGE[1])}" aria-label="The parameter ends at"></span>` +
      `<small class="piece-msg${err ? " bad" : ""}">${esc(err ?? "")}</small></div>` +
      `<p class="muted note-block">The parameter is t. Where it starts and ends can be typed with pi, as 2pi or pi/2. Use + - * / ^ and brackets; sin, cos, tan, exp, ln, lg, sqrt, abs and pi are known. For a circle to come out round, press Same scale on both under Axes.</p>`;
  }

  private curveHtml(p: Plot, c: PlotCurve): string {
    let html = "";
    if (c.param) html += this.paramHtml(c);
    else c.pieces.forEach((piece, i) => {
      const err = pieceError(piece);
      const range = c.pieces.length > 1 || piece.from !== undefined || piece.to !== undefined;
      html += `<div class="piece">` +
        `<input data-pf="expr" data-i="${i}" type="text" spellcheck="false" autocomplete="off" autocapitalize="off" class="${err ? "bad" : ""}" value="${esc(piece.expr)}" placeholder="2x + 1, sin(x), -5x^2/2" aria-label="Formula${c.pieces.length > 1 ? ` of piece ${i + 1}` : ""}">` +
        (range ? `<span class="pair small"><span>from</span><input data-pf="from" data-i="${i}" type="text" inputmode="decimal" autocomplete="off" value="${piece.from === undefined ? "" : shown(piece.from)}" placeholder="${shown(p.x.min)}" aria-label="Piece ${i + 1} starts at">` +
          `<span>to</span><input data-pf="to" data-i="${i}" type="text" inputmode="decimal" autocomplete="off" value="${piece.to === undefined ? "" : shown(piece.to)}" placeholder="${shown(p.x.max)}" aria-label="Piece ${i + 1} ends at">` +
          (c.pieces.length > 1 ? `<button type="button" class="icon-btn" data-pact="del-piece" data-i="${i}" aria-label="Remove piece ${i + 1}" title="Remove this piece">${icon("close", 16)}</button>` : "") + `</span>` : "") +
        `<small class="piece-msg${err ? " bad" : ""}">${esc(err ?? "")}</small></div>`;
    });
    if (!c.param) {
      html += `<button type="button" class="plain" data-pact="add-piece">${c.pieces.length > 1 ? "Add a piece" : "Split into pieces"}</button>`;
      html += `<p class="muted note-block">The variable is x (or t). Use + - * / ^ and brackets; sin, cos, tan, exp, ln, lg, sqrt, abs and pi are known. A function in pieces has one formula for each stretch of the axis, as an internal force diagram does.</p>`;
    }
    html += `<label class="field"><span>Name</span><input data-pf="label" type="text" spellcheck="false" autocomplete="off" value="${esc(c.label ?? "")}" placeholder="M(x), v_1">` +
      `<small>Written as TeX math and set beside the curve; drag it on the plot to move it.${c.lx !== undefined ? ` <button type="button" class="linkish" data-pact="name-back">Put it back beside the curve</button>` : ""}</small></label>`;
    html += `<div class="field"><span id="pl-colour">Colour</span><div class="swatches" role="group" aria-labelledby="pl-colour">${PLOT_COLORS.map((col) =>
      `<button type="button" class="swatch" data-pact="color" data-v="${col}" aria-pressed="${c.color === col}" aria-label="Colour ${col}" title="${col}" style="background:${col}"></button>`).join("")}` +
      `<label class="swatch custom" title="Another colour"><input data-pf="color" type="color" value="${esc(c.color)}" aria-label="Another colour"></label></div></div>`;
    const weight = c.weight ?? PLOT.weight;
    html += `<label class="field"><span>Line thickness</span><span class="slider-row"><input data-pf="weight" type="range" min="${WEIGHT_MIN}" max="${WEIGHT_MAX}" step="0.1" value="${weight}"><output>${shown(weight)} pt</output></span></label>`;
    html += `<div class="field"><span id="pl-dash">Line</span><div class="segmented" role="group" aria-labelledby="pl-dash">${([["solid", "Solid"], ["dashed", "Dashed"], ["dotted", "Dotted"]] as const).map(([v, name]) =>
      `<button type="button" data-pact="dash" data-v="${v}" aria-pressed="${(c.dash ?? "solid") === v}">${name}</button>`).join("")}</div></div>`;
    html += `<label class="check"><input data-pf="fill" type="checkbox"${c.fill ? " checked" : ""}><span>${c.param ? "Shade the inside" : "Shade down to the axis"}</span></label>`;
    if (c.pieces.length > 1 && !c.param) html += `<label class="check"><input data-pf="join" type="checkbox"${c.join !== false ? " checked" : ""}><span>Draw the jumps between pieces</span></label>`;
    html += `<button type="button" class="danger" data-pact="del-curve">Delete this ${c.param ? "curve" : "function"}</button>`;
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
    const m = this.mark();
    switch (act) {
      case "tool-note":
      case "tool-balloon": {
        const want = act === "tool-note" ? "note" : "balloon";
        this.tool = this.tool === want ? null : want;
        this.pending = null;
        return this.host.touch();
      }
      case "select-mark":
        this.selected = this.selected === ds.id ? null : ds.id ?? null;
        return this.host.touch();
      case "del-mark":
        if (!m) return;
        this.removeMark();
        return this.host.commit();
      case "aend":
        if (!m || !("balloon" in m) || !ds.v) return;
        m.balloon.end = ds.v as LeaderEnd;
        return this.host.commit();
      case "aframe":
        if (!m || !("balloon" in m) || !ds.v) return;
        if (ds.v === "circle") delete m.balloon.frame;
        else m.balloon.frame = ds.v as BalloonFrame;
        return this.host.commit();
      case "select-curve":
        this.selected = this.selected === ds.id ? null : ds.id ?? null;
        return this.host.touch();
      case "add-curve":
        this.selected = newCurve(sk, p).id;
        this.focusNext = "expr|0";
        return this.host.commit();
      case "add-param":
        this.selected = newCurve(sk, p, true).id;
        this.focusNext = "xexpr|0";
        return this.host.commit();
      case "equal": {
        const { x, y } = equalScales(p);
        [p.x.min, p.x.max] = x;
        [p.y.min, p.y.max] = y;
        this.host.commit();
        return this.keepFrame();
      }
      case "del-curve":
        if (!c) return;
        p.curves = p.curves.filter((x) => x !== c);
        this.selected = null;
        return this.host.commit();
      case "add-piece": {
        if (!c || c.param) return;
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
        return this.host.commit();
      case "ticks":
        if (ds.v === "numbers") delete p.ticks;
        else p.ticks = ds.v as "marks" | "none";
        return this.host.commit();
      case "grid":
        if (ds.v === "none") delete p.grid;
        else p.grid = ds.v as "lines" | "dots";
        return this.host.commit();
      case "fit-y": {
        // With nothing but curves given by a parameter in the plot, the horizontal range is theirs to set as well.
        const across = fitX(p);
        if (across) [p.x.min, p.x.max] = across;
        const range = fitY(p);
        if (!range) return this.host.toast(p.curves.some((x) => drawable(p, x)) ? "These functions have no values to fit the range to." : "There is no function to fit the range to yet.");
        [p.y.min, p.y.max] = range;
        this.host.commit();
        return this.keepFrame();
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
        sk.symbols = sk.symbols.filter((x) => (x.type !== "diagram" && x.type !== "trace") || x.plot !== p.id);
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
      done();
      return this.keepFrame();
    }
    if (pf === "width" || pf === "height") {
      if (live) return;
      const mm = v * 10;
      if (!(mm >= PLOT.minSize && mm <= PLOT.maxSize)) return refuse(`A plot is between ${PLOT.minSize / 10} and ${PLOT.maxSize / 10} cm wide and high.`);
      p[pf] = Number(mm.toFixed(2));
      return this.host.commit();
    }

    if (pf === "atext") {
      const m = this.mark();
      if (!m) return;
      if ("note" in m) m.note.text = input.value;
      else m.balloon.text = input.value.trim().replace(/^\$+|\$+$/g, "");
      return done();
    }

    const c = this.curve();
    if (!c) return;
    const piece = c.pieces[Number(input.dataset.i)];
    if ((pf === "expr" || pf === "xexpr") && piece) {
      if (pf === "xexpr") piece.x = input.value;
      else piece.expr = input.value;
      // While it is typed, what is wrong with it shows under the field, which is left alone.
      const err = pieceError(piece, c.param);
      input.classList.toggle("bad", c.param ? !!formulaError(input.value) : !!err);
      const msg = input.closest(".piece")?.querySelector(".piece-msg");
      if (msg) { msg.textContent = err ?? ""; msg.classList.toggle("bad", !!err); }
      return done();
    }
    if ((pf === "from" || pf === "to") && piece && c.param) {
      if (live) return;
      const t = typedConstant(input.value);
      if (!Number.isFinite(t)) return refuse("Where the parameter starts and ends are numbers; pi can be used, as in 2pi.");
      const [from, to] = pf === "from" ? [t, piece.to ?? PARAM_RANGE[1]] : [piece.from ?? PARAM_RANGE[0], t];
      if (!(to > from)) return refuse("The parameter runs from a smaller number to a larger one.");
      piece[pf] = t;
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

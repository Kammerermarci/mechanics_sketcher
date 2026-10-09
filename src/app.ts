// The editor: tools, selection, dragging, constraint and dimension commands,
// and the panels around the canvas.

import {
  type Sketch, type Id, type Point, type Line, type Circle, type Arc, type Curve, type Constraint,
  type ConstraintDraft, type Dimension, type DistanceMode, type Sym, type SupportKind, type LeaderEnd,
  type ArrowEnds, type Datum,
  ORIGIN, emptySketch, entity, point, constraint, symbol, symbolRefs, points, curves, curvePoints,
  constraintRefs, isDimension, isFixed, arcRadius, addPoint, addLine, addCircle, addArc, addConstraint,
  addSupport, addFrame, addSymbol, remove, serialize, deserialize, clone,
} from "./model";
import { SketchSolver, type Drag, type SolveResult, type Freedom } from "./solver";
import { History } from "./history";
import {
  type V, add, sub, mul, dot, cross, norm, perp, mid, dist, angleOf, polar, wrap, inSweep,
  projectOnSegment, intersectLines, boxIsEmpty, grow, TWO_PI,
} from "./geom";
import {
  type Prim, PAPER, printMm, geometryBox, buildPrims, dimensionPrims,
  primDistance, textCentre, distanceFrame, angleFrame, roundFrame, symbolPosition, balloonAnchor,
  curveParam, sideOfCurve, formatNumber, frameTips, arrowLabelAt, arrowAnchor, centerMarkEnds,
} from "./prims";
import {
  type View, type Glyph, type Preview, type SnapMark, GLYPH_SIZE, PREVIEW_REF, toScreen, toModel,
  layoutGlyphs, renderScene,
} from "./render";
import { regionAt, findOverlaps } from "./regions";
import { type TrimPlan, planTrim, applyTrim } from "./trim";
import { toSvg, toTikz } from "./export";
import { icon } from "./icons";

type DrawTool = "point" | "line" | "centerline" | "arrow" | "arcarrow" | "circle" | "arc";
type SymbolTool = "pin" | "roller" | "wall" | "frame" | "centermark" | "balloon" | "fill" | "hatch" | "datum";
type Command =
  | "horizontal" | "vertical" | "parallel" | "perpendicular" | "equal" | "coincident"
  | "midpoint" | "tangent" | "fixed" | "dimension";
/** A constraint or the dimension command is a tool too: pick it, then the geometry. */
type Tool = "select" | DrawTool | "trim" | SymbolTool | Command;
/** Sketch holds what shapes the geometry; Annotate what is added to the figure. */
type Tab = "sketch" | "annotate";

/** How a curve is drawn: a solid edge, a centre line, an arrow, or a helper that is not exported. */
type LineStyle = "solid" | "centre" | "arrow" | "construction";

/** Where a click lands once snapping has had its say. */
interface Snap {
  pos: V;
  pointId?: Id;
  curveId?: Id;
  midpoint?: boolean;
  axis?: "h" | "v";
}

type Pending =
  | { tool: "line"; start: Snap }
  | { tool: "circle"; center: Snap }
  | { tool: "arc"; center: Snap; start?: Snap; sweep: number; lastAng: number }
  /** A balloon whose leader has been anchored and whose circle is still to be placed. */
  | { tool: "balloon"; anchor: Snap };

type DragState =
  /** `quiet`: the press already confirmed a typed value, so releasing does nothing more. */
  | { kind: "pan"; last: V; moved: boolean; quiet: boolean }
  /** `click`: what to select if the press turns out to be a click, not a drag. */
  | { kind: "box"; a: V; b: V; additive: boolean; click?: Id }
  | { kind: "move"; grabbed: Id; startScreen: V; startModel: V; targets: { id: Id; x: number; y: number }[]; rim?: Id; moved: boolean; collapse: boolean }
  /** `onText`: the press was on the number, so a plain click opens it for typing. */
  | { kind: "dim"; id: Id; startScreen: V; moved: boolean; onText: boolean }
  /** `origin`: where the symbol was when the drag began (a position, or the offset of a balloon or a name). */
  | { kind: "sym"; id: Id; startScreen: V; startModel: V; origin: V; moved: boolean; edit?: EditTarget }
  /** Pulling the tip of one of a pair of axes; `slack` is how far from the tip it was grabbed, in mm. */
  | { kind: "axis"; id: Id; axis: "x" | "y"; startScreen: V; slack: number; moved: boolean; edit?: EditTarget }
  /** Pulling an end of a centre mark to make the mark larger or smaller. */
  | { kind: "reach"; id: Id; startScreen: V; moved: boolean }
  /** Moving the name of an arrow; `origin` is its offset from the arrow's middle when the drag began. */
  | { kind: "label"; id: Id; startScreen: V; startModel: V; origin: V; moved: boolean; edit?: EditTarget };
// `edit`, where present: the press was on a piece of text, so a plain click opens it for typing.

/** Something whose text can be typed where it stands on the drawing. */
type EditTarget =
  | { kind: "dim"; id: Id }
  | { kind: "balloon"; id: Id }
  | { kind: "datum"; id: Id }
  /** The name of an arrow; `id` is its line or arc. */
  | { kind: "arrow"; id: Id }
  | { kind: "axis"; id: Id; axis: "x" | "y" };

/** `part` and `text` describe the piece that was hit: which part of its owner, and whether it is text. */
interface Hit { id: Id; kind: "point" | "glyph" | "dim" | "curve" | "sym" | "fill"; part?: string; text?: boolean }

interface ToolDef {
  id: Tool;
  label: string;
  key?: string;
  icon: string;
  tab: Tab | "both";
  /** Tools with the same group number sit together on the ribbon. */
  group: number;
  /** For constraints and the dimension command: what they are applied to. */
  need?: string;
}

const TOOLS: ToolDef[] = [
  { id: "select", label: "Select", key: "Esc", icon: "select", tab: "both", group: 0 },

  { id: "line", label: "Line", key: "L", icon: "line", tab: "sketch", group: 1 },
  { id: "centerline", label: "Centre line", icon: "centerline", tab: "sketch", group: 1 },
  { id: "circle", label: "Circle", key: "C", icon: "circle", tab: "sketch", group: 1 },
  { id: "arc", label: "Arc", key: "A", icon: "arc", tab: "sketch", group: 1 },
  { id: "point", label: "Point", key: "P", icon: "point", tab: "sketch", group: 1 },
  { id: "trim", label: "Trim", key: "X", icon: "trim", tab: "sketch", group: 2 },
  { id: "horizontal", label: "Horizontal", key: "H", icon: "horizontal", tab: "sketch", group: 3, need: "a line, or two points" },
  { id: "vertical", label: "Vertical", key: "V", icon: "vertical", tab: "sketch", group: 3, need: "a line, or two points" },
  { id: "parallel", label: "Parallel", icon: "parallel", tab: "sketch", group: 3, need: "two lines" },
  { id: "perpendicular", label: "Perpendicular", icon: "perpendicular", tab: "sketch", group: 3, need: "two lines" },
  { id: "equal", label: "Equal", key: "E", icon: "equal", tab: "sketch", group: 3, need: "two lines, or two circles" },
  { id: "coincident", label: "Coincident", key: "O", icon: "coincident", tab: "sketch", group: 3, need: "two points, or a point and a line or circle" },
  { id: "midpoint", label: "Midpoint", key: "M", icon: "midpoint", tab: "sketch", group: 3, need: "a point and a line" },
  { id: "tangent", label: "Tangent", key: "T", icon: "tangent", tab: "sketch", group: 3, need: "a line and a circle or arc" },
  { id: "fixed", label: "Fix point", key: "F", icon: "fixed", tab: "sketch", group: 3, need: "a point" },

  { id: "dimension", label: "Dimension", key: "D", icon: "dimension", tab: "annotate", group: 1, need: "a line, two points, two lines, or a circle" },
  { id: "pin", label: "Pin", icon: "pin", tab: "annotate", group: 2 },
  { id: "roller", label: "Roller", icon: "roller", tab: "annotate", group: 2 },
  { id: "wall", label: "Fixed", icon: "wall", tab: "annotate", group: 2 },
  { id: "frame", label: "Axes", icon: "frame", tab: "annotate", group: 3 },
  { id: "arrow", label: "Arrow", icon: "arrow", tab: "annotate", group: 3 },
  { id: "arcarrow", label: "Curved arrow", icon: "arcarrow", tab: "annotate", group: 3 },
  { id: "datum", label: "Datum point", icon: "datum", tab: "annotate", group: 3 },
  { id: "centermark", label: "Centre mark", icon: "centermark", tab: "annotate", group: 3 },
  { id: "balloon", label: "Balloon", key: "B", icon: "balloon", tab: "annotate", group: 3 },
  { id: "fill", label: "Fill", icon: "fill", tab: "annotate", group: 4 },
  { id: "hatch", label: "Hatching", icon: "hatch", tab: "annotate", group: 4 },
];

const COMMAND_IDS: Command[] = [
  "horizontal", "vertical", "parallel", "perpendicular", "equal", "coincident", "midpoint", "tangent", "fixed", "dimension",
];
const isCommand = (t: Tool): t is Command => (COMMAND_IDS as Tool[]).includes(t);
const isSymbolTool = (t: Tool): t is SymbolTool =>
  ["pin", "roller", "wall", "frame", "centermark", "balloon", "fill", "hatch", "datum"].includes(t);
const toolDef = (t: Tool): ToolDef => TOOLS.find((d) => d.id === t)!;

const RELATION_NAMES: Record<string, string> = {
  coincident: "Coincident", pointOn: "Point on curve", midpoint: "Midpoint", horizontal: "Horizontal",
  vertical: "Vertical", parallel: "Parallel", perpendicular: "Perpendicular", equal: "Equal",
  tangent: "Tangent", fixed: "Fixed point", distance: "Distance", angle: "Angle", radius: "Radius",
};
const SUPPORT_NAMES: Record<SupportKind, string> = { pin: "Pin support", roller: "Roller support", fixed: "Fixed support" };
/** Fill colours offered as swatches: light tones that print well under black lines. */
const FILL_COLORS = ["#d5dbe1", "#eceff1", "#f6d9a8", "#f4b6a6", "#b9d7ee", "#bfe3c4", "#d9c8ea", "#8f9aa3"];
const DEFAULT_HATCH = { spacing: 1.3, depth: 1.6 };
/** Colours offered for datum points: strong ones, so the dot reads on top of the lines. */
const DATUM_COLORS = ["#d32f2f", "#1565c0", "#2e7d32", "#ef6c00", "#6a1b9a", "#17201b"];
/** Where a datum's name starts out, in mm from its point. */
const DATUM_LABEL_OFFSET: V = [2.4, 2.4];
const EXPORT_NAME_KEY = "mech-sketch.exportName";
const EDIT_SCALE_KEY = "mech-sketch.editScale";
/** Range of the slider for the size of annotations while editing, in percent. */
const EDIT_SCALE_MIN = 50, EDIT_SCALE_MAX = 250;

/** Range of the dimension size slider, in percent. */
const DIM_SCALE_MIN = 30, DIM_SCALE_MAX = 300;
const AUTOSAVE_KEY = "mech-sketch.autosave";
/**
 * Screen pixels per annotation mm while editing. Text, arrowheads and symbols
 * keep this size however far the view is zoomed, as in a CAD sketcher.
 */
const EDIT_PX_PER_MM = 5;
const POINT_TOL = 10;  // px
const CURVE_TOL = 7;   // px
const DEFAULT_SCALE = 40;
const DEG = Math.PI / 180;

const $ = <T extends HTMLElement | SVGElement = HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing element ${sel}`);
  return el;
};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Parses a number typed with either a decimal point or a decimal comma. */
function parseNumber(text: string): number {
  const t = text.trim().replace(",", ".");
  return t === "" ? NaN : Number(t);
}

/** When this copy of the app was built, in the reader's own time, for telling versions apart. */
function buildLabel(): string {
  const built = new Date(__BUILD_TIME__);
  if (Number.isNaN(built.getTime())) return "";
  const when = built.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return `This version was built on ${when}.`;
}

export class App {
  sk: Sketch = emptySketch();
  private history = new History();
  private result: SolveResult = { ok: true, dof: 0, conflicting: [], redundant: [] };

  private view: View = { cx: 0, cy: 0, scale: DEFAULT_SCALE, w: 800, h: 600 };
  private tool: Tool = "select";
  private tab: Tab = "sketch";
  /** What can still move, worked out after each edit; null until then or when it cannot be told. */
  private freedom: Freedom | null = null;
  private freedomStale = true;
  private fillColor = FILL_COLORS[0];
  private datumColor = DATUM_COLORS[0];
  /** Print preview: only what is exported is drawn, with annotations at their size in print. */
  private preview = false;
  /** How large annotations are on screen while editing, against the standard size. A setting of this browser, not of the sketch. */
  private editScale = 1;
  /** The view to go back to when the print preview is left. */
  private viewBeforePreview: View | null = null;
  /** File name, without extension, offered for the next export. */
  private exportName = "figure";
  /** What the dimension box held when it opened, to tell an edit from a plain close. */
  private editingInitial = "";
  /** What the Trim tool would remove under the pointer. */
  private trimPlan: TrimPlan | null = null;
  /** What is selected; while a command is active, the geometry picked for it so far. */
  private selection = new Set<Id>();
  private hover: Id | null = null;
  private pending: Pending | null = null;
  private drag: DragState | null = null;
  private cursor: V = [0, 0]; // last pointer position, screen px
  private snapMark: SnapMark | null = null;
  private altKey = false;
  private spaceKey = false;
  /** What the box on the drawing is editing: a dimension, or the name of something. */
  private editing: EditTarget | null = null;
  /** The last thing picked with the Select tool, for stepping through overlaps. */
  private lastPick: { pos: V; id: Id; time: number } | null = null;

  private prims: Prim[] = [];
  private glyphs: Glyph[] = [];
  private frame = 0;
  private chromeDirty = true;
  private hintOverride: string | null = null;
  private toastTimer = 0;
  private focusTimer = 0;

  private svg = $<SVGSVGElement>("#canvas");
  private stage = $<HTMLElement>("#stage");
  private panel = $<HTMLElement>("#panel");
  private titleblock = $<HTMLElement>("#titleblock");
  private hintEl = $<HTMLElement>("#hint");
  private coordsEl = $<HTMLElement>("#coords");
  private toastEl = $<HTMLElement>("#toast");
  private emptyEl = $<HTMLElement>("#empty");
  private dimEditor = $<HTMLInputElement>("#dim-editor");
  private fileInput = $<HTMLInputElement>("#file-input");

  constructor(private solver: SketchSolver) {
    this.buildToolbars();
    this.bindEvents();
    this.restore();
    this.resize();
    this.fit();
    this.solve();
    this.history.reset(this.sk);
    this.render();
  }

  // ---- state ----------------------------------------------------------------

  /**
   * Annotation mm per model unit for what is on screen. While editing it
   * follows the zoom, which is what keeps annotations one size on screen; in
   * the print preview it is the scale of the exported figure.
   */
  private mm(): number {
    return this.preview ? printMm(this.sk) : this.view.scale / (EDIT_PX_PER_MM * this.editScale);
  }

  private solve(drags: Drag[] = []): SolveResult {
    this.result = this.solver.solve(this.sk, drags);
    return this.result;
  }

  /** Records the current sketch as an undo step and saves it. */
  private commit(): void {
    this.freedomStale = true;
    this.history.commit(this.sk);
    this.autosave();
    this.touch();
  }

  private autosave(): void {
    try {
      localStorage.setItem(AUTOSAVE_KEY, serialize(this.sk));
    } catch {
      // Storage can be unavailable (private window, file:// in some browsers).
    }
  }

  private restore(): void {
    try {
      const saved = localStorage.getItem(AUTOSAVE_KEY);
      if (saved) this.sk = deserialize(saved);
      this.exportName = localStorage.getItem(EXPORT_NAME_KEY) || this.exportName;
      const scale = Number(localStorage.getItem(EDIT_SCALE_KEY));
      if (scale >= EDIT_SCALE_MIN / 100 && scale <= EDIT_SCALE_MAX / 100) {
        this.editScale = scale;
        this.showEditScale();
      }
    } catch {
      this.sk = emptySketch();
    }
  }

  /** Marks panels as stale and schedules a redraw. */
  private touch(): void {
    this.chromeDirty = true;
    this.render();
  }

  private render(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private replaceSketch(sk: Sketch): void {
    this.sk = sk;
    this.freedomStale = true;
    this.pruneSelection();
    this.pending = null;
    this.closeEditor();
    this.solve();
  }

  private exists(id: Id): boolean {
    return !!(entity(this.sk, id) || constraint(this.sk, id) || symbol(this.sk, id));
  }

  private pruneSelection(): void {
    for (const id of [...this.selection]) if (!this.exists(id)) this.selection.delete(id);
    if (this.hover && !this.exists(this.hover)) this.hover = null;
  }

  private toast(message: string): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove("show"), 4200);
  }

  /** True when nothing has been drawn: only the origin is there. */
  private isBlank(): boolean {
    return this.sk.entities.length <= 1 && !this.sk.symbols.length;
  }

  // ---- drawing the screen -----------------------------------------------------

  private draw(): void {
    const mm = this.mm();
    this.prims = buildPrims(this.sk, mm, { editor: !this.preview });
    this.glyphs = this.preview ? [] : layoutGlyphs(this.sk, this.view, this.glyphFilter());

    const related = new Set<Id>();
    for (const id of this.selection) {
      const c = constraint(this.sk, id);
      if (c) constraintRefs(c).forEach((r) => related.add(r));
      const s = symbol(this.sk, id);
      if (s && s.type !== "fill") symbolRefs(s).forEach((r) => related.add(r));
    }
    this.svg.innerHTML = renderScene({
      sk: this.sk, view: this.view, mm, prims: [...this.prims, ...this.dimensionPreview(mm)], glyphs: this.glyphs,
      selection: this.selection, related, hover: this.hover,
      conflicting: new Set(this.result.conflicting), redundant: new Set(this.result.redundant),
      freeIds: this.preview ? new Set() : this.freeIds(), overlaps: findOverlaps(this.sk),
      preview: this.previewShapes(), snap: this.snapMark,
      box: this.drag?.kind === "box" ? { a: this.drag.a, b: this.drag.b } : null,
      grips: this.grips(mm), plain: this.preview,
    });

    this.emptyEl.hidden = !this.isBlank() || this.pending !== null || this.tool !== "select";
    this.svg.dataset.tool = this.tool === "select" ? "select" : isCommand(this.tool) ? "pick" : "draw";
    this.svg.classList.toggle("panning", this.drag?.kind === "pan" || this.spaceKey);
    this.svg.classList.toggle("over", this.tool === "select" && this.hover !== null && !this.drag);

    const m = toModel(this.view, this.cursor);
    this.coordsEl.textContent = `x ${formatNumber(m[0])}   y ${formatNumber(m[1])}`;
    this.hintEl.textContent = this.hintOverride ?? (this.preview ? "Print preview: only what is exported is shown. Press Q to go back to editing." : this.toolHint());

    if (this.chromeDirty) {
      this.chromeDirty = false;
      this.drawPanel();
      this.drawTitleblock();
      this.updateButtons();
    }
    if (this.editing) this.placeEditor();
  }

  /**
   * Which constraint markers to draw: those on what is selected, the selected
   * ones themselves, and any that conflict. The rest would only be clutter.
   */
  private glyphFilter(): (c: Constraint) => boolean {
    const sel = this.selection;
    const flagged = new Set<Id>([...this.result.conflicting, ...this.result.redundant]);
    const lines: Line[] = [];
    // Selected geometry, plus the points the selected curves are built on.
    const active = new Set<Id>();
    for (const id of sel) {
      const e = entity(this.sk, id);
      if (!e) continue;
      active.add(id);
      if (e.type === "line") lines.push(e);
      if (e.type !== "point") curvePoints(e).forEach((p) => active.add(p));
    }
    return (c) => {
      if (sel.has(c.id) || flagged.has(c.id)) return true;
      if (c.type === "horizontal" || c.type === "vertical") {
        // Held between two points: it belongs to those points and to the line that joins them,
        // not to every other line that happens to share an end.
        return sel.has(c.a) || sel.has(c.b) || lines.some((l) => (l.p1 === c.a && l.p2 === c.b) || (l.p1 === c.b && l.p2 === c.a));
      }
      return constraintRefs(c).some((r) => active.has(r));
    };
  }

  /** Handles on the selected symbol: the tips of a pair of axes or the ends of a centre mark, which can be pulled. Screen pixels. */
  private grips(mm: number): V[] {
    const s = this.selectedSymbol();
    if (!s || this.tool !== "select") return [];
    let at: V[] = [];
    if (s.type === "frame") {
      const tips = frameTips(this.sk, s, mm);
      at = [tips.x, tips.y].filter((t): t is V => t !== null);
    } else if (s.type === "centermark") at = centerMarkEnds(this.sk, s, mm);
    return at.map((t) => toScreen(this.view, [t[0] / mm, t[1] / mm]));
  }

  /**
   * Ids of the points and curves that can still move. A curve is free while
   * any point it is built on is, or, for a circle, while its radius is.
   */
  private freeIds(): Set<Id> {
    // Not while dragging: what is free does not change mid-drag, and probing costs a solve per point.
    if (this.freedomStale && !this.drag) {
      this.freedomStale = false;
      this.freedom = this.result.ok ? this.solver.freedom(this.sk) : null;
    }
    const ids = new Set<Id>();
    const f = this.freedom;
    if (!f) {
      // Unknown (conflicting constraints, or too large to probe): all or nothing.
      if (this.result.dof !== 0 || !this.result.ok) for (const e of this.sk.entities) ids.add(e.id);
      return ids;
    }
    for (const e of this.sk.entities) {
      if (e.type === "point") {
        if (f.points.has(e.id)) ids.add(e.id);
      } else if (curvePoints(e).some((p) => f.points.has(p)) || f.radii.has(e.id)) {
        ids.add(e.id);
      }
    }
    return ids;
  }

  private toolHint(): string {
    const p = this.pending;
    const done = "Middle-click or Esc when done.";
    switch (this.tool) {
      case "select":
        return "Click to select, drag to move. Shift-click adds to the selection. Wheel zooms; middle-drag pans.";
      case "point": return `Click to place a point. ${done}`;
      case "line":
      case "centerline":
      case "arrow":
        if (this.tool === "arrow") {
          return p ? "Click where the arrow points. Hold Alt to switch snapping off."
            : `Click where the arrow starts. It is constrained and dimensioned like a line. ${done}`;
        }
        return p ? "Click where the line ends. Hold Alt to switch snapping off."
          : `Click where the ${this.tool === "line" ? "line" : "centre line"} starts. ${done}`;
      case "trim": return `Click the part of a line, circle or arc to remove, up to where other curves cross it. ${done}`;
      case "circle": return p ? "Click to set the radius." : `Click the centre. ${done}`;
      case "arc":
      case "arcarrow": {
        const what = this.tool === "arc" ? "arc" : "arrow";
        if (!p) return `Click the centre${this.tool === "arcarrow" ? " the arrow turns about" : ""}. ${done}`;
        return p.tool === "arc" && p.start ? `Sweep around the centre, then click where the ${what} ends.` : `Click where the ${what} starts.`;
      }
      case "pin":
      case "roller":
      case "wall":
        return `Click a joint to put a ${SUPPORT_NAMES[this.tool === "wall" ? "fixed" : this.tool].toLowerCase()} there. ${done}`;
      case "frame": return "Click where the coordinate axes should go. On a joint, they stay pinned to it.";
      case "centermark": return `Click a circle or arc to give it centre lines. ${done}`;
      case "balloon":
        return p ? "Click where the balloon should sit. Clicking the same spot again leaves out the leader."
          : `Click what the balloon points at. ${done}`;
      case "fill": return `Click inside a closed shape to fill it. ${done}`;
      case "hatch": return `Click a line, arc or circle, on the side the hatching should go. ${done}`;
      case "datum": return `Click where the datum point goes: a joint, a spot on a curve, or anywhere. ${done}`;
      case "dimension":
        return this.canApply("dimension")
          ? "Middle-click, or click empty space, where the dimension should go. Its position picks aligned, horizontal or vertical."
          : `Dimension: click a line, two points, two lines, or a circle. ${done}`;
      case "fixed": return `Fix point: click a point to fix it, or a fixed one to release it. ${done}`;
      default: {
        const info = toolDef(this.tool);
        return `${info.label}: click ${info.need}. ${done}`;
      }
    }
  }

  private previewShapes(): Preview | null {
    if (this.tool === "trim") {
      const g = this.trimPlan?.gone;
      if (!g || this.drag) return null;
      return {
        lines: g.kind === "line" ? [[g.a, g.b]] : [], circles: [],
        arcs: g.kind === "round" ? [{ c: g.c, r: g.r, a0: g.a0, a1: g.a1 >= g.a0 + TWO_PI ? g.a0 + TWO_PI - 1e-4 : g.a1 }] : [],
        points: [], danger: true,
      };
    }
    const p = this.pending;
    if (!p || this.drag?.kind === "pan") return null;
    const snap = this.snapAt(this.cursor, this.snapAnchor());
    const pv: Preview = { lines: [], circles: [], arcs: [], points: [] };
    if (p.tool === "balloon") {
      const raw = toModel(this.view, this.cursor);
      pv.lines.push([p.anchor.pos, raw]);
      pv.circles.push({ c: raw, r: PAPER.balloonRadius / this.mm() });
      return pv;
    }
    if (p.tool === "line") {
      pv.lines.push([p.start.pos, snap.pos]);
      if (!p.start.pointId) pv.points.push(p.start.pos);
    } else if (p.tool === "circle") {
      pv.circles.push({ c: p.center.pos, r: dist(p.center.pos, snap.pos) });
      pv.points.push(p.center.pos);
    } else {
      pv.points.push(p.center.pos);
      if (!p.start) {
        pv.lines.push([p.center.pos, snap.pos]);
      } else {
        const r = dist(p.center.pos, p.start.pos);
        const a0 = angleOf(sub(p.start.pos, p.center.pos));
        const a1 = angleOf(sub(snap.pos, p.center.pos));
        if (p.sweep >= 0) pv.arcs.push({ c: p.center.pos, r, a0, a1: a0 + (wrap(a1 - a0) || TWO_PI) });
        else pv.arcs.push({ c: p.center.pos, r, a0: a1, a1: a1 + (wrap(a0 - a1) || TWO_PI) });
        pv.points.push(p.start.pos);
      }
    }
    return pv;
  }

  /** The dimension the Dimension tool would place at the pointer right now. */
  private dimensionPreview(mm: number): Prim[] {
    if (this.tool !== "dimension" || this.editing || this.drag || !this.canApply("dimension")) return [];
    const draft = this.dimensionDraft(toModel(this.view, this.cursor));
    if (typeof draft === "string") return [];
    return dimensionPrims(this.sk, { ...draft, id: PREVIEW_REF } as Dimension, mm);
  }

  // ---- hit testing and snapping -----------------------------------------------

  /**
   * Everything under a screen position, best match first. With `geometryOnly`
   * only points and curves count, which is what constraint tools pick from.
   */
  private hitCandidates(sp: V, geometryOnly = false): (Hit & { rank: number; d: number })[] {
    const found = new Map<Id, Hit & { rank: number; d: number }>();
    const offer = (h: Hit, rank: number, d: number) => {
      const old = found.get(h.id);
      if (!old || rank < old.rank || (rank === old.rank && d < old.d)) found.set(h.id, { ...h, rank, d });
    };

    for (const p of points(this.sk)) {
      const d = dist(toScreen(this.view, [p.x, p.y]), sp);
      if (d < POINT_TOL) offer({ id: p.id, kind: "point" }, 0, d);
    }
    if (!geometryOnly) {
      const half = GLYPH_SIZE / 2 + 1;
      for (const g of this.glyphs) {
        if (Math.abs(sp[0] - g.x) <= half && Math.abs(sp[1] - g.y) <= half) offer({ id: g.id, kind: "glyph" }, 1, 0);
      }
    }
    const mm = this.mm();
    const pxPerMm = this.view.scale / mm;
    const q = mul(toModel(this.view, sp), mm);
    for (const p of this.prims) {
      if (!p.ref) continue;
      if (geometryOnly && p.layer !== "geom") continue;
      if (p.k === "region") {
        // A fill is picked anywhere inside it, but only when nothing else is there.
        if (primDistance(p, q) === 0) offer({ id: p.ref, kind: "fill" }, 3, 0);
        continue;
      }
      // Measured in pixels. Text gets a head start so a dimension's label is easy to grab.
      const d = primDistance(p, q) * pxPerMm - (p.k === "text" ? CURVE_TOL * 0.5 : 0);
      if (d >= CURVE_TOL) continue;
      const kind = p.layer === "dim" ? "dim" : p.layer === "sym" ? "sym" : "curve";
      offer({ id: p.ref, kind, part: p.part, text: p.k === "text" }, 2, d);
    }
    return [...found.values()].sort((a, b) => a.rank - b.rank || a.d - b.d);
  }

  private hitTest(sp: V, geometryOnly = false): Hit | null {
    return this.hitCandidates(sp, geometryOnly)[0] ?? null;
  }

  /**
   * Picks for the Select tool. Clicking the same spot again steps through
   * things that lie on top of each other, such as two overlapping lines.
   */
  private pickAt(sp: V, time: number, cycle: boolean): Hit | null {
    const cands = this.hitCandidates(sp);
    let hit: Hit | null = cands[0] ?? null;
    if (hit) {
      const stack = cands.filter((c) => c.rank === cands[0].rank && c.d <= cands[0].d + 1.5);
      const last = this.lastPick;
      const sameSpot = last !== null && dist(sp, last.pos) < 4 && time - last.time > 350;
      if (cycle && sameSpot && stack.length > 1) {
        const i = stack.findIndex((c) => c.id === last.id);
        if (i >= 0) hit = stack[(i + 1) % stack.length];
      }
    }
    this.lastPick = hit ? { pos: sp, id: hit.id, time } : null;
    return hit;
  }

  /** The point a drawing tool's next click is measured from, for H/V inference. */
  private snapAnchor(): V | undefined {
    const p = this.pending;
    if (p?.tool === "line") return p.start.pos;
    return undefined;
  }

  private snapAt(sp: V, anchor?: V): Snap {
    const raw = toModel(this.view, sp);
    if (this.altKey) return { pos: raw };

    let bestD = POINT_TOL;
    let hitPoint: Point | null = null;
    for (const p of points(this.sk)) {
      const d = dist(toScreen(this.view, [p.x, p.y]), sp);
      if (d < bestD) { bestD = d; hitPoint = p; }
    }
    if (hitPoint) return { pos: [hitPoint.x, hitPoint.y], pointId: hitPoint.id };

    const tol = CURVE_TOL / this.view.scale;
    let bestCurve: Snap | null = null;
    let bestCurveD = tol;
    for (const e of curves(this.sk)) {
      if (e.type === "line") {
        const a = point(this.sk, e.p1), b = point(this.sk, e.p2);
        const A: V = [a.x, a.y], B: V = [b.x, b.y];
        const pr = projectOnSegment(raw, A, B);
        const d = dist(raw, pr.point);
        if (d >= bestCurveD) continue;
        const m = mid(A, B);
        const nearMid = dist(pr.point, m) * this.view.scale < 9;
        bestCurveD = d;
        bestCurve = nearMid ? { pos: m, curveId: e.id, midpoint: true } : { pos: pr.point, curveId: e.id };
      } else {
        const c = point(this.sk, e.c);
        const C: V = [c.x, c.y];
        const r = e.type === "circle" ? e.r : arcRadius(this.sk, e);
        const ang = angleOf(sub(raw, C));
        if (e.type === "arc") {
          const s = point(this.sk, e.p1), t = point(this.sk, e.p2);
          if (!inSweep(ang, angleOf([s.x - c.x, s.y - c.y]), angleOf([t.x - c.x, t.y - c.y]))) continue;
        }
        const d = Math.abs(dist(raw, C) - r);
        if (d >= bestCurveD) continue;
        bestCurveD = d;
        bestCurve = { pos: polar(C, r, ang), curveId: e.id };
      }
    }
    if (bestCurve) return bestCurve;

    if (anchor) {
      const a = toScreen(this.view, anchor);
      const dx = Math.abs(sp[0] - a[0]), dy = Math.abs(sp[1] - a[1]);
      if (dy < 7 && dx > 14) return { pos: [raw[0], anchor[1]], axis: "h" };
      if (dx < 7 && dy > 14) return { pos: [anchor[0], raw[1]], axis: "v" };
    }
    return { pos: raw };
  }

  private markFor(s: Snap, anchor?: V): SnapMark | null {
    if (s.pointId) return { pos: s.pos, kind: "point" };
    if (s.curveId) return { pos: s.pos, kind: s.midpoint ? "mid" : "curve" };
    if (s.axis) return { pos: s.pos, kind: s.axis, from: anchor };
    return null;
  }

  // ---- drawing tools ------------------------------------------------------------

  /** Turns a snap into a real point, creating it if the click was on empty space. */
  private materialize(s: Snap, autos: ConstraintDraft[], standalone = false): Id {
    if (s.pointId) return s.pointId;
    const p = addPoint(this.sk, s.pos[0], s.pos[1], standalone);
    if (s.curveId) {
      autos.push(s.midpoint ? { type: "midpoint", p: p.id, l: s.curveId } : { type: "pointOn", p: p.id, on: s.curveId });
    }
    return p.id;
  }

  /**
   * Adds the constraints a drawing tool inferred, keeping each one only if the
   * sketch still solves cleanly with it, then records the edit.
   */
  private finishDrawing(autos: ConstraintDraft[]): void {
    const baseline = this.solver.solve(this.sk);
    for (const a of autos) {
      const c = addConstraint(this.sk, a);
      const r = this.solver.solve(this.sk);
      if (!r.ok || r.conflicting.length > baseline.conflicting.length || r.redundant.length > baseline.redundant.length) {
        this.sk.constraints = this.sk.constraints.filter((x) => x !== c);
      }
    }
    this.solve();
    this.commit();
  }

  private toolClick(sp: V): void {
    const snap = this.snapAt(sp, this.snapAnchor());
    const autos: ConstraintDraft[] = [];
    const p = this.pending;

    if (this.tool === "point") {
      if (snap.pointId) return;
      this.materialize(snap, autos, true);
      this.finishDrawing(autos);
      return;
    }

    if (this.tool === "line" || this.tool === "centerline" || this.tool === "arrow") {
      if (!p || p.tool !== "line") {
        this.pending = { tool: "line", start: snap };
        return;
      }
      const s = p.start;
      const samePoint = snap.pointId !== undefined && snap.pointId === s.pointId;
      if (samePoint || dist(toScreen(this.view, s.pos), toScreen(this.view, snap.pos)) < 3) return; // no length yet
      const a = this.materialize(s, autos);
      const b = this.materialize(snap, autos);
      const line = addLine(this.sk, a, b);
      if (this.tool === "centerline") line.centre = true;
      if (this.tool === "arrow") {
        line.arrow = "end";
        this.selection = new Set([line.id]);
      }
      let axis = snap.axis;
      if (!axis && snap.pointId) {
        // Ending on an existing joint, such as when closing a rectangle: still
        // take the hint if the line came out level or upright.
        const from = toScreen(this.view, s.pos), to = toScreen(this.view, snap.pos);
        const dx = Math.abs(to[0] - from[0]), dy = Math.abs(to[1] - from[1]);
        if (dy < 7 && dx > 14) axis = "h";
        else if (dx < 7 && dy > 14) axis = "v";
      }
      if (axis) autos.push({ type: axis === "h" ? "horizontal" : "vertical", a, b });
      // One line per pair of clicks: the next click starts a new one.
      this.pending = null;
      this.finishDrawing(autos);
      // An arrow's name is typed right away, where it will sit; clicking on leaves it without one.
      if (line.arrow) this.openEditor({ kind: "arrow", id: line.id });
      return;
    }

    if (this.tool === "circle") {
      if (!p || p.tool !== "circle") {
        this.pending = { tool: "circle", center: snap };
        return;
      }
      const r = dist(p.center.pos, snap.pos);
      if (r * this.view.scale < 3) return;
      const c = this.materialize(p.center, autos);
      const circle = addCircle(this.sk, c, r);
      if (snap.pointId && snap.pointId !== c) autos.push({ type: "pointOn", p: snap.pointId, on: circle.id });
      this.pending = null;
      this.finishDrawing(autos);
      return;
    }

    if (this.tool === "arc" || this.tool === "arcarrow") {
      if (!p || p.tool !== "arc") {
        this.pending = { tool: "arc", center: snap, sweep: 0, lastAng: 0 };
        return;
      }
      if (!p.start) {
        if (dist(p.center.pos, snap.pos) * this.view.scale < 3) return;
        p.start = snap;
        p.lastAng = angleOf(sub(snap.pos, p.center.pos));
        p.sweep = 0;
        return;
      }
      const r = dist(p.center.pos, p.start.pos);
      const endAng = angleOf(sub(snap.pos, p.center.pos));
      const c = this.materialize(p.center, autos);
      const s = this.materialize(p.start, autos);
      let e: Id;
      if (snap.pointId && snap.pointId !== s && snap.pointId !== c) e = snap.pointId;
      else {
        const q = polar(p.center.pos, r, endAng);
        e = addPoint(this.sk, q[0], q[1]).id;
      }
      // Arcs are kept counter-clockwise, so one swept clockwise has its ends swapped.
      const arc = p.sweep >= 0 ? addArc(this.sk, c, s, e) : addArc(this.sk, c, e, s);
      if (this.tool === "arcarrow") {
        // The head goes on the end that was clicked last.
        arc.arrow = p.sweep >= 0 ? "end" : "start";
        this.selection = new Set([arc.id]);
      }
      this.pending = null;
      this.finishDrawing(autos);
      if (arc.arrow) this.openEditor({ kind: "arrow", id: arc.id });
    }
  }

  private setTool(t: Tool): void {
    this.tool = t;
    const home = toolDef(t).tab;
    if (home !== "both") this.tab = home;
    this.pending = null;
    this.snapMark = null;
    this.trimPlan = null;
    if (t !== "select") {
      this.selection.clear();
      this.hover = null;
    }
    this.closeEditor();
    this.touch();
  }

  // ---- trim --------------------------------------------------------------------

  /** What a trim at this screen position would remove, if there is a curve there. */
  private trimAt(sp: V): TrimPlan | null {
    const hit = this.hitTest(sp, true);
    if (!hit || hit.kind !== "curve") return null;
    return planTrim(this.sk, hit.id, toModel(this.view, sp));
  }

  private trimClick(sp: V): void {
    const plan = this.trimAt(sp);
    this.trimPlan = null;
    if (!plan) return;
    const autos = applyTrim(this.sk, plan);
    this.pruneSelection();
    this.finishDrawing(autos);
  }

  // ---- symbols ----------------------------------------------------------------

  /** A fixed support turns to face the one member that ends in it. */
  private supportAngle(kind: SupportKind, at: Id): number {
    if (kind !== "fixed") return 0;
    const attached = curves(this.sk).filter((e): e is Line => e.type === "line" && (e.p1 === at || e.p2 === at));
    if (attached.length !== 1) return 0;
    const here = point(this.sk, at);
    const far = point(this.sk, attached[0].p1 === at ? attached[0].p2 : attached[0].p1);
    return Math.atan2(far.y - here.y, far.x - here.x) - Math.PI / 2;
  }

  /** The next free part number: one more than the largest number already on a balloon. */
  private nextBalloonNumber(): string {
    let max = 0;
    for (const s of this.sk.symbols) {
      if (s.type === "balloon" && /^\d+$/.test(s.text.trim())) max = Math.max(max, Number(s.text));
    }
    return String(max + 1);
  }

  /** The next free name for a datum point: A, B, C and so on, then A_1, B_1. */
  private nextDatumName(): string {
    const used = new Set(this.sk.symbols.filter((s): s is Datum => s.type === "datum").map((s) => s.label.trim()));
    for (let round = 0; round < 50; round++) {
      for (let i = 0; i < 26; i++) {
        const name = String.fromCharCode(65 + i) + (round ? `_{${round}}` : "");
        if (!used.has(name)) return name;
      }
    }
    return "";
  }

  /** The datum mark on a point, if it has one. */
  private datumOn(pointId: Id): Datum | undefined {
    return this.sk.symbols.find((s): s is Datum => s.type === "datum" && s.at === pointId);
  }

  private symbolClick(sp: V): void {
    const tool = this.tool as SymbolTool;
    const raw = toModel(this.view, sp);

    if (tool === "frame") {
      const snap = this.snapAt(sp);
      // A handy length on screen to start with; from then on it belongs to the drawing.
      const size = this.preview ? 10 / printMm(this.sk) : 56 / this.view.scale;
      const f = addFrame(this.sk, snap.pos[0], snap.pos[1], snap.pointId, size);
      this.commit();
      this.setTool("select");
      this.selection = new Set([f.id]);
      return;
    }

    if (tool === "balloon") {
      const p = this.pending;
      if (!p || p.tool !== "balloon") {
        this.pending = { tool: "balloon", anchor: this.snapAt(sp) };
        return;
      }
      const a = p.anchor;
      // Placed on the spot it points at, the balloon needs no leader.
      const onSpot = dist(toScreen(this.view, a.pos), sp) < 6;
      const offset = onSpot ? [0, 0] : sub(raw, a.pos);
      const b = addSymbol(this.sk, {
        type: "balloon", text: this.nextBalloonNumber(), x: a.pos[0], y: a.pos[1],
        dx: offset[0], dy: offset[1], end: a.curveId || a.pointId ? "arrow" : "dot",
        ...(a.pointId ? { at: a.pointId } : a.curveId ? { on: a.curveId, t: curveParam(this.sk, a.curveId, a.pos) } : {}),
      });
      this.pending = null;
      this.commit();
      this.selection = new Set([b.id]);
      return;
    }

    if (tool === "fill") {
      const region = regionAt(this.sk, raw);
      if (!region) {
        this.toast("Click inside a closed shape. Its lines must meet at shared points.");
        return;
      }
      const same = (f: Sym) => f.type === "fill" && (region.kind === "circle"
        ? f.circle === region.circle
        : !f.circle && f.points.length === region.face.points.length && region.face.points.every((id) => f.points.includes(id)));
      const existing = this.sk.symbols.find(same);
      if (existing && existing.type === "fill") {
        existing.color = this.fillColor; // filling a filled shape recolours it
        this.selection = new Set([existing.id]);
        return this.commit();
      }
      const f = region.kind === "circle"
        ? addSymbol(this.sk, { type: "fill", color: this.fillColor, circle: region.circle, points: [], arcs: [], curves: [], holes: [] })
        : addSymbol(this.sk, { type: "fill", color: this.fillColor, points: region.face.points, arcs: region.face.arcs, curves: region.face.curves, holes: region.holes });
      this.selection = new Set([f.id]);
      return this.commit();
    }

    if (tool === "datum") {
      const snap = this.snapAt(sp);
      const autos: ConstraintDraft[] = [];
      const at = this.materialize(snap, autos, true);
      const existing = this.sk.symbols.find((x) => x.type === "datum" && x.at === at);
      if (existing) {
        this.selection = new Set([existing.id]);
        return this.toast("That point is a datum point already.");
      }
      const d = addSymbol(this.sk, {
        type: "datum", at, color: this.datumColor, label: this.nextDatumName(),
        dx: DATUM_LABEL_OFFSET[0], dy: DATUM_LABEL_OFFSET[1],
      });
      this.finishDrawing(autos);
      this.selection = new Set([d.id]);
      return;
    }

    if (tool === "centermark" || tool === "hatch") {
      const hit = this.hitTest(sp, true);
      const e = hit ? entity(this.sk, hit.id) : undefined;
      if (tool === "centermark") {
        if (!e || (e.type !== "circle" && e.type !== "arc")) return this.toast("Click a circle or an arc.");
        if (this.sk.symbols.some((x) => x.type === "centermark" && x.on === e.id)) return this.toast("That one already has centre lines.");
        const c = addSymbol(this.sk, { type: "centermark", on: e.id, angle: 0 });
        this.selection = new Set([c.id]);
        return this.commit();
      }
      if (!e || e.type === "point") return this.toast("Click a line, an arc or a circle.");
      // The hatching goes on the side of the curve the click was on.
      const side = sideOfCurve(this.sk, e.id, raw) >= 0 ? 1 : -1;
      const h = addSymbol(this.sk, { type: "hatch", on: e.id, side, ...DEFAULT_HATCH });
      this.selection = new Set([h.id]);
      return this.commit();
    }

    // Supports
    const snap = this.snapAt(sp);
    if (!snap.pointId && !snap.curveId) {
      this.toast("Click a joint, or a spot on a line, to put the support there.");
      return;
    }
    const kind: SupportKind = tool === "wall" ? "fixed" : (tool as "pin" | "roller");
    const autos: ConstraintDraft[] = [];
    const at = this.materialize(snap, autos, true);
    // One support per joint: a new one replaces what was there.
    this.sk.symbols = this.sk.symbols.filter((s) => !(s.type === "support" && s.at === at));
    addSupport(this.sk, kind, at, this.supportAngle(kind, at));
    this.finishDrawing(autos);
  }

  /** Where a drag of a symbol starts from: its position, or for a balloon its offset. */
  private symbolDragOrigin(s: Sym): V {
    return s.type === "balloon" || s.type === "datum" ? [s.dx, s.dy] : symbolPosition(this.sk, s);
  }

  private dragSymbol(d: Extract<DragState, { kind: "sym" }>, sp: V): void {
    const s = symbol(this.sk, d.id);
    if (!s) return;
    const m = toModel(this.view, sp);
    const mm = this.mm();
    const snapAngle = (a: number) => (this.altKey ? a : Math.round(a / (15 * DEG)) * 15 * DEG);

    if (s.type === "support" || s.type === "centermark") {
      const centre = symbolPosition(this.sk, s);
      if (dist(m, centre) * this.view.scale < 6) return;
      const dir = sub(m, centre);
      // A support's ground side follows the pointer; a centre mark's first line points at it.
      s.angle = snapAngle(s.type === "support" ? Math.atan2(dir[0], -dir[1]) : angleOf(dir));
    } else if (s.type === "balloon" || s.type === "datum") {
      // The balloon, or the datum's name, moves; what it belongs to stays. A
      // balloon is placed in the drawing; a name keeps its distance in annotation mm.
      const moved = mul(sub(m, d.startModel), s.type === "balloon" ? 1 : mm);
      s.dx = d.origin[0] + moved[0];
      s.dy = d.origin[1] + moved[1];
    } else if (s.type === "hatch") {
      // Pulling away from the curve sets how deep the strokes reach, and on which side.
      const off = sideOfCurve(this.sk, s.on, m) * mm;
      s.side = off >= 0 ? 1 : -1;
      s.depth = Math.max(0.5, Math.min(20, Math.round(Math.abs(off) * 10) / 10));
    } else if (s.type === "frame") {
      // Axes move freely; dropped on a joint they pin to it.
      const pos = add(d.origin, sub(m, d.startModel));
      const screenPos = toScreen(this.view, pos);
      const near = points(this.sk).find((p) => dist(toScreen(this.view, [p.x, p.y]), screenPos) < POINT_TOL);
      if (near && !this.altKey) {
        s.at = near.id;
        s.x = near.x;
        s.y = near.y;
      } else {
        delete s.at;
        s.x = pos[0];
        s.y = pos[1];
      }
    }
  }

  /** Pulls the tip of an axis along its own direction to set its length. */
  private dragAxis(d: Extract<DragState, { kind: "axis" }>, sp: V): void {
    const s = symbol(this.sk, d.id);
    if (!s || s.type !== "frame") return;
    const mm = this.mm();
    const o = mul(symbolPosition(this.sk, s), mm);
    const q = mul(toModel(this.view, sp), mm);
    const ang = s.angle + (d.axis === "y" ? Math.PI / 2 : 0);
    const size = dot(sub(q, o), [Math.cos(ang), Math.sin(ang)]) - d.slack;
    // Kept in the drawing's units, and never shorter than the arrowhead it carries.
    const length = Math.max(2 * PAPER.arrowLen, size) / mm;
    if (d.axis === "x") s.xSize = length;
    else s.ySize = length;
  }

  /** True when a screen position is on one of the four ends of a centre mark. */
  private centerMarkEndAt(s: Sym, sp: V): boolean {
    if (s.type !== "centermark") return false;
    const mm = this.mm();
    return centerMarkEnds(this.sk, s, mm).some((e) => dist(toScreen(this.view, [e[0] / mm, e[1] / mm]), sp) < 10);
  }

  /** Pulls an end of a centre mark in or out, which scales the whole mark. */
  private dragReach(id: Id, sp: V): void {
    const s = symbol(this.sk, id);
    if (!s || s.type !== "centermark") return;
    const mm = this.mm();
    const f = roundFrame(this.sk, s.on, mm);
    if (!f) return;
    const over = dist(mul(toModel(this.view, sp), mm), f.c) - f.r;
    let scale = over / PAPER.centreOver;
    if (!this.altKey) scale = Math.round(scale * 20) / 20; // steps of 0.05, unless Alt is held
    s.scale = Math.max(0.2, Math.min(10, scale));
  }

  /** Which axis tip of a pair of axes is under a screen position, if any. */
  private axisTipAt(s: Sym, sp: V, hit: Hit): { axis: "x" | "y"; slack: number } | null {
    if (s.type !== "frame") return null;
    const mm = this.mm();
    const tips = frameTips(this.sk, s, mm);
    const o = mul(symbolPosition(this.sk, s), mm);
    const q = mul(toModel(this.view, sp), mm);
    for (const axis of ["x", "y"] as const) {
      const tip = tips[axis];
      if (!tip) continue;
      const near = dist(toScreen(this.view, [tip[0] / mm, tip[1] / mm]), sp) < 10;
      // The label sits at the tip, so grabbing it pulls the tip too.
      if (!near && !(hit.text && hit.part === axis)) continue;
      const dir = norm(sub(tip, o));
      return { axis, slack: dot(sub(q, o), dir) - dist(tip, o) };
    }
    return null;
  }

  private rotateSelected(by: number): void {
    let turned = false;
    for (const id of this.selection) {
      const s = symbol(this.sk, id);
      if (s && (s.type === "support" || s.type === "frame" || s.type === "centermark")) {
        s.angle = wrap(s.angle + by + Math.PI) - Math.PI;
        turned = true;
      }
    }
    if (turned) this.commit();
  }

  // ---- pointer --------------------------------------------------------------

  private screenPos(ev: PointerEvent | WheelEvent | MouseEvent): V {
    const r = this.svg.getBoundingClientRect();
    return [ev.clientX - r.left, ev.clientY - r.top];
  }

  private onPointerDown(ev: PointerEvent): void {
    const sp = this.screenPos(ev);
    this.cursor = sp;
    this.altKey = ev.altKey;
    const wasEditing = this.editing !== null;
    if (wasEditing) this.commitEditor();
    // Working on the canvas ends any typing in the panels.
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused !== document.body) focused.blur();
    this.svg.setPointerCapture(ev.pointerId);

    if (ev.button === 1 || ev.button === 2 || (ev.button === 0 && this.spaceKey)) {
      this.drag = { kind: "pan", last: sp, moved: false, quiet: wasEditing };
      this.render();
      return;
    }
    if (ev.button !== 0) return;

    if (isCommand(this.tool)) {
      this.commandClick(sp);
      this.touch();
      return;
    }
    if (isSymbolTool(this.tool)) {
      this.symbolClick(sp);
      this.updateSnapMark();
      this.touch();
      return;
    }
    if (this.tool === "trim") {
      this.trimClick(sp);
      this.touch();
      return;
    }
    if (this.tool !== "select") {
      this.toolClick(sp);
      this.updateSnapMark();
      this.render();
      return;
    }

    const hit = this.pickAt(sp, ev.timeStamp, !ev.shiftKey);
    if (!hit || hit.kind === "fill") {
      // On a fill, a drag still draws a selection box; only a plain click picks the fill.
      this.drag = { kind: "box", a: sp, b: sp, additive: ev.shiftKey, click: hit?.id };
      return;
    }
    if (ev.shiftKey) {
      if (this.selection.has(hit.id)) this.selection.delete(hit.id);
      else this.selection.add(hit.id);
      this.touch();
      return;
    }
    const wasSelected = this.selection.has(hit.id);
    if (!wasSelected) this.selection = new Set([hit.id]);

    if (hit.kind === "dim") {
      this.drag = { kind: "dim", id: hit.id, startScreen: sp, moved: false, onText: hit.text === true };
    } else if (hit.kind === "sym") {
      const s = symbol(this.sk, hit.id)!;
      const tip = this.axisTipAt(s, sp, hit);
      if (tip) {
        const edit: EditTarget | undefined = hit.text ? { kind: "axis", id: hit.id, axis: tip.axis } : undefined;
        this.drag = { kind: "axis", id: hit.id, axis: tip.axis, startScreen: sp, slack: tip.slack, moved: false, edit };
      } else if (s.type === "centermark" && this.centerMarkEndAt(s, sp)) {
        this.drag = { kind: "reach", id: hit.id, startScreen: sp, moved: false };
      } else if (s.type === "datum" && hit.part !== "label") {
        // The dot is the point itself: dragging it moves the geometry.
        this.selection = new Set([s.at]);
        this.drag = this.startMove(s.at, sp, false);
      } else {
        const edit: EditTarget | undefined = !hit.text ? undefined
          : s.type === "balloon" ? { kind: "balloon", id: hit.id }
          : s.type === "datum" ? { kind: "datum", id: hit.id } : undefined;
        this.drag = { kind: "sym", id: hit.id, startScreen: sp, startModel: toModel(this.view, sp), origin: this.symbolDragOrigin(s), moved: false, edit };
      }
    } else if (hit.kind === "curve" && hit.part === "label") {
      // The name of an arrow: it moves on its own, the arrow stays.
      const e = entity(this.sk, hit.id) as Line | Arc;
      const mm = this.mm();
      const origin = sub(arrowLabelAt(this.sk, e, mm) ?? [0, 0], arrowAnchor(this.sk, e, mm));
      this.drag = { kind: "label", id: hit.id, startScreen: sp, startModel: toModel(this.view, sp), origin, moved: false, edit: { kind: "arrow", id: hit.id } };
    } else if (hit.kind !== "glyph") {
      this.drag = this.startMove(hit.id, sp, wasSelected && this.selection.size > 1);
    }
    this.touch();
  }

  private startMove(grabbed: Id, sp: V, collapse: boolean): DragState {
    const ids = new Set<Id>();
    let rim: Id | undefined;
    const selected = [...this.selection].map((id) => entity(this.sk, id)).filter((e) => e !== undefined);
    if (selected.length === 1 && (selected[0].type === "circle" || selected[0].type === "arc")) {
      rim = selected[0].id;
    } else {
      for (const e of selected) {
        if (e.type === "point") ids.add(e.id);
        else curvePoints(e).forEach((p) => ids.add(p));
      }
    }
    const targets = [...ids].map((id) => { const p = point(this.sk, id); return { id, x: p.x, y: p.y }; });
    return { kind: "move", grabbed, startScreen: sp, startModel: toModel(this.view, sp), targets, rim, moved: false, collapse };
  }

  private onPointerMove(ev: PointerEvent): void {
    const sp = this.screenPos(ev);
    this.cursor = sp;
    this.altKey = ev.altKey;
    const d = this.drag;

    if (d?.kind === "pan") {
      const dx = sp[0] - d.last[0], dy = sp[1] - d.last[1];
      if (Math.abs(dx) + Math.abs(dy) > 0) d.moved = true;
      this.view.cx -= dx / this.view.scale;
      this.view.cy += dy / this.view.scale;
      d.last = sp;
    } else if (d?.kind === "box") {
      d.b = sp;
    } else if (d?.kind === "move") {
      if (!d.moved && dist(sp, d.startScreen) < 3) return;
      d.moved = true;
      const m = toModel(this.view, sp);
      const delta = sub(m, d.startModel);
      const drags: Drag[] = d.rim
        ? [{ kind: "rim", id: d.rim, x: m[0], y: m[1] }]
        : d.targets.map((t) => ({ kind: "point", id: t.id, x: t.x + delta[0], y: t.y + delta[1] }));
      this.solve(drags);
      this.chromeDirty = true;
    } else if (d?.kind === "dim") {
      if (!d.moved && dist(sp, d.startScreen) < 3) return;
      d.moved = true;
      this.dragDimension(d.id, sp);
    } else if (d?.kind === "sym") {
      if (!d.moved && dist(sp, d.startScreen) < 3) return;
      d.moved = true;
      this.dragSymbol(d, sp);
    } else if (d?.kind === "axis") {
      if (!d.moved && dist(sp, d.startScreen) < 3) return;
      d.moved = true;
      this.dragAxis(d, sp);
      this.chromeDirty = true;
    } else if (d?.kind === "reach") {
      if (!d.moved && dist(sp, d.startScreen) < 3) return;
      d.moved = true;
      this.dragReach(d.id, sp);
      this.chromeDirty = true;
    } else if (d?.kind === "label") {
      if (!d.moved && dist(sp, d.startScreen) < 3) return;
      d.moved = true;
      const l = entity(this.sk, d.id);
      if (l?.type === "line" || l?.type === "arc") {
        const moved = mul(sub(toModel(this.view, sp), d.startModel), this.mm());
        l.lx = d.origin[0] + moved[0];
        l.ly = d.origin[1] + moved[1];
      }
    } else if (this.tool === "select") {
      this.hover = this.hitTest(sp)?.id ?? null;
    } else if (isCommand(this.tool)) {
      this.hover = this.hitTest(sp, true)?.id ?? null;
    } else if (this.tool === "trim") {
      this.trimPlan = this.trimAt(sp);
    } else {
      const p = this.pending;
      if (p?.tool === "arc" && p.start) {
        const ang = angleOf(sub(toModel(this.view, sp), p.center.pos));
        let step = ang - p.lastAng;
        if (step > Math.PI) step -= TWO_PI;
        if (step < -Math.PI) step += TWO_PI;
        p.sweep = Math.max(-TWO_PI, Math.min(TWO_PI, p.sweep + step));
        p.lastAng = ang;
      }
      this.updateSnapMark();
    }
    this.render();
  }

  private updateSnapMark(): void {
    if (this.tool === "select" || this.tool === "trim" || isCommand(this.tool)) {
      this.snapMark = null;
      return;
    }
    const anchor = this.snapAnchor();
    this.snapMark = this.markFor(this.snapAt(this.cursor, anchor), anchor);
  }

  private onPointerUp(ev: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    if (this.svg.hasPointerCapture(ev.pointerId)) this.svg.releasePointerCapture(ev.pointerId);
    if (!d) return;

    if (d.kind === "pan") {
      if (!d.moved) {
        // A press that did not pan is a click: middle confirms, right cancels.
        if (ev.button === 1 && !d.quiet) this.confirm(this.screenPos(ev));
        else if (ev.button === 2) this.cancel();
      }
    } else if (d.kind === "box") {
      this.finishBox(d);
    } else if (d.kind === "move") {
      if (d.moved) {
        this.solve();
        this.commit();
      } else if (d.collapse) {
        this.selection = new Set([d.grabbed]);
      }
    } else if (d.kind === "dim" && !d.moved && d.onText && ev.type === "pointerup") {
      // A click on the number, not a drag: type the new value where it stands.
      this.openDimEditor(d.id);
    } else if ((d.kind === "sym" || d.kind === "axis" || d.kind === "label") && !d.moved && d.edit && ev.type === "pointerup") {
      // The same for a name: a click on it, and it is typed where it stands.
      this.openEditor(d.edit);
    } else if ((d.kind === "dim" || d.kind === "sym" || d.kind === "axis" || d.kind === "label" || d.kind === "reach") && d.moved) {
      this.commit();
    }
    this.touch();
  }

  private finishBox(d: Extract<DragState, { kind: "box" }>): void {
    if (!d.additive) this.selection.clear();
    if (dist(d.a, d.b) < 3) {
      if (d.click) {
        if (d.additive && this.selection.has(d.click)) this.selection.delete(d.click);
        else this.selection.add(d.click);
      }
      return;
    }
    const x0 = Math.min(d.a[0], d.b[0]), x1 = Math.max(d.a[0], d.b[0]);
    const y0 = Math.min(d.a[1], d.b[1]), y1 = Math.max(d.a[1], d.b[1]);
    const within = (m: V) => {
      const s = toScreen(this.view, m);
      return s[0] >= x0 && s[0] <= x1 && s[1] >= y0 && s[1] <= y1;
    };
    const inside = (id: Id) => { const p = point(this.sk, id); return within([p.x, p.y]); };
    for (const e of this.sk.entities) {
      if (e.id === ORIGIN) continue;
      if (e.type === "point") {
        if (inside(e.id)) this.selection.add(e.id);
      } else if (curvePoints(e).every(inside)) {
        if (e.type === "circle") {
          const c = toScreen(this.view, [point(this.sk, e.c).x, point(this.sk, e.c).y]);
          const r = e.r * this.view.scale;
          if (c[0] - r < x0 || c[0] + r > x1 || c[1] - r < y0 || c[1] + r > y1) continue;
        }
        this.selection.add(e.id);
      }
    }
    for (const s of this.sk.symbols) if (within(symbolPosition(this.sk, s))) this.selection.add(s.id);
  }

  private onWheel(ev: WheelEvent): void {
    ev.preventDefault();
    const sp = this.screenPos(ev);
    const before = toModel(this.view, sp);
    const unit = ev.deltaMode === 1 ? 32 : 1; // lines vs pixels
    const factor = Math.exp(-ev.deltaY * unit * 0.0016);
    this.view.scale = Math.max(1e-4, Math.min(1e7, this.view.scale * factor));
    const after = toModel(this.view, sp);
    this.view.cx += before[0] - after[0];
    this.view.cy += before[1] - after[1];
    this.render();
  }

  private onDoubleClick(ev: MouseEvent): void {
    if (this.tool !== "select") return;
    const hit = this.hitTest(this.screenPos(ev));
    if (!hit) return;
    // A double-click opens the text of what was hit, also where there is no text yet to click on.
    let target: EditTarget | null = null;
    if (hit.kind === "dim") target = { kind: "dim", id: hit.id };
    else if (hit.kind === "curve") {
      const e = entity(this.sk, hit.id);
      if (e && (e.type === "line" || e.type === "arc") && e.arrow) target = { kind: "arrow", id: hit.id };
    } else if (hit.kind === "point") {
      const d = this.datumOn(hit.id);
      if (d) target = { kind: "datum", id: d.id };
    } else if (hit.kind === "sym") {
      const s = symbol(this.sk, hit.id);
      if (s?.type === "balloon" || s?.type === "datum") target = { kind: s.type, id: hit.id };
    }
    if (!target) return;
    if (target.kind === "dim") this.selection = new Set([hit.id]);
    this.openEditor(target);
    this.touch();
  }

  /** Esc and right-click: back out one level at a time. */
  private cancel(): void {
    if (this.editing) this.closeEditor();
    else if (this.pending) this.pending = null;
    else if (isCommand(this.tool) && this.selection.size) this.selection.clear();
    else if (this.tool !== "select") return this.setTool("select");
    else this.selection.clear();
    this.snapMark = null;
    this.touch();
  }

  /**
   * Middle-click: accept and move on. It places the dimension being made, ends
   * the shape being drawn, and with nothing in progress leaves the tool.
   */
  private confirm(sp: V): void {
    if (this.tool === "dimension" && this.canApply("dimension")) {
      this.placeDimension(sp);
    } else if (this.pending) {
      this.pending = null;
      this.snapMark = null;
    } else if (isCommand(this.tool) && this.picked().entities > 0) {
      this.selection.clear();
    } else if (this.tool !== "select") {
      return this.setTool("select");
    }
    this.touch();
  }

  // ---- dimensions -----------------------------------------------------------

  private dragDimension(id: Id, sp: V): void {
    const d = constraint(this.sk, id);
    if (!d || !isDimension(d)) return;
    const mm = this.mm();
    const q = mul(toModel(this.view, sp), mm);
    if (d.type === "distance") {
      const f = distanceFrame(this.sk, d, mm);
      d.offset = dot(sub(q, f.A), f.n) / mm;
    } else if (d.type === "angle") {
      const f = angleFrame(this.sk, d, mm);
      if (f) d.radius = Math.max(3, dist(q, f.vertex)) / mm;
    } else {
      // The far end of the leader follows the pointer: its direction, its
      // length, and whether it is inside the circle or outside.
      const f = roundFrame(this.sk, d.target, mm);
      if (!f) return;
      const reach = dist(q, f.c);
      if (reach < 1e-9) return;
      d.angle = angleOf(sub(q, f.c));
      // Never shorter than its own arrowhead.
      const length = (v: number) => Math.max(2, v) / mm;
      if (reach > f.r + 1) {
        d.outside = true;
        d.len = length(reach - f.r);
      } else if (reach < f.r - 1) {
        delete d.outside;
        // Close to the centre it snaps back to the usual leader from the centre.
        if (reach < Math.max(1.5, f.r * 0.12)) delete d.len;
        else d.len = length(f.r - reach);
      }
    }
  }

  /**
   * Offset, in model units, that puts a distance dimension on the outside of
   * the figure: the side of the two points that faces away from the middle of
   * the geometry, at the standard distance for the view as it is now.
   */
  private outsideOffset(a: Point, b: Point, mode: DistanceMode): number {
    const mm = this.mm();
    const box = geometryBox(this.sk);
    const centre: V = [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2];
    const A: V = [a.x, a.y], B: V = [b.x, b.y];
    const m = mid(A, B);
    if (mode === "aligned") {
      const n = perp(norm(sub(B, A)));
      const lean = dot(sub(m, centre), n);
      const side = Math.abs(lean) < 1e-9 ? (n[1] > 0 ? -1 : 1) : Math.sign(lean);
      return (side * PAPER.dimOffset) / mm;
    }
    // Horizontal dimensions sit above or below both points, vertical ones left or right.
    const i = mode === "horizontal" ? 1 : 0;
    const lo = Math.min(A[i], B[i]), hi = Math.max(A[i], B[i]);
    return m[i] <= centre[i] ? lo - A[i] - PAPER.dimOffset / mm : hi - A[i] + PAPER.dimOffset / mm;
  }

  /**
   * The dimension the current picks call for. With `at` (a model position)
   * the dimension is laid out there, and for a distance the position also
   * chooses the kind: beside the span it is aligned, above or below it
   * horizontal, left or right of it vertical. Without `at` it gets a default
   * spot outside the figure.
   */
  private dimensionDraft(at?: V): ConstraintDraft | string {
    const { pts, lines, rounds } = this.picked();
    const mm = this.mm();
    const xy = (p: Point): V => [p.x, p.y];

    if ((pts.length === 2 && !lines.length && !rounds.length) || (lines.length === 1 && !pts.length && !rounds.length)) {
      const [a, b] = pts.length === 2 ? pts : [point(this.sk, lines[0].p1), point(this.sk, lines[0].p2)];
      const A = xy(a), B = xy(b);
      const length = dist(A, B);
      if (length < 1e-9) return "Those two points are in the same place.";
      if (!at) return { type: "distance", a: a.id, b: b.id, mode: "aligned", value: length, offset: this.outsideOffset(a, b, "aligned") };

      const x0 = Math.min(A[0], B[0]), x1 = Math.max(A[0], B[0]);
      const y0 = Math.min(A[1], B[1]), y1 = Math.max(A[1], B[1]);
      const slanted = x1 - x0 > length * 0.02 && y1 - y0 > length * 0.02;
      const inX = at[0] >= x0 && at[0] <= x1, inY = at[1] >= y0 && at[1] <= y1;
      let mode: DistanceMode = "aligned";
      if (slanted && inX && !inY) mode = "horizontal";
      else if (slanted && inY && !inX) mode = "vertical";
      if (mode === "horizontal") return { type: "distance", a: a.id, b: b.id, mode, value: x1 - x0, offset: at[1] - A[1] };
      if (mode === "vertical") return { type: "distance", a: a.id, b: b.id, mode, value: y1 - y0, offset: at[0] - A[0] };
      const n = perp(norm(sub(B, A)));
      return { type: "distance", a: a.id, b: b.id, mode, value: length, offset: dot(sub(at, A), n) };
    }

    if (lines.length === 2 && !pts.length && !rounds.length) {
      let [l1, l2] = lines;
      const ends = (l: Line): [V, V] => [xy(point(this.sk, l.p1)), xy(point(this.sk, l.p2))];
      let [a1, b1] = ends(l1), [a2, b2] = ends(l2);
      const vertex = intersectLines(a1, sub(b1, a1), a2, sub(b2, a2));
      if (!vertex) return "Those lines are parallel, so there is no angle to dimension.";
      let rev1: boolean, rev2: boolean;
      const u1 = norm(sub(b1, a1)), u2 = norm(sub(b2, a2));
      const w = at ? sub(at, vertex) : null;
      if (w && dist(at!, vertex) * this.view.scale > 4) {
        // Of the four sectors the lines make, measure the one the pointer is in.
        rev1 = false;
        rev2 = false;
        for (const [r1, r2] of [[false, false], [false, true], [true, false], [true, true]]) {
          const e1 = mul(u1, r1 ? -1 : 1), e2 = mul(u2, r2 ? -1 : 1);
          const turn = cross(e1, e2);
          if (cross(e1, w) * turn >= 0 && cross(w, e2) * turn >= 0) { rev1 = r1; rev2 = r2; break; }
        }
      } else {
        // Measure along each member away from the vertex, towards its far end.
        rev1 = dist(vertex, a1) > dist(vertex, b1);
        rev2 = dist(vertex, a2) > dist(vertex, b2);
      }
      let d1 = mul(u1, rev1 ? -1 : 1), d2 = mul(u2, rev2 ? -1 : 1);
      let value = Math.atan2(cross(d1, d2), dot(d1, d2));
      if (value < 0) {
        [l1, l2] = [l2, l1];
        [rev1, rev2] = [rev2, rev1];
        [a1, b1, a2, b2] = [a2, b2, a1, b1];
        [d1, d2] = [d2, d1];
        value = -value;
      }
      if (value < 1e-6 || value > Math.PI - 1e-6) return "Those lines are in line with each other.";
      const reach = Math.min(dist(a1, b1), dist(a2, b2)) * mm;
      const radius = at ? Math.max(3, dist(at, vertex) * mm) : Math.max(6, Math.min(14, reach * 0.35));
      return { type: "angle", l1: l1.id, rev1, l2: l2.id, rev2, value, radius: radius / mm };
    }

    if (rounds.length === 1 && !pts.length && !lines.length) {
      const e = rounds[0];
      const c = point(this.sk, e.c);
      if (at && dist(at, xy(c)) > 1e-9) {
        const r = e.type === "circle" ? e.r : arcRadius(this.sk, e);
        const base = { type: "radius" as const, target: e.id, value: r, angle: angleOf(sub(at, xy(c))) };
        // Placed beyond the rim, the dimension is drawn outside and reaches to the pointer.
        const beyond = (dist(at, xy(c)) - r) * mm;
        return beyond > 1 ? { ...base, outside: true, len: Math.max(2, beyond) / mm } : base;
      }
      if (e.type === "circle") return { type: "radius", target: e.id, value: e.r, angle: Math.PI / 4 };
      const s = point(this.sk, e.p1), t = point(this.sk, e.p2);
      const a0 = angleOf([s.x - c.x, s.y - c.y]);
      const a1 = a0 + (wrap(angleOf([t.x - c.x, t.y - c.y]) - a0) || TWO_PI);
      return { type: "radius", target: e.id, value: arcRadius(this.sk, e), angle: (a0 + a1) / 2 };
    }
    return "Select a line, two points, two lines, or a circle to dimension.";
  }

  /** Creates the dimension for the current picks and opens its value for typing. */
  private createDimension(at?: V): void {
    const draft = this.dimensionDraft(at);
    if (typeof draft === "string") return this.toast(draft);
    const made = this.addManual([draft], "That dimension would over-constrain the sketch.");
    if (!made) {
      if (isCommand(this.tool)) this.selection.clear();
      return;
    }
    this.selection = new Set([made[0].id]);
    this.openDimEditor(made[0].id);
    this.touch();
  }

  private placeDimension(sp: V): void {
    this.createDimension(toModel(this.view, sp));
  }

  /** The number shown to the user: degrees for angles, plain value otherwise. */
  private shownValue(d: Dimension): string {
    return formatNumber(d.type === "angle" ? d.value / DEG : d.value);
  }

  private setDimValue(id: Id, text: string): boolean {
    const d = constraint(this.sk, id);
    if (!d || !isDimension(d)) return false;
    let v = parseNumber(text);
    if (!Number.isFinite(v)) {
      this.toast("Type a number, such as 3 or 2,5.");
      return false;
    }
    if (d.type === "angle") {
      if (v <= 0 || v >= 360) { this.toast("An angle must be between 0 and 360 degrees."); return false; }
      v *= DEG;
    } else if (d.type === "radius" || (d.type === "distance" && d.mode === "aligned")) {
      if (v <= 0) { this.toast("That value must be greater than zero."); return false; }
    } else if (v < 0) {
      this.toast("Distances cannot be negative.");
      return false;
    }
    if (Math.abs(v - d.value) < 1e-12) return true;

    const before = clone(this.sk);
    const old = d.value;
    d.value = v;
    let r = this.solver.solve(this.sk);
    if (!r.ok) {
      // A big jump can fail from the current shape; walk there in small steps.
      this.sk = clone(before);
      const dd = constraint(this.sk, id) as Dimension;
      const STEPS = 16;
      for (let k = 1; k <= STEPS; k++) {
        dd.value = old + ((v - old) * k) / STEPS;
        r = this.solver.solve(this.sk);
        if (!r.ok) break;
      }
    }
    if (!r.ok) {
      this.sk = before;
      this.solve();
      this.toast("No solution with that value. Another constraint or dimension rules it out.");
      this.touch();
      return false;
    }
    this.result = r;
    this.commit();
    this.keepInView();
    return true;
  }

  /** Refits the view when an edit left the figure off screen or tiny. */
  private keepInView(): void {
    const b = geometryBox(this.sk);
    if (boxIsEmpty(b)) return;
    const [x0, y1] = toScreen(this.view, [b.x0, b.y0]);
    const [x1, y0] = toScreen(this.view, [b.x1, b.y1]);
    const outside = x0 < 0 || y0 < 0 || x1 > this.view.w || y1 > this.view.h;
    const tiny = x1 - x0 < this.view.w * 0.15 && y1 - y0 < this.view.h * 0.15;
    if (outside || tiny) this.fit();
  }

  private openDimEditor(id: Id): void {
    this.openEditor({ kind: "dim", id });
  }

  /** The text prim that shows what an edit target holds, if it is on the drawing right now. */
  private editPrim(t: EditTarget): Extract<Prim, { k: "text" }> | undefined {
    const part = t.kind === "axis" ? t.axis : t.kind === "datum" || t.kind === "arrow" ? "label" : undefined;
    return this.prims.find((p): p is Extract<Prim, { k: "text" }> => p.k === "text" && p.ref === t.id && (part === undefined || p.part === part));
  }

  /** What an edit target holds now, as the text to put in the box; null when it no longer exists. */
  private editValue(t: EditTarget): string | null {
    if (t.kind === "dim") {
      const d = constraint(this.sk, t.id);
      // The box shows what the figure shows: the label when there is one, else the number.
      return d && isDimension(d) ? d.label?.trim() || this.shownValue(d) : null;
    }
    if (t.kind === "arrow") {
      const e = entity(this.sk, t.id);
      return e && (e.type === "line" || e.type === "arc") && e.arrow ? e.label ?? "" : null;
    }
    const s = symbol(this.sk, t.id);
    if (t.kind === "balloon") return s?.type === "balloon" ? s.text : null;
    if (t.kind === "datum") return s?.type === "datum" ? s.label : null;
    return s?.type === "frame" ? (t.axis === "x" ? s.xLabel : s.yLabel) : null;
  }

  /** Opens the box for typing on the drawing, over the text it edits. */
  private openEditor(t: EditTarget): void {
    const value = this.editValue(t);
    if (value === null) return;
    this.editing = t;
    this.dimEditor.hidden = false;
    this.editingInitial = value;
    this.dimEditor.value = value;
    this.dimEditor.setAttribute("aria-label", t.kind === "dim" ? "Dimension value or label" : "Name");
    // The prims on hand may predate the thing being edited (an arrow just drawn).
    this.prims = buildPrims(this.sk, this.mm(), { editor: !this.preview });
    this.placeEditor();
    // Focus once the click that opened it has run its course; otherwise the
    // browser's own handling of that click takes the focus or the selection back.
    this.focusTimer = window.setTimeout(() => {
      if (this.editing !== t) return;
      this.dimEditor.focus();
      this.dimEditor.select();
    }, 0);
  }

  private placeEditor(): void {
    const t = this.editing;
    if (!t) return;
    if (this.editValue(t) === null) return this.closeEditor();
    const mm = this.mm();
    const text = this.editPrim(t);
    let at: V | null = text ? textCentre(text) : null;
    if (!at) {
      // Nothing is shown yet (an empty name): the box goes where the text will appear.
      if (t.kind === "arrow") at = arrowLabelAt(this.sk, entity(this.sk, t.id) as Line | Arc, mm, true);
      else {
        const s = symbol(this.sk, t.id);
        if (s?.type === "datum") at = add(mul(symbolPosition(this.sk, s), mm), [s.dx, s.dy]);
        else if (s?.type === "balloon") at = mul(add(balloonAnchor(this.sk, s), [s.dx, s.dy]), mm);
        else if (s?.type === "frame" && t.kind === "axis") at = frameTips(this.sk, s, mm)[t.axis];
      }
    }
    if (!at) return;
    const sp = toScreen(this.view, [at[0] / mm, at[1] / mm]);
    this.dimEditor.style.left = `${sp[0]}px`;
    this.dimEditor.style.top = `${sp[1]}px`;
  }

  private commitEditor(): void {
    const t = this.editing;
    if (!t) return;
    const text = this.dimEditor.value.trim().replace(/^\$+|\$+$/g, "");
    const unchanged = text === this.editingInitial.trim();
    this.closeEditor();
    if (unchanged || this.editValue(t) === null) return this.touch();
    if (t.kind !== "dim") {
      // A name: what was typed is what is shown.
      if (t.kind === "arrow") {
        const e = entity(this.sk, t.id) as Line | Arc;
        if (text) e.label = text;
        else delete e.label;
      } else {
        const s = symbol(this.sk, t.id)!;
        if (s.type === "balloon") s.text = text;
        else if (s.type === "datum") s.label = text;
        else if (s.type === "frame" && t.kind === "axis") {
          if (t.axis === "x") s.xLabel = text;
          else s.yLabel = text;
        }
      }
      return this.commit();
    }
    const id = t.id;
    const d = constraint(this.sk, id) as Dimension;
    const label = d.label;
    if (text === "") {
      // Cleared: a label goes, and the number shows again.
      if (label) { delete d.label; this.commit(); }
    } else if (Number.isFinite(parseNumber(text))) {
      // A number drives the geometry, and replaces a label that was shown instead.
      delete d.label;
      const same = Math.abs(parseNumber(text) * (d.type === "angle" ? DEG : 1) - d.value) < 1e-12;
      const ok = this.setDimValue(id, text);
      const now = constraint(this.sk, id);
      if (!ok && label && now && isDimension(now)) now.label = label;
      else if (ok && same && label) this.commit();
    } else {
      // Anything else is a label, shown instead of the number.
      d.label = text;
      this.commit();
    }
    this.touch();
  }

  private closeEditor(): void {
    if (!this.editing) return;
    clearTimeout(this.focusTimer);
    this.editing = null;
    this.dimEditor.hidden = true;
  }

  // ---- constraint commands ------------------------------------------------------

  private picked() {
    const pts: Point[] = [], lines: Line[] = [], rounds: (Circle | Arc)[] = [], cons: Constraint[] = [], syms: Sym[] = [];
    for (const id of this.selection) {
      const e = entity(this.sk, id);
      if (e?.type === "point") pts.push(e);
      else if (e?.type === "line") lines.push(e);
      else if (e) rounds.push(e);
      else {
        const c = constraint(this.sk, id);
        if (c) cons.push(c);
        const s = symbol(this.sk, id);
        if (s) syms.push(s);
      }
    }
    return { pts, lines, rounds, cons, syms, entities: pts.length + lines.length + rounds.length };
  }

  /** True when the picked geometry is exactly what the command needs. */
  private canApply(cmd: Command): boolean {
    const { pts, lines, rounds } = this.picked();
    const P = pts.length, L = lines.length, R = rounds.length;
    switch (cmd) {
      case "horizontal":
      case "vertical":
        return (L >= 1 && P === 0 && R === 0) || (P === 2 && L === 0 && R === 0);
      case "parallel": return L >= 2 && P === 0 && R === 0;
      case "perpendicular": return L === 2 && P === 0 && R === 0;
      case "equal": return (L >= 2 && P === 0 && R === 0) || (R >= 2 && P === 0 && L === 0);
      case "coincident": return (P === 2 && L + R === 0) || (P === 1 && L + R === 1);
      case "midpoint": return P === 1 && L === 1 && R === 0;
      case "tangent": return L === 1 && R === 1 && P === 0;
      case "fixed": return P >= 1 && L + R === 0;
      case "dimension":
        return (P === 2 && L + R === 0) || (L === 1 && P + R === 0) || (L === 2 && P + R === 0) || (R === 1 && P + L === 0);
    }
  }

  /** True when one more pick could complete what the command needs. */
  private couldGrow(cmd: Command): boolean {
    const { pts, lines, rounds } = this.picked();
    const P = pts.length, L = lines.length, R = rounds.length;
    const only = (n: number) => n === 1 && P + L + R === 1;
    switch (cmd) {
      case "horizontal":
      case "vertical":
      case "dimension":
        return only(P);
      case "parallel":
      case "perpendicular":
        return only(L);
      case "equal": return only(L) || only(R);
      case "coincident": return P + L + R === 1;
      case "midpoint": return only(P) || only(L);
      case "tangent": return only(L) || only(R);
      case "fixed": return false;
    }
  }

  /**
   * A click while a constraint or the dimension command is the active tool:
   * the geometry under it joins the picks, and the command runs as soon as it
   * has what it needs.
   */
  private commandClick(sp: V): void {
    const cmd = this.tool as Command;
    const info = toolDef(cmd);
    // Picks are geometry; a dimension left selected by the last placement is dropped.
    for (const id of [...this.selection]) if (!entity(this.sk, id)) this.selection.delete(id);

    const hit = this.hitTest(sp, true);
    if (!hit) {
      if (cmd === "dimension" && this.canApply(cmd)) this.placeDimension(sp);
      else this.selection.clear();
      return;
    }
    if (this.selection.has(hit.id)) {
      this.selection.delete(hit.id); // clicking a pick again takes it back
      return;
    }
    this.selection.add(hit.id);
    const ready = () => this.canApply(cmd);
    if (!ready() && !this.couldGrow(cmd)) {
      // The new pick does not go with the earlier ones: start over from it.
      this.selection = new Set([hit.id]);
      if (!ready() && !this.couldGrow(cmd)) {
        this.selection.clear();
        this.toast(`${info.label} needs ${info.need}.`);
        return;
      }
    }
    // A dimension waits to be placed; everything else applies at once.
    if (cmd !== "dimension" && ready()) {
      this.run(cmd);
      this.selection.clear();
    }
  }

  /**
   * A constraint button or its key. With fitting geometry already selected it
   * applies straight away; otherwise it becomes the tool and waits for picks.
   */
  private activate(cmd: Command): void {
    if (this.tool === "select" && this.picked().entities > 0 && this.canApply(cmd)) {
      if (cmd === "dimension") this.createDimension();
      else this.run(cmd);
      return;
    }
    this.setTool(cmd);
  }

  /**
   * Adds constraints the user asked for. If the sketch no longer solves, or
   * they add nothing new, the sketch is put back and the reason is shown.
   */
  private addManual(drafts: ConstraintDraft[], redundantMessage = "The sketch is already constrained that way.", replacing: Id[] = []): Constraint[] | null {
    const before = clone(this.sk);
    const baseline = this.result;
    // Constraints the new ones say again, and more: they are taken out so the new ones are not refused as repeats.
    if (replacing.length) this.sk.constraints = this.sk.constraints.filter((c) => !replacing.includes(c.id));
    const made = drafts.map((d) => addConstraint(this.sk, d));
    const r = this.solver.solve(this.sk);
    let problem: string | null = null;
    if (r.conflicting.length > baseline.conflicting.length) problem = "That conflicts with constraints already in the sketch.";
    else if (!r.ok) problem = "The solver could not satisfy that constraint from the current shape.";
    else if (r.redundant.length > baseline.redundant.length) problem = redundantMessage;
    if (problem) {
      this.sk = before;
      this.solve();
      this.toast(problem);
      this.touch();
      return null;
    }
    this.result = r;
    this.commit();
    return made;
  }

  /** Applies a constraint to the picked geometry. */
  private run(cmd: Exclude<Command, "dimension">): void {
    const info = toolDef(cmd);
    if (!this.canApply(cmd)) {
      this.toast(`${info.label} needs ${info.need}.`);
      return;
    }
    const { pts, lines, rounds } = this.picked();
    const drafts: ConstraintDraft[] = [];
    const replacing: Id[] = [];
    switch (cmd) {
      case "horizontal":
      case "vertical":
        if (lines.length) lines.forEach((l) => drafts.push({ type: cmd, a: l.p1, b: l.p2 }));
        else drafts.push({ type: cmd, a: pts[0].id, b: pts[1].id });
        break;
      case "parallel":
        // Chained pair by pair, so no line collects a marker for every other line.
        lines.slice(1).forEach((l, i) => drafts.push({ type: "parallel", l1: lines[i].id, l2: l.id }));
        break;
      case "perpendicular":
        drafts.push({ type: "perpendicular", l1: lines[0].id, l2: lines[1].id });
        break;
      case "equal": {
        const items: Curve[] = lines.length ? lines : rounds;
        items.slice(1).forEach((e, i) => drafts.push({ type: "equal", a: items[i].id, b: e.id }));
        break;
      }
      case "coincident":
        if (pts.length === 2) drafts.push({ type: "coincident", a: pts[0].id, b: pts[1].id });
        else {
          const on = lines[0] ?? rounds[0];
          if (curvePoints(on).includes(pts[0].id)) return this.toast("That point already belongs to the curve.");
          drafts.push({ type: "pointOn", p: pts[0].id, on: on.id });
        }
        break;
      case "midpoint":
        if (curvePoints(lines[0]).includes(pts[0].id)) return this.toast("An endpoint cannot be the midpoint of its own line.");
        drafts.push({ type: "midpoint", p: pts[0].id, l: lines[0].id });
        // A point already held on the line (a member that ends on it, say) is promoted to its midpoint.
        for (const c of this.sk.constraints) {
          if (c.type === "pointOn" && c.p === pts[0].id && c.on === lines[0].id) replacing.push(c.id);
        }
        break;
      case "tangent":
        drafts.push({ type: "tangent", l: lines[0].id, c: rounds[0].id });
        break;
      case "fixed": {
        const movable = pts.filter((p) => p.id !== ORIGIN);
        if (!movable.length) return this.toast("The origin is always fixed.");
        const loose = movable.filter((p) => !isFixed(this.sk, p.id));
        if (!loose.length) {
          // Every picked point is fixed already: the command releases them.
          const ids = new Set(movable.map((p) => p.id));
          this.sk.constraints = this.sk.constraints.filter((c) => !(c.type === "fixed" && ids.has(c.p)));
          this.solve();
          this.commit();
          return;
        }
        loose.forEach((p) => drafts.push({ type: "fixed", p: p.id }));
        break;
      }
    }
    this.addManual(drafts, undefined, replacing);
  }

  private deleteSelection(): void {
    if (!this.selection.size) return;
    const onlyOrigin = this.selection.size === 1 && this.selection.has(ORIGIN);
    if (onlyOrigin) return this.toast("The origin cannot be deleted.");
    remove(this.sk, this.selection);
    this.selection.clear();
    this.hover = null;
    this.solve();
    this.commit();
  }

  // ---- history, files, view -------------------------------------------------

  private undo(): void {
    const sk = this.history.undo();
    if (!sk) return;
    this.replaceSketch(sk);
    this.autosave();
    this.touch();
  }

  private redo(): void {
    const sk = this.history.redo();
    if (!sk) return;
    this.replaceSketch(sk);
    this.autosave();
    this.touch();
  }

  private newSketch(): void {
    this.selection.clear();
    this.replaceSketch(emptySketch());
    this.commit();
    this.fit();
  }

  private save(): void {
    this.download("sketch.json", serialize(this.sk), "application/json");
  }

  private download(name: string, text: string, type: string): void {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /**
   * Saves an exported file under a name the user chooses. Where the browser
   * has a save dialog it is used, so the folder can be picked too; elsewhere
   * the name is asked for here and the file is downloaded.
   */
  private async saveAs(text: string, ext: string, mime: string, what: string): Promise<void> {
    const clean = (name: string) => {
      let base = name.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, "");
      if (base.toLowerCase().endsWith(ext)) base = base.slice(0, -ext.length);
      return base.replace(/[. ]+$/, "");
    };
    const remember = (base: string) => {
      this.exportName = base;
      try { localStorage.setItem(EXPORT_NAME_KEY, base); } catch { /* storage unavailable */ }
    };
    type SaveHandle = { name: string; createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }> };
    const picker = (window as unknown as { showSaveFilePicker?: (o: object) => Promise<SaveHandle> }).showSaveFilePicker;
    if (picker) {
      try {
        const handle = await picker.call(window, { suggestedName: this.exportName + ext, types: [{ description: what, accept: { [mime]: [ext] } }] });
        const out = await handle.createWritable();
        await out.write(text);
        await out.close();
        remember(clean(handle.name) || this.exportName);
        return this.toast(`Saved ${handle.name}.`);
      } catch (err) {
        if ((err as DOMException)?.name === "AbortError") return; // the dialog was cancelled
        // The dialog is not allowed here (an embedded page, say): fall through to a download.
      }
    }
    const typed = await this.askName(ext, what);
    if (typed === null) return;
    const base = clean(typed) || "figure";
    remember(base);
    this.download(base + ext, text, mime);
  }

  /** Asks for a file name in a small dialog. Resolves to null when it is cancelled. */
  private askName(ext: string, what: string): Promise<string | null> {
    const dialog = $<HTMLDialogElement>("#name-dialog");
    const input = $<HTMLInputElement>("#name-input");
    $("#name-title").textContent = `Export ${what}`;
    $("#name-ext").textContent = ext;
    input.value = this.exportName;
    return new Promise((resolve) => {
      dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok" ? input.value : null), { once: true });
      dialog.returnValue = "";
      dialog.showModal();
      input.select();
    });
  }

  /** Exports the figure. `how` picks the format and whether it is saved or copied. */
  private async exportFigure(how: "svg" | "tikz" | "copy-tikz"): Promise<void> {
    const text = how === "svg" ? toSvg(this.sk) : toTikz(this.sk);
    if (!text) return this.toast("There is nothing to export yet.");
    if (how === "svg") return this.saveAs(text, ".svg", "image/svg+xml", "SVG image");
    if (how === "tikz") return this.saveAs(text, ".tex", "text/x-tex", "TikZ picture");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // No clipboard access (an old browser, or a page not allowed to use it): copy through a text box.
      const box = document.createElement("textarea");
      box.value = text;
      box.style.position = "fixed";
      box.style.opacity = "0";
      document.body.appendChild(box);
      box.select();
      const ok = document.execCommand("copy");
      box.remove();
      if (!ok) return this.toast("Copying is blocked here. Use Export TikZ to save the file instead.");
    }
    this.toast("TikZ copied. Paste it into your document.");
  }

  private async open(file: File): Promise<void> {
    try {
      const sk = deserialize(await file.text());
      this.selection.clear();
      this.replaceSketch(sk);
      this.commit();
      this.fit();
    } catch (err) {
      this.toast(err instanceof SyntaxError ? "That file is not valid JSON." : (err as Error).message);
    }
  }

  private resize(): void {
    const r = this.stage.getBoundingClientRect();
    this.view.w = Math.max(50, r.width);
    this.view.h = Math.max(50, r.height);
    this.svg.setAttribute("viewBox", `0 0 ${this.view.w} ${this.view.h}`);
    this.render();
  }

  /** Zooms so the whole figure, with room for its dimensions, is in view. */
  private fit(): void {
    // Keep the figure clear of the title block in the bottom corner.
    const reserved = Math.min(this.titleblock.offsetHeight + 20, this.view.h / 3);
    const usable = this.view.h - reserved;
    // Twice: how much room axes take in the drawing depends on the zoom being worked out.
    for (let pass = 0; pass < 2; pass++) {
      const mm = this.mm();
      const b = geometryBox(this.sk);
      // Axes and balloons placed away from the geometry belong in view too.
      for (const s of this.sk.symbols) {
        if (s.type === "frame") grow(b, symbolPosition(this.sk, s), boxIsEmpty(b) ? 0 : Math.max(s.xSize, s.ySize));
        if (s.type === "balloon") grow(b, add(balloonAnchor(this.sk, s), [s.dx, s.dy]));
      }
      if (boxIsEmpty(b) || (b.x1 - b.x0 < 1e-9 && b.y1 - b.y0 < 1e-9)) {
        this.view.cx = 0;
        this.view.cy = 0;
        this.view.scale = DEFAULT_SCALE;
        break;
      }
      const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
      if (this.preview) {
        // Annotations grow with the view here, so the room they need is a share of the figure.
        const margin = 18 / mm;
        this.view.scale = Math.min(this.view.w / (bw + 2 * margin), usable / (bh + 2 * margin));
      } else {
        // While editing they keep their size on screen, so the room is a fixed number of pixels.
        const pad = 18 * EDIT_PX_PER_MM * this.editScale;
        const fitTo = (px: number, extent: number) => (extent > 1e-9 ? Math.max(px - 2 * pad, px * 0.25) / extent : Infinity);
        this.view.scale = Math.min(fitTo(this.view.w, bw), fitTo(usable, bh));
      }
      this.view.cx = (b.x0 + b.x1) / 2;
      this.view.cy = (b.y0 + b.y1) / 2 - reserved / 2 / this.view.scale;
    }
    this.render();
  }

  /**
   * Switches the print preview on or off. Going in, the view is fitted to the
   * figure as it prints; coming back, it returns to where it was.
   */
  private setPreview(on: boolean): void {
    if (on === this.preview) return;
    this.closeEditor();
    this.preview = on;
    if (on) {
      this.viewBeforePreview = { ...this.view };
      this.fit();
    } else if (this.viewBeforePreview) {
      const { cx, cy, scale } = this.viewBeforePreview;
      Object.assign(this.view, { cx, cy, scale });
      this.viewBeforePreview = null;
    }
    this.touch();
  }

  // ---- chrome ---------------------------------------------------------------

  private buildToolbars(): void {
    $("#tabs").innerHTML = (["sketch", "annotate"] as Tab[]).map((t) =>
      `<button type="button" role="tab" class="tab" data-tab="${t}" id="tab-${t}" aria-controls="ribbon">${t === "sketch" ? "Sketch" : "Annotate"}</button>`,
    ).join("");
    $("#view-actions").innerHTML =
      `<button type="button" class="icon-btn" data-act="undo" aria-label="Undo" title="Undo (Ctrl+Z)">${icon("undo")}</button>` +
      `<button type="button" class="icon-btn" data-act="redo" aria-label="Redo" title="Redo (Ctrl+Y)">${icon("redo")}</button>` +
      `<span class="rule"></span>` +
      `<div class="menu">` +
      `<button type="button" class="icon-btn" id="view-btn" data-menu="view" aria-label="View settings" title="View settings" aria-haspopup="true" aria-expanded="false" aria-controls="view-list">${icon("sliders")}</button>` +
      `<div class="menu-list popover" id="view-list" role="group" aria-labelledby="view-btn" hidden>` +
      `<label class="pop-row" title="Double-click for 100%."><span>Dimension size while editing</span>` +
      `<span class="pop-ctl"><input id="edit-scale" type="range" min="${EDIT_SCALE_MIN}" max="${EDIT_SCALE_MAX}" step="5" value="100"><output id="edit-scale-out" for="edit-scale">100%</output></span></label>` +
      `<p class="pop-note">How large text, arrows and symbols look on screen while you draw. The size in print is set in the corner box.</p>` +
      `<p class="pop-note pop-build">${esc(buildLabel())}</p>` +
      `</div></div>` +
      `<button type="button" class="icon-btn" data-act="preview" aria-label="Print preview" title="Print preview: hide everything that is not exported (Q)">${icon("eye")}</button>` +
      `<button type="button" class="icon-btn" data-act="origin" aria-label="Show origin axes" title="Show or hide the axes at the origin">${icon("frame")}</button>` +
      `<button type="button" class="icon-btn" data-act="fit" aria-label="Zoom to fit" title="Zoom to fit (0)">${icon("fit")}</button>`;
    this.buildRibbon();
    this.showEditScale();
  }

  /** Puts the editing size on its slider. */
  private showEditScale(): void {
    const percent = Math.round(this.editScale * 100);
    $<HTMLInputElement>("#edit-scale").value = String(percent);
    $("#edit-scale-out").textContent = `${percent}%`;
  }

  /** Sets how large annotations are on screen while editing, from the slider's percentage. */
  private setEditScale(percent: number, save: boolean): void {
    if (!Number.isFinite(percent)) return;
    this.editScale = Math.max(EDIT_SCALE_MIN, Math.min(EDIT_SCALE_MAX, percent)) / 100;
    this.showEditScale();
    // It only shows while editing, so the print preview is left.
    if (this.preview) this.setPreview(false);
    if (save) {
      try { localStorage.setItem(EDIT_SCALE_KEY, String(this.editScale)); } catch { /* storage unavailable */ }
    }
    this.closeEditor();
    this.render();
  }

  /** The ribbon shows the tools of the open tab, in groups. */
  private buildRibbon(): void {
    const tools = TOOLS.filter((t) => t.tab === this.tab || t.tab === "both");
    let html = "";
    let group = -1;
    for (const t of tools) {
      if (t.group !== group && group !== -1) html += `<span class="ribbon-rule"></span>`;
      group = t.group;
      const attr = isCommand(t.id) ? `data-cmd="${t.id}"` : `data-tool="${t.id}"`;
      html += `<button type="button" class="tool" ${attr} aria-label="${t.label}" title="${t.label}${t.key ? ` (${t.key})` : ""}">${icon(t.icon, 22)}<span>${t.label}</span></button>`;
    }
    const ribbon = $("#ribbon");
    ribbon.innerHTML = html;
    ribbon.setAttribute("aria-labelledby", `tab-${this.tab}`);
    ribbon.dataset.shown = this.tab;
  }

  private setTab(tab: Tab): void {
    if (tab === this.tab) return;
    this.tab = tab;
    // A tool that lives on the other tab is put down.
    const home = toolDef(this.tool).tab;
    if (home !== "both" && home !== tab) return this.setTool("select");
    this.touch();
  }

  private updateButtons(): void {
    if ($("#ribbon").dataset.shown !== this.tab) this.buildRibbon();
    document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((b) => {
      b.setAttribute("aria-selected", String(b.dataset.tab === this.tab));
    });
    document.querySelectorAll<HTMLButtonElement>("[data-tool], [data-cmd]").forEach((b) => {
      b.setAttribute("aria-pressed", String((b.dataset.tool ?? b.dataset.cmd) === this.tool));
    });
    $<HTMLButtonElement>('[data-act="undo"]').disabled = !this.history.canUndo;
    $<HTMLButtonElement>('[data-act="redo"]').disabled = !this.history.canRedo;
    $<HTMLButtonElement>('[data-act="origin"]').setAttribute("aria-pressed", String(this.sk.showOrigin));
    $<HTMLButtonElement>('[data-act="preview"]').setAttribute("aria-pressed", String(this.preview));
  }

  private drawTitleblock(): void {
    const r = this.result;
    let state: string, cls: string, count: string;
    if (this.sk.entities.length <= 1) { count = "–"; state = "Nothing drawn yet"; cls = ""; }
    else if (r.conflicting.length || !r.ok) { count = "!"; state = "Constraints conflict"; cls = "bad"; }
    else if (r.dof === 0) { count = "0"; state = "Fully constrained"; cls = "done"; }
    else { count = String(r.dof); state = r.dof === 1 ? "degree of freedom left" : "degrees of freedom left"; cls = "free"; }

    const width = formatNumber(Number((this.sk.figureWidthMm / 10).toFixed(2)));
    const percent = Math.round(this.sk.dimScale * 100);
    const busy = this.titleblock.contains(document.activeElement) && document.activeElement?.tagName === "INPUT";
    if (busy) {
      // Leave the controls alone while one is in use.
      const dof = this.titleblock.querySelector(".tb-dof");
      if (dof) dof.outerHTML = this.dofCell(count, state, cls);
      return;
    }
    this.titleblock.innerHTML =
      this.dofCell(count, state, cls) +
      `<label class="tb-cell tb-size" title="How large text, arrows and symbols are in the exported figure. Double-click for 100%."><span class="tb-k">Dimension size in print</span>` +
      `<span class="tb-v"><input id="dim-scale" data-scale="dim" type="range" min="${DIM_SCALE_MIN}" max="${DIM_SCALE_MAX}" step="5" value="${percent}" aria-valuetext="${percent}%"><output id="dim-scale-out" for="dim-scale">${percent}%</output></span></label>` +
      `<label class="tb-cell" title="How wide the drawn geometry is in the exported figure."><span class="tb-k">Figure width</span><span class="tb-v"><input id="fig-width" data-scale="width" type="text" inputmode="decimal" value="${width}"> cm</span></label>`;
  }

  private dofCell(count: string, state: string, cls: string): string {
    return `<div class="tb-cell tb-dof ${cls}"><span class="tb-count">${count}</span><span class="tb-state">${state}</span></div>`;
  }

  private describe(c: Constraint): string {
    if (isDimension(c)) {
      const unit = c.type === "angle" ? "°" : "";
      const label = c.label?.trim() ? ` shown as ${c.label.trim()}` : "";
      return `${RELATION_NAMES[c.type]} ${this.shownValue(c)}${unit}${label}`;
    }
    return RELATION_NAMES[c.type];
  }

  private constraintRows(list: Constraint[]): string {
    if (!list.length) return "";
    const bad = new Set(this.result.conflicting), extra = new Set(this.result.redundant);
    return `<ul class="rows">${list.map((c) => {
      const flag = bad.has(c.id) ? `<span class="flag bad">conflicts</span>` : extra.has(c.id) ? `<span class="flag extra">redundant</span>` : "";
      const ico = isDimension(c) ? "dimension" : c.type;
      return `<li><button type="button" class="row" data-select="${c.id}">${icon(ico, 16)}<span>${esc(this.describe(c))}</span>${flag}</button>` +
        `<button type="button" class="row-del" data-delete="${c.id}" aria-label="Delete ${esc(this.describe(c))}" title="Delete">${icon("trash", 16)}</button></li>`;
    }).join("")}</ul>`;
  }

  /** `extra` goes in above the Delete button. */
  private symbolPanel(s: Sym, extra = ""): string {
    const degrees = (angle: number) => formatNumber(Number((angle / DEG).toFixed(2)));
    const mm = (v: number) => formatNumber(Number(v.toFixed(2)));
    const text = (label: string, field: string, value: string, note = "") =>
      `<label class="field"><span>${label}</span><input data-field="${field}" type="text" spellcheck="false" value="${esc(value)}">${note ? `<small>${note}</small>` : ""}</label>`;
    const number = (label: string, field: string, value: string, note = "") =>
      `<label class="field"><span>${label}</span><input data-field="${field}" type="text" inputmode="decimal" value="${value}">${note ? `<small>${note}</small>` : ""}</label>`;
    const rotate = `<button type="button" class="plain" data-act="rotate">Rotate 90° (R)</button>`;
    let html = "";

    switch (s.type) {
      case "support": {
        const kinds: [SupportKind, string][] = [["pin", "Pin"], ["roller", "Roller"], ["fixed", "Fixed"]];
        html += `<h2>${SUPPORT_NAMES[s.kind]}</h2>`;
        html += `<div class="field"><span id="kind-label">Kind</span><div class="segmented" role="group" aria-labelledby="kind-label">${kinds.map(([k, name]) =>
          `<button type="button" data-kind="${k}" aria-pressed="${s.kind === k}">${name}</button>`).join("")}</div></div>`;
        html += number("Rotation (degrees)", "sym-angle", degrees(s.angle), "At 0 the ground is below the joint. Dragging the support around its joint turns it too.");
        html += rotate;
        html += `<p class="muted note-block">Supports are drawn only. To hold a joint in place, fix the point.</p>`;
        break;
      }
      case "frame":
        html += `<h2>Coordinate axes</h2>`;
        html += text("First axis label", "sym-xlabel", s.xLabel);
        html += text("Second axis label", "sym-ylabel", s.yLabel, "Written as TeX math. Leave empty for no label. Clicking a label on the drawing edits it there.");
        html += number("First axis length (in the drawing's units)", "sym-xsize", formatNumber(Number(s.xSize.toPrecision(4))));
        html += number("Second axis length (in the drawing's units)", "sym-ysize", formatNumber(Number(s.ySize.toPrecision(4))), "Set a length to 0 to leave that axis out. The lengths belong to the drawing: neither size slider changes them.");
        html += number("Rotation (degrees)", "sym-angle", degrees(s.angle));
        html += rotate;
        html += `<p class="muted note-block">Drag an arrow tip to make that axis longer or shorter. ${s.at ? "The axes are pinned to a joint and move with it; drag them away to free them." : "Drag the axes anywhere. Dropped on a joint, they stay pinned there."}</p>`;
        break;
      case "centermark":
        html += `<h2>Centre mark</h2>`;
        html += number("Size (1 is the standard mark)", "sym-scale", formatNumber(Number((s.scale ?? 1).toFixed(2))), "Scales the cross, its gaps and how far the lines run past the rim. Dragging an end of the mark sets this too.");
        html += number("Rotation (degrees)", "sym-angle", degrees(s.angle), "Dragging the mark by its middle turns it too.");
        html += rotate;
        break;
      case "balloon": {
        const ends: [LeaderEnd, string][] = [["arrow", "Arrow"], ["dot", "Dot"], ["none", "Plain"]];
        html += `<h2>Balloon</h2>`;
        html += text("Text", "sym-text", s.text, "A part number, or any TeX math. Clicking it on the drawing edits it there.");
        html += `<div class="field"><span id="end-label">Leader ends in</span><div class="segmented" role="group" aria-labelledby="end-label">${ends.map(([e, name]) =>
          `<button type="button" data-end="${e}" aria-pressed="${s.end === e}">${name}</button>`).join("")}</div></div>`;
        html += `<label class="check"><input data-field="sym-circle" type="checkbox"${s.circle !== false ? " checked" : ""}><span>Circle around the text</span></label>`;
        html += `<p class="muted note-block">Drag the balloon to move it; its leader keeps pointing at the same spot.</p>`;
        break;
      }
      case "fill":
        html += `<h2>Fill</h2>`;
        html += `<div class="field"><span id="colour-label">Colour</span><div class="swatches" role="group" aria-labelledby="colour-label">${FILL_COLORS.map((c) =>
          `<button type="button" class="swatch" data-color="${c}" aria-pressed="${s.color === c}" aria-label="Colour ${c}" title="${c}" style="background:${c}"></button>`).join("")}` +
          `<label class="swatch custom" title="Another colour"><input data-field="sym-color" type="color" value="${esc(s.color)}" aria-label="Another colour"></label></div></div>`;
        if (s.holes.length) html += `<p class="muted note-block">${s.holes.length === 1 ? "The circle inside is" : "The circles inside are"} left unfilled.</p>`;
        break;
      case "hatch":
        html += `<h2>Hatching</h2>`;
        html += number("Stroke length (mm in print at 100%)", "sym-depth", mm(s.depth), "Dragging the hatching away from the curve sets this too.");
        html += number("Spacing (mm in print at 100%)", "sym-spacing", mm(s.spacing));
        html += `<button type="button" class="plain" data-act="flip">Move to the other side</button>`;
        html += `<button type="button" class="plain" data-act="lean">Lean the strokes the other way</button>`;
        break;
      case "datum":
        html += `<h2>Datum point</h2>`;
        html += text("Name", "sym-label", s.label, "Written as TeX math. Leave empty for none. On the drawing, click the name to type it there and drag it to move it.");
        html += `<div class="field"><span id="colour-label">Colour</span><div class="swatches" role="group" aria-labelledby="colour-label">${DATUM_COLORS.map((c) =>
          `<button type="button" class="swatch" data-color="${c}" aria-pressed="${s.color === c}" aria-label="Colour ${c}" title="${c}" style="background:${c}"></button>`).join("")}` +
          `<label class="swatch custom" title="Another colour"><input data-field="sym-color" type="color" value="${esc(s.color)}" aria-label="Another colour"></label></div></div>`;
        html += `<p class="muted note-block">The dot and its name are part of the exported figure. The point under it is constrained and dimensioned like any other.</p>`;
        html += `<button type="button" class="plain" data-act="undatum">Back to a plain point</button>`;
        break;
    }
    return html + extra + `<button type="button" class="danger" data-act="delete">Delete</button>`;
  }

  private drawPanel(): void {
    const focusField = (document.activeElement as HTMLElement | null)?.dataset?.field;
    const { pts, lines, rounds, cons, syms, entities } = this.picked();
    let html = "";

    if (isCommand(this.tool) && !(cons.length === 1 && isDimension(cons[0]))) {
      const info = toolDef(this.tool);
      html += `<h2>${info.label}</h2>`;
      html += this.tool === "dimension"
        ? `<ol class="steps"><li>Click ${info.need}.</li><li>Middle-click where the dimension should go. Beside the line gives its length; above or below, the horizontal distance; left or right, the vertical one.</li><li>Type the value and press Enter.</li></ol>`
        : this.tool === "fixed"
          ? `<p class="muted">Click a point to fix it in place. Click a fixed point to release it.</p>`
          : `<p class="muted">Click ${info.need}. The constraint is applied as soon as you have picked them.</p>`;
      html += `<p class="muted">Middle-click or Esc returns to Select.</p>`;
    } else if (cons.length === 1 && entities === 0 && !syms.length && isDimension(cons[0])) {
      const d = cons[0];
      html += `<h2>${RELATION_NAMES[d.type]}</h2>`;
      html += `<label class="field"><span>Value${d.type === "angle" ? " (degrees)" : ""}</span><input data-field="value" type="text" inputmode="decimal" value="${this.shownValue(d)}"></label>`;
      html += `<label class="field"><span>Label</span><input data-field="label" type="text" spellcheck="false" placeholder="2a, F_1, \\alpha" value="${esc(d.label ?? "")}"><small>Shown in the figure instead of the number. Written as TeX math; spaces you type are kept. Clicking the number on the drawing edits it in place.</small></label>`;
      if (d.type === "distance") {
        const modes: [DistanceMode, string][] = [["aligned", "Aligned"], ["horizontal", "Horizontal"], ["vertical", "Vertical"]];
        html += `<div class="field"><span id="mode-label">Measured</span><div class="segmented" role="group" aria-labelledby="mode-label">${modes.map(([m, name]) =>
          `<button type="button" data-mode="${m}" aria-pressed="${d.mode === m}">${name}</button>`).join("")}</div></div>`;
        if (d.mode !== "horizontal") {
          const along = (d.text ?? (d.mode === "aligned" ? "along" : "upright")) === "along";
          html += `<label class="check"><input data-field="along" type="checkbox"${along ? " checked" : ""}><span>Turn the text along the dimension line</span></label>`;
        }
      }
      if (d.type === "radius") {
        html += `<div class="field"><span id="place-label">Drawn</span><div class="segmented" role="group" aria-labelledby="place-label">` +
          `<button type="button" data-place="inside" aria-pressed="${!d.outside}">Inside</button>` +
          `<button type="button" data-place="outside" aria-pressed="${!!d.outside}">Outside</button></div></div>`;
        const shown = d.len !== undefined ? formatNumber(Number(d.len.toPrecision(4))) : "";
        html += `<label class="field"><span>Arrow length (in the drawing's units)</span><input data-field="radius-len" type="text" inputmode="decimal" value="${shown}" placeholder="${d.outside ? "standard" : "from the centre"}">` +
          `<small>${d.outside ? "Empty: a standard length. " : "Empty: the arrow starts at the centre. "}Dragging the dimension sets the length too, and pulling it across the rim moves it inside or outside.</small></label>`;
      }
      html += `<label class="check"><input data-field="hidden" type="checkbox"${d.hidden ? " checked" : ""}><span>Leave out of the figure</span></label>`;
      html += `<button type="button" class="danger" data-act="delete">Delete dimension</button>`;
    } else if (syms.length === 1 && entities === 0 && !cons.length) {
      html += this.symbolPanel(syms[0]);
    } else if (entities === 1 && pts.length === 1 && !syms.length && !cons.length && this.datumOn(pts[0].id)) {
      // The dot of a datum point is the point itself: show the datum, with what holds the point.
      const attached = this.sk.constraints.filter((c) => constraintRefs(c).includes(pts[0].id));
      const extra = `<p class="muted">x ${formatNumber(pts[0].x)}, y ${formatNumber(pts[0].y)}</p>` +
        `<h3>Constraints on the point</h3>${attached.length ? this.constraintRows(attached) : `<p class="muted">None yet.</p>`}`;
      html += this.symbolPanel(this.datumOn(pts[0].id)!, extra);
    } else if (cons.length >= 1 && entities === 0 && !syms.length) {
      html += `<h2>${cons.length === 1 ? RELATION_NAMES[cons[0].type] : `${cons.length} constraints`}</h2>`;
      html += this.constraintRows(cons);
      html += `<button type="button" class="danger" data-act="delete">Delete</button>`;
    } else if (entities === 1 && pts.length === 1 && pts[0].id === ORIGIN && !syms.length) {
      html += `<h2>Origin</h2><p class="muted">Fixed at (0, 0). Constrain or dimension geometry against it like any other point. It is not part of the exported figure.</p>`;
      const attached = this.sk.constraints.filter((c) => constraintRefs(c).includes(ORIGIN));
      if (attached.length) html += `<h3>Constraints on the origin</h3>${this.constraintRows(attached)}`;
    } else if (entities > 0 || syms.length) {
      const names: string[] = [];
      const count = (n: number, one: string, many: string) => { if (n) names.push(`${n} ${n === 1 ? one : many}`); };
      count(pts.length, "point", "points");
      count(lines.length, "line", "lines");
      count(rounds.filter((r) => r.type === "circle").length, "circle", "circles");
      count(rounds.filter((r) => r.type === "arc").length, "arc", "arcs");
      count(syms.length, "symbol", "symbols");
      html += `<h2>${names.join(", ")}</h2>`;
      if (pts.length === 1 && entities === 1) {
        html += `<p class="muted">x ${formatNumber(pts[0].x)}, y ${formatNumber(pts[0].y)}</p>`;
      }
      const cs: Curve[] = [...lines, ...rounds];
      if (cs.length) {
        const styleOf = (c: Curve): LineStyle => (c.construction ? "construction" : c.type !== "circle" && c.arrow ? "arrow" : c.centre ? "centre" : "solid");
        const shared = cs.every((c) => styleOf(c) === styleOf(cs[0])) ? styleOf(cs[0]) : null;
        const styles: [LineStyle, string][] = [["solid", "Solid"], ["centre", "Centre line"], ["construction", "Helper"]];
        // Lines and arcs can be arrows; a full circle has no end to put a head on.
        if (cs.every((c) => c.type !== "circle")) styles.splice(2, 0, ["arrow", "Arrow"]);
        html += `<div class="field"><span id="style-label">Drawn as</span><div class="segmented wrap" role="group" aria-labelledby="style-label">${styles.map(([st, name]) =>
          `<button type="button" data-style="${st}" aria-pressed="${shared === st}">${name}</button>`).join("")}</div>` +
          `<small>A centre line is thin and dash-dotted. A helper is dashed here and left out of the exported figure.</small></div>`;
        const arrow = cs.length === 1 && cs[0].type !== "circle" && cs[0].arrow ? cs[0] : null;
        if (arrow) {
          const heads: [ArrowEnds, string][] = arrow.type === "line"
            ? [["end", "End"], ["start", "Start"], ["both", "Both"]]
            : [["end", "Anticlockwise"], ["start", "Clockwise"], ["both", "Both"]];
          html += `<label class="field"><span>Name</span><input data-field="arrow-label" type="text" spellcheck="false" placeholder="${arrow.type === "line" ? "F, \\vec{v}_0" : "M, \\omega"}" value="${esc(arrow.label ?? "")}"><small>Written as TeX math. On the drawing, click the name to type it there and drag it to move it; double-click the arrow to give it one.</small></label>`;
          html += `<div class="field"><span id="head-label">${arrow.type === "line" ? "Arrowhead at the" : "Points"}</span><div class="segmented wrap" role="group" aria-labelledby="head-label">${heads.map(([h, name]) =>
            `<button type="button" data-head="${h}" aria-pressed="${arrow.arrow === h}">${name}</button>`).join("")}</div></div>`;
        }
      }
      if (entities > 0) {
        const ids = new Set<Id>([...this.selection]);
        for (const c of cs) curvePoints(c).forEach((p) => ids.add(p));
        const attached = this.sk.constraints.filter((c) => constraintRefs(c).some((r) => ids.has(r)));
        html += `<h3>Constraints on the selection</h3>`;
        html += attached.length ? this.constraintRows(attached) : `<p class="muted">None yet.</p>`;
      }
      html += `<button type="button" class="danger" data-act="delete">Delete selection</button>`;
    } else {
      html += `<h2>Nothing selected</h2>`;
      const over = findOverlaps(this.sk);
      const n = over.segments.length + over.rounds.length;
      if (n) html += `<p class="warn">${n === 1 ? "Two curves lie" : `Curves lie in ${n} places`} on top of each other, shown in red. Click there again to step through them and delete the extra one.</p>`;
      if (this.sk.constraints.length) {
        html += `<h3>All constraints</h3>${this.constraintRows(this.sk.constraints)}`;
      } else {
        html += `<ol class="steps"><li><b>Draw.</b> On the Sketch tab, place joints with the Line tool; exact positions do not matter yet.</li>` +
          `<li><b>Constrain.</b> Press a constraint, then click the geometry it applies to. Curves turn black once nothing about them can move.</li>` +
          `<li><b>Annotate.</b> On the Annotate tab, press Dimension, click a line, middle-click where the dimension goes and type its length. Supports, balloons, fills and hatching are there too.</li></ol>`;
      }
    }
    this.panel.innerHTML = html;
    if (focusField) this.panel.querySelector<HTMLElement>(`[data-field="${focusField}"]`)?.focus();
  }

  // ---- events ---------------------------------------------------------------

  private bindEvents(): void {
    const svg = this.svg;
    svg.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    svg.addEventListener("pointermove", (e) => this.onPointerMove(e));
    svg.addEventListener("pointerup", (e) => this.onPointerUp(e));
    svg.addEventListener("pointercancel", (e) => this.onPointerUp(e));
    svg.addEventListener("pointerleave", () => {
      if (this.drag) return;
      this.hover = null;
      this.snapMark = null;
      this.render();
    });
    svg.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    svg.addEventListener("dblclick", (e) => this.onDoubleClick(e));
    svg.addEventListener("contextmenu", (e) => e.preventDefault());
    // The middle button confirms and pans here; keep the browser from starting
    // its own scroll mode or pasting on it.
    svg.addEventListener("mousedown", (e) => { if (e.button === 1) e.preventDefault(); });
    svg.addEventListener("auxclick", (e) => e.preventDefault());
    new ResizeObserver(() => this.resize()).observe(this.stage);

    document.addEventListener("click", (e) => {
      const btn = (e.target as Element).closest<HTMLElement>("button");
      const menuBtn = btn?.dataset.menu ? btn : null;
      // Any click closes an open menu, other than the one on its own button, which toggles it.
      // A popover holds controls, not commands: clicks inside it leave it open.
      const within = (e.target as Element).closest(".menu-list.popover")?.id;
      for (const open of document.querySelectorAll<HTMLElement>('[data-menu][aria-expanded="true"]')) {
        if (open !== menuBtn && open.getAttribute("aria-controls") !== within) this.setMenu(open, false);
      }
      if (!btn) return;
      const ds = btn.dataset;
      // A click made from the keyboard (detail 0) moves focus into the menu.
      if (menuBtn) return this.setMenu(menuBtn, menuBtn.getAttribute("aria-expanded") !== "true", e.detail === 0);
      if (ds.tab) this.setTab(ds.tab as Tab);
      else if (ds.tool) this.setTool(ds.tool as Tool);
      else if (ds.cmd) this.activate(ds.cmd as Command);
      else if (ds.select) { this.setTool("select"); this.selection = new Set([ds.select]); this.touch(); }
      else if (ds.delete) { remove(this.sk, [ds.delete]); this.pruneSelection(); this.solve(); this.commit(); }
      else if (ds.mode) this.setDimMode(ds.mode as DistanceMode);
      else if (ds.kind) this.setSupportKind(ds.kind as SupportKind);
      else if (ds.style) this.setLineStyle(ds.style as LineStyle);
      else if (ds.end) this.editSymbol((x) => { if (x.type === "balloon") x.end = ds.end as LeaderEnd; });
      else if (ds.color) this.setColor(ds.color);
      else if (ds.head) this.setArrowHead(ds.head as ArrowEnds);
      else if (ds.place) this.setRadiusPlace(ds.place === "outside");
      else if (ds.dialog === "cancel") btn.closest("dialog")?.close("cancel");
      else if (ds.act) this.action(ds.act);
    });

    // Explain a constraint button on hover or focus.
    const explain = (e: Event) => {
      const btn = (e.target as Element).closest?.<HTMLElement>("[data-cmd]");
      if (!btn) return;
      const info = toolDef(btn.dataset.cmd as Tool);
      this.hintOverride = `${info.label}${info.key ? ` (${info.key})` : ""}: press this, then click ${info.need}.`;
      this.render();
    };
    const unexplain = () => { this.hintOverride = null; this.render(); };
    const bar = $("#ribbon");
    bar.addEventListener("mouseover", explain);
    bar.addEventListener("focusin", explain);
    bar.addEventListener("mouseleave", unexplain);
    bar.addEventListener("focusout", unexplain);

    this.panel.addEventListener("change", (e) => this.onPanelChange(e.target as HTMLInputElement));
    const editScale = $<HTMLInputElement>("#edit-scale");
    editScale.addEventListener("input", () => this.setEditScale(Number(editScale.value), false));
    editScale.addEventListener("change", () => this.setEditScale(Number(editScale.value), true));
    editScale.addEventListener("dblclick", () => this.setEditScale(100, true));

    // The slider acts as it moves. What it changes only shows in print, so the preview comes on with it.
    this.titleblock.addEventListener("input", (e) => {
      const input = e.target as HTMLInputElement;
      if (input.dataset.scale !== "dim") return;
      this.setDimScale(Number(input.value));
    });
    this.titleblock.addEventListener("dblclick", (e) => {
      const input = e.target as HTMLInputElement;
      if (input.dataset?.scale !== "dim") return;
      input.value = "100";
      this.setDimScale(100);
      input.blur();
      this.commit();
    });
    this.titleblock.addEventListener("change", (e) => {
      const input = e.target as HTMLInputElement;
      if (input.dataset.scale === "width") {
        const v = parseNumber(input.value);
        if (Number.isFinite(v) && v >= 1 && v <= 100) this.sk.figureWidthMm = v * 10;
        else this.toast("Figure width must be between 1 and 100 cm.");
      }
      // For the slider this is the end of a drag: the size is set already, and is recorded now.
      input.blur();
      this.commit();
    });
    this.titleblock.addEventListener("keydown", (e) => {
      if (e.key === "Enter") (e.target as HTMLElement).blur();
    });

    this.dimEditor.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); this.commitEditor(); }
      else if (e.key === "Escape") { e.preventDefault(); this.closeEditor(); this.touch(); }
      e.stopPropagation();
    });
    this.dimEditor.addEventListener("blur", () => { if (this.editing) this.commitEditor(); });

    this.fileInput.addEventListener("change", () => {
      const f = this.fileInput.files?.[0];
      if (f) void this.open(f);
      this.fileInput.value = "";
    });

    // Starting to draw, pan or drag also closes an open menu.
    document.addEventListener("pointerdown", (e) => {
      if ((e.target as Element).closest(".menu")) return;
      for (const open of document.querySelectorAll<HTMLElement>('[data-menu][aria-expanded="true"]')) this.setMenu(open, false);
    });
    window.addEventListener("keydown", (e) => { if (!this.menuKey(e)) this.onKeyDown(e); });
    window.addEventListener("keyup", (e) => {
      this.altKey = e.altKey;
      if (e.code === "Space") { this.spaceKey = false; this.render(); }
    });
    window.addEventListener("blur", () => { this.spaceKey = false; this.altKey = false; });
  }

  private action(act: string): void {
    switch (act) {
      case "undo": return this.undo();
      case "redo": return this.redo();
      case "fit": return this.fit();
      case "new": return this.newSketch();
      case "open": return this.fileInput.click();
      case "save": return this.save();
      case "export-svg": return void this.exportFigure("svg");
      case "export-tikz": return void this.exportFigure("tikz");
      case "copy-tikz": return void this.exportFigure("copy-tikz");
      case "delete": return this.deleteSelection();
      case "rotate": return this.rotateSelected(Math.PI / 2);
      case "flip":
        return this.editSymbol((x) => { if (x.type === "hatch") x.side = x.side === 1 ? -1 : 1; });
      case "lean":
        return this.editSymbol((x) => { if (x.type === "hatch") x.lean = (x.lean ?? 1) === 1 ? -1 : 1; });
      case "undatum": {
        // The mark goes; the point it was on stays.
        const d = this.selectedSymbol();
        if (d?.type !== "datum") return;
        remove(this.sk, [d.id]);
        this.selection = new Set([d.at]);
        return this.commit();
      }
      case "preview":
        return this.setPreview(!this.preview);
      case "origin":
        this.sk.showOrigin = !this.sk.showOrigin;
        return this.commit();
    }
  }

  private selectedDimension(): Dimension | null {
    if (this.selection.size !== 1) return null;
    const c = constraint(this.sk, [...this.selection][0]);
    return c && isDimension(c) ? c : null;
  }

  /** The one selected symbol. A datum point counts when its point is what is selected. */
  private selectedSymbol(): Sym | null {
    if (this.selection.size !== 1) return null;
    const id = [...this.selection][0];
    return symbol(this.sk, id) ?? this.datumOn(id) ?? null;
  }

  /** Sets how the selected curves are drawn. */
  private setLineStyle(style: LineStyle): void {
    const { lines, rounds } = this.picked();
    for (const c of [...lines, ...rounds]) {
      delete c.construction;
      delete c.centre;
      if (c.type !== "circle" && style !== "arrow") delete c.arrow;
      if (style === "construction") c.construction = true;
      if (style === "centre") c.centre = true;
      if (style === "arrow" && c.type !== "circle") c.arrow ??= "end";
    }
    this.commit();
  }

  /** The one selected line or arc, when it is drawn as an arrow. */
  private selectedArrow(): Line | Arc | null {
    if (this.selection.size !== 1) return null;
    const e = entity(this.sk, [...this.selection][0]);
    return e && (e.type === "line" || e.type === "arc") && e.arrow ? e : null;
  }

  /** Sets which end of the selected arrow carries the head. */
  private setArrowHead(ends: ArrowEnds): void {
    const e = this.selectedArrow();
    if (!e) return;
    e.arrow = ends;
    this.commit();
  }

  /** Moves the selected radius dimension inside or outside its circle. */
  private setRadiusPlace(outside: boolean): void {
    const d = this.selectedDimension();
    if (!d || d.type !== "radius" || !!d.outside === outside) return;
    if (outside) d.outside = true;
    else delete d.outside;
    // A length set for one side would make little sense on the other.
    delete d.len;
    this.commit();
  }

  /** Changes the one selected symbol and records the edit. */
  private editSymbol(change: (s: Sym) => void): void {
    const s = this.selectedSymbol();
    if (!s) return;
    change(s);
    this.commit();
  }

  /** Sets how large annotations are in print, from the slider's percentage, and shows the result. */
  private setDimScale(percent: number): void {
    if (!Number.isFinite(percent)) return;
    this.sk.dimScale = Math.max(DIM_SCALE_MIN, Math.min(DIM_SCALE_MAX, percent)) / 100;
    const out = this.titleblock.querySelector("#dim-scale-out");
    if (out) out.textContent = `${Math.round(this.sk.dimScale * 100)}%`;
    if (!this.preview) {
      this.setPreview(true);
      this.toast("Showing the print preview, where the dimension size applies. Press Q to go back to editing.");
    }
    this.render();
  }

  /** Colours the selected fill or datum point, and remembers the colour for the next one of its kind. */
  private setColor(color: string): void {
    if (!/^#[0-9a-f]{6}$/i.test(color)) return;
    const s = this.selectedSymbol();
    if (s?.type === "datum") this.datumColor = color;
    else this.fillColor = color;
    this.editSymbol((x) => { if (x.type === "fill" || x.type === "datum") x.color = color; });
  }

  private setSupportKind(kind: SupportKind): void {
    const s = this.selectedSymbol();
    if (!s || s.type !== "support" || s.kind === kind) return;
    s.kind = kind;
    this.commit();
  }

  private setDimMode(mode: DistanceMode): void {
    const d = this.selectedDimension();
    if (!d || d.type !== "distance" || d.mode === mode) return;
    const before = clone(this.sk);
    const a = point(this.sk, d.a), b = point(this.sk, d.b);
    // Keep the geometry where it is: the value becomes what the new direction measures now.
    const value = mode === "aligned" ? dist([a.x, a.y], [b.x, b.y]) : Math.abs(mode === "horizontal" ? b.x - a.x : b.y - a.y);
    if (mode === "aligned" && value < 1e-9) return this.toast("Those two points are in the same place.");
    d.mode = mode;
    d.value = value;
    d.offset = this.outsideOffset(a, b, mode);
    const r = this.solver.solve(this.sk);
    if (!r.ok || r.conflicting.length || r.redundant.length > this.result.redundant.length) {
      this.sk = before;
      this.solve();
      this.toast("Measured that way, the dimension would over-constrain the sketch.");
      return this.touch();
    }
    this.result = r;
    this.commit();
  }

  private onPanelChange(input: HTMLInputElement): void {
    const field = input.dataset.field;
    if (!field) return;

    if (field.startsWith("sym-")) {
      const s = this.selectedSymbol();
      if (!s) return;
      const v = parseNumber(input.value);
      const label = input.value.trim().replace(/^\$+|\$+$/g, "");
      /** A typed length in mm, or null (with a message) when it is out of range. */
      const length = (min: number, max: number, what: string): number | null => {
        if (Number.isFinite(v) && v >= min && v <= max) return v;
        this.toast(`${what} must be between ${min} and ${max} mm.`);
        return null;
      };
      if (field === "sym-angle" && (s.type === "support" || s.type === "frame" || s.type === "centermark")) {
        if (!Number.isFinite(v)) { this.toast("Type the rotation as a number of degrees."); return this.touch(); }
        s.angle = v * DEG;
      } else if (s.type === "centermark" && field === "sym-scale") {
        if (!Number.isFinite(v) || v < 0.2 || v > 10) { this.toast("The size must be between 0.2 and 10."); return this.touch(); }
        if (Math.abs(v - 1) < 1e-9) delete s.scale;
        else s.scale = v;
      } else if (s.type === "frame" && (field === "sym-xsize" || field === "sym-ysize")) {
        if (!Number.isFinite(v) || v < 0) { this.toast("An axis length must be zero or more."); return this.touch(); }
        if (field === "sym-xsize") s.xSize = v;
        else s.ySize = v;
      } else if (s.type === "frame" && field === "sym-xlabel") s.xLabel = label;
      else if (s.type === "frame" && field === "sym-ylabel") s.yLabel = label;
      else if (s.type === "balloon" && field === "sym-text") s.text = label;
      else if (s.type === "balloon" && field === "sym-circle") {
        if (input.checked) delete s.circle;
        else s.circle = false;
      } else if (s.type === "datum" && field === "sym-label") s.label = label;
      else if ((s.type === "fill" || s.type === "datum") && field === "sym-color") return this.setColor(input.value);
      else if (s.type === "hatch" && field === "sym-depth") {
        const depth = length(0.3, 30, "Stroke length");
        if (depth === null) return this.touch();
        s.depth = depth;
      } else if (s.type === "hatch" && field === "sym-spacing") {
        const spacing = length(0.3, 30, "Spacing");
        if (spacing === null) return this.touch();
        s.spacing = spacing;
      }
      return this.commit();
    }

    if (field === "arrow-label") {
      const e = this.selectedArrow();
      if (!e) return;
      const name = input.value.trim().replace(/^\$+|\$+$/g, "");
      if (name) e.label = name;
      else delete e.label;
      return this.commit();
    }

    const d = this.selectedDimension();
    if (!d) return;
    if (field === "along" && d.type === "distance") {
      d.text = input.checked ? "along" : "upright";
      return this.commit();
    }
    if (field === "radius-len" && d.type === "radius") {
      const v = parseNumber(input.value);
      if (input.value.trim() === "") delete d.len;
      else if (Number.isFinite(v) && v > 0) d.len = v;
      else { this.toast("The arrow length must be a number greater than zero."); return this.touch(); }
      return this.commit();
    }
    if (field === "value") {
      if (!this.setDimValue(d.id, input.value)) input.value = this.shownValue(d);
      this.touch();
    } else if (field === "label") {
      const label = input.value.trim().replace(/^\$+|\$+$/g, "");
      if (label) d.label = label;
      else delete d.label;
      this.commit();
    } else if (field === "hidden") {
      if (input.checked) d.hidden = true;
      else delete d.hidden;
      this.commit();
    }
  }

  /** Opens or closes a drop-down menu; `focus` puts the keyboard on its first item. */
  private setMenu(btn: HTMLElement, open: boolean, focus = false): void {
    const list = document.getElementById(btn.getAttribute("aria-controls") ?? "");
    if (!list) return;
    btn.setAttribute("aria-expanded", String(open));
    list.hidden = !open;
    if (open && focus) list.querySelector<HTMLElement>("button, input")?.focus();
  }

  /** Keys for an open menu. Returns true when the key was the menu's to handle. */
  private menuKey(e: KeyboardEvent): boolean {
    const btn = document.querySelector<HTMLElement>('[data-menu][aria-expanded="true"]');
    const target = e.target as HTMLElement;
    if (!btn) {
      // Arrow down on the closed button opens it, as menus do.
      if (e.key === "ArrowDown" && target.dataset?.menu) { e.preventDefault(); this.setMenu(target, true, true); return true; }
      return false;
    }
    const list = document.getElementById(btn.getAttribute("aria-controls") ?? "");
    if (list?.classList.contains("popover")) {
      // Its controls take the keys themselves (the arrows move a slider); Esc closes it.
      if (e.key !== "Escape") return true;
      this.setMenu(btn, false);
      btn.focus();
      e.preventDefault();
      return true;
    }
    const items = [...(list?.querySelectorAll<HTMLElement>("button") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => items[(i + items.length) % items.length]?.focus();
    switch (e.key) {
      case "Escape": this.setMenu(btn, false); btn.focus(); break;
      case "ArrowDown": go(at + 1); break;
      case "ArrowUp": go(at < 0 ? -1 : at - 1); break;
      case "Home": go(0); break;
      case "End": go(-1); break;
      case "Tab": this.setMenu(btn, false); return true; // let focus move on
      default:
        if (e.ctrlKey || e.metaKey) return false;
        // Enter and Space press the focused item. Other typed keys are not tool shortcuts while the menu is open.
        return e.key === "Enter" || e.key.length === 1;
    }
    e.preventDefault();
    return true;
  }

  private onKeyDown(e: KeyboardEvent): void {
    this.altKey = e.altKey;
    const target = e.target as HTMLElement;
    // Checkboxes and buttons keep focus after a click but take no text.
    const textInput = target.tagName === "INPUT" && !["checkbox", "radio", "button", "file", "range"].includes((target as HTMLInputElement).type);
    const typing = textInput || target.tagName === "TEXTAREA" || target.isContentEditable;
    const mod = e.ctrlKey || e.metaKey;

    if (mod && !typing) {
      const k = e.key.toLowerCase();
      if (k === "z") { e.preventDefault(); return e.shiftKey ? this.redo() : this.undo(); }
      if (k === "y") { e.preventDefault(); return this.redo(); }
      if (k === "s") { e.preventDefault(); return this.save(); }
      if (k === "o") { e.preventDefault(); return this.fileInput.click(); }
      if (k === "a") {
        e.preventDefault();
        this.setTool("select");
        this.selection = new Set([
          ...this.sk.entities.filter((x) => x.id !== ORIGIN).map((x) => x.id),
          ...this.sk.symbols.map((x) => x.id),
        ]);
        return this.touch();
      }
      return;
    }
    if (typing || mod || e.altKey) {
      if (e.key === "Enter" && typing && this.panel.contains(target)) target.blur();
      return;
    }

    if (e.code === "Space") {
      // Space on a focused button should press it, not start a pan.
      if (target.tagName === "BUTTON") return;
      e.preventDefault();
      if (!this.spaceKey) { this.spaceKey = true; this.render(); }
      return;
    }
    if (e.key === "Escape") return this.cancel();
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); return this.deleteSelection(); }
    if (e.key === "0" || e.key === "Home") return this.fit();
    if (e.key === "Enter" && this.tool === "select") {
      const d = this.selectedDimension();
      if (d) { e.preventDefault(); this.openDimEditor(d.id); }
      return;
    }

    const key = e.key.toUpperCase();
    if (key === "R" && this.tool === "select" && this.picked().syms.length) {
      e.preventDefault();
      return this.rotateSelected(e.shiftKey ? -Math.PI / 2 : Math.PI / 2);
    }
    if (key === "Q") {
      e.preventDefault();
      return this.action("preview");
    }
    const tool = TOOLS.find((t) => t.key === key);
    if (!tool) return;
    // Without this the letter would be typed into the dimension box a command opens.
    e.preventDefault();
    if (isCommand(tool.id)) this.activate(tool.id);
    else this.setTool(tool.id);
  }
}

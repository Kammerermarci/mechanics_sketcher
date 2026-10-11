// What a newcomer is told: the tip shown the first time each tool is picked
// up, and what the browser remembers about which of them have been seen.

/** A tip: the name of the feature and how it is used, in a sentence or three. */
export interface Tip { title: string; body: string }

const CONSTRAINT = " Selecting the geometry first and then pressing the button works too.";
const SUPPORT = "Click a joint, or a spot on a line, to put the support there. Drag it around its joint, or press R, to turn it. The side panel has a slider for the size of all supports. A support is only drawn: to hold a joint in place, fix the point.";

/** Keyed by tool, command or action. */
export const TIPS: Record<string, Tip> = {
  line: { title: "Line", body: "Click where the line starts and click again where it ends; the next click starts a new one. Click a joint that is there already to connect to it. Lines that are nearly level or upright snap and stay that way: hold Alt to switch that off." },
  centerline: { title: "Centre line", body: "Drawn like a line, but thin and dash-dotted. It is part of the exported figure and does not close shapes for filling. It makes a good line to mirror about." },
  circle: { title: "Circle", body: "Click the centre, then click again to set the radius. Give the radius a value afterwards with Dimension." },
  arc: { title: "Arc", body: "Click the centre, then where the arc starts. Sweep round the centre and click where it ends." },
  point: { title: "Point", body: "Click to place a point of its own: on a line, on a circle or anywhere. Constrain and dimension against it like any joint." },
  beam: { title: "Beam", body: "Click where the beam starts and where it ends, then move away from its middle line and click to set the width. Round or square ends are chosen in the side panel while the tool is active." },
  arcbeam: { title: "Curved beam", body: "Click the centre the beam bends round, then where the beam starts. Sweep round the centre and click where it ends, then move towards or away from the centre and click to set the width. Round or square ends are chosen in the side panel while the tool is active." },
  trim: { title: "Trim", body: "Point at the piece of a line, circle or arc that should go; it turns red. Click to remove it, up to where other curves cross it. Or hold the button down and drag: everything the pointer crosses is trimmed." },
  mirror: { title: "Mirror", body: "Select what to mirror first, then press Mirror and click the line to mirror about. The image stays tied to the original: change one side and the other follows." },
  shift: { title: "Linear pattern", body: "Select what to repeat first, then press this and say how many there should be. The copies follow the original. To set the spacing, drag a copy or dimension from a point to its copy." },
  turn: { title: "Circular pattern", body: "Select what to repeat first, then press this, click the point the copies go around and say how many there should be. The copies follow the original." },

  horizontal: { title: "Horizontal", body: "Click a line to make it level, or two points to put them level with each other." + CONSTRAINT },
  vertical: { title: "Vertical", body: "Click a line to make it upright, or two points to put one straight above the other." + CONSTRAINT },
  parallel: { title: "Parallel", body: "Click two lines to keep them parallel." + CONSTRAINT },
  perpendicular: { title: "Perpendicular", body: "Click two lines to keep them square to each other." + CONSTRAINT },
  equal: { title: "Equal", body: "Click two lines to give them the same length, or two circles or arcs to give them the same radius." + CONSTRAINT },
  coincident: { title: "Coincident", body: "Click two points to join them, or a point and a line or circle to keep the point on it." + CONSTRAINT },
  midpoint: { title: "Midpoint", body: "Click a point and a line to keep the point at the middle of the line." + CONSTRAINT },
  tangent: { title: "Tangent", body: "Click a line and a circle or arc to make the line touch it, or two circles or arcs to make them touch each other." + CONSTRAINT },
  fixed: { title: "Fix point", body: "Click a point to pin it where it is. Click a fixed point again to release it. Blue geometry can still move; it turns black once it is fully constrained." },

  dimension: { title: "Dimension", body: "Click a line, two points, two lines or a circle. Then middle-click, or click empty space, where the dimension should go and type its value: the drawing follows the number. Type text such as 2a to show a label in its place." },
  pin: { title: "Pin support", body: SUPPORT },
  roller: { title: "Roller support", body: SUPPORT },
  wall: { title: "Fixed support", body: SUPPORT },
  load: { title: "Load", body: "Click a joint, or a spot on a line, to put a force there. Type its magnitude in the side panel: the arrow's length follows it, at a scale all forces share. Drag the arrow round its point, or press R, to turn it. Its colour and name are in the side panel too." },
  lineload: { title: "Distributed load", body: "Click a line, on the side the load should be drawn. The side panel sets the magnitude at each end (different ones give a triangle or a trapezium), the number of arrows, the colour and whether the area under the arrows is shaded. Drag an end of the load along the line to make it cover only part of it." },
  moment: { title: "Moment", body: "Click a joint, or a spot on a line, to put a moment about it. Its magnitude sets the radius of the arc, at a scale all moments share. Drag it round, or press R, to turn it; the side panel switches between clockwise and anticlockwise." },
  frame: { title: "Axes", body: "Click where the coordinate axes should go; on a joint they stay pinned to it. Drag an arrow tip to change its length, and click a label to rename it." },
  arrow: { title: "Arrow", body: "Two clicks, like a line: where it starts and where it points. Then type its name, written as TeX math such as F_1, or just carry on. It is constrained and dimensioned like a line." },
  arcarrow: { title: "Curved arrow", body: "For moments and rotations. Click the centre, then where the arrow starts, sweep round and click where it ends." },
  datum: { title: "Datum point", body: "Click a joint, a spot on a curve or anywhere to mark it with a coloured dot and a name. Click the name to change it, and drag it to move it." },
  note: { title: "Note", body: "Click where the text should start and type it. Put math between dollar signs, as in $F_1 = 2a$, and \\\\ where a new line should start. Drag a note to move it." },
  centermark: { title: "Centre mark", body: "Click a circle or arc to give it centre lines. Drag an end of the mark to make it larger or smaller; the side panel sets how it is dashed." },
  balloon: { title: "Balloon", body: "Click what the balloon points at, then where it should sit. The numbers count up by themselves; click the text to change it. The side panel puts it in a circle or a box, underlines it, or leaves it bare." },
  fill: { title: "Fill", body: "Click inside a closed shape to fill it. The lines around it have to meet at shared points. The colour is picked in the side panel." },
  hatch: { title: "Hatching", body: "Click a line, arc or circle on the side the strokes should go, as for the ground under a support. Their size and number are set in the side panel." },

  preview: { title: "Print preview", body: "This is the figure as it is exported: no helper lines, markers or grid, and text at its size in print. Press Q again to go back to editing." },
  export: { title: "Export", body: "SVG saves a picture file. TikZ saves a .tex file to \\input in LaTeX, and Copy TikZ puts the same text on the clipboard. How wide the figure is, and how large its text, is set in the box in the corner." },
};

const WELCOME_KEY = "mech-sketch.welcome";
const TIPS_KEY = "mech-sketch.tips";
const SESSION_KEY = "mech-sketch.session";

const read = (store: () => Storage, key: string): string | null => {
  try { return store().getItem(key); } catch { return null; } // storage can be unavailable (private window, file:// in some browsers)
};
const write = (store: () => Storage, key: string, value: string): void => {
  try { store().setItem(key, value); } catch { /* nothing to remember it in */ }
};

/** Whether the welcome is still due: it is shown until someone says not to show it again. */
export const welcomeDue = (): boolean => read(() => localStorage, WELCOME_KEY) !== "seen";
export const setWelcomeDue = (due: boolean): void => write(() => localStorage, WELCOME_KEY, due ? "" : "seen");

/** True the first time it is asked in a browser session, so a reload does not ask for support again. */
export function firstInSession(): boolean {
  if (read(() => sessionStorage, SESSION_KEY)) return false;
  write(() => sessionStorage, SESSION_KEY, "1");
  return true;
}

/** Which tips are done with, and whether tips are shown at all. */
export class TipBook {
  private seen = new Set<string>();
  off = false;

  constructor() {
    try {
      const saved = JSON.parse(read(() => localStorage, TIPS_KEY) ?? "{}") as { seen?: unknown; off?: unknown };
      if (Array.isArray(saved.seen)) this.seen = new Set(saved.seen.filter((x): x is string => typeof x === "string"));
      this.off = saved.off === true;
    } catch {
      // Unreadable: start with every tip still to come.
    }
  }

  private save(): void {
    write(() => localStorage, TIPS_KEY, JSON.stringify({ seen: [...this.seen], off: this.off }));
  }

  /** The tip for a feature, if there is one and it is still to be shown. */
  due(id: string): Tip | null {
    return !this.off && !this.seen.has(id) ? TIPS[id] ?? null : null;
  }

  dismiss(id: string): void {
    this.seen.add(id);
    this.save();
  }

  setOff(off: boolean): void {
    this.off = off;
    this.save();
  }

  /** Every tip is shown once more. */
  reset(): void {
    this.seen.clear();
    this.off = false;
    this.save();
  }
}

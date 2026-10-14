import { clone, entity, geometryBox, symbol, type Id, type Sketch } from "./model";
import { copyObjects } from "./object-clipboard";
import { solveGroupMove } from "./group-move";
import { fillOutlines } from "./prims";
import { gradientPoints, gradientPosition } from "./gradient-fill";
import { add, sub, grow, boxIsEmpty, type V } from "./geom";
import { toScreen, type View } from "./render";
import type { SketchSolver, SolveResult } from "./solver";

export interface RotationSelection { source: Sketch; points: Id[]; objects: Set<Id>; pivot: V }
export interface RotationMode { key: string; pivot: V; angle: number }
export const selectionKey = (selection: Iterable<Id>): string => [...selection].sort().join("|");
export const rotateVector = ([x, y]: V, angle: number): V => [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)];
export const rotatePosition = (p: V, pivot: V, angle: number): V => add(pivot, rotateVector(sub(p, pivot), angle));

/** Include boundary holes, spline controls, construction geometry and attached annotations. */
export function rotationSelection(sk: Sketch, selection: Iterable<Id>): RotationSelection | null {
  const copied = copyObjects(sk, selection)?.sketch;
  if (!copied) return null;
  const box = geometryBox(copied);
  for (const s of copied.symbols) if (s.type === "note" || s.type === "frame" || s.type === "balloon") {
    grow(box, s.type === "balloon" ? [s.x + s.dx, s.y + s.dy] : [s.x, s.y]);
  }
  if (boxIsEmpty(box)) return null;
  return {
    source: clone(sk), points: copied.entities.filter(e => e.type === "point").map(e => e.id),
    objects: new Set([...copied.entities.map(e => e.id), ...copied.symbols.map(s => s.id), ...copied.constraints.map(c => c.id)]),
    pivot: [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2],
  };
}

/** Solve each preview from the original snapshot, never from a previous preview. */
export function rotateSelection(selection: RotationSelection, solver: SketchSolver, pivot: V, angle: number): { sketch: Sketch; result: SolveResult } | null {
  const { source, objects } = selection, candidate = clone(source);
  const drags = selection.points.map(id => {
    const p = entity(source, id);
    if (p?.type !== "point") throw new Error("Missing rotation point");
    const [x, y] = rotatePosition([p.x, p.y], pivot, angle);
    return { kind: "point" as const, id, x, y };
  });
  const result = solveGroupMove(candidate, solver, drags);
  if (!result.ok) return null;
  for (const e of candidate.entities) if (objects.has(e.id) && (e.type === "line" || e.type === "arc") && e.lx !== undefined && e.ly !== undefined) {
    [e.lx, e.ly] = rotateVector([e.lx, e.ly], angle);
  }
  for (const s of candidate.symbols) {
    if (!objects.has(s.id)) continue;
    if (s.type === "note" || s.type === "frame" || s.type === "balloon") [s.x, s.y] = rotatePosition([s.x, s.y], pivot, angle);
    if (s.type === "support" || s.type === "frame" || s.type === "centermark" || s.type === "load" || s.type === "moment" || s.type === "trace" || s.type === "lineload") {
      if (s.angle !== undefined || s.type === "trace") s.angle = (s.angle ?? 0) + angle;
    }
    if (s.type === "balloon" || s.type === "datum" || s.type === "load" || s.type === "moment" || s.type === "lineload") {
      if (s.dx !== undefined && s.dy !== undefined) [s.dx, s.dy] = rotateVector([s.dx, s.dy], angle);
    }
    if (s.type === "fill" && s.gradient) {
      const old = symbol(source, s.id);
      if (old?.type === "fill" && old.gradient) {
        const stops = gradientPoints(fillOutlines(source, old, 1), old.gradient);
        const outlines = fillOutlines(candidate, s, 1);
        s.gradient.from = gradientPosition(outlines, rotatePosition(stops[0], pivot, angle));
        s.gradient.to = gradientPosition(outlines, rotatePosition(stops[1], pivot, angle));
      }
    }
  }
  for (const c of candidate.constraints) if (objects.has(c.id) && c.type === "radius") c.angle += angle;
  return { sketch: candidate, result };
}

export function rotationHandles(view: View, mode: RotationMode): { pivot: V; handle: V } {
  const pivot = toScreen(view, mode.pivot);
  return { pivot, handle: add(pivot, [60 * Math.cos(mode.angle), -60 * Math.sin(mode.angle)]) };
}
/** Screen-only controls: their size stays constant while zooming. */
export function rotationOverlay(view: View, mode: RotationMode): string {
  const { pivot: [x, y], handle: [hx, hy] } = rotationHandles(view, mode);
  return `<g class="selection-rotation" aria-label="Selection rotation controls"><circle class="rotation-ring" cx="${x}" cy="${y}" r="60"/><path class="rotation-stem" d="M${x} ${y}L${hx} ${hy}"/><g class="rotation-pivot"><title>Drag to move the center of rotation</title><circle cx="${x}" cy="${y}" r="10"/><path d="M${x - 6} ${y}H${x + 6}M${x} ${y - 6}V${y + 6}"/></g><circle class="rotation-handle" cx="${hx}" cy="${hy}" r="9"><title>Drag to rotate; Shift snaps to 15 degrees</title></circle></g>`;
}

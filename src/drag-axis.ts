import type { V } from "./geom";

export type DragAxis = "x" | "y";
export function dominantDragAxis(position: V, origin: V): DragAxis {
  return Math.abs(position[0] - origin[0]) >= Math.abs(position[1] - origin[1]) ? "x" : "y";
}
export function lockDragToAxis(position: V, origin: V, axis: DragAxis): V {
  return axis === "x" ? [position[0], origin[1]] : [origin[0], position[1]];
}

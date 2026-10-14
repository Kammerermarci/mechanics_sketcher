import type { V } from "./geom";

/** Shift + touchpad scroll pans both axes together in screen pixels. */
export function wheelPanDelta(event: Pick<WheelEvent, "shiftKey" | "deltaMode" | "deltaX" | "deltaY">, viewport: V): V | null {
  if (!event.shiftKey) return null;
  const unit: V = event.deltaMode === 2 ? viewport : event.deltaMode === 1 ? [32, 32] : [1, 1];
  return [event.deltaX * unit[0], event.deltaY * unit[1]];
}

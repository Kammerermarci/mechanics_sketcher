import type { V } from "./geom";

/** Nearest intersection of the origin-aligned background grid, in drawing units. */
export function snapToGrid(position: V, spacing: number): V {
  const round = (value: number) => {
    // Limit multiplication noise for decimal spacings and avoid negative zero.
    const snapped = Number((Math.round(value / spacing) * spacing).toPrecision(15));
    return snapped === 0 ? 0 : snapped;
  };
  return [round(position[0]), round(position[1])];
}

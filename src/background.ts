// Editor background helpers; all distances follow the drawing, not the paper scale.
import type { Sketch } from "./model";
import type { View } from "./render";

export function backgroundPattern(view: View, sk: Sketch): string {
  const step = (sk.backgroundSpacingMm ?? 1) * view.scale;
  const origin = [view.w / 2 - view.cx * view.scale, view.h / 2 + view.cy * view.scale];
  const pattern = (id: string, spacing: number, marks: string): string => {
    // Omit an unreadably dense layer when zoomed out; never change its spacing.
    if (spacing < 2) return "";
    const x = ((origin[0] % spacing) + spacing) % spacing - spacing / 2;
    const y = ((origin[1] % spacing) + spacing) % spacing - spacing / 2;
    return `<defs><pattern id="${id}" width="${spacing}" height="${spacing}" patternUnits="userSpaceOnUse" x="${x}" y="${y}">${marks}</pattern></defs>` +
      `<rect width="${view.w}" height="${view.h}" fill="url(#${id})"/>`;
  };
  const lines = (spacing: number, cls: string) =>
    `<path class="${cls}" d="M${spacing / 2} 0V${spacing}M0 ${spacing / 2}H${spacing}"/>`;
  return sk.backgroundStyle === "grid"
    ? pattern("grid", step, lines(step, "grid-line")) + pattern("grid-major", step * 10, lines(step * 10, "grid-line grid-major"))
    : pattern("grid", step, `<circle class="grid-dot" cx="${step / 2}" cy="${step / 2}" r="0.9"/>`);
}

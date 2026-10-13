import { icon } from "./icons";
import type { RectangleMode } from "./primitive-geometry";

export type PrimitiveTool = RectangleMode | "arc" | "arc3" | "gradient" | "radialgradient";
export const PRIMITIVE_CHOICES = {
  rectangle: [
    { id: "rectangle", label: "2-point rectangle", short: "2-point", icon: "rectangle", note: "Opposite corners" },
    { id: "rectcenter", label: "Center-point rectangle", short: "Center", icon: "rectcenter", note: "Center, then corner" },
    { id: "rect3", label: "3-point rectangle", short: "3-point", icon: "rect3", note: "First edge, then width" },
  ],
  arc: [
    { id: "arc", label: "Center-point arc", short: "Center", icon: "arc", note: "Center, start, end" },
    { id: "arc3", label: "3-point arc", short: "3-point", icon: "arc3", note: "Start, end, point on arc" },
  ],
  gradient: [
    { id: "gradient", label: "Linear gradient fill", short: "Linear", icon: "gradient", note: "Colour along a direction" },
    { id: "radialgradient", label: "Radial gradient fill", short: "Radial", icon: "radialgradient", note: "Colour from the center outward" },
  ],
} as const;

const KEY = "mech-sketch.primitiveModes";
export class PrimitiveModes {
  rectangle: RectangleMode = "rectangle";
  arc: "arc" | "arc3" = "arc";
  gradient: "gradient" | "radialgradient" = "gradient";
  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
      if (["rectangle", "rectcenter", "rect3"].includes(saved?.rectangle)) this.rectangle = saved.rectangle;
      if (["arc", "arc3"].includes(saved?.arc)) this.arc = saved.arc;
      if (["gradient", "radialgradient"].includes(saved?.gradient)) this.gradient = saved.gradient;
    } catch { /* Storage unavailable: the standard modes remain usable. */ }
  }
  select(tool: string): tool is PrimitiveTool {
    if (["rectangle", "rectcenter", "rect3"].includes(tool)) this.rectangle = tool as RectangleMode;
    else if (tool === "arc" || tool === "arc3") this.arc = tool;
    else if (tool === "gradient" || tool === "radialgradient") this.gradient = tool;
    else return false;
    try { localStorage.setItem(KEY, JSON.stringify({ rectangle: this.rectangle, arc: this.arc, gradient: this.gradient })); } catch { /* storage unavailable */ }
    return true;
  }
  button(group: "rectangle" | "arc" | "gradient"): string {
    const choices = PRIMITIVE_CHOICES[group];
    const chosen = choices.find((c) => c.id === this[group])!;
    const title = group === "rectangle" ? "Rectangle" : group === "arc" ? "Arc" : "Gradient Fill";
    return `<div class="menu primitive-tool"><button type="button" class="tool" data-tool="${chosen.id}" aria-label="${chosen.label}" title="${chosen.label}${group === "arc" ? " (A)" : ""}">${icon(chosen.icon, 22)}<span>${title}</span><small>${chosen.short}</small></button>` +
      `<button type="button" class="primitive-toggle" data-menu="${group}" aria-label="${title} modes" aria-haspopup="menu" aria-expanded="false" aria-controls="${group}-modes">${icon("chevron", 12)}</button>` +
      `<div class="menu-list primitive-menu" id="${group}-modes" role="menu" aria-label="${title} modes" hidden>${choices.map((c) =>
        `<button type="button" role="menuitemradio" data-primitive="${c.id}" aria-checked="${c.id === chosen.id}">${icon(c.icon, 20)}<span>${c.label}<small>${c.note}</small></span><span class="primitive-check" aria-hidden="true">${c.id === chosen.id ? "✓" : ""}</span></button>`).join("")}</div></div>`;
  }
}

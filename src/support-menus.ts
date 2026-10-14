import { icon } from "./icons";
import { CUSTOM_SUPPORT_SHAPES } from "./custom-support-shapes";

export type SupportTool = "pin" | "roller" | "wall";
type Style = "classic" | "custom";
const KEY = "mech-sketch.supportStyles";
const names = { pin: "Pin", roller: "Roller", wall: "Fixed" };
const tools: SupportTool[] = ["pin", "roller", "wall"];

function artwork(tool: SupportTool, size: number): string {
  const shapes = CUSTOM_SUPPORT_SHAPES[tool === "wall" ? "fixed" : tool];
  return `<svg width="${size}" height="${size}" viewBox="-7 -2 14 10" aria-hidden="true"><g transform="scale(1,-1)">${shapes.map((shape) => {
    const paint = `fill="${shape.fill}" stroke="${shape.stroke}" stroke-width="${shape.width}"`;
    return shape.kind === "circle" ? `<circle cx="${shape.center[0]}" cy="${shape.center[1]}" r="${shape.radius}" ${paint}/>` :
      `<path d="M${shape.points.map((p) => p.join(",")).join(" L")}${shape.closed ? " Z" : ""}" ${paint}/>`;
  }).join("")}</g></svg>`;
}

/** Each support remembers its selected drawing style independently. */
export class SupportModes {
  private styles: Record<SupportTool, Style> = { pin: "classic", roller: "classic", wall: "classic" };
  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
      for (const tool of tools) if (saved?.[tool] === "custom") this.styles[tool] = "custom";
    } catch { /* Defaults work without browser storage. */ }
  }
  style(tool: SupportTool): Style { return this.styles[tool]; }
  select(value: string): SupportTool | null {
    const [tool, style, extra] = value.split(":");
    if (!tools.includes(tool as SupportTool) || !["classic", "custom"].includes(style) || extra !== undefined) return null;
    this.styles[tool as SupportTool] = style as Style;
    try { localStorage.setItem(KEY, JSON.stringify(this.styles)); } catch { /* Storage unavailable. */ }
    return tool as SupportTool;
  }
  button(tool: SupportTool): string {
    const style = this.style(tool), title = names[tool];
    const preview = (value: Style, size: number) => value === "custom" ? artwork(tool, size) : icon(tool, size);
    return `<div class="menu primitive-tool"><button type="button" class="tool" data-tool="${tool}" aria-label="${title}: ${style}" title="${title}: ${style}">${preview(style, 22)}<span>${title}</span><small>${style === "custom" ? "Custom" : "Classic"}</small></button>` +
      `<button type="button" class="primitive-toggle" data-menu="${tool}-support" aria-label="${title} styles" aria-haspopup="menu" aria-expanded="false" aria-controls="${tool}-support-modes">${icon("chevron", 12)}</button>` +
      `<div class="menu-list primitive-menu" id="${tool}-support-modes" role="menu" aria-label="${title} styles" hidden>${(["classic", "custom"] as const).map((value) =>
        `<button type="button" role="menuitemradio" data-support-mode="${tool}:${value}" aria-checked="${style === value}">${preview(value, 20)}<span>${value === "custom" ? "Custom filled" : "Classic"}<small>${value === "custom" ? "Filled SVG artwork" : "Standard engineering symbol"}</small></span><span class="primitive-check" aria-hidden="true">${style === value ? "✓" : ""}</span></button>`).join("")}</div></div>`;
  }
}

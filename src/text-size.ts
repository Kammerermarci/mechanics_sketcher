import type { Prim } from "./prims";

export interface TextSize {
  /** Text size relative to the normal annotation text: 1 is 100%. */
  textScale?: number;
}
export const TEXT_SIZE_MIN = 25, TEXT_SIZE_MAX = 300;

export function textSize(object: TextSize): number {
  const scale = object.textScale;
  return scale === undefined || !Number.isFinite(scale) ? 1 : Math.max(TEXT_SIZE_MIN / 100, Math.min(TEXT_SIZE_MAX / 100, scale));
}

export function setTextSize(object: TextSize, percent: number): void {
  const scale = textSize({ textScale: percent / 100 });
  if (scale === 1) delete object.textScale;
  else object.textScale = scale;
}

export function sizedText(prims: Prim[], object: TextSize): Prim[] {
  const scale = textSize(object);
  for (const p of prims) if (p.k === "text") {
    if (scale === 1) delete p.textScale;
    else p.textScale = scale;
  }
  return prims;
}

export function textSizePanel(object: TextSize, field = "text-size", attribute = "data-field", label = "Text size"): string {
  const percent = Math.round(textSize(object) * 100);
  return `<label class="field"><span>${label}</span><span class="slider-row"><input ${attribute}="${field}" type="range" min="${TEXT_SIZE_MIN}" max="${TEXT_SIZE_MAX}" step="5" value="${percent}"><output>${percent}%</output></span>` +
    `<small>Relative to the normal annotation text. 100% uses the default size.</small></label>`;
}

export function bearsText(object: { type: string; arrow?: unknown; element?: unknown }): boolean {
  if (object.type === "line" || object.type === "arc") return !!(object.arrow || object.element);
  return ["frame", "balloon", "datum", "note", "load", "lineload", "moment", "diagram", "distance", "angle", "radius"].includes(object.type);
}

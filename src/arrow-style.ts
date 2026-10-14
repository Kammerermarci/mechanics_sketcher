import type { Line, Arc } from "./model";

export const ARROW_HEAD_MIN = 0.5;
export const ARROW_HEAD_MAX = 3;
export const ARROW_HEAD_STEP = 0.25;

/** A discrete multiplier of the arrowhead's standard size for its thickness. */
export function arrowHeadScale(value?: number): number {
  if (value === undefined || !Number.isFinite(value)) return 1;
  return Math.max(ARROW_HEAD_MIN, Math.min(ARROW_HEAD_MAX, Math.round(value / ARROW_HEAD_STEP) * ARROW_HEAD_STEP));
}

export function arrowColor(arrow: Line | Arc): string | undefined {
  return arrow.color && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(arrow.color) ? arrow.color : undefined;
}

/** Additional controls for the selected arrow, using the app's shared colour palette. */
export function arrowStylePanel(arrow: Line | Arc): string {
  const scale = arrowHeadScale(arrow.headScale);
  return `<label class="field"><span>Arrowhead size</span><span class="slider-row"><input data-field="arrow-head-scale" type="range" min="${ARROW_HEAD_MIN * 100}" max="${ARROW_HEAD_MAX * 100}" step="${ARROW_HEAD_STEP * 100}" value="${scale * 100}" list="arrow-head-steps"><output>${scale * 100}%</output></span>` +
    `<datalist id="arrow-head-steps">${Array.from({ length: 11 }, (_, i) => `<option value="${50 + i * 25}"></option>`).join("")}</datalist>` +
    `<small>Relative to the standard head for this line thickness. Steps of 25%; 100% keeps the usual proportions. Double-click to reset.</small></label>` +
    `<label class="check"><input data-field="arrow-foot" type="checkbox"${arrow.foot ? " checked" : ""}${arrow.arrow === "both" || arrow.arrow === "none" ? " disabled" : ""}><span>Tail foot</span></label>` +
    `<p class="muted">A short perpendicular bar at the tail. Shown when the arrow has a head at one end; its size follows the arrowhead size.</p>`;
}

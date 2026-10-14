// Saved annotation colours belong to this browser, independently of any sketch.
import { colorAlpha, colorChannels, channelsColor, readColorMode, rememberColorMode, withAlpha, type ColorMode, type Channels } from "./color-channels";
const KEY = "mech-sketch.customColors";

/** One palette for fills, annotations and plots, followed by saved user colours. */
export const PALETTE_COLORS = ["#d5dbe1", "#eceff1", "#f6d9a8", "#f4b6a6", "#b9d7ee", "#bfe3c4", "#d9c8ea", "#8f9aa3",
  "#d32f2f", "#1565c0", "#2e7d32", "#ef6c00", "#6a1b9a", "#17201b"];
let shared: CustomPalette | undefined;
export const sharedColorPalette = (): CustomPalette => shared ??= new CustomPalette();

export function colorPanel(color: string | undefined, plot = false, inline = false): string {
  const selected = normalizeColor(color ?? "") ?? "#17201b";
  if (inline) return `<div class="field"><span id="fill-colour-label">Colour</span><div class="swatches" role="group" aria-labelledby="fill-colour-label">${sharedColorPalette().colors().map(c =>
    `<button type="button" class="swatch" data-color="${c}" aria-pressed="${selected === c}" aria-label="Colour ${c}" title="${c}" style="background:${c}"></button>`).join("")}` +
    `<button type="button" class="swatch custom" data-act="custom-color" title="Another colour" aria-label="Another colour"></button></div></div>`;
  return `<div class="field"><span>Colour</span><button type="button" class="plain colour-trigger" ${plot ? 'data-pact="color-palette"' : 'data-act="color-palette"'} aria-haspopup="dialog"><span class="colour-preview" style="background:${selected}" aria-hidden="true"></span>Change colour</button></div>`;
}

/** The shared palette lives in a bounded popup, keeping object settings compact. */
export function showColorPalette(initial: string, accept: (color: string, save: boolean) => void): void {
  if (document.getElementById("color-palette-dialog")) return;
  const selected = normalizeColor(initial) ?? "#17201b";
  const dialog = document.createElement("dialog");
  dialog.id = "color-palette-dialog";
  dialog.className = "color-palette-dialog";
  dialog.setAttribute("aria-labelledby", "color-palette-title");
  dialog.innerHTML = `<h2 id="color-palette-title">Change colour</h2><div class="swatches palette-grid" role="group" aria-label="Colour palette">${sharedColorPalette().colors().map(c =>
    `<button type="button" class="swatch" data-palette-color="${c}" aria-pressed="${selected === c}" aria-label="Colour ${c}" title="${c}" style="background:${c}"></button>`).join("")}</div>` +
    `<div class="dialog-actions"><button type="button" data-palette-custom>Another colour</button><button type="button" data-palette-cancel>Cancel</button></div>`;
  dialog.addEventListener("click", (e) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!button) return;
    const color = button.dataset.paletteColor;
    if (color) { dialog.close(); accept(color, false); }
    else if (button.hasAttribute("data-palette-custom")) { dialog.close(); showCustomColor(selected, accept); }
    else if (button.hasAttribute("data-palette-cancel")) dialog.close();
  });
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  document.body.append(dialog);
  dialog.showModal();
  (dialog.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ?? dialog.querySelector<HTMLButtonElement>("button"))?.focus();
}

export function normalizeColor(text: string): string | null {
  const hex = text.trim().replace(/^#/, "").toLowerCase();
  if (/^(?:[0-9a-f]{6}|[0-9a-f]{8})$/.test(hex)) return hex.endsWith("ff") && hex.length === 8 ? `#${hex.slice(0, 6)}` : `#${hex}`;
  if (/^(?:[0-9a-f]{3}|[0-9a-f]{4})$/.test(hex)) return normalizeColor(`#${[...hex].map((c) => c + c).join("")}`);
  return null;
}

export class CustomPalette {
  private saved: string[] = [];
  constructor() {
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
      if (Array.isArray(raw)) this.saved = [...new Set(raw.filter((c): c is string => typeof c === "string").map(normalizeColor).filter((c): c is string => !!c))];
    } catch { /* An unavailable or damaged preference does not prevent colouring. */ }
  }
  colors(base: readonly string[] = PALETTE_COLORS): string[] {
    return [...new Set([...base.map((c) => c.toLowerCase()), ...this.saved])];
  }
  add(color: string): void {
    const normalized = normalizeColor(color);
    if (!normalized || this.saved.includes(normalized)) return;
    this.saved.push(normalized);
    try { localStorage.setItem(KEY, JSON.stringify(this.saved)); } catch { /* Kept for this session when storage is unavailable. */ }
  }
}

/** The colour is only applied after an explicit OK; cancelling leaves it alone. */
export function showCustomColor(initial: string, accept: (color: string, save: boolean) => void): void {
  if (document.getElementById("custom-color-dialog")) return;
  const dialog = document.createElement("dialog");
  dialog.id = "custom-color-dialog";
  dialog.className = "custom-color-dialog";
  dialog.setAttribute("aria-labelledby", "custom-color-title");
  dialog.innerHTML = `<form><h2 id="custom-color-title">Custom colour</h2>` +
    `<div class="custom-color-preview" aria-label="Colour preview"><span></span></div>` +
    `<label class="field"><span>Colour system</span><select id="custom-color-mode"><option value="rgb">RGB</option><option value="hsl">HSL</option><option value="hsv">HSV</option></select></label>` +
    `<div id="custom-color-channels"></div>` +
    `<label class="field"><span>Opacity (%)</span><span class="color-channel-row"><input id="custom-color-alpha" type="range" min="0" max="100" step="1" aria-label="Opacity"><input id="custom-color-alpha-number" type="number" min="0" max="100" step="1" aria-label="Opacity percent"></span></label>` +
    `<label class="field"><span>Hex colour</span><input id="custom-color-hex" type="text" spellcheck="false" autocomplete="off" aria-describedby="custom-color-note"></label>` +
    `<p class="muted" id="custom-color-note">OK applies the colour. OK and Add also saves it in your annotation palettes for future use.</p>` +
    `<div class="dialog-actions"><button type="button" id="custom-color-cancel">Cancel</button><button type="submit" value="ok">OK</button><button type="submit" value="add" class="primary">OK and Add</button></div></form>`;
  const hex = dialog.querySelector<HTMLInputElement>("#custom-color-hex")!;
  const mode = dialog.querySelector<HTMLSelectElement>("#custom-color-mode")!;
  const channels = dialog.querySelector<HTMLElement>("#custom-color-channels")!;
  const alpha = dialog.querySelector<HTMLInputElement>("#custom-color-alpha")!;
  const alphaNumber = dialog.querySelector<HTMLInputElement>("#custom-color-alpha-number")!;
  const preview = dialog.querySelector<HTMLElement>(".custom-color-preview span")!;
  let color = normalizeColor(initial) ?? "#17201b";
  let values: Channels;
  let opacity = colorAlpha(color) * 100;
  mode.value = readColorMode();
  const update = () => {
    hex.value = color;
    hex.setCustomValidity("");
    preview.style.background = color;
    alpha.value = alphaNumber.value = String(Math.round(opacity));
  };
  const renderChannels = () => {
    const system = mode.value as ColorMode;
    values = colorChannels(color, system);
    const labels = system === "rgb" ? ["Red", "Green", "Blue"] : ["Hue", "Saturation", system === "hsl" ? "Lightness" : "Value"];
    channels.innerHTML = labels.map((label, i) => {
      const max = system === "rgb" ? 255 : i === 0 ? 360 : 100;
      const value = Math.round(values[i] * 10) / 10;
      return `<label class="field"><span>${label}${system === "rgb" ? "" : i === 0 ? " (°)" : " (%)"}</span><span class="color-channel-row"><input type="range" min="0" max="${max}" step="${system === "rgb" ? 1 : 0.1}" value="${value}" data-channel="${i}" aria-label="${label}"><input type="number" min="0" max="${max}" step="${system === "rgb" ? 1 : 0.1}" value="${value}" data-channel="${i}" aria-label="${label} value"></span></label>`;
    }).join("");
  };
  channels.addEventListener("input", e => {
    const input = e.target as HTMLInputElement;
    if (!input.hasAttribute("data-channel") || !Number.isFinite(input.valueAsNumber) || !input.validity.valid) return;
    const index = Number(input.dataset.channel);
    values[index] = input.valueAsNumber;
    channels.querySelectorAll<HTMLInputElement>(`[data-channel="${index}"]`).forEach(other => { if (other !== input) other.value = input.value; });
    color = channelsColor(values, mode.value as ColorMode, opacity / 100);
    update();
  });
  mode.addEventListener("change", () => { rememberColorMode(mode.value as ColorMode); renderChannels(); });
  for (const input of [alpha, alphaNumber]) input.addEventListener("input", () => {
    if (!Number.isFinite(input.valueAsNumber) || !input.validity.valid) return;
    opacity = input.valueAsNumber;
    color = withAlpha(color, opacity / 100);
    update();
  });
  hex.addEventListener("input", () => {
    hex.setCustomValidity("");
    const entered = normalizeColor(hex.value);
    if (entered) {
      color = entered;
      opacity = colorAlpha(color) * 100;
      preview.style.background = color;
      alpha.value = alphaNumber.value = String(Math.round(opacity));
      renderChannels();
    }
  });
  dialog.querySelector("form")!.addEventListener("submit", (e) => {
    e.preventDefault();
    const color = normalizeColor(hex.value);
    if (!color) {
      hex.setCustomValidity("Enter a hex colour such as #1565c0 or #1565c080 (with opacity).");
      hex.reportValidity();
      return;
    }
    const save = (e.submitter as HTMLButtonElement | null)?.value === "add";
    dialog.close();
    accept(color, save);
  });
  dialog.querySelector("#custom-color-cancel")!.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  update();
  renderChannels();
  document.body.append(dialog);
  dialog.showModal();
  hex.focus();
  hex.select();
}

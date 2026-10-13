// Saved annotation colours belong to this browser, independently of any sketch.
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
  if (/^[0-9a-f]{6}$/.test(hex)) return `#${hex}`;
  if (/^[0-9a-f]{3}$/.test(hex)) return `#${[...hex].map((c) => c + c).join("")}`;
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
    `<label class="field"><span>Choose a colour</span><input id="custom-color-picker" type="color"></label>` +
    `<label class="field"><span>Hex colour</span><input id="custom-color-hex" type="text" spellcheck="false" autocomplete="off" aria-describedby="custom-color-note"></label>` +
    `<p class="muted" id="custom-color-note">OK applies the colour. OK and Add also saves it in your annotation palettes for future use.</p>` +
    `<div class="dialog-actions"><button type="button" id="custom-color-cancel">Cancel</button><button type="submit" value="ok">OK</button><button type="submit" value="add" class="primary">OK and Add</button></div></form>`;
  const picker = dialog.querySelector<HTMLInputElement>("#custom-color-picker")!;
  const hex = dialog.querySelector<HTMLInputElement>("#custom-color-hex")!;
  picker.value = hex.value = normalizeColor(initial) ?? "#17201b";
  picker.addEventListener("input", () => { hex.value = picker.value; hex.setCustomValidity(""); });
  hex.addEventListener("input", () => {
    hex.setCustomValidity("");
    const color = normalizeColor(hex.value);
    if (color) picker.value = color;
  });
  dialog.querySelector("form")!.addEventListener("submit", (e) => {
    e.preventDefault();
    const color = normalizeColor(hex.value);
    if (!color) {
      hex.setCustomValidity("Enter a hex colour such as #1565c0.");
      hex.reportValidity();
      return;
    }
    const save = (e.submitter as HTMLButtonElement | null)?.value === "add";
    dialog.close();
    accept(color, save);
  });
  dialog.querySelector("#custom-color-cancel")!.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  document.body.append(dialog);
  dialog.showModal();
  hex.focus();
  hex.select();
}

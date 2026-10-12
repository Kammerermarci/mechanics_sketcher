// Fields of the side panel that take TeX show it typeset while they are not
// being typed in: \pi as π, \frac{\pi}{2} as a fraction, F_1 with its
// subscript. Clicking one shows what was typed, to change it.
//
// A field says it takes TeX with data-tex: "math" for a name written as TeX
// math (typeset once it has a command, a sub- or superscript or a brace in it),
// "formula" for a number or a formula (typeset once it has a LaTeX command).
// The typeset text is the field's background image while it does not have the
// keyboard, and what was typed is hidden over it; nothing about the field
// itself changes, so it is laid out and read as any other.

import { texEngine } from "./tex";
import { labelTex } from "./prims";

/** Size of the typeset text, in px: about that of the text in the fields. */
const EM = 15;
const INK = "#17201b";

/** Puts the typeset text behind each field under `root` that takes TeX, or takes it away where there is none to show. */
export function showTexFields(root: ParentNode): void {
  for (const input of root.querySelectorAll<HTMLInputElement>("input[data-tex]")) {
    const typed = input.value.trim();
    const math = input.dataset.tex === "math";
    const tex = !typed ? "" : math ? (/[\\^_{]/.test(typed) ? labelTex(typed) : "") : /\\/.test(typed) ? typed.replace(/^\$+|\$+$/g, "") : "";
    const image = tex ? typesetImage(tex) : null;
    input.classList.toggle("tex-shown", !!image);
    if (image) input.style.setProperty("--tex", image);
    else input.style.removeProperty("--tex");
  }
}

/** The TeX typeset as an SVG image for a CSS background; null when it cannot be. */
function typesetImage(tex: string): string | null {
  try {
    const engine = texEngine();
    const m = engine.measure(tex);
    const markup = engine.svg(tex, 1, 1, EM, "tex");
    if (!markup || !(m.w > 0)) return null;
    const w = Math.ceil(m.w * EM + 2), h = Math.ceil((m.asc + m.desc) * EM + 2);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" color="${INK}" fill="${INK}">${markup}</svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  } catch {
    return null;
  }
}

/** TeX typeset as an SVG to put in a line of text, on its baseline. `em` is the size of that text, in px. */
export function texInline(tex: string, em = 14): string {
  try {
    const engine = texEngine();
    const m = engine.measure(tex);
    const markup = engine.svg(tex, 0, 0, em, "tex");
    if (!markup) return "";
    return `<svg class="tex-inline" width="${(m.w * em).toFixed(2)}" height="${((m.asc + m.desc) * em).toFixed(2)}" style="vertical-align:${(-m.desc * em).toFixed(2)}px" aria-hidden="true">${markup}</svg>`;
  } catch {
    return "";
  }
}

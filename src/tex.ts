// A small stand-in for TeX math on screen: enough to preview labels such as
// F_1, 2a, \alpha or \vec{v}_{0} with sub- and superscripts. The TikZ export
// passes the original string to LaTeX untouched.

export interface Run {
  text: string;
  italic: boolean;
  /** -1 subscript, 0 baseline, 1 superscript. */
  level: -1 | 0 | 1;
}

const SYMBOLS: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ",
  eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν",
  xi: "ξ", pi: "π", rho: "ρ", varrho: "ϱ", sigma: "σ", tau: "τ", upsilon: "υ", phi: "ϕ",
  varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ",
  Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  circ: "∘", cdot: "·", times: "×", pm: "±", infty: "∞", ell: "ℓ", degree: "°",
  ",": " ", ";": " ", " ": " ", quad: " ", "!": "",
  le: "≤", ge: "≥", ne: "≠", approx: "≈", perp: "⊥", parallel: "∥", prime: "′",
};
/** Combining marks for accent commands. */
const ACCENTS: Record<string, string> = {
  vec: "⃗", dot: "̇", ddot: "̈", bar: "̄", hat: "̂", tilde: "̃",
  overline: "̄",
};
const UPRIGHT = new Set(["mathrm", "text", "textrm", "mathup", "operatorname"]);
const TRANSPARENT = new Set(["mathit", "mathbf", "boldsymbol", "bm", "mathbb", "left", "right", "displaystyle"]);

export function texRuns(tex: string): Run[] {
  const runs: Run[] = [];
  let i = 0;

  const push = (text: string, italic: boolean, level: Run["level"]) => {
    if (!text) return;
    const last = runs[runs.length - 1];
    if (last && last.italic === italic && last.level === level) last.text += text;
    else runs.push({ text, italic, level });
  };

  // Parses one atom: a braced group, a command, or a single character.
  const atom = (level: Run["level"], upright: boolean): void => {
    const ch = tex[i];
    if (ch === "{") {
      i++;
      while (i < tex.length && tex[i] !== "}") item(level, upright);
      i++;
      return;
    }
    if (ch === "\\") {
      i++;
      let name = "";
      if (i < tex.length && /[a-zA-Z]/.test(tex[i])) {
        while (i < tex.length && /[a-zA-Z]/.test(tex[i])) name += tex[i++];
        while (tex[i] === " ") i++; // TeX swallows spaces after a command word
      } else {
        name = tex[i++] ?? "";
      }
      if (name in ACCENTS) {
        const before = runs.length;
        const prev = runs[before - 1];
        const prevLen = prev?.text.length ?? 0;
        atom(level, upright);
        // Put the combining mark after the first character the argument produced.
        if (prev && prev.text.length > prevLen) {
          prev.text = prev.text.slice(0, prevLen + 1) + ACCENTS[name] + prev.text.slice(prevLen + 1);
        } else if (runs[before]) {
          runs[before].text = runs[before].text.slice(0, 1) + ACCENTS[name] + runs[before].text.slice(1);
        }
        return;
      }
      if (UPRIGHT.has(name)) return atom(level, true);
      if (TRANSPARENT.has(name)) return;
      if (name in SYMBOLS) {
        const s = SYMBOLS[name];
        // Lowercase Greek is set in italics, like Latin letters.
        push(s, !upright && /[α-ωϑϕϱ]/.test(s), level);
        return;
      }
      push(name, false, level);
      return;
    }
    i++;
    if (ch === "~") return push(" ", false, level);
    if (ch === " ") return upright ? push(" ", false, level) : undefined;
    push(ch === "-" ? "−" : ch, !upright && /[a-zA-Z]/.test(ch), level);
  };

  const item = (level: Run["level"], upright: boolean): void => {
    const ch = tex[i];
    if (ch === "_" || ch === "^") {
      i++;
      if (i < tex.length) atom(ch === "_" ? -1 : 1, upright);
      return;
    }
    atom(level, upright);
  };

  while (i < tex.length) {
    if (tex[i] === "}") { i++; continue; } // stray closing brace
    item(0, false);
  }
  return runs;
}

const SCRIPT_SCALE = 0.7;

/** Rough width in em, for hit boxes and layout before real metrics exist. */
export function runsWidthEm(runs: Run[]): number {
  let w = 0;
  for (const r of runs) {
    let chars = 0;
    for (const ch of r.text) {
      if (/[̀-ͯ⃐-⃿]/.test(ch)) continue; // combining marks
      chars += /[   ]/.test(ch) ? 0.25 : /[mMWw]/.test(ch) ? 0.8 : /[ijlI.,′°]/.test(ch) ? 0.3 : 0.52;
    }
    w += chars * (r.level === 0 ? 1 : SCRIPT_SCALE);
  }
  return w;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** SVG <tspan> markup for the runs. `em` is the font size in px. */
export function runsToTspans(runs: Run[], em: number): string {
  let out = "";
  let shift = 0; // current baseline shift in px (positive is down)
  for (const r of runs) {
    const want = r.level === -1 ? 0.22 * em : r.level === 1 ? -0.42 * em : 0;
    const dy = want - shift;
    shift = want;
    const size = r.level === 0 ? "" : ` font-size="${(em * SCRIPT_SCALE).toFixed(2)}"`;
    const style = r.italic ? ` font-style="italic"` : "";
    out += `<tspan dy="${dy.toFixed(2)}"${size}${style}>${esc(r.text)}</tspan>`;
  }
  return out;
}

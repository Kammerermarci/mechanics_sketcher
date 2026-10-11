// Letters that carry an accent, such as é, ő and ű. TeX's fonts hold the
// letter and the accent apart, so wherever a label is typeset (by MathJax on
// screen and in the SVG, by LaTeX from the TikZ) an accented letter is put
// together from the two: the label looks the same in all three, and LaTeX
// takes it in math mode, where a bare é is an error.

/** The long umlaut of ő and ű. */
export const DOUBLE_ACUTE = "\u030B";

/** The LaTeX command that sets each accent over a letter in math mode, by Unicode combining mark. */
const MATH_ACCENT: Record<string, string> = {
  "\u0300": "\\grave",
  "\u0301": "\\acute",
  "\u0302": "\\hat",
  "\u0303": "\\tilde",
  "\u0304": "\\bar",
  "\u0306": "\\breve",
  "\u0307": "\\dot",
  "\u0308": "\\ddot",
  "\u030A": "\\mathring",
  // No math command of its own: this takes it from the roman font, the way \acute is defined. The number is
  // hexadecimal 707D written in decimal: with babel, some languages take the quote sign that marks a hexadecimal one.
  [DOUBLE_ACUTE]: "\\mathaccent28797",
  "\u030C": "\\check",
};

export interface Accented {
  /** The plain letter under the accent. */
  base: string;
  /** The accent, as a Unicode combining mark. */
  mark: string;
  /** The LaTeX command for it in math mode. */
  math: string;
}

/** An accented letter taken apart; null for anything else, and for accents TeX has no command for. */
export function splitAccent(ch: string): Accented | null {
  const parts = ch.normalize("NFD");
  if (parts.length !== 2 || !/[A-Za-z]/.test(parts[0])) return null;
  const math = MATH_ACCENT[parts[1]];
  return math ? { base: parts[0], mark: parts[1], math } : null;
}

/** Every single character that splitAccent takes apart, as the inside of a regular expression's character class. */
export const ACCENTED = (() => {
  let out = "";
  for (const [from, to] of [[0xc0, 0x24f], [0x1e00, 0x1eff]]) {
    for (let c = from; c <= to; c++) if (splitAccent(String.fromCharCode(c))) out += String.fromCharCode(c);
  }
  return out;
})();

/** Commands whose argument is ordinary text, even in the middle of math. */
const TEXT_COMMANDS = new Set([
  "text", "textrm", "textnormal", "textup", "textit", "textsl", "textbf", "textsf", "texttt", "textsc", "emph", "mbox", "hbox", "intertext",
]);

/**
 * TeX as LaTeX will take it: in math, an accented letter becomes its accent
 * command over the plain letter (é is \acute{e}), since LaTeX takes no
 * accented letters there. In text they stay as typed, which LaTeX reads as
 * they are. `start` says which of the two the source begins in.
 */
export function latexAccents(tex: string, start: "math" | "text"): string {
  // What each open brace group, and each run of math between dollar signs, will go back to.
  const outer: { text: boolean; dollar: boolean }[] = [];
  let text = start === "text";
  /** Set by \text and its like: the group that opens next holds text. */
  let textNext = false;
  /** After _ or ^, or a command with no brace yet: what comes next is taken as one piece, so an accent is wrapped up. */
  let single = false;
  let out = "";
  for (let i = 0; i < tex.length;) {
    const ch = String.fromCodePoint(tex.codePointAt(i)!);
    if (ch === "\\") {
      let j = i + 1;
      if (j < tex.length && /[a-zA-Z]/.test(tex[j])) {
        while (j < tex.length && /[a-zA-Z]/.test(tex[j])) j++;
        textNext = TEXT_COMMANDS.has(tex.slice(i + 1, j));
        single = true;
      } else {
        // \( and \) open and close math inside text; any other one stands for itself.
        if (tex[j] === "(" && text) { outer.push({ text, dollar: false }); text = false; }
        else if (tex[j] === ")" && !text && outer.length) text = outer.pop()!.text;
        j = Math.min(j + 1, tex.length);
        textNext = single = false;
      }
      out += tex.slice(i, j);
      i = j;
      continue;
    }
    i += ch.length;
    if (ch === "{") {
      outer.push({ text, dollar: false });
      if (textNext) text = true;
    } else if (ch === "}") {
      // Back to what was outside, past any math left open inside the group.
      while (outer.length && outer[outer.length - 1].dollar) outer.pop();
      if (outer.length) text = outer.pop()!.text;
    } else if (ch === "$") {
      if (text) { outer.push({ text, dollar: true }); text = false; }
      else if (outer.length && outer[outer.length - 1].dollar) text = outer.pop()!.text;
    }
    if (ch !== " ") textNext = false;
    const split = text ? null : splitAccent(ch);
    if (split) {
      const set = `${split.math}{${split.base === "i" ? "\\imath" : split.base === "j" ? "\\jmath" : split.base}}`;
      out += single ? `{${set}}` : set;
    } else out += ch;
    if (ch !== " ") single = ch === "_" || ch === "^";
  }
  return out;
}

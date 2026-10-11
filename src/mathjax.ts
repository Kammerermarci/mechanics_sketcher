// Typesets labels with MathJax, so the editor shows real TeX math. MathJax is
// bundled, not fetched, and runs without touching the page: it hands back SVG
// paths that are dropped straight into the drawing.

import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import "mathjax-full/js/input/tex/base/BaseConfiguration.js";
import "mathjax-full/js/input/tex/ams/AmsConfiguration.js";
import "mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js";
import "mathjax-full/js/input/tex/boldsymbol/BoldsymbolConfiguration.js";
import "mathjax-full/js/input/tex/textmacros/TextMacrosConfiguration.js";
import "mathjax-full/js/input/tex/noundefined/NoUndefinedConfiguration.js";
import { Configuration } from "mathjax-full/js/input/tex/Configuration.js";
import { RegExpMap } from "mathjax-full/js/input/tex/SymbolMap.js";
import type { MmlNode } from "mathjax-full/js/core/MmlTree/MmlNode.js";
import { getRange } from "mathjax-full/js/core/MmlTree/OperatorDictionary.js";
import type TexParser from "mathjax-full/js/input/tex/TexParser.js";
import type { ParseMethod } from "mathjax-full/js/input/tex/Types.js";
import type { TexEngine, TexMetrics } from "./tex";
import { ACCENTED, DOUBLE_ACUTE, splitAccent } from "./accents";

// MathJax's font has no é or ő, only e, o and the accents. Left alone, such a
// letter is handed to whatever font the browser has, at a width MathJax can
// only guess. So an accented letter is read as its letter with the accent set
// over it, in math and inside \text{...} alike. An i or j loses its dot first.
const accented = new RegExp(`[${ACCENTED}]`);

/** A handler for single characters, which is what these maps are given. */
const reads = (f: (parser: TexParser, ch: string) => void): ParseMethod => (parser, ch) => f(parser, ch as string);

/** Reads the plain letter as if it had been typed in braces, in whatever font is in force. */
function letterUnder(parser: TexParser, ch: string, letter: string): MmlNode {
  parser.string = `{${letter}}` + parser.string.slice(parser.i);
  parser.i = 0;
  return parser.ParseArg(ch);
}

/** The accent to go over a letter. MathJax swaps a combining mark used as an accent for the glyph that draws it. */
function accentOver(parser: TexParser, mark: string, def: Record<string, unknown>): MmlNode {
  const mo = parser.create("token", "mo", def, mark);
  if (mark !== DOUBLE_ACUTE) return mo;
  // The font has the long umlaut only as a mark that hangs back over the letter before it, half an em wide.
  return parser.create("node", "mpadded", [mo], { width: 0, lspace: "0.25em" });
}

new RegExpMap("accented-math", reads((parser, ch) => {
  const { base, mark } = splitAccent(ch)!;
  const letter = letterUnder(parser, ch, base === "i" ? "\\imath" : base === "j" ? "\\jmath" : base);
  // Built the way MathJax builds \acute{e}: in the font in force, as an accent that sits close and is centred.
  const font = parser.stack.env.font;
  const over = accentOver(parser, mark, { ...(font ? { mathvariant: font } : {}), accent: true, mathaccent: true, stretchy: false });
  const both = parser.create("node", "munderover");
  both.childNodes[0] = letter;
  both.childNodes[2] = over;
  letter.parent = over.parent = both;
  parser.Push(parser.create("node", "TeXAtom", [both]));
}), accented);

new RegExpMap("accented-text", reads((parser, ch) => {
  const { base, mark } = splitAccent(ch)!;
  const letter = letterUnder(parser, ch, base === "i" ? "\u0131" : base === "j" ? "\u0237" : base);
  // The accent says that it is one; said on the two together, MathJax takes it for an ordinary sign.
  parser.Push(parser.create("node", "mover", [letter, accentOver(parser, mark, { accent: true })]));
}), accented);

// Hungarian opens a quotation with low quote marks, which the font lacks: two commas drawn close, as TeX does it.
new RegExpMap("low-quote", reads((parser) => {
  parser.string = ",\\kern-0.06em," + parser.string.slice(parser.i);
  parser.i = 0;
}), /\u201E/);

// A sign outside every range MathJax knows of (the euro sign, an emoji) makes it stop with an
// error when it meets one in math. Here it is passed on as it is, for the browser to draw.
const unknown = { test: (ch: string) => ch.codePointAt(0)! > 0x7f && getRange(ch) === null } as RegExp;
new RegExpMap("unknown-sign", reads((parser, ch) => {
  parser.Push(parser.create("token", "mi", { mathvariant: "normal" }, ch));
}), unknown);

Configuration.create("accented", { handler: { character: ["accented-math", "unknown-sign"] } });
Configuration.create("accented-text", { parser: "text", handler: { character: ["accented-text", "low-quote"] } });

interface Typeset extends TexMetrics {
  /** viewBox of the MathJax output, in 1/1000 em. */
  viewBox: string;
  /** Everything inside MathJax's <svg> element. */
  inner: string;
}

export function createMathJaxEngine(): TexEngine {
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  const doc = mathjax.document("", {
    InputJax: new TeX({
      packages: ["base", "ams", "newcommand", "boldsymbol", "textmacros", "noundefined", "accented"],
      textmacros: { packages: ["text-base", "accented-text"] },
    }),
    // Without a font cache every label carries its own paths, so one label's
    // markup can be reused anywhere, including in an exported file.
    OutputJax: new SVG({ fontCache: "none" }),
  });
  const cache = new Map<string, Typeset>();

  const typeset = (tex: string): Typeset => {
    const hit = cache.get(tex);
    if (hit) return hit;
    const node = doc.convert(tex, { display: false });
    const html = adaptor.innerHTML(node);
    const open = /<svg[^>]*viewBox="([^"]+)"[^>]*>/.exec(html);
    const close = html.lastIndexOf("</svg>");
    let out: Typeset;
    if (open && close > 0) {
      const [, minY, width, height] = open[1].split(/\s+/).map(Number);
      out = {
        viewBox: open[1],
        inner: html.slice(open.index + open[0].length, close),
        w: width / 1000,
        asc: -minY / 1000,
        desc: (height + minY) / 1000,
      };
    } else {
      out = { viewBox: "0 0 0 0", inner: "", w: 0, asc: 0, desc: 0 };
    }
    cache.set(tex, out);
    return out;
  };

  return {
    measure: (tex) => {
      const t = typeset(tex);
      return { w: t.w, asc: t.asc, desc: t.desc };
    },
    svg: (tex, x, y, em, cls) => {
      const t = typeset(tex);
      if (!t.inner) return "";
      return `<svg class="${cls}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${(t.w * em).toFixed(2)}" height="${((t.asc + t.desc) * em).toFixed(2)}" viewBox="${t.viewBox}" overflow="visible">${t.inner}</svg>`;
    },
  };
}

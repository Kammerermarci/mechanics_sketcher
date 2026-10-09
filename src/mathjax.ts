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
import type { TexEngine, TexMetrics } from "./tex";

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
    InputJax: new TeX({ packages: ["base", "ams", "newcommand", "boldsymbol", "textmacros", "noundefined"] }),
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

// Writes the figure out as SVG and as TikZ. Both read the same primitive list
// the screen draws from, in paper millimetres, so what is exported is what was
// on screen without the editing aids.

import type { Sketch } from "./model";
import {
  type Prim, type StrokeStyle, type Outline, type Anchor, type LinePrim, type ArcPrim,
  PAPER, STROKE_MM, STROKE_DASH, mmPerUnit, buildPrims, arrowHeads, textBox, outlinePolygon,
} from "./prims";
import { type V, type Box, emptyBox, grow, boxIsEmpty, polar, wrap, TWO_PI } from "./geom";
import { texEngine } from "./tex";
import { outlinePath } from "./render";

/** The figure as primitives: no construction geometry, no hidden dimensions. */
export function figurePrims(sk: Sketch): Prim[] {
  return buildPrims(sk, mmPerUnit(sk), { editor: false });
}

/** Everything the primitives cover, in paper mm. */
export function figureBounds(prims: Prim[]): Box {
  const b = emptyBox();
  for (const p of prims) {
    if (p.k === "text") {
      const t = textBox(p);
      grow(b, [t.x0, t.y0]);
      grow(b, [t.x1, t.y1]);
    } else if (p.k === "region") {
      for (const o of p.outlines) for (const q of outlinePolygon(o)) grow(b, q);
    } else {
      const half = STROKE_MM[p.stroke] / 2;
      if (p.k === "line") {
        grow(b, p.a, half);
        grow(b, p.b, half);
      } else if (p.k === "circle") grow(b, p.c, p.r + half);
      else if (p.k === "poly") for (const q of p.pts) grow(b, q, half);
      else {
        const n = Math.max(2, Math.ceil((p.a1 - p.a0) / (Math.PI / 30)));
        for (let i = 0; i <= n; i++) grow(b, polar(p.c, p.r, p.a0 + ((p.a1 - p.a0) * i) / n), half);
      }
      if (p.k === "line" || p.k === "arc") for (const head of arrowHeads(p)) for (const q of head) grow(b, q);
    }
  }
  return b;
}

// ---- SVG ----------------------------------------------------------------------

/** Trims a number to at most `digits` decimals, without trailing zeros. */
const num = (v: number, digits = 3): string => {
  if (Math.abs(v) < 0.5 / 10 ** digits) return "0"; // also keeps "-0" out
  const s = v.toFixed(digits);
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
};

/**
 * The figure as a standalone SVG file, or null when there is nothing to draw.
 * Sizes are in millimetres; labels are outlines, so no font is needed to show it.
 */
export function toSvg(sk: Sketch): string | null {
  const prims = figurePrims(sk);
  const box = figureBounds(prims);
  if (boxIsEmpty(box)) return null;
  const margin = 1;
  const w = box.x1 - box.x0 + 2 * margin, h = box.y1 - box.y0 + 2 * margin;
  // SVG's y axis points down: flip, and put the top-left corner of the figure at the origin.
  const M = ([x, y]: V): V => [x - box.x0 + margin, box.y1 - y + margin];
  const pt = (q: V) => { const m = M(q); return `${num(m[0])},${num(m[1])}`; };
  const engine = texEngine();

  const body: string[] = [];
  for (const p of prims) {
    if (p.k === "region") {
      body.push(`<path d="${outlinePath(p.outlines, M, 1)}" fill="${p.color}" fill-rule="evenodd" stroke="none"/>`);
      continue;
    }
    if (p.k === "text") {
      const t = textBox(p);
      const corner = M([t.x0, t.y1]);
      // currentColor would depend on where the file is placed; make it black outright.
      body.push(engine.svg(p.tex, corner[0], corner[1], PAPER.em, "label").replace(/currentColor/g, "#000").replace(' class="label"', ' fill="#000" stroke="none"'));
      continue;
    }
    const dash = STROKE_DASH[p.stroke];
    const stroke = `stroke-width="${num(STROKE_MM[p.stroke])}"` + (dash ? ` stroke-dasharray="${dash.map((d) => num(d)).join(" ")}"` : "");
    const fill = (p.k === "circle" || p.k === "poly") && p.fill ? ` fill="${p.fill === "ink" ? "#000" : "#fff"}"` : "";
    if (p.k === "line") {
      const a = M(p.a), b = M(p.b);
      body.push(`<line x1="${num(a[0])}" y1="${num(a[1])}" x2="${num(b[0])}" y2="${num(b[1])}" ${stroke}/>`);
    } else if (p.k === "circle") {
      const c = M(p.c);
      body.push(`<circle cx="${num(c[0])}" cy="${num(c[1])}" r="${num(p.r)}" ${stroke}${fill}/>`);
    } else if (p.k === "poly") {
      body.push(`<polygon points="${p.pts.map(pt).join(" ")}" ${stroke}${fill}/>`);
    } else {
      const s = M(polar(p.c, p.r, p.a0)), e = M(polar(p.c, p.r, p.a1));
      const r = num(p.r);
      // Counter-clockwise on paper is sweep-flag 0 once y is flipped.
      body.push(`<path d="M${num(s[0])} ${num(s[1])}A${r} ${r} 0 ${p.a1 - p.a0 > Math.PI ? 1 : 0} 0 ${num(e[0])} ${num(e[1])}" ${stroke}/>`);
    }
    if (p.k === "line" || p.k === "arc") {
      for (const head of arrowHeads(p)) body.push(`<polygon points="${head.map(pt).join(" ")}" fill="#000" stroke="none"/>`);
    }
  }

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(w, 2)}mm" height="${num(h, 2)}mm" viewBox="0 0 ${num(w)} ${num(h)}">\n` +
    `<g fill="none" stroke="#000" stroke-linecap="round" stroke-linejoin="round" font-family="'Latin Modern Math', 'STIX Two Math', 'Times New Roman', serif">\n` +
    body.join("\n") +
    `\n</g>\n</svg>\n`
  );
}

// ---- TikZ ---------------------------------------------------------------------

/** Line widths in points, as LaTeX users know them. */
const TIKZ_WIDTH: Record<StrokeStyle, string> = {
  member: "0.8pt", construction: "0.4pt", dim: "0.3pt", symbol: "0.4pt", hatch: "0.3pt", centre: "0.3pt", centreline: "0.4pt",
};
const TIKZ_ANCHOR: Record<Anchor, string> = {
  c: "center", n: "north", s: "south", e: "east", w: "west",
  ne: "north east", nw: "north west", se: "south east", sw: "south west",
};
const deg = (rad: number) => num((rad * 180) / Math.PI, 2);
const co = (q: V) => `(${num(q[0], 2)},${num(q[1], 2)})`;

function tikzColor(hex: string): string {
  const v = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!v) return "black!15";
  return `{rgb,255:red,${parseInt(v[1], 16)};green,${parseInt(v[2], 16)};blue,${parseInt(v[3], 16)}}`;
}

function tikzOutline(o: Outline): string {
  if (o.kind === "circle") return `${co(o.c)} circle[radius=${num(o.r, 2)}]`;
  let s = co(o.start);
  o.segs.forEach((seg, i) => {
    if (seg.k === "L") {
      // The last straight side is the one "cycle" draws.
      if (i < o.segs.length - 1) s += ` -- ${co(seg.to)}`;
      return;
    }
    // An arc carries on from the current point; its end is the next corner.
    const sweep = seg.ccw ? wrap(seg.a1 - seg.a0) || TWO_PI : -(wrap(seg.a0 - seg.a1) || TWO_PI);
    s += ` arc[start angle=${deg(seg.a0)}, end angle=${deg(seg.a0 + sweep)}, radius=${num(seg.r, 2)}]`;
  });
  return `${s} -- cycle`;
}

function tips(p: LinePrim | ArcPrim): string {
  if (p.arrowA && p.arrowB) return ", tip-tip";
  if (p.arrowA) return ", tip-";
  if (p.arrowB) return ", -tip";
  return "";
}

/**
 * The figure as a tikzpicture, or null when there is nothing to draw. One
 * unit is one millimetre. Labels are passed to LaTeX as they were typed, so
 * they come out in the document's own font.
 */
export function toTikz(sk: Sketch): string | null {
  const prims = figurePrims(sk);
  if (!prims.length) return null;
  const used = new Set<StrokeStyle>();
  let needTip = false, needLabel = false;
  const lines: string[] = [];
  /** Plain line segments of one style and symbol in a row share a \draw. */
  let run: { style: StrokeStyle; ref: string | undefined; parts: string[] } | null = null;
  const flush = () => {
    if (run) lines.push(`  \\draw[${run.style}] ${run.parts.join(" ")};`);
    run = null;
  };

  for (const p of prims) {
    if (p.k !== "text" && p.k !== "region") used.add(p.stroke);
    if (p.k === "line" && !p.arrowA && !p.arrowB) {
      if (!run || run.style !== p.stroke || run.ref !== p.ref || run.parts.length >= 8) {
        flush();
        run = { style: p.stroke, ref: p.ref, parts: [] };
      }
      run.parts.push(`${co(p.a)} -- ${co(p.b)}`);
      continue;
    }
    flush();
    if (p.k === "region") {
      lines.push(`  \\fill[fill=${tikzColor(p.color)}, even odd rule] ${p.outlines.map(tikzOutline).join(" ")};`);
    } else if (p.k === "text") {
      needLabel = true;
      const where = p.anchor === "c" ? "inner sep=0pt" : `label, anchor=${TIKZ_ANCHOR[p.anchor]}`;
      lines.push(`  \\node[${where}] at ${co(p.at)} {$${p.tex}$};`);
    } else if (p.k === "line") {
      needTip = true;
      lines.push(`  \\draw[${p.stroke}${tips(p)}] ${co(p.a)} -- ${co(p.b)};`);
    } else if (p.k === "arc") {
      if (p.arrowA || p.arrowB) needTip = true;
      lines.push(`  \\draw[${p.stroke}${tips(p)}] ${co(polar(p.c, p.r, p.a0))} arc[start angle=${deg(p.a0)}, end angle=${deg(p.a1)}, radius=${num(p.r, 2)}];`);
    } else {
      const fill = p.fill ? `, fill=${p.fill === "ink" ? "black" : "white"}` : "";
      const shape = p.k === "circle" ? `${co(p.c)} circle[radius=${num(p.r, 2)}]` : `${p.pts.map(co).join(" -- ")} -- cycle`;
      lines.push(`  \\draw[${p.stroke}${fill}] ${shape};`);
    }
  }
  flush();

  const styles: string[] = [];
  for (const s of Object.keys(TIKZ_WIDTH) as StrokeStyle[]) {
    if (!used.has(s)) continue;
    const dash = STROKE_DASH[s];
    const pattern = dash ? `, dash pattern=${dash.map((d, i) => `${i % 2 ? "off" : "on"} ${num(d, 2)}mm`).join(" ")}` : "";
    styles.push(`${s}/.style={line width=${TIKZ_WIDTH[s]}${pattern}}`);
  }
  if (needLabel) styles.push(`label/.style={inner sep=${num(PAPER.textSep, 2)}mm}`);
  if (needTip) {
    styles.push(`tip/.tip={Stealth[length=${num(PAPER.arrowLen, 2)}mm, width=${num(PAPER.arrowWidth, 2)}mm, inset=${num(PAPER.arrowLen * 0.28, 2)}mm]}`);
  }
  return (
    `% Made with Mech Sketch. Needs \\usepackage{tikz}${needTip ? " and \\usetikzlibrary{arrows.meta}" : ""}.\n` +
    `\\begin{tikzpicture}[x=1mm, y=1mm, line cap=round, line join=round,\n  ${styles.join(",\n  ")}]\n` +
    lines.join("\n") +
    `\n\\end{tikzpicture}\n`
  );
}

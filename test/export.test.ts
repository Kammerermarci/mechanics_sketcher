import { describe, it, expect, afterEach } from "vitest";
import { emptySketch, addPoint, addLine, addCircle, addArc, addConstraint, addSupport, addSymbol, type Sketch } from "../src/model";
import { geometryExtent } from "../src/model";
import { toSvg as svgOf, toTikz as tikzOf, figurePrims as primsOf, figureBounds } from "../src/export";
import { findFaces } from "../src/regions";
import { createMathJaxEngine } from "../src/mathjax";
import { setTexEngine, plainEngine } from "../src/tex";

afterEach(() => setTexEngine(plainEngine));

/** Sets the figure width so that one model unit is 10 annotation mm, which keeps the numbers below round. */
const tenMm = (sk: Sketch): Sketch => {
  sk.figureWidthMm = geometryExtent(sk) * 10 * sk.dimScale || 80;
  return sk;
};
const toSvg = (sk: Sketch) => svgOf(tenMm(sk));
const toTikz = (sk: Sketch) => tikzOf(tenMm(sk));
const figurePrims = (sk: Sketch) => primsOf(tenMm(sk));

/** A 40 mm beam (4 units at 10 mm each) with a length dimension labelled 2a. */
function beam(): Sketch {
  const sk = emptySketch();
  const a = addPoint(sk, 0, 0), b = addPoint(sk, 4, 0);
  addLine(sk, a.id, b.id);
  addConstraint(sk, { type: "distance", a: a.id, b: b.id, mode: "aligned", value: 4, offset: -0.8, label: "2a" });
  return sk;
}

describe("export", () => {
  it("gives nothing for an empty sketch", () => {
    expect(toSvg(emptySketch())).toBeNull();
    expect(toTikz(emptySketch())).toBeNull();
  });

  it("writes TikZ in millimetres with named styles and the label as typed", () => {
    const tikz = toTikz(beam())!;
    expect(tikz).toContain("\\begin{tikzpicture}[x=1mm, y=1mm");
    expect(tikz).toContain("member/.style={line width=0.8pt}");
    expect(tikz).toContain("\\draw[member] (0,0) -- (40,0);");
    expect(tikz).toContain("\\draw[dim, tip-tip] (0,-8) -- (40,-8);");
    expect(tikz).toContain("\\node[label, anchor=north] at (20,-8) {$2a$};");
    expect(tikz).toContain("\\usetikzlibrary{arrows.meta}");
    expect(tikz.trim().endsWith("\\end{tikzpicture}")).toBe(true);
    expect(tikz).not.toContain("symbol/.style"); // only the styles that are used
  });

  it("writes a self-contained SVG sized in millimetres", () => {
    setTexEngine(createMathJaxEngine());
    const sk = beam();
    const svg = toSvg(sk)!;
    const box = figureBounds(figurePrims(sk));
    expect(box.x0).toBeCloseTo(-0.14, 1);
    expect(box.x1).toBeCloseTo(40.14, 1);
    const size = /width="([\d.]+)mm" height="([\d.]+)mm" viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)!;
    expect(Number(size[1])).toBeCloseTo(box.x1 - box.x0 + 2, 1); // a 1 mm margin each side
    expect(Number(size[1])).toBeCloseTo(Number(size[3]), 1);
    expect(svg).toContain('stroke-width="0.28"'); // 0.8 pt
    expect(svg).toContain("<polygon"); // arrowheads
    expect(svg).toContain("<path"); // the label, as outlines
    expect(svg).not.toContain("currentColor");
    expect(svg).not.toContain("class=");
    // Balanced enough to be XML: every opened svg is closed.
    expect(svg.match(/<svg/g)!.length).toBe(svg.match(/<\/svg>/g)!.length);
  });

  it("leaves out helpers and hidden dimensions, and dash-dots centre lines", () => {
    const sk = beam();
    const c1 = addPoint(sk, 2, -1), c2 = addPoint(sk, 2, 1), h1 = addPoint(sk, 0, 2), h2 = addPoint(sk, 4, 2);
    addLine(sk, c1.id, c2.id).centre = true;
    addLine(sk, h1.id, h2.id).construction = true;
    const dim = sk.constraints[0];
    if (dim.type === "distance") dim.hidden = true;
    const tikz = toTikz(sk)!;
    expect(tikz).toContain("centreline/.style={line width=0.4pt, dash pattern=on 2mm off 0.6mm on 0.3mm off 0.6mm}");
    expect(tikz).toContain("\\draw[centreline] (20,-10) -- (20,10);");
    expect(tikz).not.toContain("(0,20)");
    expect(tikz).not.toContain("2a");
    expect(toSvg(sk)).toContain('stroke-dasharray="2 0.6 0.3 0.6"');
  });

  it("writes circles, arcs, supports and fills", () => {
    const sk = emptySketch();
    const c = addPoint(sk, 0, 0), s = addPoint(sk, 2, 0), e = addPoint(sk, -2, 0);
    addArc(sk, c.id, s.id, e.id);
    addLine(sk, e.id, s.id);
    const face = findFaces(sk)[0];
    addSymbol(sk, { type: "fill", color: "#f6d9a8", points: face.points, arcs: face.arcs, curves: face.curves, holes: [] });
    addCircle(sk, addPoint(sk, 5, 0).id, 1);
    addSupport(sk, "pin", s.id);
    const tikz = toTikz(sk)!;
    // Round the arc, then back along the diameter (the arc's centre lies on it, so it is a corner too).
    expect(tikz).toContain("\\fill[fill={rgb,255:red,246;green,217;blue,168}, even odd rule] (20,0) arc[start angle=0, end angle=180, radius=20] -- (0,0) -- cycle;");
    expect(tikz).toContain("\\draw[member] (20,0) arc[start angle=0, end angle=180, radius=20];");
    expect(tikz).toContain("\\draw[member] (50,0) circle[radius=10];");
    expect(tikz).toContain("\\draw[symbol, fill=white] (20,0) -- (17.6,-4) -- (22.4,-4) -- cycle;");
    expect(tikz).toMatch(/\\draw\[hatch\] \(.*\) -- \(.*\) \(.*\) -- \(.*\);/); // hatch strokes share a \draw
    const svg = toSvg(sk)!;
    expect(svg).toContain('fill="#f6d9a8" fill-rule="evenodd"');
    expect(svg).toMatch(/<polygon points="[^"]+" stroke-width="0.14" fill="#fff"\/>/);
  });

  it("turns the text of a slanted aligned dimension along its line", () => {
    const sk = emptySketch();
    const a = addPoint(sk, 0, 0), b = addPoint(sk, 3, 3);
    addLine(sk, a.id, b.id);
    const d = addConstraint(sk, { type: "distance", a: a.id, b: b.id, mode: "aligned", value: Math.hypot(3, 3), offset: 0.8, label: "\\ell" });
    const tikz = toTikz(sk)!;
    // 45 degrees, text on the side the dimension line was pulled to.
    expect(tikz).toMatch(/\\node\[label, anchor=south, rotate=45\] at \(9\.34,20\.66\) \{\$\\ell\$\};/);
    setTexEngine(createMathJaxEngine());
    expect(toSvg(sk)).toMatch(/<g transform="rotate\(-45 [\d.]+ [\d.]+\)"><svg/);
    // Asked to stay upright, it is not turned.
    d.text = "upright";
    expect(toTikz(sk)).not.toContain("rotate=");
    expect(toSvg(sk)).not.toContain("rotate(");
  });

  it("keeps typed spaces in labels", () => {
    const sk = beam();
    const dim = sk.constraints[0];
    if (dim.type === "distance") dim.label = "F = 10 \\mathrm{kN}";
    expect(toTikz(sk)).toContain("{$F\\ =\\ 10\\ \\mathrm{kN}$}");
  });

  it("writes arrows with a larger tip and their names, and datum points in colour", () => {
    const sk = emptySketch();
    const a = addPoint(sk, 0, 0), b = addPoint(sk, 4, 0);
    const l = addLine(sk, a.id, b.id);
    l.arrow = "end";
    l.label = "F";
    l.lx = 0;
    l.ly = 3;
    addSymbol(sk, { type: "datum", at: a.id, color: "#d32f2f", label: "A", dx: -2, dy: 2 });
    const tikz = toTikz(sk)!;
    expect(tikz).toContain("arrow/.style={line width=0.6pt}");
    expect(tikz).toContain("bigtip/.tip={Stealth[length=2.7mm, width=1.65mm, inset=0.76mm]}");
    expect(tikz).toContain("\\draw[arrow, -bigtip] (0,0) -- (40,0);");
    expect(tikz).toContain("\\node[inner sep=0pt] at (20,3) {$F$};");
    // The dot is filled with its colour and keeps a black edge.
    expect(tikz).toContain("\\draw[symbol, fill={rgb,255:red,211;green,47;blue,47}] (0,0) circle[radius=0.7];");
    expect(tikz).toContain("\\node[inner sep=0pt] at (-2,2) {$A$};");
    expect(tikz).not.toMatch(/\btip\/\.tip/); // only the tip that is used
    const svg = toSvg(sk)!;
    expect(svg).toMatch(/<circle cx="[\d.]+" cy="[\d.]+" r="0\.7" stroke-width="0\.14" fill="#d32f2f"\/>/);
    // The stroked line stops inside the arrowhead instead of running to its tip.
    expect(svg).toMatch(/<line x1="[\d.]+" y1="[\d.]+" x2="[\d.]+" y2="[\d.]+" stroke-width="0\.21"\/>/);
    const x = /<line x1="([\d.]+)" y1="[\d.]+" x2="([\d.]+)"/.exec(svg)!;
    expect(Number(x[2]) - Number(x[1])).toBeCloseTo(40 - 2.7 * 0.6, 2);
  });

  it("draws a radius dimension outside the circle when asked", () => {
    const sk = emptySketch();
    const c = addCircle(sk, addPoint(sk, 0, 0).id, 2);
    const d = addConstraint(sk, { type: "radius", target: c.id, value: 2, angle: 0 });
    expect(toTikz(sk)).toContain("\\draw[dim, -tip] (0,0) -- (20,0);"); // from the centre
    d.len = 0.6;
    expect(toTikz(sk)).toContain("\\draw[dim, -tip] (14,0) -- (20,0);");
    d.outside = true;
    const tikz = toTikz(sk)!;
    expect(tikz).toContain("\\draw[dim, -tip] (26,0) -- (20,0);");
    expect(tikz).toContain("\\node[label, anchor=west] at (26,0) {$R2$};");
  });

  it("writes a curved arrow with its head on the chosen end, and asks for the bending library", () => {
    const sk = emptySketch();
    const c = addPoint(sk, 0, 0), s = addPoint(sk, 2, 0), e = addPoint(sk, 0, 2);
    const arc = addArc(sk, c.id, s.id, e.id); // a quarter turn, counter-clockwise
    arc.arrow = "end";
    arc.label = "M";
    const tikz = toTikz(sk)!;
    expect(tikz).toContain("\\usetikzlibrary{arrows.meta, bending}");
    expect(tikz).toContain("\\draw[arrow, -bigtip] (20,0) arc[start angle=0, end angle=90, radius=20];");
    expect(tikz).toMatch(/\\node\[inner sep=0pt\] at \(1[5-9][\d.]*,1[5-9][\d.]*\) \{\$M\$\};/); // outside the arc, at its middle
    arc.arrow = "start";
    expect(toTikz(sk)).toContain("\\draw[arrow, bigtip-] (20,0) arc[start angle=0, end angle=90, radius=20];");
    // In the SVG the stroke stops inside the head, short of the arc's end.
    const svg = toSvg(sk)!;
    const end = /<path d="M([\d.]+) ([\d.]+)A20 20 0 0 0 ([\d.]+) ([\d.]+)" stroke-width="0\.21"\/>/.exec(svg)!;
    expect(end).not.toBeNull();
    expect(Number(end[2])).toBeLessThan(Number(end[4]) + 20 - 1); // the start has moved along the arc
  });

  it("draws a centre mark like a centre line: long and short dashes, as many gaps as asked for", () => {
    const sk = emptySketch();
    const circle = addCircle(sk, addPoint(sk, 0, 0).id, 1);
    const mark = addSymbol(sk, { type: "centermark", on: circle.id, angle: 0 });
    // Radius 10, 2 past the rim: long to -2, gap, the short dash across the centre, gap, long from 2.
    expect(toTikz(sk)).toContain("(-12,0) -- (-2,0) (-1.2,0) -- (1.2,0) (2,0) -- (12,0)");
    mark.scale = 2;
    expect(toTikz(sk)).toContain("(-14,0) -- (-4,0) (-2.4,0) -- (2.4,0) (4,0) -- (14,0)");
    delete mark.scale;
    // Four gaps: two short dashes, and a long one across the centre. 24 = 3 long + 2 * 2.4 + 4 * 0.8.
    mark.gaps = 4;
    expect(toTikz(sk)).toContain("(-12,0) -- (-6.67,0) (-5.87,0) -- (-3.47,0) (-2.67,0) -- (2.67,0) (3.47,0) -- (5.87,0) (6.67,0) -- (12,0)");
    // More than fit: drawn with as many as leave the long dashes recognisable.
    mark.gaps = 16;
    const perLine = figurePrims(sk).filter((p) => p.k === "line" && p.stroke === "centre").length / 2;
    expect(perLine).toBeLessThan(17);
    expect(perLine % 2).toBe(1); // still a long dash at both ends
    // Segmentation off: one unbroken line each way.
    mark.solid = true;
    expect(toTikz(sk)).toContain("\\draw[centre] (-12,0) -- (12,0) (0,-12) -- (0,12);");
  });

  it("writes a note as text, with its math in dollar signs and its lines stacked", () => {
    const sk = beam();
    addSymbol(sk, { type: "note", x: 1, y: 2, text: "Fixed end, $F_1 = 2a$" });
    addSymbol(sk, { type: "note", x: 1, y: 1, text: "50% of load & more\\\\ second line_2" });
    addSymbol(sk, { type: "note", x: 0, y: 3, text: "   " });
    const tikz = toTikz(sk)!;
    // Text is set as text in the document's own font; only what was typed as math is math.
    expect(tikz).toContain("\\node[label, anchor=west] at (10,20) {Fixed end, $F_1 = 2a$};");
    // What would break a line of LaTeX is escaped, and a node with more than one line says how to align them.
    expect(tikz).toContain("\\node[label, anchor=west, align=left] at (10,10) {50\\% of load \\& more\\\\second line\\_2};");
    expect(tikz.match(/\\node/g)).toHaveLength(3); // the two notes and the dimension; the blank one is nothing
    const texts = figurePrims(sk).filter((p) => p.k === "text" && p.layer === "sym");
    expect(texts.map((p) => p.k === "text" && p.tex)).toEqual([
      "\\text{Fixed end, }F_1 = 2a",
      "\\begin{array}{@{}l@{}}\\text{50\\% of load \\& more}\\\\\\text{second line\\_2}\\end{array}",
    ]);
    // On screen and in the SVG it is typeset, so it takes up room there.
    setTexEngine(createMathJaxEngine());
    const box = figureBounds(figurePrims(sk));
    expect(box.x1).toBeGreaterThan(40);
    expect(toSvg(sk)).toContain("<path");
  });

  it("writes accented letters so that LaTeX takes them: accent commands in math, as typed in text", () => {
    const sk = beam();
    const [a, b] = sk.entities.filter((e) => e.type === "point" && e.id !== "origin");
    sk.constraints[0] = { ...sk.constraints[0], label: "hosszúság" } as typeof sk.constraints[0];
    addSymbol(sk, { type: "load", at: b.id, angle: -Math.PI / 2, value: 1, label: "F_{eredő}", color: "#d32f2f" });
    addSymbol(sk, { type: "datum", at: a.id, label: "Á", color: "#2e7d32", dx: -0.5, dy: 0.5 });
    addSymbol(sk, { type: "note", x: 0, y: 2, text: "Görgős támasz: $F_é = 2a$, \\textbf{tűrés} $\\text{erő} + \\mathrm{álló}$" });
    const tikz = toTikz(sk)!;
    expect(tikz).toContain("{$hossz\\acute{u}s\\acute{a}g$}");
    // The long umlaut has no math command of its own.
    expect(tikz).toContain("{$F_{ered\\mathaccent\"707D{o}}$}");
    expect(tikz).toContain("{$\\acute{A}$}");
    // In a note only the math is touched; a subscript that is one accented letter is kept together.
    expect(tikz).toContain("{Görgős támasz: $F_{\\acute{e}} = 2a$, \\textbf{tűrés} $\\text{erő} + \\mathrm{\\acute{a}ll\\acute{o}}$}");
    // The SVG has every one of them as outlines.
    setTexEngine(createMathJaxEngine());
    const svg = toSvg(sk)!;
    expect(svg).not.toContain("<text");
    expect(svg).toContain("<path");
  });

  it("enlarges the whole figure by the dimension size, keeping the geometry at the figure width", () => {
    setTexEngine(createMathJaxEngine());
    const sk = beam();
    sk.figureWidthMm = 40;
    const plain = svgOf(sk)!;
    const tikz1 = tikzOf(sk)!;
    sk.dimScale = 2;
    // Laid out with the geometry at half the width, then everything doubled: 40 mm of beam either way.
    const big = svgOf(sk)!;
    const size = (svg: string) => /width="([\d.]+)mm" height="([\d.]+)mm" viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)!.slice(1).map(Number);
    const [w1, h1] = size(plain), [w2, h2, vw2] = size(big);
    expect(w1).toBeCloseTo(40 + 2 + 0.28, 1);
    expect(w2).toBeCloseTo(40 + 2 + 0.56, 1);    // the line is twice as thick, so are its round ends
    expect(vw2).toBeCloseTo(w2 / 2, 1);
    expect(h2).toBeGreaterThan(h1);              // the text and arrows take more room
    const tikz2 = tikzOf(sk)!;
    expect(tikz1).toContain("[x=1mm, y=1mm,");
    expect(tikz1).not.toContain("every node");
    expect(tikz2).toContain("[x=2mm, y=2mm,");
    expect(tikz2).toContain("every node/.style={scale=2}");
    expect(tikz2).toContain("member/.style={line width=1.6pt}");
    expect(tikz2).toContain("tip/.tip={Stealth[length=3.6mm, width=2.2mm, inset=1.01mm]}");
    expect(tikz2).toContain("\\draw[member] (0,0) -- (20,0);"); // 20 units of 2 mm
  });
});

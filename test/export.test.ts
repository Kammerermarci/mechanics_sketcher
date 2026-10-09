import { describe, it, expect, afterEach } from "vitest";
import { emptySketch, addPoint, addLine, addCircle, addArc, addConstraint, addSupport, addSymbol, type Sketch } from "../src/model";
import { toSvg, toTikz, figurePrims, figureBounds } from "../src/export";
import { findFaces } from "../src/regions";
import { createMathJaxEngine } from "../src/mathjax";
import { setTexEngine, plainEngine } from "../src/tex";

afterEach(() => setTexEngine(plainEngine));

/** A 40 mm beam (4 units at 10 mm each) with a length dimension labelled 2a. */
function beam(): Sketch {
  const sk = emptySketch();
  sk.scaleMode = "fixed";
  sk.mmPerUnit = 10;
  const a = addPoint(sk, 0, 0), b = addPoint(sk, 4, 0);
  addLine(sk, a.id, b.id);
  addConstraint(sk, { type: "distance", a: a.id, b: b.id, mode: "aligned", value: 4, offset: -8, label: "2a" });
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
    expect(tikz).toContain("centreline/.style={line width=0.4pt, dash pattern=on 4mm off 1mm on 0.6mm off 1mm}");
    expect(tikz).toContain("\\draw[centreline] (20,-10) -- (20,10);");
    expect(tikz).not.toContain("(0,20)");
    expect(tikz).not.toContain("2a");
    expect(toSvg(sk)).toContain('stroke-dasharray="4 1 0.6 1"');
  });

  it("writes circles, arcs, supports and fills", () => {
    const sk = emptySketch();
    sk.scaleMode = "fixed";
    sk.mmPerUnit = 10;
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
});

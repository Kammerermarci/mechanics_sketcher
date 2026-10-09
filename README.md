# Mech Sketch

A constraint sketcher for truss and beam figures. Draw roughly, then constrain
and dimension; changing a dimension re-solves the whole drawing. Figures are
meant for LaTeX: export to TikZ and SVG is not built yet (see Status).

## Run it

```
npm install
npm run dev      # development server
npm test         # solver, model and primitive-list tests
npm run build    # one self-contained dist/index.html
```

`dist/index.html` has the solver and fonts inlined, so it also opens straight
from disk by double-click.

## Using it

The tools sit on two tabs. **Sketch** has what shapes the geometry: drawing
tools and constraints. **Annotate** has what is added to the figure:
dimensions, supports, axes, centre marks, balloons, fills and hatching.

1. **Draw.** Pick Line (L) and click to place joints. Clicking an existing
   joint reuses it. Near-horizontal and near-vertical lines snap and get that
   constraint; hold Alt to switch snapping off. Middle-click ends a chain.
2. **Constrain.** Press a constraint, then click the geometry it applies to. It
   is applied as soon as it has what it needs, and the tool stays active for
   the next one. (Selecting the geometry first works too.)
3. **Dimension.** Press D, click a line (or two points, two lines, a circle),
   then middle-click where the dimension should go and type the value. For a
   slanted line the position picks the kind: beside it measures its length,
   above or below the horizontal distance, left or right the vertical one.
   Double-click a dimension to change it later; drag it to move it. In the
   side panel a dimension can get a TeX label (`2a`, `\alpha`), shown instead
   of the number, or be left out of the figure.
4. **Annotate.**
   - *Supports:* pick Pin, Roller or Fixed and click a joint. Drag a support
     around its joint, or press R, to turn it.
   - *Axes:* placed anywhere; dropped on a joint they stay pinned to it. Each
     axis has its own length and label.
   - *Centre mark:* click a circle or arc.
   - *Balloon (B):* click what it points at, then where the balloon goes.
     Numbers count up on their own; the text can be any TeX.
   - *Fill:* click inside a closed shape. A circle inside it is left as a hole.
     The shape's lines have to meet at shared points.
   - *Hatching:* click a line, arc or circle on the side the strokes should
     go. Drag it away from the curve to make the strokes longer.

**The middle mouse button confirms**, as in Creo: it ends the line being
drawn, places the dimension, accepts a typed value, and with nothing in
progress returns to Select. Dragging with it pans. Esc or right-click cancels.

**Colours while sketching.** A curve is blue while it can still move and
turns black once it is fully constrained; the box in the corner counts the
degrees of freedom left in the whole sketch. Where two curves lie on top of
each other the shared stretch is drawn red; click there again to step through
them.

**Paper scale.** Text, arrows and symbols have fixed sizes on paper. The box
in the corner sets how the drawing maps to paper, one of two ways: type a
*figure width* and the scale follows the drawing so it always comes out that
wide (annotations then grow or shrink against the geometry as it changes
size); or type a *paper scale* and it stays put while you draw, with the
width following instead.

The origin is a fixed point at (0, 0) that geometry can be constrained and
dimensioned against. The button in the top right hides its axes. It is never
part of the exported figure.

| Key | Action | Key | Action |
| --- | --- | --- | --- |
| L, C, A, P | Line, circle, arc, point | D | Dimension |
| H, V | Horizontal, vertical | E | Equal |
| O | Coincident / point on curve | M | Midpoint |
| T | Tangent | F | Fix or release a point |
| B | Balloon | R | Turn the selected support, axes or centre mark 90° |
| Middle-click | Confirm | Esc, right-click | Cancel one step |
| Delete | Delete selection | Ctrl+Z, Ctrl+Y | Undo, redo |
| Wheel | Zoom | Middle-drag | Pan |
| 0 | Zoom to fit | Ctrl+A | Select all |
| Ctrl+S, Ctrl+O | Save, open (JSON) | | |

## How it is built

- `src/model.ts`: the sketch document (points, lines, circles, arcs,
  constraints, dimensions, symbols) and JSON save/load.
- `src/solver.ts`: translates the model to FreeCAD's `planegcs` solver and
  back; dragging uses the solver's temporary constraints. It also works out
  which points are still free, by pinning each in turn and seeing whether
  that uses up a degree of freedom.
- `src/prims.ts`: breaks the sketch down into lines, circles, arcs, filled
  regions and text in paper millimetres. The screen draws from this list, and
  the exporters will too.
- `src/regions.ts`: finds the closed regions for fills, and the stretches
  where curves overlap.
- `src/render.ts`: the editor canvas (SVG), including point handles and
  constraint markers that are never exported.
- `src/mathjax.ts`: typesets labels with a bundled MathJax; `src/tex.ts` holds
  a simple stand-in used when MathJax is not loaded (the tests).
- `src/app.ts`: tools, selection, dragging, commands and panels.

Sizes that should not depend on how big the truss is (line widths, arrowheads,
text) are fixed in paper units; the paper scale decides how many millimetres
one model unit is.

## Installing it as an app

Served over HTTPS the page can be installed (the install button in the
browser's address bar), which gives a desktop icon, its own window and
offline use. `.github/workflows/pages.yml` builds and publishes it to GitHub
Pages on every push to `main`; in the repository settings, Pages has to be
set to the source "GitHub Actions" once.

## Status

Working: geometry, constraints, distance / angle / radius dimensions with
labels typeset by MathJax, supports, coordinate axes, centre marks, balloons,
fills, hatching, the fixed origin, snapping, dragging, undo, save and load,
install as an app.

Not built yet: loads (forces, moments, distributed loads), TikZ and SVG
export. `docs/status-report.pdf` is the plan as of the first build.

## Licence note

The solver, [`@salusoft89/planegcs`](https://github.com/Salusoft89/planegcs),
is FreeCAD's planegcs compiled to WebAssembly and is licensed LGPL-2.0-or-later.
MathJax is Apache-2.0. The UI font is Barlow (SIL Open Font License).

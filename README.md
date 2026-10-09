# Mech Sketch

A constraint sketcher for truss and beam figures. Draw roughly, then constrain
and dimension; changing a dimension re-solves the whole drawing. Figures are
meant for LaTeX: export to TikZ and SVG is the next step (see Status).

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

1. **Draw.** Pick Line (L) and click to place joints. Clicking an existing
   joint reuses it. Near-horizontal and near-vertical lines snap and get that
   constraint; hold Alt to switch snapping off. Middle-click ends a chain.
2. **Constrain.** Press a constraint in the top bar, then click the geometry it
   applies to. It is applied as soon as it has what it needs, and the tool stays
   active for the next one. (Selecting the geometry first and then pressing
   the constraint works too.)
3. **Dimension.** Press D, click a line (or two points, two lines, a circle),
   then middle-click where the dimension should go and type the value. For a
   slanted line the position picks the kind: beside it measures its length,
   above or below the horizontal distance, left or right the vertical one.
   Double-click a dimension to change it later; drag it to move it. In the
   side panel a dimension can get a TeX label (`2a`, `\alpha`), shown instead
   of the number, or be left out of the figure.
4. **Supports and axes.** Pick Pin, Roller or Fixed and click a joint. Drag a
   support around its joint, or press R, to turn it. Axes can be placed
   anywhere; dropped on a joint they stay pinned to it.

**The middle mouse button confirms**, as in Creo: it ends the line being
drawn, places the dimension, accepts a typed value, and with nothing in
progress returns to Select. Dragging with it pans. Esc or right-click cancels.

The origin is a fixed point at (0, 0) that geometry can be constrained and
dimensioned against. The button in the top right hides its axes. It is never
part of the exported figure.

The box in the corner of the canvas shows how many degrees of freedom are
left. Geometry is blue while it can still move and black once fully
constrained. Where lines lie on top of each other, clicking the same spot
again steps through them.

| Key | Action | Key | Action |
| --- | --- | --- | --- |
| L, C, A, P | Line, circle, arc, point | D | Dimension |
| H, V | Horizontal, vertical | E | Equal |
| O | Coincident / point on curve | M | Midpoint |
| T | Tangent | F | Fix or release a point |
| R | Turn the selected support or axes 90° | 0 | Zoom to fit |
| Middle-click | Confirm | Esc, right-click | Cancel one step |
| Delete | Delete selection | Ctrl+Z, Ctrl+Y | Undo, redo |
| Wheel | Zoom | Middle-drag | Pan |
| Ctrl+S, Ctrl+O | Save, open (JSON) | Ctrl+A | Select all |

## How it is built

- `src/model.ts`: the sketch document (points, lines, circles, arcs,
  constraints, dimensions, symbols) and JSON save/load.
- `src/solver.ts`: translates the model to FreeCAD's `planegcs` solver and
  back; dragging uses the solver's temporary constraints.
- `src/prims.ts`: breaks the sketch down into lines, circles, arcs and text in
  paper millimetres. The screen draws from this list, and the exporters will too.
- `src/render.ts`: the editor canvas (SVG), including point handles and
  constraint markers that are never exported.
- `src/mathjax.ts`: typesets labels with a bundled MathJax; `src/tex.ts` holds
  a simple stand-in used when MathJax is not loaded (the tests).
- `src/app.ts`: tools, selection, dragging, commands and panels.

Sizes that should not depend on how big the truss is (line widths, arrowheads,
text) are fixed in paper units; the figure width setting decides how many
millimetres one model unit is.

## Status

Working: geometry, constraints (coincident, point on curve, midpoint,
horizontal, vertical, parallel, perpendicular, equal, tangent, fixed),
distance / angle / radius dimensions with labels typeset by MathJax, supports
(pin, roller, fixed), coordinate axes, the fixed origin, snapping, dragging,
undo, save and load.

Not built yet: loads (forces, moments, distributed loads), TikZ and SVG
export, PWA install. `docs/status-report.pdf` is the plan as of the first
build.

## Licence note

The solver, [`@salusoft89/planegcs`](https://github.com/Salusoft89/planegcs),
is FreeCAD's planegcs compiled to WebAssembly and is licensed LGPL-2.0-or-later.
MathJax is Apache-2.0. The UI font is Barlow (SIL Open Font License).

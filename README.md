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
   constraint; hold Alt to switch snapping off. Esc or right-click ends a chain.
2. **Constrain.** With the Select tool, click geometry (Shift-click adds), then
   press a constraint in the top bar.
3. **Dimension.** Select a line, two points, two lines or a circle and press D.
   Type the value. Double-click a dimension to change it later; drag it to move
   it. In the side panel a dimension can get a TeX label (`2a`, `\alpha`),
   which is shown instead of the number, or be left out of the figure.

The box in the corner of the canvas shows how many degrees of freedom are
left. Geometry is blue while it can still move and black once fully
constrained.

| Key | Action | Key | Action |
| --- | --- | --- | --- |
| L, C, A, P | Line, circle, arc, point | D | Dimension |
| H, V | Horizontal, vertical | E | Equal |
| O | Coincident / point on curve | M | Midpoint |
| T | Tangent | F | Fix or release a point |
| Esc | Back out one step | Delete | Delete selection |
| Ctrl+Z, Ctrl+Y | Undo, redo | 0 | Zoom to fit |
| Wheel | Zoom | Middle-drag, Space-drag | Pan |
| Ctrl+S, Ctrl+O | Save, open (JSON) | Ctrl+A | Select all |

## How it is built

- `src/model.ts`: the sketch document (points, lines, circles, arcs,
  constraints, dimensions) and JSON save/load.
- `src/solver.ts`: translates the model to FreeCAD's `planegcs` solver and
  back; dragging uses the solver's temporary constraints.
- `src/prims.ts`: breaks the sketch down into lines, circles, arcs and text in
  paper millimetres. The screen draws from this list, and the exporters will too.
- `src/render.ts`: the editor canvas (SVG), including point handles and
  constraint markers that are never exported.
- `src/app.ts`: tools, selection, dragging, commands and panels.

Sizes that should not depend on how big the truss is (line widths, arrowheads,
text) are fixed in paper units; the figure width setting decides how many
millimetres one model unit is.

## Status

Working: geometry, constraints (coincident, point on curve, midpoint,
horizontal, vertical, parallel, perpendicular, equal, tangent, fixed),
distance / angle / radius dimensions with labels, snapping, dragging, undo,
save and load.

Not built yet: supports and loads, MathJax label preview, TikZ and SVG export,
PWA install. See `docs/status-report.pdf`.

## Licence note

The solver, [`@salusoft89/planegcs`](https://github.com/Salusoft89/planegcs),
is FreeCAD's planegcs compiled to WebAssembly and is licensed LGPL-2.0-or-later.
The UI font is Barlow (SIL Open Font License).

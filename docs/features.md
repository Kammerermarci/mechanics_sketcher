# Mech Sketch: features

Mech Sketch is a free sketcher for mechanics figures that runs in the browser. You draw roughly, then constrain and dimension the drawing the way you would in a CAD sketcher. The finished figure exports as TikZ or SVG and drops straight into a LaTeX document.

- Live app: https://mech-sketch.org
- Beta, with what is coming next: https://mech-sketch.org/beta/

Features marked **(beta)** are only in the beta so far. They reach the live app once the beta is merged.

---

## Why Mech Sketch

- **Made for mechanics, not for general drawing.** Trusses, beams, supports, loads, internal force diagrams, springs and dampers are all built in. You don't have to assemble a support symbol out of lines and triangles.
- **Draw first, size later.** Rough geometry is fine. Constraints (horizontal, parallel, equal, tangent, …) and dimensions then pull it into shape, as in Creo, SolidWorks or FreeCAD. Change a dimension and the whole drawing follows.
- **The figure looks like it belongs in your document.** TikZ export means LaTeX sets the labels in your document's own font. You type labels as TeX (`F_1`, `\alpha`, `2a`), so what you type is what LaTeX prints.
- **Text and arrowheads have a fixed print size.** Set the figure width, for example 8 cm, and text stays 10 pt, however long the beam is in metres. What doesn't overlap on screen won't overlap in the PDF.
- **One source, two exports.** SVG and TikZ come from the same drawing, so a picture in a slide and a figure in a thesis match.
- **Plots keep their formulas (beta).** A plot exports to pgfplots with the formulas still written as formulas, not thousands of points, so it stays editable in LaTeX.
- **Covers the whole mechanics track.** It handles statics (supports, loads), strength of materials (beams, distributed loads, internal force diagrams), and dynamics and vibrations (springs, dampers, centres of mass, parametric paths).
- **Free, with no account and no install needed.** It opens in the browser. You can also install it as an app with its own window, and it then works offline.
- **Your work stays with you.** Sketches are autosaved in your browser. Save writes a file you can keep or take to another computer.

---

## The basic workflow

1. **Draw.** Place lines, circles and arcs. Positions don't need to be exact.
2. **Constrain.** Make lines horizontal, parallel, equal and so on. Geometry is blue while it can still move and turns black once it's fully constrained. The corner box counts the degrees of freedom left.
3. **Dimension.** Click a line, type its length, and the drawing follows the number. A label such as `2a` can stand in for the number.
4. **Annotate.** Add supports, loads, arrows, notes, balloons, hatching and fills.
5. **Export.** Use SVG, TikZ, or Copy TikZ for the clipboard.

---

## Sketch tab

### Drawing
| Tool | Key | What it does |
|---|---|---|
| Construction | G | A switch at the start of the ribbon. While it's on, what you draw is construction geometry: pink while it can still move and dark purple once it's fully constrained. It's left out of the print and the export, but takes constraints and dimensions like anything else. **(beta)** |
| Line | L | Click start and end; the next click continues from there. Nearly level or upright lines snap, and Alt switches that off. |
| Centre line | | A thin dash-dotted line that's part of the figure. It's good for mirroring about. |
| Circle | C | Centre, then radius. |
| Arc | A | Centre, start, sweep to the end. |
| Point | P | A free point on a line, on a circle or anywhere. |
| Beam | | A straight beam with a set width and round or square ends. |
| Curved beam | | A beam bent round a centre. |

### Editing
| Tool | Key | What it does |
|---|---|---|
| Trim | X | Click a piece to remove it up to the next crossing, or drag across several pieces. |
| Mirror | | Mirrors the selection about a line. The image stays tied to the original. |
| Linear pattern | | Repeats the selection in a row. The copies follow the original. |
| Circular pattern | | Repeats the selection round a point. |

### Constraints
| Constraint | Key | What it does |
|---|---|---|
| Dimension | D | Lengths, distances (aligned, horizontal or vertical), angles and radii. A text label such as `2a` can replace the number, and a dimension can be hidden yet still drive the geometry. |
| Horizontal / Vertical | H / V | Applies to a line, or to two points. |
| Parallel / Perpendicular | | Applies to two lines. |
| Equal | E | Equal lengths, or equal radii. |
| Coincident | O | Joins two points, or keeps a point on a curve. |
| Midpoint | M | Keeps a point at the middle of a line. |
| Tangent | T | A line and a circle or arc, or two circles or arcs. |
| Fix point | F | Pins a point where it is. |

Conflicting constraints are flagged as they happen. The solver is FreeCAD's planegcs.

---

## Annotate tab

- **Supports:** pin, roller and fixed (clamped), with adjustable size and hatched ground.
- **Loads:**
  - Forces: the arrow length follows the magnitude, at one scale for all forces.
  - Moments: the arc size follows the magnitude, clockwise or anticlockwise.
  - Distributed loads: uniform, triangular or trapezoidal, over all of a line or part of it, with optional shading.
- **Diagram (beta):** lays a plot from the Plot tab along a line, an arc or a beam, the way internal force diagrams are drawn.
  - Drag the peak to set the height, and drag the ends to cover part of the member.
  - The peak value is written on it.
  - It updates when the function changes.
- **Plots at a point (beta):** a plot's parametric curves can be placed at a point, with that point as the origin, for example a path or a trajectory on a mechanism.
- **Axes:** a coordinate frame, pinned to a joint if wanted. Drag the tips to change length and click a label to rename it.
- **Arrow and curved arrow:** for velocities, rotations and anything else with a name. They're constrained and dimensioned like lines.
- **Datum point:** a coloured dot with a name.
- **Note:** text with math between dollar signs (`$F_1 = 2a$`) and line breaks.
- **Centre mark:** centre lines for circles and arcs.
- **Balloon:**
  - Numbers count up automatically.
  - The frame can be a circle, a box, an underline or nothing.
  - The leader can end in an arrow, a dot or nothing.
- **Fill:** click inside a closed shape to colour it.
- **Hatching:** strokes along a line, arc or circle, such as the ground under a support.

Any text on the drawing (a dimension, an arrow's name, a note, a balloon) can be clicked and edited in place.

---

## Dynamics tab (beta)

- **Spring:**
  - Drawn as a zigzag or a coil.
  - It keeps a constant pitch, so a spring pulled longer gets more turns.
  - Width and pitch can be adjusted.
- **Damper:** a cylinder and piston that can be turned round. It can also be bent round a joint as a **torsion damper**.
- **Torsion spring:** a spiral wound about a joint, with a hub at its centre to attach to.
- **Centre of mass:** the quartered-circle mark, on a joint, on a curve or anywhere.

All of these stretch and turn with their end points and take constraints and dimensions like lines.

---

## Plot tab (beta)

A workspace of its own for plotting functions, exported separately as SVG or pgfplots.

- **Graph and print side by side.**
  - On the left is the graph, which you move and zoom freely. A dashed frame marks the range that is exported; drag its handles or its edge to change it.
  - On the right is the print, the plot exactly as it is exported. Its handles set the size on paper.
- **Functions of x:** type `2x + 1`, `sin(x)`, `-5x^2/2`, or LaTeX such as `2\sin(\pi x)`.
- **Piecewise functions:** one formula per stretch of the axis, as internal force diagrams need. The jumps between pieces are drawn as upright lines, and you can switch them off.
- **Parametric curves:** x(t) and y(t), for circles, paths and phase portraits.
- **Flip axes:** the variable runs up and the values across, for example N(z) along a column.
- **Ranges in LaTeX:**
  - The axis ends, the tick spacing and the piece boundaries accept `\pi`, `2\pi`, `\frac{\pi}{2}` and similar.
  - Ticks a share of π apart are labelled π/2, π, 3π/2.
- **Styling:**
  - Colour, line thickness, solid, dashed or dotted lines.
  - Shading down to the axis.
  - Arrowed axes or a box.
  - Ticks with numbers, marks only, or none.
  - Grid lines or dots.
  - "Same scale on both" axes, so circles come out round.
- **Fit range:** sets the value range so every function shows.
- **Notes and balloons** on the plot, and **names** beside each curve.
- Several plots per sketch, with duplicate and delete.

---

## Look and style

- **Drawn as:** solid, dashed or centre line, with **Construction line** as a separate switch.
- **Line thickness:** per curve, in points as LaTeX counts them.
- **Colours** for loads, fills, datum points and plot curves.
- **Dimension size in print:** scales all text and symbols in the export together.
- **Figure width:** the width of the exported figure, in cm.
- **Print preview (Q):** hides everything that isn't exported and shows text at its size in print.
- **Accented letters** (á, é, ő, ű, …) work in labels and notes, including in the TikZ export.
- **TeX fields show typeset (beta):** a field holding `\pi` or `F_1` shows π or F₁ while you're not typing in it.

---

## Export

| Export | What you get |
|---|---|
| **SVG** | A picture file for slides, Word or the web. |
| **TikZ** | A `.tex` file to `\input` in LaTeX. Labels are set in the document's font. |
| **Copy TikZ** | The same text, on the clipboard. |
| **Plot → pgfplots (beta)** | An `axis` environment with the formulas written as formulas, ticks and labels pinned to match the screen. |

The live app shows the Support button for 10 seconds before an export finishes; the beta exports at once.

---

## Working with the app

- **Install as an app:** use the install button in the browser's address bar. You get a desktop icon and its own window, and it works offline.
- **Autosave:** the current sketch is kept in the browser.
- **Save / Open (Ctrl+S / Ctrl+O):** a `.json` sketch file to keep or move between computers.
- **Undo / Redo:** Ctrl+Z / Ctrl+Y.
- **Built-in guide:** a welcome guide, plus a tip the first time each tool is used. Help brings them back.
- **Report a bug or suggest something:** the button at top right writes an email for you to send.
- **Support:** ko-fi.com/mech_sketch.

---

## Mouse and keys

| Input | Action |
|---|---|
| Middle-click | Confirm or place, as in Creo |
| Middle-drag, wheel | Pan, zoom |
| 0 | Zoom to fit |
| Esc, right-click | Cancel one step |
| Delete | Delete the selection |
| Ctrl+A | Select everything |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Ctrl+S / Ctrl+O | Save / open |
| Q | Print preview |
| R | Turn the selected symbol |
| G | Construction on or off **(beta)** |
| L C A P | Line, circle, arc, point |
| X N B | Trim, note, balloon |
| D H V E O M T F | Dimension, horizontal, vertical, equal, coincident, midpoint, tangent, fix |

---

## Planned (not built yet)

- **Relative dimensions (Creo-style):** the first dimension only sets the scale and nothing moves; every later dimension is relative to it. The plan and a demo are in `docs/dimension-scale-plan.md`.
- **Fitted export:** the whole figure, dimensions included, fitted to the set width with 5 % margins.

---

## Notes for updating the PDF guide

The old one-page guide predates the beta. When updating it:

- **Remove** "Not built yet: distributed loads". They're built.
- **Add** the Dynamics tab and the Plot tab, with one screenshot each (a spring–mass–damper and an internal force diagram would show them best).
- **Add** the Diagram tool to the Annotate list, and the Construction switch to the Sketch list.
- **Mouse and keys:** add G (construction), Q (print preview) and R (turn).
- **Export step:** keep the note about the 10-second support wait for the live app.
- **Wait for the merge:** update the PDF once the beta is merged into the live app, so the guide and the app match.

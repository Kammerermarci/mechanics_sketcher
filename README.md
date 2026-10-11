# Mech Sketch

A constraint sketcher for truss and beam figures. Draw roughly, then constrain
and dimension; changing a dimension re-solves the whole drawing. Figures are
meant for LaTeX: they export to TikZ and to SVG.

**Use it at [mech-sketch.org](https://mech-sketch.org).** It is free; if it saves
you time, you can [support it on Ko-fi](https://ko-fi.com/mech_sketch).

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

The first time the page is opened it greets you with a short guide to the
steps below, and the first time each tool is picked up a small tip says how
it is used. Both have a *Don't show this again* box. The question mark in the
top right brings the guide back; the settings button next to it switches the
tips off, or shows them all again from the start.

The speech bubble beside the question mark is for **reporting a bug or
suggesting something**. The page has no server behind it, so the form writes
an email, with the app's version, the browser and the size of the sketch
added underneath, and opens it in your own mail program to send; *Copy the
text* is there for mail that is read in a browser. The address is
`REPORT_EMAIL` in `src/config.ts`.

The tools sit on two tabs. **Sketch** has what shapes the geometry: drawing
tools, copying tools and constraints. **Annotate** has what is added to the
figure: dimensions, supports, loads, axes, arrows, notes, centre marks, balloons,
fills and hatching.

1. **Draw.** Pick Line (L): one click starts a line, the next one ends it,
   and the click after that starts a new line, so four clicks give two
   lines. Clicking an existing joint reuses it. Near-horizontal and
   near-vertical lines snap and get that constraint; hold Alt to switch
   snapping off. *Centre line* draws the same way but gives a thin
   dash-dotted line that is exported and does not close shapes for fills. A
   selected line, circle or arc can be switched between solid, centre line
   and helper (editor only, never exported) in the side panel. A slider
   there sets its *line thickness* in points, from 0.1 to 3; double-click it
   to go back to the standard (0.8 pt for a solid line, 0.6 pt for an arrow,
   0.4 pt for a centre line). The head of a thicker arrow grows with it.
   *Trim (X)* removes the piece of a line, arc or circle under the cursor, up
   to where other curves cross it; the piece that would go is shown in red
   first. The cut ends stay on the curve they were cut at. A circle needs
   two crossings to be trimmed and becomes an arc. Holding the button down
   and dragging trims everything the pointer crosses, in one undo step. The
   two pieces of a line cut in the middle stay in line with each other. An
   equal-length constraint on a trimmed line is dropped and a midpoint on it
   becomes a point on the line, since neither is true of the piece that is
   left; a fill bounded by the trimmed curve goes too.
   - *Beam:* a bar between two points, like a slot in a CAD sketch. Click
     where it starts and where it ends (joints that are there already are
     used), then move away from its middle line and click to set the width.
     The side panel picks round ends or square ones while the tool is
     active. A beam is ordinary geometry: two lines closed by two arcs, or
     four lines, with the constraints that keep its shape. So it is filled,
     trimmed and dimensioned like the rest: the distance between its two
     centres for the length, an end's radius (or the end itself) for the
     width.
   - *Curved beam:* the same bar, bent round a centre. Click the centre, then
     where the beam starts, sweep round the centre and click where it ends,
     then move towards or away from the centre and click to set the width.
     Its long sides are two arcs about the centre; the ends are round or
     square, as picked in the side panel. Dimension the distance from the
     centre to an end of the beam for the radius of the bend.
   - *Mirror:* select what to mirror, press Mirror and click the line to
     mirror about. Points on that line are shared by both halves. The image
     stays an image: one constraint ties every point of it to its original,
     so changing one side changes the other.
   - *Linear pattern:* select what to repeat, press it and say how many
     there should be, and whether the row runs across, up or freely. The
     copies follow the original. Their spacing is left free: drag a copy,
     or dimension from a point to its copy.
   - *Circular pattern:* select what to repeat, press it, click the point
     the copies go around (a circle stands for its centre) and say how many.
     They are spread over a full turn, or set apart by an angle that can be
     changed later by selecting the pattern's marker.

   Supports, centre marks, hatching, fills and datum points on what is
   copied are copied with it. Deleting the green marker of a mirror image
   or pattern lets the copies go their own way; deleting one copy leaves the
   rest tied.
2. **Constrain.** Press a constraint, then click the geometry it applies to. It
   is applied as soon as it has what it needs, and the tool stays active for
   the next one. (Selecting the geometry first works too.) The small green
   markers of the constraints show only for what is selected, so the drawing
   stays clean; the side panel lists all of them when nothing is selected.
3. **Dimension.** Press D, click a line (or two points, two lines, a circle),
   then middle-click where the dimension should go and type the value. For a
   slanted line the position picks the kind: beside it measures its length,
   above or below the horizontal distance, left or right the vertical one.
   Click the number of a dimension to change it right there: a number sets
   the value, anything else (`2a`, `\alpha`, `F = 10`) becomes a label shown
   instead of the number. Spaces typed in a label are kept. Drag a dimension
   to move it. The text of an aligned dimension is turned to run along its
   line; a checkbox in the side panel switches that on or off. A radius
   dimension can sit inside the circle or outside it: drag it across the rim,
   and drag further to make its arrow longer or shorter. Dimensions can also
   be left out of the figure.
4. **Annotate.**
   - *Supports:* pick Pin, Roller or Fixed and click a joint. Drag a support
     around its joint, or press R, to turn it. *Size of the supports*, a
     slider in the side panel of a support (and of the three support tools),
     makes every support in the sketch larger or smaller and leaves
     everything else alone; it is saved with the sketch and exported.
   - *Load:* a force on a joint, or on a spot on a line. Its *magnitude*, typed
     in the side panel, sets how long the arrow is: every force in the sketch
     is drawn at one scale, so one of twice the magnitude is twice as long.
     Drag the arrow round its point, or press R, to turn it. It can arrive at
     the point or leave it.
   - *Distributed load:* click beside a line, on the side the load should be
     drawn. It has a magnitude at each end, so it can be uniform, a trapezium,
     or a triangle that runs down to a point. Drag an end of it along the line
     to cover only part of the line. The arrows are square to the line, or at
     an angle of their own (weight on a sloping beam); a slider sets how many
     there are. Their heads are smaller than a force's, and the area under
     them is shaded in a light tone of the load's colour; a checkbox in the
     side panel leaves the shading out.
   - *Moment:* an arc with a head about a joint. Its magnitude sets the
     radius; it turns clockwise or anticlockwise.

     All three have a colour, picked in the side panel and carried into the
     SVG and the TikZ, and a name that is typed where it stands and can be
     dragged. A *Size* slider sets the scale for all loads of the same kind
     together. That scale belongs to the drawing, like the length of axes: it
     follows the zoom, and neither size slider changes it. Loads are copied
     by Mirror and the patterns along with what they are on.
   - *Axes:* placed anywhere; dropped on a joint they stay pinned to it. Each
     axis has its own length and label; drag an arrow tip to change the
     length. The lengths are in the drawing's units, so neither size slider
     changes them; only the arrowheads and labels follow the sliders.
   - *Arrow:* drawn with two clicks like a line, and constrained and
     dimensioned like one. A box for its name (TeX) opens as soon as it is
     drawn; type it, or carry on clicking to leave it without one. The name
     is dragged to where it should sit, and the head can be at either end or
     both. Any line can be turned into an arrow in the side panel.
   - *Curved arrow:* the same on an arc, for moments and rotations. Click
     the centre, where it starts, sweep round and click where it ends; the
     head goes on the end clicked last.
   - *Datum point:* a coloured dot with a black edge and a name (A, B, C
     ...) on a joint, on a curve or anywhere. The point under it is ordinary
     geometry. Pick the colour in the side panel and drag the name to move
     it.
   - *Note (N):* text placed anywhere. Click where it should start and type
     it. It is plain text set in the document's font; put math between
     dollar signs (`Link $AB$, $F_1 = 2a$`) and `\\` where a new line
     starts. Click a note to change it, drag it to move it.
   - *Centre mark:* click a circle or arc. Its two lines are drawn like a
     centre line, long and short dashes in turn; a slider in the side panel
     sets how many gaps each line has, and a checkbox switches the
     segmentation off for two plain lines. Drag an end of the mark to make
     the whole mark larger or smaller; dragging it by the middle turns it.
   - *Balloon (B):* click what it points at, then where the balloon goes.
     Numbers count up on their own and the text can be any TeX. The side
     panel puts it in a circle or in a box, underlines it (the leader then
     runs to the end of the line), or leaves it bare.
   - *Fill:* click inside a closed shape. A circle inside it is left as a hole.
     The shape's lines have to meet at shared points.
   - *Hatching:* click a line, arc or circle on the side the strokes should
     go. Two sliders in the side panel set the stroke size and the
     frequency; dragging the hatching away from the curve also sets the
     size. The panel moves it to the other side or leans the strokes the
     other way. Hatching belongs to the drawing: it keeps its strokes when
     you zoom, and neither size slider changes it.

**Text is typed where it stands.** Click a dimension's number, the name of
an arrow or a datum point, a note, a balloon's text or an axis label, and a box opens
on the spot; Enter accepts, Esc leaves it as it was. Pressing and dragging
the same text moves it instead. Double-click an arrow or a datum point that
has no name yet to give it one.

**The middle mouse button confirms**, as in Creo: it places the dimension,
accepts a typed value, drops a shape that is only half drawn, and with
nothing in progress returns to Select. Dragging with it pans. Esc or right-click cancels.

**Print preview.** Q, or the eye button in the top right, shows the figure
as it is exported: annotations at their size in print, and without helper
geometry, point handles, constraint markers, the grid and the origin. Press
it again to go back to editing, with the view where it was.

**Colours while sketching.** A curve is blue while it can still move and
turns black once it is fully constrained; the box in the corner counts the
degrees of freedom left in the whole sketch. Where two curves lie on top of
each other the shared stretch is drawn red; click there again to step through
them.

**Sizes.** While editing, dimensions, arrowheads, supports and every other
annotation keep one size on screen however far you zoom, as in a CAD
sketcher; only the geometry grows and shrinks. Where a dimension or a balloon
sits is part of the drawing and moves with it. How large they are on
screen is a slider of its own under the settings button in the top right
(*Dimension size while editing*); it is remembered by the browser and has no
effect on the exported figure.

How large annotations are in the exported figure is set by one slider in the
corner box, *Dimension size in print*. At 100% the text is 10 pt; moving the
slider scales text, arrows, symbols and line widths together. Because that
only shows in print, the print preview comes on while you move it.
Double-click the slider to go back to 100%. *Figure width* next to it is how
wide the geometry comes out, in centimetres.

The origin is a fixed point at (0, 0) that geometry can be constrained and
dimensioned against. The button in the top right hides its axes. It is never
part of the exported figure.

## Export

The **Export** menu in the top bar writes the figure as it will appear on
paper: geometry, centre lines, dimensions, labels and symbols, without helper
geometry, the origin, constraint markers or hidden dimensions.

- **SVG** saves an `.svg` file sized in millimetres. Labels are outlines, so
  it needs no fonts.
- **TikZ** saves a `.tex` file with a `tikzpicture` to `\input`. **Copy
  TikZ** puts the same text on the clipboard. Labels are passed on as typed,
  so LaTeX sets them in the document's own font.

An export first shows a short notice with the Support button and a
countdown; when it has run out, the button that saves the file (or copies
the TikZ) comes alive. How long that takes is `EXPORT_WAIT_SECONDS` in
`src/config.ts`; 0 switches it off.

**Save** and every export ask where the file should go and what it should be
called. Chrome and Edge (and the installed app) open their own save dialog
for that, in the folder used last time: sketches and exported figures each
remember theirs. Other browsers do not let a page pick a folder, so there a
small prompt asks for the name and the file goes where that browser puts
downloads. The last name is offered again next time, and a sketch that was
opened is offered its own name.

```latex
\usepackage{tikz}
\usetikzlibrary{arrows.meta, bending}   % arrowheads; bending makes them follow arcs
...
\begin{figure}
  \centering
  \input{figure.tex}
\end{figure}
```

The figure comes out at the width shown in the corner box. At a dimension
size of 100% one TikZ unit is one millimetre and the labels are set at the
document's font size; at another size the unit, the line widths, the
arrowheads and the labels (through `every node/.style={scale=...}`) are all
scaled by it. Line widths and the arrowhead are named styles at the top of
the picture and can be changed there.

**Accented letters.** Letters such as é, ö, ő and ű are typed as they are, in
labels and in notes. On screen and in the SVG each is drawn as its letter
with the accent over it, from the same font as the rest of the label. In the
TikZ, a label is math, where LaTeX takes no accented letters: there é is
written `\acute{e}`, ö `\ddot{o}`, and ő and ű with `\mathaccent28797`, the
long umlaut of the roman font. The text of a note, and of `\text{...}` in a
label, stays as typed; `\text` needs `amsmath`, and low quote marks („) need
`\usepackage[T1]{fontenc}` with pdfLaTeX.

| Key | Action | Key | Action |
| --- | --- | --- | --- |
| L, C, A, P | Line, circle, arc, point | D | Dimension |
| X | Trim | B | Balloon |
| N | Note | | |
| Q | Print preview on and off | | |
| H, V | Horizontal, vertical | E | Equal |
| O | Coincident / point on curve | M | Midpoint |
| T | Tangent | F | Fix or release a point |
| R | Turn the selected support, axes or centre mark 90° | | |
| Middle-click | Confirm | Esc, right-click | Cancel one step |
| Delete | Delete selection | Ctrl+Z, Ctrl+Y | Undo, redo |
| Wheel | Zoom | Middle-drag | Pan |
| 0 | Zoom to fit | Ctrl+A | Select all |
| Ctrl+S, Ctrl+O | Save, open (JSON) | | |

## Plots

The **Plot** tab is a workspace of its own, beside the sketcher, for plotting
functions: an internal force diagram, a velocity over time. A file holds the
sketch and any number of plots; undo, Save and Open take them along.

- **Functions.** Type a formula of x (or t) in the side panel: `2x + 1`,
  `-5x^2/2`, `3 sin(2x)`. Things written side by side are multiplied; a comma
  or a point goes before decimals. `sin cos tan asin acos atan sinh cosh
  tanh exp ln lg log2 sqrt abs sign floor ceil round min max`, `pi` and `e`
  are known. What cannot be read is said under the field while it is typed.
  Nothing typed is ever run as code.
- **Pieces.** *Split into pieces* gives a function one formula for each
  stretch of the axis, as a shear force diagram has. Where two pieces meet at
  different values the jump is drawn as an upright line, unless that is
  switched off.
- **Looks.** Each function has a colour, a thickness, a solid, dashed or
  dotted line, and a name set beside the curve that can be dragged anywhere.
  *Shade down to the axis* fills the area under it and closes it at the ends.
- **Axes.** Each axis has a name, written as TeX math, and the range it runs
  over. They are drawn as arrows through the origin, or as a box with the
  names centred along it. Ticks carry numbers, are bare marks, or are left
  out; their spacing suits the size of the plot unless one is typed. A grid
  of lines or of dots follows the ticks.
- **Size.** Drag a handle of the dotted box to set the size of the axes on
  paper; it snaps to whole millimetres (hold Alt for any size), or type it in
  centimetres. Text is 10 pt at any size. Inside the plot, dragging moves what
  it shows and the wheel zooms it (Shift: sideways only, Alt: up and down
  only). Outside it, dragging and the wheel move and zoom the view, and 0
  brings the whole plot back.
- **Export.** In this tab Export saves the plot on show. The SVG is drawn from
  the same shapes as the screen. The TikZ is written for `pgfplots`: the size,
  the ranges, every tick and where each label sits are pinned in it, so it
  comes out as the screen shows it, while the formulas stay formulas that can
  be changed in the LaTeX.

```latex
\usepackage{pgfplots}                   % any version from 1.11 on; no compat line is needed
\usetikzlibrary{arrows.meta}
...
\input{plot-1.tex}
```

**Diagrams.** A plot can be laid along a member of the sketch, the way an
internal force diagram is drawn. On the Annotate tab, pick *Diagram* and click
a line, an arc or a side of a beam, on the side positive values should go.

- The plot's horizontal range is stretched over the member, from its start to
  its end, and the values are set off square to it: radially on an arc. *The
  plot runs from* turns it round. On a side of a beam, straight or curved, the
  diagram runs along the middle of the beam and brings a thin zero line of its
  own; the side panel can put it on the edge instead.
- Drag the handle at the peak to set the height (across the member, the side),
  and the handles at the ends to cover only part of the member.
- It is shaded in a light tone of each function's colour, can have strokes
  drawn across it, and can have the values at its ends, jumps and peaks
  written beside it. The colours and line styles are the plot's.
- The diagram stays tied to its plot: change a function on the Plot tab and it
  follows. *Edit this plot*, or a double-click on the diagram, goes there.
  Deleting the plot deletes its diagrams.
- Unlike the plot itself, a diagram is not cut off at the plot's vertical
  range. In the SVG and the TikZ it is part of the figure, drawn through
  points like the rest of it: no pgfplots is needed for the sketch.

A curve is drawn through the same points on screen and by pgfplots: two for a
straight line, about one every half millimetre for anything else. Where a
function has no value, or runs more than the height of the plot outside it,
the curve stops, so the two sides of an asymptote are not joined.

## How it is built

- `src/model.ts`: the sketch document (points, lines, circles, arcs,
  constraints, dimensions, symbols) and JSON save/load.
- `src/solver.ts`: translates the model to FreeCAD's `planegcs` solver and
  back; dragging uses the solver's temporary constraints. It also works out
  which points are still free, by pinning each in turn and seeing whether
  that uses up a degree of freedom.
- `src/prims.ts`: breaks the sketch down into lines, circles, arcs, filled
  regions and text, at a given number of annotation millimetres per model
  unit. The screen and both exporters draw from this list.
- `src/export.ts`: writes that list as SVG and as TikZ.
- `src/regions.ts`: finds the closed regions for fills, and the stretches
  where curves overlap.
- `src/trim.ts`: where curves cross, and cutting a curve between crossings.
- `src/beam.ts`: straight and curved beams: the lines and arcs of the
  outline and the constraints that hold its shape.
- `src/pattern.ts`: mirror images and patterns. A copy is ordinary geometry;
  one *link* constraint per mirror or pattern holds each copied point to its
  original. `src/solver.ts` turns a link into equations: two per point, but
  one for a point the copied arc already ties down, so nothing is said twice.
- `src/expr.ts`: reads a typed function into a tree, works it out for a
  value of x, and writes it in the notation of pgfplots.
- `src/plot.ts`: lays a plot out on paper as primitives, for the screen and
  the SVG, and writes it for pgfplots. `src/plotwork.ts` is its workspace:
  the canvas, the handles and the side panel.
- `src/plotmath.ts`: the formulas of a plot read and sampled into points, for
  the plot and for `src/diagram.ts`, which lays those points along a line, an
  arc or the middle of a beam. A beam is told by its shape, not by a record.
- `src/guide.ts`: the tips, and what the browser remembers about which have
  been seen. `src/config.ts`: where the Support button leads and how long an
  export waits.
- `src/render.ts`: the editor canvas (SVG), including point handles and
  constraint markers that are never exported.
- `src/mathjax.ts`: typesets labels with a bundled MathJax; `src/tex.ts` holds
  a simple stand-in used when MathJax is not loaded (the tests).
- `src/accents.ts`: takes accented letters apart into letter and accent, for
  MathJax and for the TikZ.
- `src/app.ts`: tools, selection, dragging, commands and panels.

Sizes that should not depend on how big the truss is (line widths, arrowheads,
text, symbols) are in annotation millimetres: their size on paper at a
dimension size of 100%. The editor lays the list out at a scale that follows
the zoom, which keeps annotations one size on screen; the exporters lay it
out at the scale that fits the figure width and then enlarge everything by
the dimension size. Sketches saved in earlier file versions kept placements
(version 1), axis lengths (up to version 2) and hatching (up to version 3)
in millimetres and are converted when they are opened.

## Installing it as an app

Served over HTTPS the page can be installed (the install button in the
browser's address bar), which gives a desktop icon, its own window and
offline use. `.github/workflows/pages.yml` builds and publishes it to GitHub
Pages on every push to `main`; in the repository settings, Pages has to be
set to the source "GitHub Actions" once.

## Search engines and shared links

The `<head>` of `index.html` carries what a search engine and a shared link
show: the title, the description, the address the page is known by
(`canonical`), the Open Graph tags and a short description in schema.org
form. `public/preview.png` (1200 × 630) is the picture a chat or a post
shows beside the link; put another file of that size in its place to change
it. All of them name `https://mech-sketch.org/`, so a copy published
somewhere else needs its own address there.

## Status

Working: geometry, centre lines, trim, constraints, distance / angle / radius
dimensions with labels typeset by MathJax, supports, coordinate axes, straight
and curved arrows, forces, distributed loads and moments, notes, datum points,
centre marks, balloons, fills, hatching, straight and curved beams, mirror and
patterns, plots of functions with pgfplots export, diagrams laid along
members, the fixed origin,
snapping, dragging, undo, save and load, print preview, SVG and TikZ export,
install as an app.

`docs/status-report.pdf` is the plan as of the first build.

## Licence note

The solver, [`@salusoft89/planegcs`](https://github.com/Salusoft89/planegcs),
is FreeCAD's planegcs compiled to WebAssembly and is licensed LGPL-2.0-or-later.
MathJax is Apache-2.0. The UI font is Barlow (SIL Open Font License).

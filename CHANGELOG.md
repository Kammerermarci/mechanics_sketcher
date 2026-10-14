# Mech Sketch change log

Changes are consolidated by feature. Dates record when each feature was added
or updated; descriptions reflect the current behaviour. New entries should say
what changed and how to use it.

## 2026-10-13 — Background styles and spacing

- Open **View settings** (the sliders button) to choose **Dots** or **Grid**
  and set **Background spacing (mm)** from 0.1 to 1000, including decimals.
  One drawing unit is treated as 1 mm, independently of the exported figure size.
- Every tenth gridline is heavier and aligned to the origin. Background spacing
  stays fixed in drawing coordinates as you pan or zoom; layers less than two
  screen pixels apart are hidden to keep the canvas legible.
- The default is dots at 1 mm spacing. Background settings support autosave,
  sketch files, and Undo/Redo; print preview and exports omit the background.
- On narrow screens, View settings opens to the right of its button to keep
  the controls visible.

## 2026-10-13 to 2026-10-14 — Keep the camera fixed while editing

- Dimensions, circular-pattern angles, mirror copies, patterns, and pasted
  objects can be created or edited without changing the camera position or zoom.
- In the Plot workspace, axis-range edits, fitting the exported range to
  functions, flipping axes, and equalizing axis scales keep the graph camera fixed.
- Annotation-size changes appear directly while sketching without switching to
  print preview or reframing the drawing.
- Use **Zoom to fit**, **0**, or **Home** to frame the whole figure. Initial
  framing when opening drawings or switching plots, and framing on entering
  print preview, remain available.

## 2026-10-13 — Rectangle and arc modes, and ribbon layout

- **Rectangle** offers **2-point** (opposite corners), **Center-point** (center,
  then corner), and **3-point** (first edge, then width) modes. Three-point
  rectangles can be drawn at any angle.
- **Arc** offers **Center-point** and **3-point** modes. A three-point arc takes
  its start, end, then a point on the curve, and can exceed a semicircle.
- The chosen mode updates the main button, is remembered in this browser, and
  is used by the **A** shortcut for arcs.
- Shapes have live previews, snapping, and Construction support. They remain
  ordinary geometry with constraints: rectangle sides stay rectangular, a center
  rectangle has a construction diagonal holding its center, and an arc's third
  point stays on the curve. Each completed shape is one Undo step; Escape cancels.
- **Point** comes before **Line** on the Sketch ribbon; its shortcut is **P**.
  Dropdown items have a 4 px gap to separate hover and selection highlights.

## 2026-10-13 — Grid snapping and Ctrl axis locking

- Enable **Snap to grid (S)** in View settings, or press **S** while sketching.
  It applies to new placements and existing geometry, annotation positions and
  labels, gradient handles, axis tips, dimensions, center marks, and load/diagram
  handles. Existing joints and curves take priority over the grid.
- Snapping uses the background spacing. A small square marks the grid target;
  **Alt** temporarily bypasses snapping. Geometry constraints and handles tied to
  directions or curves still limit movement.
- A dragged group snaps its grabbed point, or its first point when grabbed by
  a curve, while preserving relative spacing. Labels and free annotations retain
  their grab offsets. Each drag is one Undo step.
- Hold **Ctrl** during a drag to lock horizontal or vertical movement. The first
  clear movement chooses the axis until Ctrl is released. Grid snapping applies
  along that axis without changing the other coordinate, even if it is off grid.
  **Alt + Ctrl** bypasses snapping while retaining the axis lock.
- The same lock works while drawing a line or the first edge of a beam or
  three-point rectangle: place the first point, then hold Ctrl. Geometry snaps
  cannot pull the next point off the locked axis.
- Grid snapping starts disabled for existing drawings and is saved with the
  sketch. Toggling it moves neither existing geometry nor the camera.

## 2026-10-13 — Shared colours and compact colour controls

- Fills, arrows, notes, balloons, axes, loads, datum points, and plot annotations
  share a palette containing the fill swatches, strong annotation colours, and
  saved custom colours. Plot functions and their labels also support colours.
- Solid and gradient fills show swatches directly in the side panel. Other
  objects use a compact **Change colour** popup with the current colour shown;
  large palettes scroll inside the popup instead of expanding the panel.
- **Another colour** or the multicolour swatch opens the custom-colour dialog.
  Use the picker or enter a hex colour. **OK** applies it; **OK and Add** also
  saves it across the shared palette without creating duplicate swatches.
- Saved colours remain available after reloading and in future sketches.
  **Cancel** or Escape leaves the current colour unchanged. Applied colours
  support Undo/Redo and exports; saved palette colours remain independently.

## 2026-10-13 — Linear and radial gradient fills

- **Gradient Fill**, immediately after **Fill** on Annotate, offers Linear and
  Radial modes and remembers the last choice. Click inside a closed shape to fill it.
- Drag the square handle to move the gradient and the round handle to set its
  direction/length or radius. Handles follow the region when geometry is resized.
- In the side panel, choose Start/End or Center/Edge to edit the colours. You
  can reverse colours, reset handles, or switch between Solid, Linear, and Radial.
  Holes remain unfilled.
- Gradients support autosave, sketch files, Undo/Redo, copying, and mirroring.
  Print and SVG use native gradients; TikZ uses 128 fine colour bands clipped
  to the shape and its holes, requiring only TikZ.
- The handles were inspired by [Inkscape's gradient controls](https://inkscape-manuals.readthedocs.io/en/1.3/creating-gradients.html).

## 2026-10-13 to 2026-10-14 — Copy, paste, and move selections

- Use **Ctrl+C** / **Ctrl+V** or **Copy objects** / **Paste objects** beside
  Undo/Redo. Text fields retain normal copy/paste behaviour.
- Copying a fill or one of its boundary edges includes the whole outline,
  solid or gradient fill, holes, attached annotations, shape helpers, and
  constraints wholly inside the copied geometry.
- Pasted objects have fresh IDs and no mirror/pattern link to the source.
  Copies release source **Fix point** anchors while retaining internal dimensions
  and shape constraints; the originals remain fixed.
- Each paste centers the collection at the last canvas cursor position, selects
  it, and records one Undo step. Move the cursor to choose another location;
  repeated pastes do not add a predetermined offset.
- Drag an edge or fill to move the selected group together, preserving shapes,
  circle sizes, relative spacing, fills, and selected notes. This works for both
  pasted and ordinary selections. Pressing a selected shape's corner keeps the
  rest of the group selected.
- Dragging an unselected fill moves its boundary and holes. Shift-drag over a
  fill still draws an additive selection box; single-gradient editing retains
  its gradient handles.
- Existing anchors or external dimensions that prevent translation block the
  whole group instead of scattering or stretching it. Group moves support grid
  snapping, Ctrl axis locking, Alt overrides, and Undo/Redo.
- System clipboard data allows copies between drawings and browser tabs, with
  an in-app fallback. Same-app Paste uses its snapshot immediately; keyboard
  paste reads the native paste event to avoid clipboard-read permission waits.

## 2026-10-13 — Filled shapes and object depth

- Each fill and its boundary strokes stack as one object, including hole
  outlines. A shape in front covers both the fill and outlines behind it.
- Select a fill or boundary curve and press **Page Up** to raise the shape one
  step, or **Page Down** to lower it. Multiple selected objects retain their
  relative order.
- Depth edits keep the camera fixed, support Undo/Redo, and are saved and used
  in exports. Editing handles and constraint markers remain visible as aids.
  When overlapping fills are equally close, the frontmost is selected first.

## 2026-10-13 to 2026-10-14 — Arrow appearance and optional arrowheads

- A straight or curved arrow's shaft, heads, and label share its chosen colour.
- **Arrowhead size** ranges from 50% to 300% in 25% steps, relative to the normal
  head for the line thickness. It updates live; double-click resets to 100%.
  Existing arrows retain their original proportions until adjusted.
- Choose **None** in the arrowhead options to use an arrow as a straight or
  curved line with editable text, colour, and thickness. Choose another option
  to restore the heads.
- Arrow appearance supports Undo/Redo, saved sketches, copies, mirrors,
  patterns, SVG, and TikZ.

## 2026-10-14 — Print proportions and individual text sizes

- Text, dimensions, arrowheads, pins, and other annotations zoom with geometry
  while sketching, using the same proportions as exports. **Dimension size in
  print** and **Figure width** set their relative size directly in sketch mode.
- Removed **Dimension size while editing** from View settings; old browser
  preferences for it no longer affect the drawing. New axes and load lengths
  start at consistent print sizes regardless of editing zoom.
- Select a text-bearing object and use **Text size** to override only its text,
  from 25% to 300% of the normal annotation size. **100%** restores the default;
  double-click the slider in sketch mode to reset. Multiple selections can be
  adjusted together without changing geometry or stroke widths.
- Overrides cover notes, balloons, dimensions, arrows, springs, axes, datum
  points, loads, and diagram labels. Plot notes, balloons, curve labels, and each
  axis have their own controls. Balloon frames and text picking fit the resized text.
- Text overrides combine with the global print annotation size, support
  Undo/Redo, and survive Save/Open and copying. SVG and TikZ use the same sizes.

## 2026-10-14 — Math spacing preference

- In View settings, **Preserve spaces in math labels** is enabled by default.
  Turn it off for standard LaTeX math spacing, where ordinary typed spaces are
  ignored. Explicit spacing commands continue to work.
- Existing sketch and plot labels, input previews, and exports update together.
  The preference is remembered in this browser without changing stored label text.

## 2026-10-14 — Touchpad panning with Shift

- Hold **Shift** and scroll with two fingers to pan horizontally, vertically,
  or diagonally, using both axes at once. It works in sketching, print preview,
  and over the Plot graph, without changing zoom, drawing geometry, or plot ranges.
- Release Shift to zoom with scrolling. Ordinary scrolling, Ctrl + wheel, and
  Space + scrolling zoom; Space + mouse drag and middle-drag still pan.
- Shift replaces the initial Space + scrolling shortcut. In the Plot graph,
  Shift + wheel now pans instead of zooming only horizontally. Navigation hints
  show the current shortcut.

## 2026-10-14 — Adjustable straight ends on springs

- Select a spring and use **Straight ends** to adjust the length of each end
  before its zigzag or coil starts. Both ends change together; double-click
  resets to automatic lengths.
- Endpoints and width stay fixed. Turns fill the remaining middle section,
  with room for a spring body even when the endpoints move closer.
- Straight and curved springs support the setting, including Undo/Redo,
  Save/Open, copying, SVG, and TikZ.

## 2026-10-14 — Draggable balloon leader tips in sketch mode

- Select a balloon and drag the handle at its leader tip to change what it
  points at while leaving the bubble in place. Dragging the bubble still moves
  only the bubble.
- Tips snap to joints and curves and follow them afterward. Drop elsewhere
  for a free tip; grid snapping, Ctrl axis locking, and Alt overrides apply.
- A tip drag is one Undo/Redo step. The new attachment is saved and used in exports.

## 2026-10-14 — Zero-width strokes

- Set **Line thickness** to **0 pt** to hide an object's stroke and arrowheads
  while retaining geometry, fills, and labels. Selection, snapping, constraints,
  and editing remain available. Double-click the slider to restore standard width.
- Plot curves also accept zero thickness, retaining shading and labels.
  Hidden strokes stay hidden in SVG and TikZ, and the setting supports saved
  sketches, copying, and Undo/Redo.

## 2026-10-14 — Plain uppercase datum labels

- New datum points use upright uppercase plain text: A, B, C… and then A1, B1…
  after Z, in the drawing and exports.
- Choose **Label style → Plain text / Math** in the datum's side panel to change
  its format. Existing labels retain their previous math styling; centre-of-mass
  symbols retain their existing default.
- Save/Open, clipboard copies, and patterns retain label style and text-size overrides.

## 2026-10-14 — Export countdown temporarily disabled

- SVG, TikZ, and Copy TikZ proceed immediately without the Support countdown.
  Use the Export menu as usual. Restore the delay through `EXPORT_WAIT_SECONDS`
  in `src/config.ts`.

# Mech Sketch change log

This is a readable record of added features and changes in behaviour. Append new
dated entries below; keep existing entries so the history remains available.
Each entry should say what changed and where to find or use it.

## 2026-10-13 — Background styles and spacing

- Open **View settings** (the sliders button) to choose **Dots** or **Grid**.
- Set **Background spacing (mm)** from 0.1 to 1000 mm, including decimals.
  Spacing is the distance between neighbouring dots or gridlines. One drawing
  unit is treated as 1 mm; it is independent of the exported figure's paper size.
- Every tenth horizontal and vertical gridline is thicker and darker. For
  example, 1 mm spacing gives heavier lines every 10 mm, aligned to the origin.
- Spacing stays fixed in the drawing as you pan or zoom. Layers less than two
  screen pixels apart are hidden until you zoom in again to keep the canvas legible.
- The default is dots with 1 mm spacing. Settings are included in autosave and
  saved sketch files, and work with Undo and Redo. Print preview and exports omit
  the background.
- On narrower screens, View settings opens to the right of its button so its
  controls remain visible.

## 2026-10-13 — Keep the camera fixed while editing

- Applying or changing a dimension now keeps the camera's position and zoom
  fixed, even when the result extends off screen or becomes very small.
- Changing a circular pattern's angle also keeps the camera fixed.
- Mirror copies and linear or circular patterns keep the camera fixed when
  created, including when copies lie outside the current view.
- Changing the dimension size in print still shows print preview, but no
  longer automatically reframes the camera when that preview opens.
- In the Plot workspace, editing axis ranges, fitting the exported range to
  functions, and flipping the axes no longer move or zoom the graph camera.
  The same applies when making the axes use equal scales.
- Use **Zoom to fit**, **0**, or **Home** when you want to frame the whole figure.
  Panning and zooming still work as before. Initial framing when opening a
  drawing or switching plots, and framing in print preview, remain available.

## 2026-10-13 — Rectangle and arc drawing modes

- On the Sketch ribbon, **Rectangle** starts with a **2-point rectangle**:
  click two opposite corners.
- Its dropdown also offers **Center-point rectangle** (center, then corner)
  and **3-point rectangle** (the ends of the first edge, then the width).
  Three-point rectangles can be drawn at any angle.
- **Arc** keeps the existing **Center-point arc** and adds **3-point arc**:
  click the start, end, then a point on the curve. The curve passes through
  all three points, including arcs larger than a semicircle.
- Selecting a mode updates the main button immediately. The choice is
  remembered in this browser, and the **A** shortcut uses the chosen arc mode.
- New shapes have live previews, use the existing snapping and Construction
  settings, and are saved as ordinary geometry. Rectangle constraints keep
  the sides rectangular; a center rectangle has a construction diagonal
  holding its center. The third point of an arc stays on the curve.
- Each completed shape is one Undo step. Escape cancels an unfinished shape,
  and drawing keeps the camera fixed.

## 2026-10-13 — Snap to grid while sketching

- Enable **Snap to grid (S)** in **View settings**, or press **S** while
  sketching to toggle it without changing your active drawing tool.
- New placements snap to the nearest background dot or grid intersection,
  using the spacing set in millimetres. Existing joints and curves take priority.
- Hold **Alt** to temporarily bypass snapping. A small square marks a grid
  snap target; horizontal and vertical alignment hints still work.
- The setting starts off for existing drawings and is saved with the sketch.
  Toggling it does not move existing geometry or the camera.

## 2026-10-13 — Point tool comes first

- Moved **Point** to the beginning of the Sketch drawing tools, before **Line**.
  Its **P** shortcut is unchanged.

## 2026-10-13 — Spacing between dropdown items

- Added a 4 px gap between dropdown menu items so hover and selection highlights
  stay visually separated, including in the Rectangle and Arc mode menus.

## 2026-10-13 — Apply or save custom annotation colours

- The multicolour swatch now opens a custom colour dialog with **OK** and
  **OK and Add**. Choose with the colour picker or enter a hex colour.
- **OK** applies the colour to the selected annotation without adding a swatch.
- **OK and Add** applies it and adds it to the fill, load, and datum palettes.
  Saved colours remain available for future sketches and after reloading this
  browser. Adding the same colour twice does not create duplicate swatches.
- **Cancel** or Escape leaves the current colour unchanged. Applying a colour
  still works with Undo; saved palette colours remain available independently.

## 2026-10-13 — Linear and radial gradient fills

- Added **Gradient Fill** immediately after **Fill** on the Annotate ribbon.
  Its dropdown chooses Linear or Radial, and remembers the last chosen mode.
- Click a closed shape to fill it. Drag the square handle to move the gradient;
  drag the round handle to set a linear gradient's direction/length or a radial
  gradient's radius. Handles follow the region when geometry is resized.
- Select Start/End or Center/Edge in the side panel to edit the two colours,
  using the palette or the custom-colour dialog with OK and OK and Add.
- The side panel can reverse colours, reset handles, or change between Solid,
  Linear, and Radial fills. Holes remain unfilled.
- Gradients support autosave, sketch files, Undo/Redo, and copying/mirroring.
  Print and SVG use native gradients; TikZ approximates them with 128 fine
  colour bands clipped to the shape and its holes, requiring only TikZ.
- Inspired by Inkscape's on-canvas gradient handles:
  https://inkscape-manuals.readthedocs.io/en/1.3/creating-gradients.html

## 2026-10-13 — Snap existing handles and objects to the grid

- **Snap to grid** now also works while moving existing points, geometry,
  annotation positions and labels, and gradient handles.
- Axis tips, dimensions, center-mark handles, and load/diagram handles use
  snapped targets too. Their geometry or constraints may project the target
  onto a permitted direction or curve.
- Dragging a group snaps its grabbed point (or first point when grabbed by a
  curve) while keeping the group's relative spacing. Grab offsets are preserved
  for labels and freely positioned annotations.
- Uses the background spacing from View settings. **Alt** temporarily bypasses
  snapping, and the small square indicates the current grid target.
- Handles still form one Undo step per drag, and dragging keeps the camera fixed.

## 2026-10-13 — Horizontal and vertical dragging with Ctrl

- Hold **Ctrl** while dragging an object or handle to restrict movement to
  horizontal or vertical. The first clear movement selects the axis, which
  stays locked until Ctrl is released.
- **Alt** still bypasses grid snapping. Holding **Alt + Ctrl** gives free
  movement along only the selected horizontal or vertical axis.
- With Ctrl alone, grid snapping applies along the moving axis and preserves
  the original coordinate on the other axis, even when that coordinate is off grid.
- Applies to grouped geometry, annotation positions and labels, and gradient
  handles. Geometry constraints and handles tied to curves still take effect.

## 2026-10-13 — Ctrl axis lock while drawing

- The same Ctrl lock now works for line drawing and the first edge of beams
  and 3-point rectangles. Place the first point, then hold Ctrl to draw the
  next point horizontally or vertically from it.
- The first clear movement chooses the axis; release Ctrl to draw freely or
  select a new direction. Snaps to existing geometry cannot pull the point off
  the locked axis.
- **Alt + Ctrl** bypasses grid snapping while keeping horizontal/vertical
  alignment. Ctrl alone allows grid snapping along the chosen axis.

## 2026-10-13 — Copy and paste sketch objects with their fills

- Added **Ctrl+C** / **Ctrl+V** and **Copy objects** / **Paste objects** buttons
  beside Undo/Redo. Text fields keep their normal copy/paste behaviour.
- Copying a filled region or one of its boundary edges includes the complete
  outline and its solid or gradient fill, including holes and their geometry.
- Attached annotations, shape helpers, and constraints wholly inside the copied
  geometry come along. Pasted copies have fresh IDs and no pattern/mirror link
  to the source, so they can be edited independently.
- Each paste is selected, offset slightly from the source, and recorded as one
  Undo step. Repeated pastes are staggered and do not move the camera.
- Uses the system clipboard for copying between drawings or browser tabs, with
  an in-app fallback if browser clipboard access is unavailable.
- Same-app Paste uses the copied snapshot immediately. Ctrl+V reads its data
  through the browser's native paste event, avoiding clipboard-read permission
  waits for keyboard paste.

## 2026-10-13 — Arrow appearance and a shared colour palette

- Select a straight or curved arrow to choose its colour in the side panel.
  The shaft, arrowheads and name share the chosen colour.
- The new **Arrowhead size** slider has discrete stops from 50% to 300% in
  steps of 25%, relative to the normal head for the current line thickness.
  The preview updates as you move the slider. Double-click to reset to 100%.
  Existing arrows retain their original proportions until you change the slider.
- Notes, balloons and axis labels now have the same colour controls. Plot notes
  and balloons also support colours, as do plot functions and their labels.
- All colour controls share one palette: the fill swatches, the existing strong
  annotation colours, and your saved custom colours. **Another colour** uses
  the same dialog everywhere; **OK and Add** makes the colour available across
  fills, arrows, text, loads, datum points and plots immediately.
- Colours and arrowhead sizes are saved with the sketch, support Undo/Redo,
  and carry into SVG and TikZ exports. Mirrored and patterned arrows keep them.

## 2026-10-13 — Compact colour controls

- Colour is now the last adjustable setting for each colourable object, just
  above Delete, in both the sketch and Plot workspaces.
- **Change colour** shows the current colour and opens a popup containing the
  same shared palette and saved user colours. Choose a swatch to apply it.
- Large palettes scroll inside the popup instead of expanding the object panel.
  **Another colour** opens the custom picker; **OK and Add** still saves a colour
  for use throughout the app. Cancel or Escape dismisses without changing colour.

## 2026-10-13 — Keep fill colours visible

- Solid and gradient fills show the shared palette directly in the side panel
  again, including saved custom colours. Click a swatch to apply it; **Another
  colour** opens the custom picker directly.
- Other objects retain the compact **Change colour** popup.

## 2026-10-13 — Filled shapes and object depth

- Each filled shape and its boundary strokes now stack as one object. A shape
  in front covers the fill and outline behind it together, instead of allowing
  covered outlines to show through. Hole outlines move with their fill too.
- Select an object and press **Page Up** to raise it one step, or **Page Down**
  to lower it. Selecting either a fill or one of its boundary curves moves the
  whole filled shape. Multiple selected objects retain their relative order.
- Depth edits work without a new menu, keep the camera fixed, support Undo/Redo,
  and are saved with the sketch. The same order is used in print, SVG and TikZ.
- Editing handles and constraint markers remain visible as editor aids.
- When overlapping fills are equally close to the pointer, the frontmost one is selected first.

# Mech Sketch TODO

## Arrows with a tail foot (2026-10-14)

- [x] Add an optional short perpendicular bar (a "foot") at the tail of an
  arrow, matching the reference image. Support both straight and curved arrows;
  on curved arrows, the foot should be perpendicular to the curve at its tail.
  Include the foot in SVG, TikZ and PDF exports.

Completed 2026-10-14: select a straight or curved arrow and enable **Tail foot**
in its side panel. The foot follows the arrow's direction, color, thickness and
head size. It is radial on curved arrows and included in all three exports.

## Next priority — Fix group movement after pasting (2026-10-13)

- [x] Make multiple objects pasted with **Ctrl+V** move together when they are
  all selected. Currently, dragging the selection can scatter or distort the
  objects instead of translating them as one group.

Reproduce by copying several objects, pasting them together, and dragging the
entire pasted selection. Their relative positions and shapes should stay fixed;
their fills should follow their outlines.

Investigate the copied constraints and the group-drag solver. One possible cause
is that constraints to the origin, fixed coordinates, or other global references
remain active on some pasted objects while others can move. This is a hypothesis,
not a confirmed diagnosis. Preserve constraints within the copied group while
checking how global anchors should behave on independent pasted copies.

Verify the fix with a mix of constrained and unconstrained objects, including
solid and gradient fills. Check repeated paste, grid snapping, Ctrl axis locking,
and Undo/Redo, and keep the camera fixed while moving the group.

Completed 2026-10-14: group drags now apply a checked translation atomically,
and independent pasted copies release source fixed-point anchors. Regression
tests cover repeated paste, constrained and unconstrained geometry, solid and
gradient fills, snapping, Ctrl/Alt modifiers, blocked moves, Undo/Redo, and camera stability.

Follow-up 2026-10-14: fixed the initial press on fills and corners so dragging
keeps an existing group selected. Fill dragging also works for ordinary selections,
including boundaries and holes. Paste now centers copies at the current cursor.
Added regression checks for the full press-and-drag path, not just solver movement.

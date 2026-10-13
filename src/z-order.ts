import type { Sketch, Id, Fill } from "./model";
import type { Prim } from "./prims";

/** The outer boundary and hole outlines belong at the same depth as their fill. */
function boundaries(sk: Sketch, fill: Fill): Set<Id> {
  const ids = new Set([...fill.curves, ...fill.holes, ...fill.arcs.filter((id): id is Id => id !== null)]);
  if (fill.circle) ids.add(fill.circle);
  // Older polygon fills can describe their boundary only by corner points.
  if (!fill.circle && !fill.curves.length) {
    for (let i = 0; i < fill.points.length; i++) {
      const a = fill.points[i], b = fill.points[(i + 1) % fill.points.length];
      for (const e of sk.entities) if (e.type === "line" && ((e.p1 === a && e.p2 === b) || (e.p1 === b && e.p2 === a))) ids.add(e.id);
    }
  }
  return ids;
}

/** All visual parts of an object are contiguous; filled shapes include their strokes. */
export function orderPrims(sk: Sketch, prims: Prim[]): Prim[] {
  const owners = new Map<Id, Id[]>();
  for (const fill of sk.symbols) {
    if (fill.type !== "fill" || !prims.some(p => p.ref === fill.id)) continue;
    for (const id of boundaries(sk, fill)) owners.set(id, [...(owners.get(id) ?? []), fill.id]);
  }
  const groups = new Map<Id, Prim[]>();
  prims.forEach((p, i) => {
    // A shared boundary is painted with each adjacent region, at that region's depth.
    const roots = (p.ref && owners.get(p.ref)) ?? [p.ref ?? `unowned-${i}`];
    for (const root of roots) {
      const group = groups.get(root) ?? [];
      group.push({ ...p, stack: root });
      groups.set(root, group);
    }
  });
  const stored = [...new Set(sk.zOrder ?? [])].filter(id => groups.has(id));
  const order = [...stored, ...[...groups.keys()].filter(id => !stored.includes(id))];
  return order.flatMap(id => groups.get(id)!);
}

/** Move the selected objects by one neighbouring depth, preserving their relative order. */
export function moveInZ(sk: Sketch, selected: Set<Id>, prims: Prim[], direction: 1 | -1): boolean {
  const order = [...new Set(prims.map(p => p.stack ?? p.ref).filter((id): id is Id => !!id))];
  const roots = new Set<Id>();
  for (const id of selected) {
    // Picking a shared outline controls its frontmost filled object.
    const p = [...prims].reverse().find(p => p.ref === id);
    if (p) roots.add(p.stack ?? id);
  }
  let changed = false;
  const swap = (a: number, b: number) => { [order[a], order[b]] = [order[b], order[a]]; changed = true; };
  if (direction === 1) {
    for (let i = order.length - 2; i >= 0; i--) if (roots.has(order[i]) && !roots.has(order[i + 1])) swap(i, i + 1);
  } else {
    for (let i = 1; i < order.length; i++) if (roots.has(order[i]) && !roots.has(order[i - 1])) swap(i, i - 1);
  }
  if (changed) sk.zOrder = order;
  return changed;
}

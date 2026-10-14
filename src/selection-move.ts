import { entity, symbol, symbolRefs, curvePoints, type Id, type Sketch } from "./model";

/** Geometry belonging to the selection, including filled boundaries and holes. */
export function selectionGeometry(sk: Sketch, selection: Iterable<Id>): Set<Id> {
  const ids = new Set<Id>();
  const include = (id: Id) => {
    const e = entity(sk, id);
    if (!e || ids.has(id)) return;
    ids.add(id);
    if (e.type !== "point") curvePoints(e).forEach(include);
  };
  for (const id of selection) {
    include(id);
    const s = symbol(sk, id);
    if (s) {
      symbolRefs(s).forEach(include);
      if (s.type === "fill") s.holes.forEach(include);
    }
  }
  return ids;
}

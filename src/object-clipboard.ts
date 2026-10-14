// Self-contained selection snapshots; pasted geometry never shares IDs with the source.
import {
  type Sketch, type Id, type Sym, type Entity, type Constraint, ORIGIN, clone, deserialize,
  entity, curvePoints, symbolRefs, constraintRefs, isLink, newId, geometryBox,
} from "./model";
import { type V, grow, boxIsEmpty } from "./geom";

export interface ObjectClipboard { format: "mech-sketch-objects"; version: 1; sketch: Sketch }

/** Put the centre of the copied collection at the pointer, preserving its spacing. */
export function pasteOffsetAtCursor(clipboard: ObjectClipboard, cursor: V): V {
  const box = geometryBox(clipboard.sketch);
  for (const s of clipboard.sketch.symbols) {
    if (s.type === "note" || s.type === "frame" || s.type === "balloon") grow(box, [s.x, s.y]);
  }
  if (boxIsEmpty(box)) return cursor;
  return [cursor[0] - (box.x0 + box.x1) / 2, cursor[1] - (box.y0 + box.y1) / 2];
}

export function copyObjects(sk: Sketch, selected: Iterable<Id>): ObjectClipboard | null {
  const requested = new Set(selected), entities = new Set<Id>(), symbols = new Set<Id>();
  const include = (id: Id) => {
    const e = entity(sk, id);
    if (!e || entities.has(id)) return;
    entities.add(id);
    if (e.type !== "point") curvePoints(e).forEach((p) => entities.add(p));
  };
  const includeSymbol = (s: Sym) => {
    symbols.add(s.id);
    symbolRefs(s).forEach(include);
    if (s.type === "fill") s.holes.forEach(include);
  };
  requested.forEach((id) => { if (id !== ORIGIN) include(id); });
  for (const s of sk.symbols) {
    if (requested.has(s.id) || (s.type === "fill" && (s.circle ? requested.has(s.circle) : s.curves.some((id) => requested.has(id))))) includeSymbol(s);
  }
  for (const c of sk.constraints) if (requested.has(c.id) && !isLink(c)) constraintRefs(c).forEach(include);
  // Rectangle construction diagonals and arc control points are part of their shape.
  for (const e of sk.entities) if (e.type !== "point" && e.construction && curvePoints(e).every((id) => entities.has(id))) include(e.id);
  for (const c of sk.constraints) {
    if (c.type === "midpoint" && entities.has(c.l) && (entity(sk, c.l) as Entity & { construction?: boolean })?.construction) include(c.p);
    if (c.type === "pointOn" && entities.has(c.on) && entity(sk, c.on)?.type === "arc") include(c.p);
  }
  for (const s of sk.symbols) {
    const refs = symbolRefs(s);
    if (refs.length && refs.every((id) => entities.has(id))) includeSymbol(s);
  }
  if (!entities.size && !symbols.size) return null;
  const copied = clone(sk);
  copied.entities = copied.entities.filter((e) => entities.has(e.id));
  copied.symbols = copied.symbols.filter((s) => symbols.has(s.id));
  copied.constraints = copied.constraints.filter((c) => !isLink(c) && constraintRefs(c).every((id) => entities.has(id)));
  const plotIds = new Set(copied.symbols.flatMap((s) => s.type === "diagram" || s.type === "trace" ? [s.plot] : []));
  copied.plots = copied.plots?.filter((p) => plotIds.has(p.id));
  copied.zOrder = copied.zOrder?.filter((id) => entities.has(id) || symbols.has(id) || copied.constraints.some((c) => c.id === id));
  return { format: "mech-sketch-objects", version: 1, sketch: copied };
}

export function readObjectClipboard(text: string): ObjectClipboard | null {
  try {
    const raw = JSON.parse(text) as ObjectClipboard;
    if (raw.format !== "mech-sketch-objects" || raw.version !== 1 || !raw.sketch) return null;
    const hadOrigin = raw.sketch.entities.some((e) => e.id === ORIGIN);
    const sketch = deserialize(JSON.stringify(raw.sketch));
    if (!hadOrigin) sketch.entities = sketch.entities.filter((e) => e.id !== ORIGIN);
    const ids = new Set(sketch.entities.map((e) => e.id));
    if (ids.size !== sketch.entities.length) return null;
    for (const e of sketch.entities) {
      if (!["point", "line", "circle", "arc", "spline"].includes(e.type)) return null;
      if (e.type === "point" ? !Number.isFinite(e.x) || !Number.isFinite(e.y) : !curvePoints(e).every((id) => ids.has(id))) return null;
    }
    if (!sketch.constraints.every((c) => !isLink(c) && constraintRefs(c).every((id) => ids.has(id)))) return null;
    if (!sketch.symbols.every((s) => symbolRefs(s).every((id) => ids.has(id)))) return null;
    if (!sketch.entities.length && !sketch.symbols.length) return null;
    return { format: "mech-sketch-objects", version: 1, sketch };
  } catch { return null; }
}

const REFERENCE_KEYS = new Set(["id", "p1", "p2", "c1", "c2", "c", "a", "b", "p", "on", "l", "l1", "l2", "at", "o", "circle", "target", "plot", "points", "arcs", "curves", "holes"]);
function remap<T>(value: T, ids: Map<Id, Id>, key = ""): T {
  if (typeof value === "string") return (REFERENCE_KEYS.has(key) ? ids.get(value) ?? value : value) as T;
  if (Array.isArray(value)) return value.map((v) => remap(v, ids, key)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remap(v, ids, k)])) as T;
  return value;
}

export function pasteObjects(sk: Sketch, clipboard: ObjectClipboard, offset: V): Id[] {
  const source = clipboard.sketch, ids = new Map<Id, Id>();
  const oldOrder = sk.zOrder ?? [...sk.entities.filter((e) => e.type !== "point").map((e) => e.id), ...sk.constraints.map((c) => c.id), ...sk.symbols.map((s) => s.id)];
  if (!sk.symbols.some((s) => s.type === "support") && source.supportScale) sk.supportScale = source.supportScale;
  source.entities.forEach((e) => ids.set(e.id, newId(sk, e.type)));
  source.constraints.forEach((c) => ids.set(c.id, newId(sk, "constraint")));
  source.symbols.forEach((s) => ids.set(s.id, newId(sk, "symbol")));
  for (const p of source.plots ?? []) {
    ids.set(p.id, newId(sk, "plot"));
    p.curves.forEach((c) => ids.set(c.id, newId(sk, "curve")));
    [...p.notes ?? [], ...p.balloons ?? []].forEach((m) => ids.set(m.id, newId(sk, "mark")));
  }
  const entities = source.entities.map((e) => remap(e, ids));
  for (const e of entities) if (e.type === "point") { e.x += offset[0]; e.y += offset[1]; }
  const symbols = source.symbols.map((s) => remap(s, ids));
  for (const s of symbols) if (s.type === "note" || s.type === "frame" || s.type === "balloon") { s.x += offset[0]; s.y += offset[1]; }
  sk.entities.push(...entities);
  // Absolute pins belong to the source placement, not to an independent copy.
  sk.constraints.push(...source.constraints.filter((c) => c.type !== "fixed").map((c) => remap<Constraint>(c, ids)));
  sk.symbols.push(...symbols);
  if (source.plots?.length) sk.plots = [...sk.plots ?? [], ...source.plots.map((p) => remap(p, ids))];
  if (source.zOrder?.length) sk.zOrder = [...oldOrder, ...source.zOrder.map((id) => ids.get(id)!).filter(Boolean)];
  if (source.loadScale) sk.loadScale = { ...source.loadScale, ...sk.loadScale };
  const usedPoints = new Set(entities.flatMap((e) => e.type === "point" ? [] : curvePoints(e)));
  return [...entities.filter((e) => e.type !== "point" || !usedPoints.has(e.id)).map((e) => e.id), ...symbols.map((s) => s.id)];
}

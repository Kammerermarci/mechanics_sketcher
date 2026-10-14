import { type Sketch, type Id, type Line, type Circle, type Arc, type Spline, entity } from "./model";

export type ColoredCurve = Line | Circle | Arc | Spline;

/** Only explicitly selected curves are recolored; points and fills keep their own controls. */
export function selectedColorCurves(sk: Sketch, selection: Iterable<Id>): ColoredCurve[] {
  return [...selection].flatMap((id) => {
    const e = entity(sk, id);
    return e && e.type !== "point" ? [e] : [];
  });
}

/** Accept the same hex colors and opacity channels as the shared palette. */
export function strokeColor(curve: ColoredCurve): string | undefined {
  return curve.color && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(curve.color) ? curve.color : undefined;
}

export function setStrokeColor(curves: ColoredCurve[], color: string): boolean {
  if (!/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(color) || !curves.length) return false;
  curves.forEach((curve) => { curve.color = color; });
  return true;
}

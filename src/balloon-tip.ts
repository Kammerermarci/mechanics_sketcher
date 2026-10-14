import type { Balloon, Id, Sketch } from "./model";
import type { V } from "./geom";
import { balloonAnchor, curveParam } from "./prims";

/** Hide the tip grip when it would cover the balloon's own text. */
export function balloonTipGrip(sk: Sketch, balloon: Balloon, scale: number): V | null {
  return Math.hypot(balloon.dx, balloon.dy) * scale > 16 ? balloonAnchor(sk, balloon) : null;
}

/** Reattach the leader while preserving the bubble's original position. */
export function moveBalloonTip(sk: Sketch, balloon: Balloon, target: { pos: V; pointId?: Id; curveId?: Id }, centre: V): void {
  delete balloon.at; delete balloon.on; delete balloon.t;
  if (target.pointId) balloon.at = target.pointId;
  else if (target.curveId) { balloon.on = target.curveId; balloon.t = curveParam(sk, target.curveId, target.pos); }
  [balloon.x, balloon.y] = target.pos;
  balloon.dx = centre[0] - target.pos[0];
  balloon.dy = centre[1] - target.pos[1];
}

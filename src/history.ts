// Undo and redo as a list of whole-sketch snapshots. Sketches are small, so
// this is cheaper than tracking individual edits.

import { type Sketch, clone } from "./model";

const LIMIT = 300;

export class History {
  private states: Sketch[] = [];
  private index = -1;

  /** Starts over with `sk` as the only state. */
  reset(sk: Sketch): void {
    this.states = [clone(sk)];
    this.index = 0;
  }

  /** Records `sk` as the state after an edit. */
  commit(sk: Sketch): void {
    this.states.length = this.index + 1;
    this.states.push(clone(sk));
    if (this.states.length > LIMIT) this.states.shift();
    this.index = this.states.length - 1;
  }

  get canUndo(): boolean { return this.index > 0; }
  get canRedo(): boolean { return this.index < this.states.length - 1; }

  undo(): Sketch | null {
    if (!this.canUndo) return null;
    return clone(this.states[--this.index]);
  }

  redo(): Sketch | null {
    if (!this.canRedo) return null;
    return clone(this.states[++this.index]);
  }
}

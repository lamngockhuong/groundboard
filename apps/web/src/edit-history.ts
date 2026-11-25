/**
 * One undo history for everything a person changes while editing a board: content edits and
 * layout moves alike, each step a whole snapshot. At most `limit` steps back; a new step after
 * an undo drops the steps that were undone.
 */
export class EditHistory<T> {
  private steps: T[];
  private at = 0;
  private readonly limit: number;

  constructor(initial: T, limit = 50) {
    this.steps = [initial];
    this.limit = limit;
  }

  get current(): T {
    return this.steps[this.at] as T;
  }

  get canUndo(): boolean {
    return this.at > 0;
  }

  get canRedo(): boolean {
    return this.at < this.steps.length - 1;
  }

  push(step: T): void {
    this.steps = [...this.steps.slice(0, this.at + 1), step];
    if (this.steps.length > this.limit + 1) this.steps = this.steps.slice(-(this.limit + 1));
    this.at = this.steps.length - 1;
  }

  undo(): T | null {
    if (!this.canUndo) return null;
    this.at -= 1;
    return this.current;
  }

  redo(): T | null {
    if (!this.canRedo) return null;
    this.at += 1;
    return this.current;
  }
}

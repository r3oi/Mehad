// Snapshot-based undo/redo. Consecutive changes with the same merge key
// (e.g. dragging a font-size slider) collapse into one undo step.
export class History {
  constructor(limit = 150) {
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
    this.lastKey = null;
    this.lastAt = 0;
  }

  record(before, mergeKey = null) {
    const now = Date.now();
    if (mergeKey && mergeKey === this.lastKey && now - this.lastAt < 1200 && this.undoStack.length) {
      this.lastAt = now;
      this.redoStack = [];
      return;
    }
    this.undoStack.push(before);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    this.lastKey = mergeKey;
    this.lastAt = now;
  }

  undo(current) {
    if (!this.undoStack.length) return null;
    this.redoStack.push(current);
    this.lastKey = null;
    return this.undoStack.pop();
  }

  redo(current) {
    if (!this.redoStack.length) return null;
    this.undoStack.push(current);
    this.lastKey = null;
    return this.redoStack.pop();
  }

  breakMerge() { this.lastKey = null; }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
}

import {
  rebaseCanvasSnapshotChanges,
  type CanvasCommandResult,
  type CanvasDocumentSnapshot,
} from './commands';

interface CanvasHistoryEntry {
  before: CanvasDocumentSnapshot;
  after: CanvasDocumentSnapshot;
}

interface CanvasHistoryTransaction {
  id: string;
  before: CanvasDocumentSnapshot;
  redoStack: CanvasHistoryEntry[];
}

export interface CanvasHistoryTransitionToken {
  projectId: string | null;
  epoch: number;
}

export function isCanvasHistoryTransitionCurrent(
  transition: CanvasHistoryTransitionToken,
  currentProjectId: string | null,
  currentEpoch: number,
): boolean {
  return transition.projectId === currentProjectId && transition.epoch === currentEpoch;
}

function sameSnapshot(left: CanvasDocumentSnapshot, right: CanvasDocumentSnapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class CanvasHistoryController {
  private snapshot: CanvasDocumentSnapshot;
  private readonly maxSteps: number;
  private undoStack: CanvasHistoryEntry[] = [];
  private redoStack: CanvasHistoryEntry[] = [];
  private transaction: CanvasHistoryTransaction | null = null;

  constructor(initial: CanvasDocumentSnapshot, maxSteps = 50) {
    if (!Number.isInteger(maxSteps) || maxSteps < 1) throw new Error('History maxSteps must be positive');
    this.snapshot = initial;
    this.maxSteps = maxSteps;
  }

  current(): CanvasDocumentSnapshot {
    return this.snapshot;
  }

  begin(id: string): void {
    if (!id) throw new Error('History transaction ID is required');
    if (this.transaction) throw new Error(`History transaction ${this.transaction.id} is already active`);
    this.transaction = { id, before: this.snapshot, redoStack: [...this.redoStack] };
  }

  record(result: CanvasCommandResult): CanvasDocumentSnapshot {
    const before = this.snapshot;
    this.snapshot = result.next;
    if (result.history === 'skip') {
      if (this.transaction) {
        this.transaction.before = rebaseCanvasSnapshotChanges(this.transaction.before, before, result.next);
      }
      return this.snapshot;
    }
    if (sameSnapshot(before, result.next)) return this.snapshot;
    this.redoStack = [];
    if (!this.transaction) this.pushUndo({ before, after: result.next });
    return this.snapshot;
  }

  commit(id: string): CanvasDocumentSnapshot {
    const transaction = this.requireTransaction(id);
    this.transaction = null;
    if (!sameSnapshot(transaction.before, this.snapshot)) {
      this.pushUndo({ before: transaction.before, after: this.snapshot });
      this.redoStack = [];
    }
    return this.snapshot;
  }

  rollback(id: string): CanvasDocumentSnapshot {
    const transaction = this.requireTransaction(id);
    this.snapshot = transaction.before;
    this.redoStack = transaction.redoStack;
    this.transaction = null;
    return this.snapshot;
  }

  undo(): CanvasDocumentSnapshot {
    if (this.transaction) throw new Error('Cannot undo while a history transaction is active');
    const entry = this.undoStack.pop();
    if (!entry) return this.snapshot;
    this.redoStack.push(entry);
    this.snapshot = entry.before;
    return this.snapshot;
  }

  redo(): CanvasDocumentSnapshot {
    if (this.transaction) throw new Error('Cannot redo while a history transaction is active');
    const entry = this.redoStack.pop();
    if (!entry) return this.snapshot;
    this.pushUndo(entry);
    this.snapshot = entry.after;
    return this.snapshot;
  }

  reset(snapshot: CanvasDocumentSnapshot): void {
    this.snapshot = snapshot;
    this.undoStack = [];
    this.redoStack = [];
    this.transaction = null;
  }

  getCounts(): { undo: number; redo: number } {
    return { undo: this.undoStack.length, redo: this.redoStack.length };
  }

  private requireTransaction(id: string): CanvasHistoryTransaction {
    if (!this.transaction) throw new Error('There is no active history transaction');
    if (this.transaction.id !== id) {
      throw new Error(`History transaction ${id} does not match active transaction ${this.transaction.id}`);
    }
    return this.transaction;
  }

  private pushUndo(entry: CanvasHistoryEntry): void {
    this.undoStack.push(entry);
    while (this.undoStack.length > this.maxSteps) this.undoStack.shift();
  }
}

import * as vscode from 'vscode';
import { Hunk, FileChangeEntry } from './types';

export class HunkStore {
  private store: Map<string, Hunk[]> = new Map();
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  setHunks(filePath: string, hunks: Hunk[]): void {
    if (hunks.length === 0) {
      this.store.delete(filePath);
    } else {
      this.store.set(filePath, hunks);
    }
    this._onDidChange.fire();
  }

  getHunks(filePath: string): Hunk[] {
    return this.store.get(filePath) || [];
  }

  getHunkById(hunkId: string): Hunk | undefined {
    for (const hunks of this.store.values()) {
      const found = hunks.find(h => h.id === hunkId);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  accept(hunkId: string): Hunk | undefined {
    for (const [filePath, hunks] of this.store.entries()) {
      const hunk = hunks.find(h => h.id === hunkId);
      if (hunk) {
        hunk.status = 'accepted';
        this._onDidChange.fire();
        this.cleanupFile(filePath);
        return hunk;
      }
    }
    return undefined;
  }

  reject(hunkId: string): Hunk | undefined {
    for (const [filePath, hunks] of this.store.entries()) {
      const hunk = hunks.find(h => h.id === hunkId);
      if (hunk) {
        hunk.status = 'rejected';
        this._onDidChange.fire();
        this.cleanupFile(filePath);
        return hunk;
      }
    }
    return undefined;
  }

  acceptFile(filePath: string): Hunk[] {
    const hunks = this.store.get(filePath);
    if (!hunks) {
      return [];
    }
    const accepted: Hunk[] = [];
    for (const hunk of hunks) {
      if (hunk.status === 'pending') {
        hunk.status = 'accepted';
        accepted.push(hunk);
      }
    }
    this._onDidChange.fire();
    this.cleanupFile(filePath);
    return accepted;
  }

  rejectFile(filePath: string): Hunk[] {
    const hunks = this.store.get(filePath);
    if (!hunks) {
      return [];
    }
    const rejected: Hunk[] = [];
    for (const hunk of hunks) {
      if (hunk.status === 'pending') {
        hunk.status = 'rejected';
        rejected.push(hunk);
      }
    }
    this._onDidChange.fire();
    this.cleanupFile(filePath);
    return rejected;
  }

  acceptAll(): void {
    for (const filePath of [...this.store.keys()]) {
      this.acceptFile(filePath);
    }
  }

  getPending(filePath: string): Hunk[] {
    const hunks = this.store.get(filePath) || [];
    return hunks.filter(h => h.status === 'pending');
  }

  getAllEntries(): FileChangeEntry[] {
    const entries: FileChangeEntry[] = [];
    for (const [filePath, hunks] of this.store.entries()) {
      const pendingCount = hunks.filter(h => h.status === 'pending').length;
      if (pendingCount > 0) {
        entries.push({ filePath, hunks, pendingCount });
      }
    }
    return entries;
  }

  private cleanupFile(filePath: string): void {
    const hunks = this.store.get(filePath);
    if (!hunks) {
      return;
    }
    const hasPending = hunks.some(h => h.status === 'pending');
    if (!hasPending) {
      this.store.delete(filePath);
      this._onDidChange.fire();
    }
  }

  clear(): void {
    this.store.clear();
    this._onDidChange.fire();
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}

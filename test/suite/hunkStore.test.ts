import * as assert from 'assert';
import { Hunk } from '../../src/types';

// Minimal HunkStore for unit testing (no vscode dependency)
class TestHunkStore {
  private store: Map<string, Hunk[]> = new Map();

  setHunks(filePath: string, hunks: Hunk[]): void {
    if (hunks.length === 0) {
      this.store.delete(filePath);
    } else {
      this.store.set(filePath, hunks);
    }
  }

  getHunks(filePath: string): Hunk[] {
    return this.store.get(filePath) || [];
  }

  accept(hunkId: string): Hunk | undefined {
    for (const [filePath, hunks] of this.store.entries()) {
      const hunk = hunks.find(h => h.id === hunkId);
      if (hunk) {
        hunk.status = 'accepted';
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
        this.cleanupFile(filePath);
        return hunk;
      }
    }
    return undefined;
  }

  getPending(filePath: string): Hunk[] {
    const hunks = this.store.get(filePath) || [];
    return hunks.filter(h => h.status === 'pending');
  }

  getAllEntries() {
    const entries: { filePath: string; hunks: Hunk[]; pendingCount: number }[] = [];
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
    }
  }

  clear(): void {
    this.store.clear();
  }
}

function makeHunk(id: string, filePath: string): Hunk {
  return {
    id,
    filePath,
    startLine: 1,
    endLine: 2,
    newStartLine: 1,
    originalLines: ['original'],
    newLines: ['modified'],
    status: 'pending',
  };
}

suite('HunkStore', () => {
  test('accept() changes status and decrements pending count', () => {
    const store = new TestHunkStore();
    const h1 = makeHunk('f::1', 'file.ts');
    const h2 = makeHunk('f::5', 'file.ts');
    store.setHunks('file.ts', [h1, h2]);

    assert.strictEqual(store.getPending('file.ts').length, 2);

    store.accept('f::1');
    assert.strictEqual(store.getPending('file.ts').length, 1);
    assert.strictEqual(h1.status, 'accepted');
  });

  test('reject() preserves originalLines', () => {
    const store = new TestHunkStore();
    const h1 = makeHunk('f::1', 'file.ts');
    const originalLinesCopy = [...h1.originalLines];

    store.setHunks('file.ts', [h1]);
    store.reject('f::1');

    assert.strictEqual(h1.status, 'rejected');
    assert.deepStrictEqual(h1.originalLines, originalLinesCopy);
  });

  test('mixed accept/reject on same file leaves other hunks untouched', () => {
    const store = new TestHunkStore();
    const h1 = makeHunk('f::1', 'file.ts');
    const h2 = makeHunk('f::5', 'file.ts');
    const h3 = makeHunk('f::10', 'file.ts');
    store.setHunks('file.ts', [h1, h2, h3]);

    store.accept('f::1');
    store.reject('f::5');

    assert.strictEqual(h1.status, 'accepted');
    assert.strictEqual(h2.status, 'rejected');
    assert.strictEqual(h3.status, 'pending');
    assert.strictEqual(store.getPending('file.ts').length, 1);
  });

  test('file is removed from entries when all hunks resolved', () => {
    const store = new TestHunkStore();
    const h1 = makeHunk('f::1', 'file.ts');
    store.setHunks('file.ts', [h1]);

    store.accept('f::1');
    assert.strictEqual(store.getAllEntries().length, 0);
  });
});

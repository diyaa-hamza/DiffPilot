import * as assert from 'assert';
import { computeHunks } from '../../src/DiffEngine';

suite('DiffEngine', () => {
  test('single-line change produces 1 hunk', () => {
    const original = 'line1\nline2\nline3\n';
    const modified = 'line1\nchanged\nline3\n';
    const hunks = computeHunks(original, modified, 'test.ts');

    assert.strictEqual(hunks.length, 1);
    assert.strictEqual(hunks[0].filePath, 'test.ts');
    assert.strictEqual(hunks[0].status, 'pending');
    assert.deepStrictEqual(hunks[0].originalLines, ['line2']);
    assert.deepStrictEqual(hunks[0].newLines, ['changed']);
  });

  test('multi-block change produces N hunks', () => {
    // Need enough context lines between changes so jsdiff treats them as separate hunks
    const lines = [];
    for (let i = 1; i <= 30; i++) {
      lines.push(`line${i}`);
    }
    const original = lines.join('\n') + '\n';
    const modLines = [...lines];
    modLines[1] = 'CHANGED2';   // line 2
    modLines[28] = 'CHANGED29'; // line 29 — far enough apart
    const modified = modLines.join('\n') + '\n';
    const hunks = computeHunks(original, modified, 'multi.ts');

    assert.ok(hunks.length >= 2, `Expected >= 2 hunks, got ${hunks.length}`);
    assert.ok(hunks.every(h => h.status === 'pending'));
  });

  test('identical files produce 0 hunks', () => {
    const content = 'same\ncontent\nhere\n';
    const hunks = computeHunks(content, content, 'same.ts');

    assert.strictEqual(hunks.length, 0);
  });

  test('empty original (new file) produces 1 hunk', () => {
    const modified = 'new\nfile\ncontent\n';
    const hunks = computeHunks('', modified, 'new.ts');

    assert.strictEqual(hunks.length, 1);
    assert.strictEqual(hunks[0].originalLines.length, 0);
    assert.ok(hunks[0].newLines.length > 0);
  });
});

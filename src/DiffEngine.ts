import * as Diff from 'diff';
import { Hunk } from './types';

export function computeHunks(original: string, modified: string, filePath: string): Hunk[] {
  const patch = Diff.structuredPatch('', '', original, modified, '', '');

  return patch.hunks.map(h => ({
    id: `${filePath}::${h.oldStart}`,
    filePath,
    startLine: h.oldStart,
    endLine: h.oldStart + h.oldLines,
    newStartLine: h.newStart,
    originalLines: h.lines.filter(l => l.startsWith('-')).map(l => l.slice(1)),
    newLines: h.lines.filter(l => l.startsWith('+')).map(l => l.slice(1)),
    status: 'pending' as const,
  }));
}

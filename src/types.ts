export type HunkStatus = 'pending' | 'accepted' | 'rejected';

export interface Hunk {
  id: string;               // `${filePath}::${startLine}`
  filePath: string;
  startLine: number;        // 1-based line in original file
  endLine: number;
  newStartLine: number;     // 1-based line in modified file
  originalLines: string[];
  newLines: string[];
  status: HunkStatus;
}

export interface FileChangeEntry {
  filePath: string;
  hunks: Hunk[];
  pendingCount: number;
}

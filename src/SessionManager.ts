import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';

export class SessionManager {
  private snapshot: Map<string, string> = new Map();
  private _onDidReset = new vscode.EventEmitter<void>();
  readonly onDidReset = this._onDidReset.event;
  private _isActive = false;

  get isActive(): boolean {
    return this._isActive;
  }

  async start(): Promise<void> {
    await this.capture();
    this._isActive = true;
  }

  stop(): void {
    this._isActive = false;
    // Do NOT clear snapshots — hunks stay for review
  }

  async captureFromGit(workspaceRoot: string): Promise<void> {
    this.snapshot.clear();

    const execGit = (args: string[]): Promise<string> => {
      return new Promise((resolve, reject) => {
        cp.execFile('git', args, { cwd: workspaceRoot, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
          if (err) {
            reject(new Error(stderr || err.message));
          } else {
            resolve(stdout);
          }
        });
      });
    };

    const [diffOut, untrackedOut] = await Promise.all([
      execGit(['diff', '--name-only']),
      execGit(['ls-files', '--others', '--exclude-standard']),
    ]);

    const modified = diffOut.trim().split('\n').filter(Boolean);
    const untracked = untrackedOut.trim().split('\n').filter(Boolean);

    // For each modified file, store the index (staged) content as the baseline
    for (const relPath of modified) {
      try {
        const indexContent = await execGit(['show', `:${relPath}`]);
        const absPath = path.join(workspaceRoot, relPath);
        this.snapshot.set(absPath, indexContent);
      } catch {
        // File may not be in index
      }
    }

    // For each untracked file, store '' as baseline (entire file is new)
    for (const relPath of untracked) {
      const absPath = path.join(workspaceRoot, relPath);
      this.snapshot.set(absPath, '');
    }

    this._isActive = true;
  }

  private async capture(): Promise<void> {
    this.snapshot.clear();
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return;
    }
    for (const folder of workspaceFolders) {
      await this.captureDirectory(folder.uri.fsPath);
    }
  }

  private async captureDirectory(dirPath: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name === 'node_modules' ||
          entry.name === '.git' ||
          entry.name === 'out' ||
          entry.name === '.vscode-test'
        ) {
          continue;
        }
        await this.captureDirectory(fullPath);
      } else if (entry.isFile()) {
        if (entry.name === '.diffpilot-signal') {
          continue;
        }
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          this.snapshot.set(fullPath, content);
        } catch {
          // Skip files that can't be read (binary, permissions, etc.)
        }
      }
    }
  }

  captureFile(filePath: string): void {
    if (this.snapshot.has(filePath)) {
      return;
    }
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      this.snapshot.set(filePath, content);
    } catch {
      // File doesn't exist yet (truly new) — leave it unsnapshotted so
      // getOriginal returns undefined and we treat '' as the baseline.
    }
  }

  getOriginal(filePath: string): string | undefined {
    return this.snapshot.get(filePath);
  }

  hasFile(filePath: string): boolean {
    return this.snapshot.has(filePath);
  }

  isNewFile(filePath: string): boolean {
    return !this.snapshot.has(filePath);
  }

  reset(): void {
    this.snapshot.clear();
    this._onDidReset.fire();
  }

  get fileCount(): number {
    return this.snapshot.size;
  }

  /** Returns all file paths that have snapshots */
  getSnapshotPaths(): string[] {
    return Array.from(this.snapshot.keys());
  }

  dispose(): void {
    this._onDidReset.dispose();
  }
}

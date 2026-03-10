import * as vscode from 'vscode';
import * as fs from 'fs';
import { SessionManager } from './SessionManager';
import { HunkStore } from './HunkStore';
import { computeHunks } from './DiffEngine';

export class FileWatcher implements vscode.Disposable {
  private watcher: vscode.FileSystemWatcher | undefined;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    private sessionManager: SessionManager,
    private hunkStore: HunkStore,
  ) {}

  start(): void {
    this.watcher = vscode.workspace.createFileSystemWatcher('**/*');
    this.watcher.onDidChange(uri => this.handleChange(uri));
    this.watcher.onDidCreate(uri => this.handleChange(uri));
    this.watcher.onDidDelete(uri => this.handleDelete(uri));
  }

  private handleChange(uri: vscode.Uri): void {
    const filePath = uri.fsPath;
    if (this.shouldIgnore(filePath)) {
      return;
    }

    const existing = this.debounceTimers.get(filePath);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(filePath);
      this.computeDiff(filePath);
    }, 300);
    this.debounceTimers.set(filePath, timer);
  }

  private handleDelete(uri: vscode.Uri): void {
    const filePath = uri.fsPath;
    this.hunkStore.setHunks(filePath, []);
  }

  private computeDiff(filePath: string): void {
    let modified: string;
    try {
      modified = fs.readFileSync(filePath, 'utf-8');
    } catch {
      return;
    }

    const original = this.sessionManager.getOriginal(filePath) ?? '';
    const hunks = computeHunks(original, modified, filePath);
    this.hunkStore.setHunks(filePath, hunks);
  }

  private shouldIgnore(filePath: string): boolean {
    const ignorePatterns = [
      'node_modules',
      '.git',
      '.vscode-test',
      '/out/',
      '.DS_Store',
      '.diffpilot-signal',
    ];
    return ignorePatterns.some(p => filePath.includes(p));
  }

  stop(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.watcher?.dispose();
    this.watcher = undefined;
  }

  dispose(): void {
    this.stop();
  }
}

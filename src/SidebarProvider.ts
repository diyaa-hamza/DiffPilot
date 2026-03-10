import * as vscode from 'vscode';
import * as path from 'path';
import { HunkStore } from './HunkStore';
import { FileChangeEntry } from './types';

export class SidebarProvider implements vscode.TreeDataProvider<FileChangeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<FileChangeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private hunkStore: HunkStore) {
    hunkStore.onDidChange(() => {
      this._onDidChangeTreeData.fire();
    });
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: FileChangeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): FileChangeItem[] {
    const entries = this.hunkStore.getAllEntries();
    return entries.map(entry => new FileChangeItem(entry));
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}

export class FileChangeItem extends vscode.TreeItem {
  constructor(public readonly entry: FileChangeEntry) {
    const fileName = path.basename(entry.filePath);
    super(fileName, vscode.TreeItemCollapsibleState.None);

    this.description = `${entry.pendingCount} pending hunk${entry.pendingCount !== 1 ? 's' : ''}`;
    this.tooltip = entry.filePath;
    this.iconPath = new vscode.ThemeIcon('diff');
    this.contextValue = 'changedFile';

    this.command = {
      command: 'diffpilot.openFileInline',
      title: 'Open File with Inline Review',
      arguments: [entry.filePath],
    };
  }
}

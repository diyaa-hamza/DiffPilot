import * as vscode from 'vscode';
import { HunkStore } from './HunkStore';

export class HunkCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;
  private disposables: vscode.Disposable[] = [];

  constructor(private hunkStore: HunkStore) {
    this.disposables.push(
      hunkStore.onDidChange(() => this._onDidChangeCodeLenses.fire()),
    );
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const filePath = document.uri.fsPath;
    const pending = this.hunkStore.getPending(filePath);

    if (pending.length === 0) {
      return [];
    }

    const firstHunk = pending[0];
    const line = Math.max(0, firstHunk.newStartLine - 1);
    const range = new vscode.Range(line, 0, line, 0);

    return [
      new vscode.CodeLens(range, {
        title: '$(check-all) Keep All',
        command: 'diffpilot.acceptFile',
        arguments: [filePath],
      }),
      new vscode.CodeLens(range, {
        title: '$(close-all) Undo All',
        command: 'diffpilot.rejectFile',
        arguments: [filePath],
      }),
    ];
  }

  dispose(): void {
    this._onDidChangeCodeLenses.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

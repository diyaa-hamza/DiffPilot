import * as vscode from 'vscode';
import { HunkStore } from './HunkStore';

export class HunkInlayHintProvider implements vscode.InlayHintsProvider, vscode.Disposable {
  private _onDidChangeInlayHints = new vscode.EventEmitter<void>();
  readonly onDidChangeInlayHints = this._onDidChangeInlayHints.event;
  private disposables: vscode.Disposable[] = [];

  constructor(private hunkStore: HunkStore) {
    this.disposables.push(
      hunkStore.onDidChange(() => this._onDidChangeInlayHints.fire()),
    );
  }

  provideInlayHints(document: vscode.TextDocument, range: vscode.Range): vscode.InlayHint[] {
    const filePath = document.uri.fsPath;
    const pending = this.hunkStore.getPending(filePath);

    if (pending.length === 0) {
      return [];
    }

    const isMac = process.platform === 'darwin';
    const hints: vscode.InlayHint[] = [];

    for (const hunk of pending) {
      // Determine the line to place the hint on
      let hintLine: number;
      if (hunk.newLines.length > 0) {
        // End of the hunk's last new line (0-based)
        hintLine = hunk.newStartLine - 1 + hunk.newLines.length - 1;
      } else {
        // Pure deletion: place at newStartLine - 1 (the line where content was removed)
        hintLine = Math.max(0, hunk.newStartLine - 1);
      }

      // Clamp to document bounds
      if (hintLine >= document.lineCount) {
        hintLine = document.lineCount - 1;
      }

      // Skip if outside the requested range
      if (hintLine < range.start.line || hintLine > range.end.line) {
        continue;
      }

      const lineLength = document.lineAt(hintLine).text.length;
      const position = new vscode.Position(hintLine, lineLength);

      const undoPart = new vscode.InlayHintLabelPart(isMac ? '  Undo ⌘N  ' : '  Undo Ctrl+N  ');
      undoPart.command = {
        title: 'Undo Hunk',
        command: 'diffpilot.rejectHunkInline',
        arguments: [hunk.id],
      };

      const keepPart = new vscode.InlayHintLabelPart('  Keep  ');
      keepPart.command = {
        title: 'Keep Hunk',
        command: 'diffpilot.acceptHunkInline',
        arguments: [hunk.id],
      };

      const hint = new vscode.InlayHint(position, [undoPart, keepPart]);
      hint.paddingLeft = true;
      hint.kind = vscode.InlayHintKind.Parameter;
      hints.push(hint);
    }

    return hints;
  }

  dispose(): void {
    this._onDidChangeInlayHints.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

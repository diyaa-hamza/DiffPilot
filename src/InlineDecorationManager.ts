import * as vscode from 'vscode';
import { HunkStore } from './HunkStore';

export class InlineDecorationManager implements vscode.Disposable {
  private addedDecoration: vscode.TextEditorDecorationType;
  private removedDecoration: vscode.TextEditorDecorationType;
  private disposables: vscode.Disposable[] = [];

  constructor(private hunkStore: HunkStore) {
    this.addedDecoration = vscode.window.createTextEditorDecorationType({
      backgroundColor: 'rgba(155, 233, 168, 0.35)',
      isWholeLine: true,
      overviewRulerColor: 'rgba(40, 167, 69, 0.8)',
      overviewRulerLane: vscode.OverviewRulerLane.Left,
      gutterIconSize: 'contain',
      borderWidth: '0 0 0 3px',
      borderStyle: 'solid',
      borderColor: 'rgba(40, 167, 69, 0.6)',
    });

    this.removedDecoration = vscode.window.createTextEditorDecorationType({
      backgroundColor: 'rgba(255, 129, 130, 0.25)',
      isWholeLine: true,
      overviewRulerColor: 'rgba(215, 58, 73, 0.8)',
      overviewRulerLane: vscode.OverviewRulerLane.Left,
      borderWidth: '0 0 0 3px',
      borderStyle: 'solid',
      borderColor: 'rgba(215, 58, 73, 0.6)',
    });

    this.disposables.push(
      hunkStore.onDidChange(() => this.updateDecorations()),
      vscode.window.onDidChangeActiveTextEditor(() => this.updateDecorations()),
    );

    // Apply decorations to the current editor immediately
    this.updateDecorations();
  }

  updateDecorations(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    const filePath = editor.document.uri.fsPath;
    const hunks = this.hunkStore.getPending(filePath);

    if (hunks.length === 0) {
      editor.setDecorations(this.addedDecoration, []);
      editor.setDecorations(this.removedDecoration, []);
      return;
    }

    const addedRanges: vscode.DecorationOptions[] = [];
    const removedRanges: vscode.DecorationOptions[] = [];

    for (const hunk of hunks) {
      const lineIndex = hunk.newStartLine - 1; // Convert to 0-based

      if (hunk.newLines.length > 0) {
        // Added or modified lines — highlight them green
        const startPos = new vscode.Position(lineIndex, 0);
        const endLine = lineIndex + hunk.newLines.length - 1;
        const endPos = new vscode.Position(endLine, Number.MAX_SAFE_INTEGER);

        const hoverParts: string[] = [];
        if (hunk.originalLines.length > 0) {
          hoverParts.push('**Replaced:**');
          hoverParts.push('```');
          hoverParts.push(...hunk.originalLines);
          hoverParts.push('```');
        } else {
          hoverParts.push('*New lines added*');
        }

        addedRanges.push({
          range: new vscode.Range(startPos, endPos),
          hoverMessage: new vscode.MarkdownString(hoverParts.join('\n')),
        });
      }

      if (hunk.originalLines.length > 0 && hunk.newLines.length === 0) {
        // Pure deletion — mark the line where content was removed
        const markerLine = Math.max(0, lineIndex);
        const pos = new vscode.Position(markerLine, 0);

        const hoverParts = [
          '**Deleted lines:**',
          '```',
          ...hunk.originalLines,
          '```',
        ];

        removedRanges.push({
          range: new vscode.Range(pos, pos),
          hoverMessage: new vscode.MarkdownString(hoverParts.join('\n')),
        });
      }
    }

    editor.setDecorations(this.addedDecoration, addedRanges);
    editor.setDecorations(this.removedDecoration, removedRanges);
  }

  dispose(): void {
    this.addedDecoration.dispose();
    this.removedDecoration.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

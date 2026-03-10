import * as vscode from 'vscode';
import { HunkStore } from './HunkStore';
import { SessionManager } from './SessionManager';
import { Hunk } from './types';
import { computeHunks } from './DiffEngine';
import * as fs from 'fs';
import * as path from 'path';

export class DiffViewerPanel {
  public static currentPanel: DiffViewerPanel | undefined;
  private static readonly viewType = 'diffpilot.diffViewer';

  private readonly panel: vscode.WebviewPanel;
  private filePath: string;
  private disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    filePath: string,
    private hunkStore: HunkStore,
    private sessionManager: SessionManager,
    private extensionUri: vscode.Uri,
  ) {
    this.panel = panel;
    this.filePath = filePath;

    this.update();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'acceptHunk':
            await this.handleAcceptHunk(message.hunkId);
            break;
          case 'rejectHunk':
            await this.handleRejectHunk(message.hunkId);
            break;
          case 'acceptFile':
            await this.handleAcceptFile();
            break;
          case 'rejectFile':
            await this.handleRejectFile();
            break;
        }
      },
      null,
      this.disposables,
    );

    this.hunkStore.onDidChange(() => {
      if (this.panel.visible) {
        this.update();
      }
    }, null, this.disposables);
  }

  static createOrShow(
    filePath: string,
    hunkStore: HunkStore,
    sessionManager: SessionManager,
    extensionUri: vscode.Uri,
  ): DiffViewerPanel {
    const column = vscode.ViewColumn.Beside;

    if (DiffViewerPanel.currentPanel) {
      DiffViewerPanel.currentPanel.filePath = filePath;
      DiffViewerPanel.currentPanel.panel.reveal(column);
      DiffViewerPanel.currentPanel.update();
      return DiffViewerPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      DiffViewerPanel.viewType,
      `DiffPilot: ${path.basename(filePath)}`,
      column,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      },
    );

    DiffViewerPanel.currentPanel = new DiffViewerPanel(
      panel, filePath, hunkStore, sessionManager, extensionUri,
    );
    return DiffViewerPanel.currentPanel;
  }

  public getCurrentHunkId(): string | undefined {
    const hunks = this.hunkStore.getPending(this.filePath);
    return hunks.length > 0 ? hunks[0].id : undefined;
  }

  public getFilePath(): string {
    return this.filePath;
  }

  private async handleAcceptHunk(hunkId: string): Promise<void> {
    this.hunkStore.accept(hunkId);
    this.update();
  }

  private async handleRejectHunk(hunkId: string): Promise<void> {
    const hunk = this.hunkStore.getHunkById(hunkId);
    if (!hunk) {
      return;
    }

    await this.restoreHunkContent(hunk);
    this.hunkStore.reject(hunkId);
    this.update();
  }

  private async handleAcceptFile(): Promise<void> {
    this.hunkStore.acceptFile(this.filePath);
    this.update();
  }

  private async handleRejectFile(): Promise<void> {
    const original = this.sessionManager.getOriginal(this.filePath);

    if (original === undefined) {
      // New file — delete it
      try {
        fs.unlinkSync(this.filePath);
      } catch {
        // Already gone
      }
    } else {
      // Restore entire file from snapshot
      const edit = new vscode.WorkspaceEdit();
      const uri = vscode.Uri.file(this.filePath);
      const doc = await vscode.workspace.openTextDocument(uri);
      const fullRange = new vscode.Range(
        doc.positionAt(0),
        doc.positionAt(doc.getText().length),
      );
      edit.replace(uri, fullRange, original);
      await vscode.workspace.applyEdit(edit);
      await doc.save();
    }

    this.hunkStore.rejectFile(this.filePath);
    this.update();
  }

  private async restoreHunkContent(hunk: Hunk): Promise<void> {
    const uri = vscode.Uri.file(hunk.filePath);
    const doc = await vscode.workspace.openTextDocument(uri);

    const edit = new vscode.WorkspaceEdit();
    const startLine = hunk.newStartLine - 1; // 0-based
    const endLine = startLine + hunk.newLines.length;

    const startPos = new vscode.Position(startLine, 0);
    const endPos = endLine <= doc.lineCount
      ? new vscode.Position(endLine, 0)
      : doc.lineAt(doc.lineCount - 1).range.end;

    const restoredText = hunk.originalLines.length > 0
      ? hunk.originalLines.join('\n') + '\n'
      : '';

    edit.replace(uri, new vscode.Range(startPos, endPos), restoredText);
    await vscode.workspace.applyEdit(edit);
    await doc.save();

    // Recompute hunks for this file after the restore
    const original = this.sessionManager.getOriginal(hunk.filePath) ?? '';
    let modified: string;
    try {
      modified = fs.readFileSync(hunk.filePath, 'utf-8');
    } catch {
      modified = '';
    }
    const newHunks = computeHunks(original, modified, hunk.filePath);
    this.hunkStore.setHunks(hunk.filePath, newHunks);
  }

  private update(): void {
    const hunks = this.hunkStore.getHunks(this.filePath);
    const pendingHunks = hunks.filter(h => h.status === 'pending');

    this.panel.title = `DiffPilot: ${path.basename(this.filePath)}`;
    this.panel.webview.html = this.getHtml(pendingHunks);
  }

  private getHtml(hunks: Hunk[]): string {
    const cssUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'diffpilot.css'),
    );

    const hunksHtml = hunks.length === 0
      ? '<p class="no-changes">No pending changes for this file.</p>'
      : hunks.map(h => this.renderHunk(h)).join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.panel.webview.cspSource} 'unsafe-inline'; script-src 'unsafe-inline';">
  <link href="${cssUri}" rel="stylesheet">
  <title>DiffPilot</title>
</head>
<body>
  <div class="toolbar">
    <h2>${this.escapeHtml(path.basename(this.filePath))}</h2>
    <div class="toolbar-actions">
      <button class="btn btn-accept" onclick="acceptFile()">Accept All</button>
      <button class="btn btn-reject" onclick="rejectFile()">Reject All</button>
    </div>
  </div>
  <div class="hunks">
    ${hunksHtml}
  </div>
  <script>
    const vscode = acquireVsCodeApi();

    function acceptHunk(hunkId) {
      vscode.postMessage({ command: 'acceptHunk', hunkId });
    }

    function rejectHunk(hunkId) {
      vscode.postMessage({ command: 'rejectHunk', hunkId });
    }

    function acceptFile() {
      vscode.postMessage({ command: 'acceptFile' });
    }

    function rejectFile() {
      vscode.postMessage({ command: 'rejectFile' });
    }
  </script>
</body>
</html>`;
  }

  private renderHunk(hunk: Hunk): string {
    const escapedId = this.escapeHtml(hunk.id);
    const removedLines = hunk.originalLines
      .map(l => `<div class="line removed">- ${this.escapeHtml(l)}</div>`)
      .join('\n');
    const addedLines = hunk.newLines
      .map(l => `<div class="line added">+ ${this.escapeHtml(l)}</div>`)
      .join('\n');

    return `
    <div class="hunk" data-hunk-id="${escapedId}">
      <div class="hunk-header">
        <span class="hunk-location">Line ${hunk.startLine}</span>
        <div class="hunk-actions">
          <button class="btn btn-accept btn-sm" onclick="acceptHunk('${escapedId}')">Accept</button>
          <button class="btn btn-reject btn-sm" onclick="rejectHunk('${escapedId}')">Reject</button>
        </div>
      </div>
      <div class="hunk-diff">
        ${removedLines}
        ${addedLines}
      </div>
    </div>`;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private dispose(): void {
    DiffViewerPanel.currentPanel = undefined;
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}

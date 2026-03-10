import * as vscode from 'vscode';
import { HunkStore } from './HunkStore';

export interface NavBarState {
  hunkIndex: number;
  hunkCount: number;
  fileIndex: number;
  fileCount: number;
  showHunkItems: boolean;
  showFileItems: boolean;
}

export class NavigationBarManager implements vscode.Disposable {
  private _onDidRefresh = new vscode.EventEmitter<NavBarState>();
  readonly onDidRefresh = this._onDidRefresh.event;

  private prevHunkItem: vscode.StatusBarItem;
  private nextHunkItem: vscode.StatusBarItem;
  private hunkCounterItem: vscode.StatusBarItem;
  private undoAllItem: vscode.StatusBarItem;
  private keepAllItem: vscode.StatusBarItem;
  private prevFileItem: vscode.StatusBarItem;
  private fileCounterItem: vscode.StatusBarItem;
  private nextFileItem: vscode.StatusBarItem;

  private fileList: string[] = [];
  private currentFileIndex = 0;
  private currentHunkIndex = 0;

  private disposables: vscode.Disposable[] = [];

  constructor(private hunkStore: HunkStore) {
    this.prevHunkItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10007);
    this.nextHunkItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10006);
    this.hunkCounterItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10005);
    this.undoAllItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10004);
    this.keepAllItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10003);
    this.prevFileItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10002);
    this.fileCounterItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10001);
    this.nextFileItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10000);

    this.prevHunkItem.text = '$(chevron-up)';
    this.prevHunkItem.command = 'diffpilot.previousHunk';
    this.prevHunkItem.tooltip = 'Previous Hunk';

    this.nextHunkItem.text = '$(chevron-down)';
    this.nextHunkItem.command = 'diffpilot.nextHunk';
    this.nextHunkItem.tooltip = 'Next Hunk';

    this.hunkCounterItem.tooltip = 'Current hunk position';

    this.undoAllItem.text = 'Undo All';
    this.undoAllItem.command = 'diffpilot.rejectFile';
    this.undoAllItem.tooltip = 'Reject all hunks in current file';

    this.keepAllItem.text = 'Keep All';
    this.keepAllItem.command = 'diffpilot.acceptFile';
    this.keepAllItem.tooltip = 'Accept all hunks in current file';
    this.keepAllItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');

    this.prevFileItem.text = '$(chevron-left)';
    this.prevFileItem.command = 'diffpilot.previousFile';
    this.prevFileItem.tooltip = 'Previous File';

    this.fileCounterItem.tooltip = 'Current file position';

    this.nextFileItem.text = '$(chevron-right)';
    this.nextFileItem.command = 'diffpilot.nextFile';
    this.nextFileItem.tooltip = 'Next File';

    this.disposables.push(
      this.prevHunkItem, this.nextHunkItem, this.hunkCounterItem,
      this.undoAllItem, this.keepAllItem,
      this.prevFileItem, this.fileCounterItem, this.nextFileItem,
    );

    this.disposables.push(
      hunkStore.onDidChange(() => this.refresh()),
      vscode.window.onDidChangeActiveTextEditor(() => this.refresh()),
      vscode.window.onDidChangeTextEditorSelection(() => this.syncHunkIndexToCursor()),
    );

    this.refresh();
  }

  refresh(): void {
    const entries = this.hunkStore.getAllEntries();
    this.fileList = entries.map(e => e.filePath);

    // Hide everything if no changed files
    if (this.fileList.length === 0) {
      this.hideAll();
      this._onDidRefresh.fire({
        hunkIndex: 0, hunkCount: 0,
        fileIndex: 0, fileCount: 0,
        showHunkItems: false, showFileItems: false,
      });
      return;
    }

    // Show file navigation
    this.currentFileIndex = this.clamp(this.currentFileIndex, 0, this.fileList.length - 1);
    this.fileCounterItem.text = `${this.currentFileIndex + 1} / ${this.fileList.length} files`;
    this.prevFileItem.show();
    this.fileCounterItem.show();
    this.nextFileItem.show();

    // Determine if active editor matches a changed file
    const activeFilePath = vscode.window.activeTextEditor?.document.uri.fsPath;
    const activeFileIndex = activeFilePath ? this.fileList.indexOf(activeFilePath) : -1;

    if (activeFileIndex >= 0) {
      this.currentFileIndex = activeFileIndex;
      this.fileCounterItem.text = `${this.currentFileIndex + 1} / ${this.fileList.length} files`;
    }

    const currentFile = this.fileList[this.currentFileIndex];
    const pendingHunks = this.hunkStore.getPending(currentFile);

    if (pendingHunks.length === 0 || activeFileIndex < 0) {
      // Hide hunk-level items when active editor isn't a changed file or no pending hunks
      this.prevHunkItem.hide();
      this.nextHunkItem.hide();
      this.hunkCounterItem.hide();
      this.undoAllItem.hide();
      this.keepAllItem.hide();
      this._onDidRefresh.fire({
        hunkIndex: 0, hunkCount: 0,
        fileIndex: this.currentFileIndex, fileCount: this.fileList.length,
        showHunkItems: false, showFileItems: true,
      });
      return;
    }

    this.currentHunkIndex = this.clamp(this.currentHunkIndex, 0, pendingHunks.length - 1);
    this.hunkCounterItem.text = `${this.currentHunkIndex + 1} / ${pendingHunks.length}`;

    this.prevHunkItem.show();
    this.nextHunkItem.show();
    this.hunkCounterItem.show();
    this.undoAllItem.show();
    this.keepAllItem.show();

    this._onDidRefresh.fire({
      hunkIndex: this.currentHunkIndex,
      hunkCount: pendingHunks.length,
      fileIndex: this.currentFileIndex,
      fileCount: this.fileList.length,
      showHunkItems: true,
      showFileItems: true,
    });
  }

  private syncHunkIndexToCursor(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    const filePath = editor.document.uri.fsPath;
    if (!this.fileList.includes(filePath)) {
      return;
    }

    const pendingHunks = this.hunkStore.getPending(filePath);
    if (pendingHunks.length === 0) {
      return;
    }

    const cursorLine = editor.selection.active.line + 1; // 1-based
    let closestIndex = 0;
    let closestDistance = Infinity;
    for (let i = 0; i < pendingHunks.length; i++) {
      const dist = Math.abs(pendingHunks[i].newStartLine - cursorLine);
      if (dist < closestDistance) {
        closestDistance = dist;
        closestIndex = i;
      }
    }

    if (this.currentHunkIndex !== closestIndex) {
      this.currentHunkIndex = closestIndex;
      this.hunkCounterItem.text = `${this.currentHunkIndex + 1} / ${pendingHunks.length}`;
    }
  }

  nextHunk(): void {
    const currentFile = this.fileList[this.currentFileIndex];
    if (!currentFile) {
      return;
    }
    const pendingHunks = this.hunkStore.getPending(currentFile);
    if (pendingHunks.length === 0) {
      return;
    }

    this.currentHunkIndex = (this.currentHunkIndex + 1) % pendingHunks.length;
    this.hunkCounterItem.text = `${this.currentHunkIndex + 1} / ${pendingHunks.length}`;
    this.revealHunk(currentFile, pendingHunks[this.currentHunkIndex].newStartLine);
  }

  previousHunk(): void {
    const currentFile = this.fileList[this.currentFileIndex];
    if (!currentFile) {
      return;
    }
    const pendingHunks = this.hunkStore.getPending(currentFile);
    if (pendingHunks.length === 0) {
      return;
    }

    this.currentHunkIndex = (this.currentHunkIndex - 1 + pendingHunks.length) % pendingHunks.length;
    this.hunkCounterItem.text = `${this.currentHunkIndex + 1} / ${pendingHunks.length}`;
    this.revealHunk(currentFile, pendingHunks[this.currentHunkIndex].newStartLine);
  }

  async nextFile(): Promise<void> {
    if (this.fileList.length === 0) {
      return;
    }
    this.currentFileIndex = (this.currentFileIndex + 1) % this.fileList.length;
    this.currentHunkIndex = 0;
    await this.openFileAtFirstHunk(this.fileList[this.currentFileIndex]);
  }

  async previousFile(): Promise<void> {
    if (this.fileList.length === 0) {
      return;
    }
    this.currentFileIndex = (this.currentFileIndex - 1 + this.fileList.length) % this.fileList.length;
    this.currentHunkIndex = 0;
    await this.openFileAtFirstHunk(this.fileList[this.currentFileIndex]);
  }

  private async openFileAtFirstHunk(filePath: string): Promise<void> {
    const uri = vscode.Uri.file(filePath);
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);

    const pendingHunks = this.hunkStore.getPending(filePath);
    if (pendingHunks.length > 0) {
      const line = pendingHunks[0].newStartLine - 1;
      const pos = new vscode.Position(line, 0);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    }

    this.refresh();
  }

  private revealHunk(filePath: string, startLine: number): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.fsPath !== filePath) {
      return;
    }
    const line = startLine - 1;
    const pos = new vscode.Position(line, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
  }

  private hideAll(): void {
    this.prevHunkItem.hide();
    this.nextHunkItem.hide();
    this.hunkCounterItem.hide();
    this.undoAllItem.hide();
    this.keepAllItem.hide();
    this.prevFileItem.hide();
    this.fileCounterItem.hide();
    this.nextFileItem.hide();
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  dispose(): void {
    this._onDidRefresh.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { HunkStore } from './HunkStore';
import { SessionManager } from './SessionManager';
import { FileWatcher } from './FileWatcher';
import { SidebarProvider } from './SidebarProvider';
import { DiffViewerPanel } from './DiffViewerPanel';
import { InlineDecorationManager } from './InlineDecorationManager';
import { HunkCodeLensProvider } from './HunkCodeLensProvider';
import { NavigationBarManager } from './NavigationBarManager';
import { HunkInlayHintProvider } from './HunkInlayHintProvider';
import { computeHunks } from './DiffEngine';
import { Hunk } from './types';

export async function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel('DiffPilot');
  outputChannel.appendLine('DiffPilot: activating...');

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    outputChannel.appendLine('DiffPilot: No workspace folder found. Extension inactive.');
    return;
  }

  outputChannel.appendLine(`DiffPilot: workspace = ${workspaceFolder.uri.fsPath}`);

  const workspaceRoot = workspaceFolder.uri.fsPath;

  const hunkStore = new HunkStore();
  const sessionManager = new SessionManager();
  const fileWatcher = new FileWatcher(sessionManager, hunkStore);
  const sidebarProvider = new SidebarProvider(hunkStore);
  const decorationManager = new InlineDecorationManager(hunkStore);
  const codeLensProvider = new HunkCodeLensProvider(hunkStore);
  const navBar = new NavigationBarManager(hunkStore);
  const inlayHintProvider = new HunkInlayHintProvider(hunkStore);

  // Register inlay hints provider for inline Undo/Keep buttons
  context.subscriptions.push(
    vscode.languages.registerInlayHintsProvider({ scheme: 'file' }, inlayHintProvider),
  );

  // No auto-start — session inactive initially
  vscode.commands.executeCommand('setContext', 'diffpilotSessionActive', false);

  // Register tree view
  const treeView = vscode.window.createTreeView('diffpilot.changedFiles', {
    treeDataProvider: sidebarProvider,
  });

  // Register CodeLens provider for all files
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, codeLensProvider),
  );

  // Track whether our view is active for keybinding context
  context.subscriptions.push(
    treeView.onDidChangeVisibility(() => {
      vscode.commands.executeCommand(
        'setContext', 'diffpilotViewActive', treeView.visible,
      );
    }),
  );

  // --- Helper: restore a single hunk's content from snapshot ---
  async function restoreHunkContent(hunk: Hunk): Promise<void> {
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
    const original = sessionManager.getOriginal(hunk.filePath) ?? '';
    let modified: string;
    try {
      modified = fs.readFileSync(hunk.filePath, 'utf-8');
    } catch {
      modified = '';
    }
    const newHunks = computeHunks(original, modified, hunk.filePath);
    hunkStore.setHunks(hunk.filePath, newHunks);
  }

  // --- Helper: restore an entire file from snapshot ---
  async function restoreFileContent(filePath: string): Promise<void> {
    const original = sessionManager.getOriginal(filePath);

    if (original === undefined) {
      // New file — delete it
      try {
        fs.unlinkSync(filePath);
      } catch {
        // Already gone
      }
    } else {
      const edit = new vscode.WorkspaceEdit();
      const uri = vscode.Uri.file(filePath);
      const doc = await vscode.workspace.openTextDocument(uri);
      const fullRange = new vscode.Range(
        doc.positionAt(0),
        doc.positionAt(doc.getText().length),
      );
      edit.replace(uri, fullRange, original);
      await vscode.workspace.applyEdit(edit);
      await doc.save();
    }
  }

  // =============================================
  // SESSION COMMANDS
  // =============================================

  // Start Session
  context.subscriptions.push(
    vscode.commands.registerCommand('diffpilot.startSession', async () => {
      try {
        hunkStore.clear();
        await sessionManager.start();
        fileWatcher.start();
        vscode.commands.executeCommand('setContext', 'diffpilotSessionActive', true);
        vscode.window.showInformationMessage(`DiffPilot: Session started. Snapshotted ${sessionManager.fileCount} files.`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`DiffPilot: Failed to start session — ${err.message}`);
      }
    }),
  );

  // Stop Session
  context.subscriptions.push(
    vscode.commands.registerCommand('diffpilot.stopSession', async () => {
      fileWatcher.stop();
      sessionManager.stop();
      vscode.commands.executeCommand('setContext', 'diffpilotSessionActive', false);
      vscode.window.showInformationMessage('DiffPilot: Session stopped. Hunks remain for review.');
    }),
  );

  // Capture from Git Diff
  context.subscriptions.push(
    vscode.commands.registerCommand('diffpilot.captureFromGit', async () => {
      try {
        // Verify this is a git repo
        const { execFileSync } = require('child_process');
        execFileSync('git', ['rev-parse', '--git-dir'], { cwd: workspaceRoot });

        hunkStore.clear();
        await sessionManager.captureFromGit(workspaceRoot);

        // Compute hunks for each file that has a snapshot
        for (const filePath of sessionManager.getSnapshotPaths()) {
          const original = sessionManager.getOriginal(filePath) ?? '';
          let modified: string;
          try {
            modified = fs.readFileSync(filePath, 'utf-8');
          } catch {
            continue;
          }
          const hunks = computeHunks(original, modified, filePath);
          if (hunks.length > 0) {
            hunkStore.setHunks(filePath, hunks);
          }
        }

        fileWatcher.start();
        vscode.commands.executeCommand('setContext', 'diffpilotSessionActive', true);
        vscode.window.showInformationMessage('DiffPilot: Captured changes from git diff. Session active.');
      } catch (err: any) {
        vscode.window.showErrorMessage(`DiffPilot: Failed to capture — ${err.message}`);
      }
    }),
  );

  // =============================================
  // ACCEPT / REJECT COMMANDS
  // =============================================

  // Open file inline with decorations + CodeLens (primary UX)
  context.subscriptions.push(
    vscode.commands.registerCommand('diffpilot.openFileInline', async (filePath: string) => {
      const uri = vscode.Uri.file(filePath);
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);

      // Scroll to first pending hunk
      const pending = hunkStore.getPending(filePath);
      if (pending.length > 0) {
        const line = pending[0].newStartLine - 1;
        const pos = new vscode.Position(line, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
      }

      vscode.commands.executeCommand('setContext', 'diffpilotViewActive', true);
    }),
  );

  // Open diff viewer (webview — secondary option)
  context.subscriptions.push(
    vscode.commands.registerCommand('diffpilot.openDiffViewer', (filePath: string) => {
      DiffViewerPanel.createOrShow(filePath, hunkStore, sessionManager, context.extensionUri);
      vscode.commands.executeCommand('setContext', 'diffpilotViewActive', true);
    }),
  );

  // Accept hunk inline (from CodeLens)
  context.subscriptions.push(
    vscode.commands.registerCommand('diffpilot.acceptHunkInline', async (hunkId: string) => {
      hunkStore.accept(hunkId);
    }),
  );

  // Reject hunk inline (from CodeLens)
  context.subscriptions.push(
    vscode.commands.registerCommand('diffpilot.rejectHunkInline', async (hunkId: string) => {
      const hunk = hunkStore.getHunkById(hunkId);
      if (!hunk) {
        return;
      }
      await restoreHunkContent(hunk);
      hunkStore.reject(hunkId);
    }),
  );

  // Accept hunk (keyboard shortcut / webview)
  context.subscriptions.push(
    vscode.commands.registerCommand('diffpilot.acceptHunk', async () => {
      // Try inline first: find first pending hunk for active editor
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        const pending = hunkStore.getPending(editor.document.uri.fsPath);
        if (pending.length > 0) {
          hunkStore.accept(pending[0].id);
          return;
        }
      }
      // Fallback to webview panel
      const panel = DiffViewerPanel.currentPanel;
      if (panel) {
        const hunkId = panel.getCurrentHunkId();
        if (hunkId) {
          hunkStore.accept(hunkId);
        }
      }
    }),
  );

  // Reject hunk (keyboard shortcut / webview)
  context.subscriptions.push(
    vscode.commands.registerCommand('diffpilot.rejectHunk', async () => {
      // Try inline first
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        const pending = hunkStore.getPending(editor.document.uri.fsPath);
        if (pending.length > 0) {
          const hunk = pending[0];
          await restoreHunkContent(hunk);
          hunkStore.reject(hunk.id);
          return;
        }
      }
      // Fallback to webview panel
      const panel = DiffViewerPanel.currentPanel;
      if (panel) {
        const hunkId = panel.getCurrentHunkId();
        if (hunkId) {
          const hunk = hunkStore.getHunkById(hunkId);
          if (hunk) {
            await restoreHunkContent(hunk);
            hunkStore.reject(hunkId);
          }
        }
      }
    }),
  );

  // Accept file
  context.subscriptions.push(
    vscode.commands.registerCommand('diffpilot.acceptFile', async (filePath?: string) => {
      const target = filePath
        || vscode.window.activeTextEditor?.document.uri.fsPath
        || DiffViewerPanel.currentPanel?.getFilePath();
      if (target) {
        hunkStore.acceptFile(target);
      }
    }),
  );

  // Reject file
  context.subscriptions.push(
    vscode.commands.registerCommand('diffpilot.rejectFile', async (filePath?: string) => {
      const target = filePath
        || vscode.window.activeTextEditor?.document.uri.fsPath
        || DiffViewerPanel.currentPanel?.getFilePath();
      if (target) {
        await restoreFileContent(target);
        hunkStore.rejectFile(target);
      }
    }),
  );

  // =============================================
  // NAVIGATION COMMANDS
  // =============================================

  // Accept All Files
  context.subscriptions.push(
    vscode.commands.registerCommand('diffpilot.acceptAllFiles', () => {
      hunkStore.acceptAll();
    }),
  );

  // Next Hunk
  context.subscriptions.push(
    vscode.commands.registerCommand('diffpilot.nextHunk', () => {
      navBar.nextHunk();
    }),
  );

  // Previous Hunk
  context.subscriptions.push(
    vscode.commands.registerCommand('diffpilot.previousHunk', () => {
      navBar.previousHunk();
    }),
  );

  // Next File
  context.subscriptions.push(
    vscode.commands.registerCommand('diffpilot.nextFile', async () => {
      await navBar.nextFile();
    }),
  );

  // Previous File
  context.subscriptions.push(
    vscode.commands.registerCommand('diffpilot.previousFile', async () => {
      await navBar.previousFile();
    }),
  );

  // =============================================
  // SIGNAL FILE WATCHER (Claude Code integration)
  // =============================================
  const signalPattern = new vscode.RelativePattern(workspaceFolder, '.diffpilot-signal');
  const signalWatcher = vscode.workspace.createFileSystemWatcher(signalPattern);

  const handleSignalFile = async () => {
    const signalPath = path.join(workspaceRoot, '.diffpilot-signal');
    let content: string;
    try {
      content = fs.readFileSync(signalPath, 'utf-8').trim().toLowerCase();
    } catch {
      return;
    }

    if (content === 'start') {
      await vscode.commands.executeCommand('diffpilot.startSession');
    } else if (content === 'stop') {
      await vscode.commands.executeCommand('diffpilot.stopSession');
    }

    // Delete the signal file after processing
    try {
      fs.unlinkSync(signalPath);
    } catch {
      // Already gone
    }
  };

  signalWatcher.onDidCreate(handleSignalFile);
  signalWatcher.onDidChange(handleSignalFile);

  // =============================================
  // DISPOSABLES
  // =============================================
  context.subscriptions.push(
    { dispose: () => hunkStore.dispose() },
    { dispose: () => sessionManager.dispose() },
    { dispose: () => fileWatcher.dispose() },
    { dispose: () => sidebarProvider.dispose() },
    decorationManager,
    codeLensProvider,
    navBar,
    inlayHintProvider,
    treeView,
    signalWatcher,
  );
}

export function deactivate() {}

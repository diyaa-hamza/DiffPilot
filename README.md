# DiffPilot

A VS Code / Cursor extension that gives you a dedicated review panel for AI-generated code changes. When AI agents (Claude Code, Cursor, Copilot) modify your files, DiffPilot lets you accept or reject changes at the hunk level — surgically, one by one.

## Why DiffPilot?

AI coding tools modify multiple files at once. VS Code's built-in diff only shows you the full file delta against git. DiffPilot solves this by:

- **Session-based tracking** — only changes made *during* a session are shown, not your entire git diff
- **Hunk-level control** — accept or reject individual hunks, not entire files
- **Inline review** — Undo/Keep buttons and green/red highlighting right where the changes are

## Features

- **Start/Stop Sessions** — snapshot workspace files, then track only new changes
- **Capture from Git Diff** — import existing unstaged git changes as reviewable hunks
- **Inline Hunk Review** — per-hunk `Undo` / `Keep` inlay hint buttons at the end of each changed block
- **Prominent Diff Highlighting** — saturated green/red line backgrounds with gutter borders
- **File-Level CodeLens** — `Keep All` / `Undo All` CodeLens above the first hunk in each file
- **Sidebar Panel** — activity bar view listing all changed files with pending hunk counts
- **Status Bar Navigation** — navigate between hunks and files from the status bar
- **Diff Viewer** — webview panel with red/green line diffs and Accept/Reject buttons
- **Keyboard Shortcuts** — `Alt+]` to accept, `Alt+[` to reject the current hunk
- **Claude Code Integration** — auto-start sessions via a signal file

## Installation

### From VSIX

```bash
# VS Code
code --install-extension diffpilot-0.1.0.vsix

# Cursor
cursor --install-extension diffpilot-0.1.0.vsix
```

Or in either editor: `Cmd+Shift+P` → **Extensions: Install from VSIX...** → select the file.

### From Source

```bash
git clone https://github.com/diyaa-hamza/DiffPilot.git
cd DiffPilot
npm install
npm run compile
```

Then press `F5` in VS Code to launch the Extension Development Host.

## Usage

### Quick Start

1. Open a **folder** in VS Code or Cursor (required — the extension needs a workspace)
2. Click the **DiffPilot** icon in the Activity Bar
3. Click **Start Session** or **Capture from Git Diff**
4. Make changes — or let an AI agent make changes
5. Review hunks inline: green lines = added, red lines = deleted
6. Use the `Undo` / `Keep` buttons at the end of each hunk, or `Keep All` / `Undo All` CodeLens at the top
7. Click **Stop Session** when done

### Three Ways to Start

| Method | When to Use |
|--------|-------------|
| **Start Session** | Before AI makes changes — snapshots all files, tracks only new changes |
| **Capture from Git Diff** | AI already made changes — imports unstaged git diff as reviewable hunks |
| **Signal File** | Automated — AI tools write `.diffpilot-signal` to auto-start/stop |

### Claude Code Integration

Add this to your project's `CLAUDE.md` so Claude Code automatically starts a review session:

```markdown
# DiffPilot Integration
Before making any code changes, start the DiffPilot session:
  echo "start" > .diffpilot-signal
After all code changes are complete, stop the session:
  echo "stop" > .diffpilot-signal
```

The extension watches for `.diffpilot-signal` and processes the command automatically.

## Commands

| Command | Keybinding | Description |
|---------|------------|-------------|
| `DiffPilot: Start Session` | — | Snapshot files and start tracking changes |
| `DiffPilot: Stop Session` | — | Stop tracking (hunks remain for review) |
| `DiffPilot: Capture from Git Diff` | — | Import unstaged git changes as hunks |
| `DiffPilot: Accept Hunk` | `Alt+]` | Accept the current hunk (keep the change) |
| `DiffPilot: Reject Hunk` | `Alt+[` | Reject the current hunk (restore original) |
| `DiffPilot: Accept All Hunks in File` | — | Keep all pending hunks in a file |
| `DiffPilot: Reject All Hunks in File` | — | Undo all pending hunks and restore the file |
| `DiffPilot: Next Hunk` | — | Navigate to next pending hunk |
| `DiffPilot: Previous Hunk` | — | Navigate to previous pending hunk |
| `DiffPilot: Next File` | — | Navigate to next file with pending hunks |
| `DiffPilot: Previous File` | — | Navigate to previous file with pending hunks |

## Architecture

```
src/
  extension.ts               # Entry point — commands, signal file watcher
  SessionManager.ts          # Snapshot capture, session lifecycle, git capture
  FileWatcher.ts             # File system watcher, debounced diff computation
  DiffEngine.ts              # Hunk computation using the diff library
  HunkStore.ts               # In-memory hunk state (pending/accepted/rejected)
  SidebarProvider.ts         # Tree view data provider for changed files
  InlineDecorationManager.ts # Inline green/red decorations in the editor
  HunkCodeLensProvider.ts    # File-level Keep All / Undo All CodeLens
  HunkInlayHintProvider.ts   # Per-hunk Undo / Keep inlay hint buttons
  NavigationBarManager.ts    # Status bar hunk/file navigation
  DiffViewerPanel.ts         # Webview panel for side-by-side diff review
  types.ts                   # Shared types (Hunk, FileChangeEntry)
```

## Development

### Prerequisites

- Node.js >= 18
- VS Code >= 1.85.0

### Setup

```bash
npm install
npm run compile
```

### Running

Press `F5` in VS Code to launch the Extension Development Host with the extension loaded.

### Watch Mode

```bash
npm run watch
```

### Testing

```bash
npm run compile
npx mocha out/test/suite/diffEngine.test.js out/test/suite/hunkStore.test.js --ui tdd
```

### Packaging

```bash
npx @vscode/vsce package --allow-missing-repository
```

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Run tests (`npm run compile && npx mocha out/test/suite/*.test.js --ui tdd`)
5. Commit your changes
6. Push to the branch (`git push origin feature/my-feature`)
7. Open a Pull Request

## Roadmap

- [ ] Publish to VS Code Marketplace
- [ ] Multi-root workspace support
- [ ] Hunk grouping by logical change
- [ ] Undo rejected hunks
- [ ] Integration with more AI tools (Aider, Continue, etc.)

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

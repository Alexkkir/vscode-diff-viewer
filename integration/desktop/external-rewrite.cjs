const vscode = require("vscode");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
exports.run = async function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "diff-rewrite-"));
  const filename = path.join(dir, "changes.diff");
  const uri = vscode.Uri.file(filename);
  const patch = (label) =>
    `diff --git a/example.txt b/example.txt\n--- a/example.txt\n+++ b/example.txt\n@@ -1 +1 @@\n-old\n+${label}\n`;
  const events = [];
  const listener = vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.document.uri.fsPath === filename) events.push({ version: e.document.version, text: e.document.getText() });
  });
  async function expectRendered(label) {
    let state;
    for (let i = 0; i < 50; i++) {
      try {
        state = await vscode.commands.executeCommand("diffviewer._captureActiveTestState");
      } catch {}
      if (state?.codeLineTexts.some((line) => line.includes(label))) return;
      await wait(100);
    }
    console.log(
      "REWRITE DEBUG",
      JSON.stringify({
        state,
        events,
        documents: vscode.workspace.textDocuments
          .filter((d) => d.uri.fsPath === filename)
          .map((d) => ({ version: d.version, text: d.getText(), closed: d.isClosed })),
      }),
    );
    assert.fail(`Rendered diff did not update to ${label}`);
  }
  try {
    fs.writeFileSync(filename, patch("first-version"));
    await vscode.commands.executeCommand("vscode.openWith", uri, "diffViewer");
    await expectRendered("first-version");
    fs.writeFileSync(filename, patch("second-version"));
    await vscode.commands.executeCommand("vscode.openWith", uri, "diffViewer");
    await expectRendered("second-version");
    const replacement = path.join(dir, "replacement.tmp");
    fs.writeFileSync(replacement, patch("atomic-version"));
    fs.renameSync(replacement, filename);
    await expectRendered("atomic-version");
    fs.writeFileSync(filename, patch("third-version"));
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    await vscode.commands.executeCommand("vscode.openWith", uri, "diffViewer");
    await expectRendered("third-version");
    console.log("External diff rewrite passed");
  } finally {
    listener.dispose();
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

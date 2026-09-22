const vscode = require("vscode");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
exports.run = async function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "syntax-colors-"));
  const file = path.join(dir, "changes.diff");
  try {
    fs.writeFileSync(
      file,
      "--- docs/failure_handling.md\t(446896b256014781a4d94f1ccc267c8615eb1474)\n+++ docs/failure_handling.md\t(working tree)\n@@ -1 +1,2 @@\n-old\n+# Failure Handling\n+Use `code` here\n",
    );
    if (process.env.DIFF_VIEWER_TEST_FIXTURE) fs.copyFileSync(process.env.DIFF_VIEWER_TEST_FIXTURE, file);
    await vscode.commands.executeCommand("vscode.openWith", vscode.Uri.file(file), "diffViewer");
    let state;
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 100));
      try {
        state = await vscode.commands.executeCommand("diffviewer._captureActiveTestState");
      } catch {}
      if (state?.syntaxTokens?.some((t) => t.color !== t.baseColor)) break;
    }
    assert.ok(state.textMateTokenCount > 0, "Native TextMate tokens must be used");
    console.log("SYNTAX COLORS", JSON.stringify(state?.syntaxTokens));
    assert.ok(
      state?.syntaxTokens?.some((t) => t.color !== t.baseColor),
      "Tokens must have a different computed color from plain code",
    );
    await vscode.commands.executeCommand("diffviewer.diagnostics");
    const report = JSON.parse(vscode.window.activeTextEditor.document.getText());
    assert.equal(report.extensionVersion, "1.8.8");
    assert.equal(report.read.lastRead.source, "disk");
    assert.equal(report.read.lastReadSha256, report.read.disk.utf8Sha256);
    console.log("Read diagnostics passed");
  } finally {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

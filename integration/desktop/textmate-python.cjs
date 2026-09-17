const vscode = require("vscode");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
exports.run = async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "textmate-python-"));
  const filename = path.join(dir, "python.diff");
  const config = vscode.workspace.getConfiguration("workbench");
  const theme = config.get("colorTheme");
  const layout = vscode.workspace.getConfiguration("diffviewer").get("outputFormat");
  try {
    await config.update("colorTheme", "Dark+", vscode.ConfigurationTarget.Global);
    fs.writeFileSync(
      filename,
      '--- example.py\t(abcdef123)\n+++ example.py\t(working tree)\n@@ -1 +1,5 @@\n-old\n+@module.decorator(\n+    owner="example",\n+    enabled=True,\n+)\n+def example():\n',
    );
    await vscode.commands.executeCommand("vscode.openWith", vscode.Uri.file(filename), "diffViewer");
    for (const format of ["line-by-line", "side-by-side"]) {
      await vscode.workspace
        .getConfiguration("diffviewer")
        .update("outputFormat", format, vscode.ConfigurationTarget.Global);
      let state;
      for (let i = 0; i < 100; i++) {
        await new Promise((r) => setTimeout(r, 100));
        try {
          state = await vscode.commands.executeCommand("diffviewer._captureActiveTestState");
        } catch {}
        if (
          state?.outputFormat === format &&
          state?.syntaxTokens?.some((t) => t.text === "def" && t.color === "rgb(86, 156, 214)")
        )
          break;
      }
      assert.ok(state?.textMateTokenCount > 0);
      assert.ok(
        state.syntaxTokens.some((t) => t.text === "def" && t.color === "rgb(86, 156, 214)"),
        "Python def must use the actual Dark+ storage color",
      );
      assert.ok(
        state.syntaxTokens.some((t) => t.text === "example" && t.color === "rgb(220, 220, 170)"),
        "Function name must use the actual Dark+ function color",
      );
      console.log("TextMate Python passed", format, JSON.stringify(state.syntaxTokens));
    }
  } finally {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await config.update("colorTheme", theme, vscode.ConfigurationTarget.Global);
    await vscode.workspace
      .getConfiguration("diffviewer")
      .update("outputFormat", layout, vscode.ConfigurationTarget.Global);
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

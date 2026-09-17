const vscode = require("vscode");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
exports.run = async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "diff-fstrings-"));
  const config = vscode.workspace.getConfiguration("workbench");
  const theme = config.get("colorTheme");
  const layout = vscode.workspace.getConfiguration("diffviewer").get("outputFormat");
  try {
    await config.update("colorTheme", "Dark+", vscode.ConfigurationTarget.Global);
    for (const format of ["line-by-line", "side-by-side"]) {
      await vscode.workspace
        .getConfiguration("diffviewer")
        .update("outputFormat", format, vscode.ConfigurationTarget.Global);
      for (const scenario of ["standalone", "with-source", "stale-source"]) {
        const stem = `${format}-${scenario}`;
        const sourcePath = path.join(dir, stem + ".py");
        const patchPath = path.join(dir, stem + ".diff");
        if (scenario !== "standalone")
          fs.writeFileSync(
            sourcePath,
            scenario === "with-source"
              ? "\n".repeat(8) +
                  'run_query(f"""\nSELECT {value}\n""",\n)\nif ready:\n    count = 2\nquery = f"""SELECT {value}"""\n'
              : 'unrelated = "wrong snapshot"\n',
          );
        fs.writeFileSync(
          patchPath,
          `--- ${stem}.py\t(abcdef123)\n+++ ${stem}.py\t(working tree)\n@@ -10,6 +10,6 @@\n SELECT {value}\n """,\n )\n if ready:\n-    count = 1\n+    count = 2\n query = f"""SELECT {value}"""\n`,
        );
        await vscode.commands.executeCommand("vscode.openWith", vscode.Uri.file(patchPath), "diffViewer");
        let state;
        for (let i = 0; i < 80; i++) {
          await new Promise((r) => setTimeout(r, 100));
          try {
            state = await vscode.commands.executeCommand("diffviewer._captureActiveTestState");
          } catch {}
          if (
            state?.textMateTokenCount > 0 &&
            state.syntaxTokens.some((t) => t.text === "if" && t.color === "rgb(197, 134, 192)")
          )
            break;
        }
        assert.ok(
          state?.syntaxTokens.some((t) => t.text === "if" && t.color === "rgb(197, 134, 192)"),
          `${scenario}/${format}: Python following a closing triple quote must not be colored as string`,
        );
        assert.ok(
          state.syntaxTokens.some((t) => t.text.includes("SELECT") && t.color === "rgb(206, 145, 120)"),
          `${scenario}/${format}: SQL must remain string content`,
        );
        assert.ok(
          state.syntaxTokens.some((t) => t.text === "value" && t.color !== "rgb(206, 145, 120)"),
          `${scenario}/${format}: f-string interpolation must not inherit string color`,
        );
        console.log("F-string context passed", scenario, format);
        await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      }
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

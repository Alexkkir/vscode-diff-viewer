const vscode = require("vscode");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const blue = "rgb(79, 193, 255)";
const teal = "rgb(78, 201, 176)";
const gray = "rgb(212, 212, 212)";
const orange = "rgb(206, 145, 120)";
const green = "rgb(106, 153, 85)";
const commonLines = [
  "import math",
  "PROMPT_COLUMN: str = __PROMPT_COLUMN__",
  "MAX_IMAGE_AREA = 1024",
  'label = "MAX_IMAGE_AREA"',
  "# MAX_IMAGE_AREA must stay a comment",
  'label2 = f"MAX_IMAGE_AREA {MAX_IMAGE_AREA}"',
];

function hasToken(state, text, color, exact = true) {
  return state?.syntaxTokens?.some(
    (token) => (exact ? token.text === text : token.text.includes(text)) && token.color === color,
  );
}

exports.run = async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "diff-semantics-"));
  const workbench = vscode.workspace.getConfiguration("workbench");
  const editor = vscode.workspace.getConfiguration("editor");
  const diffviewer = vscode.workspace.getConfiguration("diffviewer");
  const theme = workbench.get("colorTheme");
  const layout = diffviewer.get("outputFormat");
  const semantic = editor.get("semanticHighlighting.enabled");
  const custom = editor.get("semanticTokenColorCustomizations");
  const legend = new vscode.SemanticTokensLegend(["namespace", "variable"], ["readonly"]);
  const requestedUris = new Set();
  const provider = vscode.languages.registerDocumentSemanticTokensProvider(
    { language: "python", scheme: "file", pattern: `${dir.replace(/\\/g, "/")}/*.py` },
    {
      provideDocumentSemanticTokens(document) {
        requestedUris.add(document.uri.toString());
        const tokens = new vscode.SemanticTokensBuilder(legend);
        tokens.push(new vscode.Range(0, 7, 0, 11), "namespace");
        tokens.push(new vscode.Range(1, 0, 1, "PROMPT_COLUMN".length), "variable", ["readonly"]);
        tokens.push(new vscode.Range(2, 0, 2, "MAX_IMAGE_AREA".length), "variable", ["readonly"]);
        tokens.push(new vscode.Range(6, 9, 6, 9 + "MAX_IMAGE_AREA".length), "variable", ["readonly"]);
        const interpolation = commonLines[5].indexOf("{MAX_IMAGE_AREA}") + 1;
        tokens.push(new vscode.Range(5, interpolation, 5, interpolation + "MAX_IMAGE_AREA".length), "variable", [
          "readonly",
        ]);
        return tokens.build();
      },
    },
    legend,
  );
  try {
    await workbench.update("colorTheme", "Dark+", vscode.ConfigurationTarget.Global);
    await editor.update("semanticHighlighting.enabled", true, vscode.ConfigurationTarget.Global);
    for (const format of ["line-by-line", "side-by-side"]) {
      await diffviewer.update("outputFormat", format, vscode.ConfigurationTarget.Global);
      for (const scenario of ["with-source", "standalone"]) {
        const stem = `${format}-${scenario}`;
        const sourcePath = path.join(dir, stem + ".py");
        const patchPath = path.join(dir, stem + ".diff");
        if (scenario === "with-source")
          fs.writeFileSync(sourcePath, [...commonLines, "result = MAX_IMAGE_AREA + 1", ""].join("\n"));
        fs.writeFileSync(
          patchPath,
          [
            `--- ${stem}.py\t(abcdef123)`,
            `+++ ${stem}.py\t(working tree)`,
            "@@ -1,7 +1,7 @@",
            ...commonLines.map((line) => ` ${line}`),
            "-result = MAX_IMAGE_AREA",
            "+result = MAX_IMAGE_AREA + 1",
            "",
          ].join("\n"),
        );
        await vscode.commands.executeCommand("vscode.openWith", vscode.Uri.file(patchPath), "diffViewer");
        let state;
        for (let i = 0; i < 80; i++) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          try {
            state = await vscode.commands.executeCommand("diffviewer._captureActiveTestState");
          } catch {}
          if (
            hasToken(state, "PROMPT_COLUMN", blue) &&
            hasToken(state, "MAX_IMAGE_AREA", blue) &&
            (scenario === "standalone" || hasToken(state, "math", teal))
          )
            break;
        }
        const context = `${scenario}/${format}`;
        const constants = state?.syntaxTokens.filter(
          (token) => token.text === "MAX_IMAGE_AREA" && token.color === blue,
        );
        assert.ok(
          constants?.length >= (format === "side-by-side" ? 6 : 4),
          `${context}: f-string interpolation and references must be blue`,
        );
        assert.ok(hasToken(state, "PROMPT_COLUMN", blue), `${context}: declared constants must be blue`);
        assert.ok(hasToken(state, "MAX_IMAGE_AREA", blue), `${context}: assigned constants must be blue`);
        assert.ok(
          hasToken(state, "__PROMPT_COLUMN__", gray, false),
          `${context}: an unresolved placeholder must remain gray`,
        );
        assert.ok(
          hasToken(state, "MAX_IMAGE_AREA", orange, false),
          `${context}: a constant name inside a string must remain orange`,
        );
        assert.ok(
          hasToken(state, "MAX_IMAGE_AREA must stay a comment", green, false),
          `${context}: a constant name inside a comment must remain green`,
        );
        if (scenario === "with-source") {
          assert.ok(
            requestedUris.has(vscode.Uri.file(sourcePath).toString()),
            `${context}: native provider was called`,
          );
          assert.ok(hasToken(state, "math", teal), `${context}: semantic namespace color must be applied`);
        }
        if (scenario === "with-source" && format === "line-by-line") {
          const waitForConstant = async (color) => {
            for (let i = 0; i < 80; i++) {
              await new Promise((resolve) => setTimeout(resolve, 100));
              const current = await vscode.commands.executeCommand("diffviewer._captureActiveTestState");
              if (
                current?.syntaxTokens.some((token) => token.text.startsWith("PROMPT_COLUMN") && token.color === color)
              )
                return;
            }
            assert.fail(`Expected updated constant color ${color}`);
          };
          await editor.update(
            "semanticTokenColorCustomizations",
            { "[*Dark*][Unused Theme]": { rules: { "variable.readonly:python": "#FF00FF" } } },
            vscode.ConfigurationTarget.Global,
          );
          await waitForConstant("rgb(255, 0, 255)");
          await editor.update("semanticHighlighting.enabled", false, vscode.ConfigurationTarget.Global);
          await waitForConstant(gray);
          await editor.update("semanticTokenColorCustomizations", custom, vscode.ConfigurationTarget.Global);
          await editor.update("semanticHighlighting.enabled", true, vscode.ConfigurationTarget.Global);
        }
        console.log("Semantic colors passed", context);
        await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      }
    }
  } finally {
    provider.dispose();
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await workbench.update("colorTheme", theme, vscode.ConfigurationTarget.Global);
    await editor.update("semanticTokenColorCustomizations", custom, vscode.ConfigurationTarget.Global);
    await editor.update("semanticHighlighting.enabled", semantic, vscode.ConfigurationTarget.Global);
    await diffviewer.update("outputFormat", layout, vscode.ConfigurationTarget.Global);
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

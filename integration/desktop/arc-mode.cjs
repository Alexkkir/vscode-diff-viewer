const vscode = require("vscode");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sourceName = "ml/project/demo.py";
const missingName = "ml/project/only-in-first-mount.py";

async function expectState(predicate, message) {
  let state;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      state = await vscode.commands.executeCommand("diffviewer._captureActiveTestState");
    } catch {}
    if (state?.isReady && predicate(state)) return state;
    await wait(100);
  }
  assert.fail(`${message}: ${JSON.stringify(state)}`);
}

async function expectEditor(filename, line) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const editor = vscode.window.activeTextEditor;
    if (
      editor?.document.uri.fsPath === filename &&
      (line === undefined || (editor.selection.active.line === line - 1 && editor.selection.anchor.line === line - 1))
    ) {
      return editor;
    }
    await wait(100);
  }
  assert.fail(
    `Expected ${filename}${line === undefined ? "" : ` at line ${line}`}; active editor is ${vscode.window.activeTextEditor?.document.uri.toString()}`,
  );
}

const patch = (name, value) =>
  `--- ${name} (0123456789abcdef0123456789abcdef01234567)\n+++ ${name} (working tree)\n@@ -1,3 +1,3 @@\n # Arc root resolution\n-value = "old"\n+value = "${value}"\n print(value)\n`;

exports.run = async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "diff-arc-mode-"));
  const config = vscode.workspace.getConfiguration("diffviewer");
  const originalArcMode = config.inspect("arcMode")?.globalValue;
  const originalOutputFormat = config.inspect("outputFormat")?.globalValue;
  const mounts = ["1arcadia", "5arcadia"];
  const fixtures = new Map();

  for (const mount of mounts) {
    const root = path.join(dir, mount);
    const sourcePath = path.join(root, sourceName);
    const patchPath = path.join(root, "ml/project/experiments/nested/run/diff.diff");
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.mkdirSync(path.dirname(patchPath), { recursive: true });
    fs.writeFileSync(sourcePath, `# Arc root resolution\nvalue = "${mount}"\nprint(value)\n`);
    fs.writeFileSync(patchPath, patch(sourceName, mount) + patch(missingName, "missing-in-this-mount"));
    fixtures.set(mount, { sourcePath, patchPath });
  }
  fs.writeFileSync(path.join(dir, "1arcadia", missingName), "# Exists only in the other Arc mount\n");

  const fifth = fixtures.get("5arcadia");
  const openDiff = async (filename) => {
    await vscode.commands.executeCommand("vscode.openWith", vscode.Uri.file(filename), "diffViewer");
    return expectState(
      (state) => state.filePaths.includes(sourceName) && state.clickableFilePaths?.includes(sourceName),
      `Expected a clickable Arc file in ${filename}`,
    );
  };

  try {
    assert.equal(
      vscode.workspace.getWorkspaceFolder(vscode.Uri.file(fifth.patchPath)),
      undefined,
      "Arc integration fixture must be outside the workspace",
    );
    assert.equal(config.inspect("arcMode")?.defaultValue, true, "Arc mode must be enabled by default");
    await config.update("arcMode", true, vscode.ConfigurationTarget.Global);

    for (const outputFormat of ["line-by-line", "side-by-side"]) {
      await config.update("outputFormat", outputFormat, vscode.ConfigurationTarget.Global);
      const state = await openDiff(fifth.patchPath);
      assert.ok(state.filePaths.includes(missingName), "Missing files still appear in the diff");
      assert.ok(
        !state.clickableFilePaths.includes(missingName),
        "A file absent from 5arcadia must not resolve to the sibling 1arcadia mount",
      );
      await assert.rejects(
        vscode.commands.executeCommand("diffviewer._runActiveTestAction", { kind: "clickFileName", path: missingName }),
        /No file name link/,
      );
      assert.notEqual(vscode.window.activeTextEditor?.document.uri.fsPath, path.join(dir, "1arcadia", missingName));

      await vscode.commands.executeCommand("diffviewer._runActiveTestAction", {
        kind: "clickFileName",
        path: sourceName,
      });
      const editor = await expectEditor(fifth.sourcePath);
      assert.ok(editor.document.getText().includes('value = "5arcadia"'), "The fifth mount must supply the source");

      await openDiff(fifth.patchPath);
      await vscode.commands.executeCommand("diffviewer._runActiveTestAction", {
        kind: "clickLineNumber",
        path: sourceName,
        line: 2,
      });
      const lineEditor = await expectEditor(fifth.sourcePath, 2);
      assert.equal(lineEditor.selection.active.character, 0);

      await openDiff(fifth.patchPath);
      const originalStat = fs.statSync(fifth.patchPath);
      await config.update("arcMode", false, vscode.ConfigurationTarget.Global);
      await expectState(
        (candidate) => candidate.filePaths.includes(sourceName) && candidate.clickableFilePaths?.length === 0,
        "Disabling Arc mode must remove links outside the workspace without changing the diff",
      );
      await config.update("arcMode", true, vscode.ConfigurationTarget.Global);
      await expectState(
        (candidate) =>
          candidate.clickableFilePaths?.includes(sourceName) && !candidate.clickableFilePaths.includes(missingName),
        "Re-enabling Arc mode must restore the correct links without changing the diff",
      );
      assert.equal(
        fs.statSync(fifth.patchPath).mtimeMs,
        originalStat.mtimeMs,
        "Config changes must not touch the diff file",
      );
      console.log(
        "Arc mode verified",
        outputFormat,
        "5arcadia, line selection, missing-file isolation, config refresh",
      );
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    }

    const first = fixtures.get("1arcadia");
    const firstState = await openDiff(first.patchPath);
    assert.ok(
      firstState.clickableFilePaths.includes(missingName),
      "The extra file should resolve inside its own mount",
    );
    await vscode.commands.executeCommand("diffviewer._runActiveTestAction", {
      kind: "clickFileName",
      path: sourceName,
    });
    const firstEditor = await expectEditor(first.sourcePath);
    assert.ok(
      firstEditor.document.getText().includes('value = "1arcadia"'),
      "Opening the first mount's diff must select its own source",
    );
    console.log("Arc mode verified mount switching from 5arcadia to 1arcadia");
  } finally {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await config.update("arcMode", originalArcMode, vscode.ConfigurationTarget.Global);
    await config.update("outputFormat", originalOutputFormat, vscode.ConfigurationTarget.Global);
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

// Launch VS Code with --remote-debugging-port=$DIFF_VIEWER_TEST_CDP_PORT (default 9333).
// Launch with --user-data-dir=$DIFF_VIEWER_TEST_USER_DATA_DIR as well: the local
// macOS CLI needs this explicitly to target the isolated instance, not a user window.
const vscode = require("vscode");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const quote = (value) => `'${value.replace(/'/g, "'\\''")}'`;

exports.run = async () => {
  if (process.platform === "win32") return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "diff-hide-terminal-"));
  const filename = path.join(dir, "sample.diff");
  const config = vscode.workspace.getConfiguration("diffviewer");
  const original = config.inspect("hideTerminalOnOpen")?.globalValue;
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.DIFF_VIEWER_TEST_CDP_PORT || 9333}`);
  const page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((candidate) => /workbench/.test(candidate.url()));
  assert.ok(page, "Could not attach to the isolated VS Code workbench");
  const states = [];
  const events = [];
  const subscriptions = [
    vscode.window.tabGroups.onDidChangeTabs((event) => {
      events.push({ kind: "tabs", changed: event.changed.map((tab) => ({ label: tab.label, active: tab.isActive })) });
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      events.push({ kind: "editor", uri: editor?.document.uri.toString() });
    }),
    vscode.window.onDidChangeActiveTerminal((terminal) => events.push({ kind: "terminal", name: terminal?.name })),
  ];
  let terminal;
  async function panelState(label) {
    const state = await page.evaluate(() => {
      const panel = document.getElementById("workbench.parts.panel");
      const rect = panel?.getBoundingClientRect();
      const visible = !!panel && panel.checkVisibility() && rect.width > 0 && rect.height > 0;
      return {
        visible,
        width: rect?.width,
        height: rect?.height,
        focus: document.activeElement?.className,
        workbenchClass: document.querySelector(".monaco-workbench")?.className,
      };
    });
    states.push({ label, ...state });
    return state;
  }
  async function runCli(label, rewriteFrom) {
    const marker = path.join(dir, `${label}.done`);
    const code = path.join(vscode.env.appRoot, "bin/code");
    assert.ok(process.env.DIFF_VIEWER_TEST_USER_DATA_DIR, "The isolated CLI user-data directory is required");
    const rewrite = rewriteFrom ? `cat ${quote(rewriteFrom)} > ${quote(filename)} && ` : "";
    terminal.sendText(
      `${rewrite}${quote(code)} --user-data-dir ${quote(process.env.DIFF_VIEWER_TEST_USER_DATA_DIR)} --reuse-window ${quote(filename)}; printf '%s' "$?" > ${quote(marker)}`,
    );
    for (let attempt = 0; attempt < 100 && !fs.existsSync(marker); attempt++) await wait(100);
    assert.ok(fs.existsSync(marker), "The integrated terminal code CLI did not finish");
    assert.equal(fs.readFileSync(marker, "utf8"), "0", "The integrated terminal code CLI failed");
    await wait(800);
    return panelState(label);
  }
  async function showMaximized() {
    terminal.show();
    await wait(300);
    const normal = await panelState("shown");
    await vscode.commands.executeCommand("workbench.action.toggleMaximizedPanel");
    await wait(300);
    const maximized = await panelState("maximized");
    assert.ok(maximized.visible && maximized.height > normal.height + 100, "Terminal must really start maximized");
    await wait(500);
    assert.equal(
      (await panelState("manually-maximized-stable")).height,
      maximized.height,
      "Manual terminal focus/maximize must remain possible with hideTerminalOnOpen enabled",
    );
    return maximized;
  }
  try {
    fs.writeFileSync(
      filename,
      "diff --git a/example.txt b/example.txt\n--- a/example.txt\n+++ b/example.txt\n@@ -1 +1 @@\n-old\n+new\n",
    );
    await config.update("hideTerminalOnOpen", true, vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await vscode.commands.executeCommand("vscode.openWith", vscode.Uri.file(filename), "diffViewer");
    await wait(1500);
    terminal = vscode.window.createTerminal({ name: "Diff Viewer hide-panel regression", shellPath: "/bin/sh" });
    await showMaximized();
    const reopened = await runCli("same-file-cli");
    assert.equal(reopened.visible, false, "Reopening the same diff through code must fully hide the panel");

    const maximized = await showMaximized();
    const changedPatch = fs.readFileSync(filename, "utf8").replace("+new", "+changed");
    fs.writeFileSync(filename, changedPatch);
    await wait(600);
    const background = await panelState("background-rewrite");
    assert.ok(
      background.visible && background.height === maximized.height,
      "Background file updates must not hide or resize the terminal",
    );

    const replacement = path.join(dir, "replacement.diff");
    fs.writeFileSync(replacement, changedPatch.replace("+changed", "+rewritten-from-shell"));
    const rewritten = await runCli("rewrite-and-cli", replacement);
    assert.equal(rewritten.visible, false, "Shell redirection followed by code must fully hide the panel");

    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await showMaximized();
    assert.equal((await runCli("first-open-cli")).visible, false, "The first CLI open must fully hide the panel");

    await config.update("hideTerminalOnOpen", false, vscode.ConfigurationTarget.Global);
    await showMaximized();
    const disabled = await runCli("disabled-cli");
    assert.equal(disabled.visible, true, "Disabling hideTerminalOnOpen must preserve VS Code's normal panel behavior");
  } finally {
    console.log("Hide terminal regression:", JSON.stringify({ vscode: vscode.version, states, events }));
    for (const subscription of subscriptions) subscription.dispose();
    terminal?.dispose();
    await config.update("hideTerminalOnOpen", original, vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

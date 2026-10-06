// Real installed VS Code + extension host + Electron webview, disposable launcher profile.
// Run: node scripts/test-large-diff-desktop.mjs after the production build.
// DIFF_LARGE_BASELINE=1 records old behavior without new invariant assertions.
// Reports contain counts/timings/build hashes only; no patch names, text, screenshots, or traces.
const vscode = require("vscode");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { chromium } = require("playwright");
require("../browser/load-typescript.cjs");
const { parseDiff } = require("../../src/shared/diff.ts");
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const baseline = process.env.DIFF_LARGE_BASELINE === "1";
const now = () => performance.now();
const rounded = (value) => +value.toFixed(1);

function synthetic(count) {
  return Array.from({ length: count / 100 }, (_, file) =>
    [
      `diff --git a/src/module_${file}.py b/src/module_${file}.py`,
      `--- a/src/module_${file}.py`,
      `+++ b/src/module_${file}.py`,
      "@@ -0,0 +1,100 @@",
      ...Array.from({ length: 100 }, (_, line) => `+value_${line} = compute(items[${line}], enabled=True)`),
      "",
    ].join("\n"),
  ).join("\n");
}
function input(environmentName, count, label, workspace) {
  const patch = process.env[environmentName] ? fs.readFileSync(process.env[environmentName], "utf8") : synthetic(count);
  const parsed = parseDiff(patch);
  const filename = path.join(workspace, `${label}.diff`);
  fs.writeFileSync(filename, patch);
  return {
    patch,
    filename,
    uri: vscode.Uri.file(filename),
    metadata: {
      input: process.env[environmentName] ? "private" : "synthetic",
      characters: patch.length,
      patchLines: patch.split("\n").length,
      files: parsed.length,
      sourceRows: parsed.reduce((sum, file) => sum + file.blocks.reduce((n, block) => n + block.lines.length, 0), 0),
    },
  };
}

exports.run = async () => {
  const workspace = vscode.workspace.workspaceFolders[0].uri.fsPath;
  assert.equal(workspace, process.env.DIFF_LARGE_WORKSPACE, "Use only the disposable launcher workspace");
  const output = process.env.DIFF_LARGE_OUTPUT;
  fs.mkdirSync(output, { recursive: true });
  const bundleRoot = process.env.DIFF_LARGE_EXTENSION_PATH;
  const report = {
    mode: baseline ? "baseline" : "final",
    vscode: vscode.version,
    configuration: {
      outputFormat: process.env.DIFF_BENCH_FORMAT || "line-by-line",
      drawFileList: true,
      globalScrollbar: true,
      matching: "none",
    },
    build: {
      version: JSON.parse(fs.readFileSync(path.join(bundleRoot, "package.json"), "utf8")).version,
      extensionSha256: createHash("sha256")
        .update(fs.readFileSync(path.join(bundleRoot, "dist/extension.js")))
        .digest("hex"),
      webviewSha256: createHash("sha256")
        .update(fs.readFileSync(path.join(bundleRoot, "dist/webview.js")))
        .digest("hex"),
    },
    results: [],
    failures: [],
  };
  const save = () =>
    fs.writeFileSync(path.join(output, "large-diff-desktop-results.json"), JSON.stringify(report, null, 2) + "\n");
  const check = (condition, label) => {
    if (!baseline && !condition) report.failures.push(label);
  };
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.DIFF_LARGE_CDP_PORT || 9365}`);
  const page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((page) => /workbench/.test(page.url()));
  assert.ok(page, "Isolated VS Code workbench must exist");
  page.setDefaultTimeout(60000);
  async function activeFrame() {
    const deadline = now() + 60000;
    while (now() < deadline) {
      for (const frame of page.frames()) {
        try {
          if (await frame.locator("#diff-container").isVisible()) return frame;
        } catch {}
      }
      await wait(15);
    }
    throw new Error("Diff Viewer frame not found");
  }
  async function settled(frame, count, expanded = false) {
    await frame.waitForFunction(
      ({ count, expanded }) => {
        const files = [...document.querySelectorAll(".d2h-file-wrapper")];
        return (
          files.length === count &&
          getComputedStyle(document.getElementById("loading-container")).display === "none" &&
          (!expanded ||
            files.every(
              (file) =>
                !file.querySelector(".d2h-file-collapse-input")?.checked &&
                !file.dataset.diffBodyPending &&
                file.getAttribute("aria-busy") !== "true",
            ))
        );
      },
      { count, expanded },
      { timeout: 60000 },
    );
    await frame.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    if (expanded) {
      await frame.waitForFunction(
        () => document.getElementById("horizontal-scrollbar-container")?.getAttribute("aria-busy") !== "true",
      );
      await frame.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    }
  }
  async function snapshot(frame) {
    return frame.evaluate(() => {
      const container = document.getElementById("diff-container");
      const wrappers = [...document.querySelectorAll(".d2h-file-wrapper")];
      return {
        files: wrappers.length,
        rows: container.querySelectorAll(".d2h-code-line-ctn").length,
        elements: document.querySelectorAll("*").length,
        expandedFiles: wrappers.filter((file) => !file.querySelector(".d2h-file-collapse-input")?.checked).length,
        pendingFiles: container.querySelectorAll("[data-diff-body-pending]").length,
        nativeTokens: container.querySelectorAll(".diff-textmate-token").length,
        loadingVisible: getComputedStyle(document.getElementById("loading-container")).display !== "none",
        previewVisible: container.checkVisibility() && wrappers.length > 0,
      };
    });
  }
  try {
    await vscode.workspace
      .getConfiguration("workbench")
      .update("colorTheme", "Dark+", vscode.ConfigurationTarget.Global);
    for (const [key, value] of Object.entries(report.configuration))
      await vscode.workspace.getConfiguration("diffviewer").update(key, value, vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await vscode.commands.executeCommand("workbench.action.closeSidebar");
    await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");
    await vscode.commands.executeCommand("notifications.clearAll");
    const collapsed = input("DIFF_BENCH_FIXTURE", 20000, "collapsed", workspace);
    let started = now();
    await vscode.commands.executeCommand("vscode.openWith", collapsed.uri, "diffViewer");
    let frame = await activeFrame();
    await settled(frame, collapsed.metadata.files);
    const initial = { milliseconds: rounded(now() - started), ...(await snapshot(frame)) };
    check(initial.rows === 0, "collapsed opening created code rows");
    check(initial.expandedFiles === 0, "large diff did not open collapsed");
    const result = { fixture: "collapsed-20k", ...collapsed.metadata, initial };
    report.results.push(result);
    save();
    started = now();
    await frame.evaluate(() => document.querySelector(".d2h-file-collapse-input").click());
    await frame.waitForFunction(() => {
      const file = document.querySelector(".d2h-file-wrapper");
      return (
        !file.querySelector(".d2h-file-collapse-input").checked &&
        !file.dataset.diffBodyPending &&
        file.getAttribute("aria-busy") !== "true"
      );
    });
    await frame.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    result.expandFirst = { milliseconds: rounded(now() - started), ...(await snapshot(frame)) };
    let nativeReady = true;
    try {
      await frame.waitForFunction(() => document.querySelector(".diff-textmate-token"), undefined, { timeout: 5000 });
    } catch {
      nativeReady = false;
    }
    result.nativeColor = { ready: nativeReady, milliseconds: rounded(now() - started) };
    // Re-focusing an unchanged document must not flash Loading or hide its current preview.
    await frame.evaluate(() => {
      window.diffFocusObservation = { hidden: false, loading: false };
      window.diffFocusObserver = new MutationObserver(() => {
        if (!document.getElementById("diff-container").checkVisibility()) window.diffFocusObservation.hidden = true;
        if (getComputedStyle(document.getElementById("loading-container")).display !== "none")
          window.diffFocusObservation.loading = true;
      });
      window.diffFocusObserver.observe(document.body, {
        subtree: true,
        attributes: true,
        attributeFilter: ["style", "class"],
      });
    });
    await vscode.commands.executeCommand("vscode.openWith", collapsed.uri, "diffViewer");
    await wait(200);
    result.unchangedFocus = await frame.evaluate(() => {
      window.diffFocusObserver.disconnect();
      return window.diffFocusObservation;
    });
    check(!result.unchangedFocus.hidden && !result.unchangedFocus.loading, "unchanged focus hid the rendered preview");
    // Match shell redirection, leaving the file empty while the producer starts.
    const replacement =
      "diff --git a/replacement.py b/replacement.py\n--- a/replacement.py\n+++ b/replacement.py\n@@ -1 +1 @@\n-value = 1\n+value = 2\n";
    started = now();
    const descriptor = fs.openSync(collapsed.filename, "w");
    try {
      await wait(80);
      result.duringTruncate = { milliseconds: rounded(now() - started), ...(await snapshot(frame)) };
      check(result.duringTruncate.loadingVisible, "truncate did not show Loading within 80 ms");
      check(!result.duringTruncate.previewVisible, "truncate left obsolete preview visible after 80 ms");
      fs.writeSync(descriptor, replacement);
    } finally {
      fs.closeSync(descriptor);
    }
    await settled(frame, 1);
    result.rewriteComplete = { milliseconds: rounded(now() - started), ...(await snapshot(frame)) };
    check(
      !result.rewriteComplete.loadingVisible && result.rewriteComplete.previewVisible,
      "completed rewrite did not restore preview",
    );
    save();
    console.log("LARGE_DESKTOP", JSON.stringify(result));
    if (process.env.DIFF_LARGE_ONLY_COLLAPSED !== "1") {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      const expanded = input("DIFF_BENCH_SCROLL_FIXTURE", 6000, "expanded", workspace);
      started = now();
      await vscode.commands.executeCommand("vscode.openWith", expanded.uri, "diffViewer");
      frame = await activeFrame();
      await settled(frame, expanded.metadata.files);
      const first = await snapshot(frame);
      if (first.expandedFiles !== expanded.metadata.files) {
        await vscode.commands.executeCommand("diffviewer.expandAll");
      }
      await settled(frame, expanded.metadata.files, true);
      const expandedResult = {
        fixture: "expanded-6k",
        ...expanded.metadata,
        initial: { milliseconds: rounded(now() - started), ...(await snapshot(frame)) },
      };
      await wait(300);
      expandedResult.verticalScroll = await frame.evaluate(async () => {
        const container = document.getElementById("diff-container");
        const scroll =
          container.scrollHeight > container.clientHeight && /(auto|scroll)/.test(getComputedStyle(container).overflowY)
            ? container
            : document.scrollingElement;
        const maximum = scroll.scrollHeight - scroll.clientHeight;
        const gaps = [];
        let previous = performance.now();
        const started = previous;
        for (let index = 0; index < 90; index++)
          await new Promise((resolve) =>
            requestAnimationFrame((time) => {
              gaps.push(time - previous);
              previous = time;
              scroll.scrollTop = Math.round((maximum * (index % 45)) / 44);
              resolve();
            }),
          );
        const sorted = gaps.slice(1).sort((a, b) => a - b);
        return {
          milliseconds: +(performance.now() - started).toFixed(1),
          scrollRange: maximum,
          frames: sorted.length,
          p95FrameGapMs: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1),
          maxFrameGapMs: +Math.max(...sorted).toFixed(1),
          over34ms: sorted.filter((gap) => gap > 34).length,
        };
      });
      report.results.push(expandedResult);
      save();
      console.log("LARGE_DESKTOP", JSON.stringify(expandedResult));
    }
    assert.deepEqual(report.failures, [], "Desktop invariants failed; see count-only report");
  } finally {
    save();
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await browser.close();
  }
};

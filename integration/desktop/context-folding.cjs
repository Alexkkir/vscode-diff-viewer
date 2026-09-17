const vscode = require("vscode");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const context = (prefix, count) =>
  Array.from({ length: count }, (_, index) => `${prefix}_${String(index + 1).padStart(3, "0")} = ${index + 1}`);
const leading = context("leading", 75);
const middle = context("middle", 135);
const trailing = context("trailing", 63);
const changes = ["old_first_value = 1", "new_first_value = 2", "old_second_value = 3", "new_second_value = 4"];
const allCode = [...leading, ...middle, ...trailing, ...changes];

function patch(sourceName) {
  const lines = [
    ...leading.map((line) => " " + line),
    "-" + changes[0],
    "+" + changes[1],
    ...middle.map((line) => " " + line),
    "-" + changes[2],
    "+" + changes[3],
    ...trailing.map((line) => " " + line),
  ];
  return `--- ${sourceName}\t(abcdef123456)\n+++ ${sourceName}\t(working tree)\n@@ -1,275 +1,275 @@\n${lines.join("\n")}\n`;
}

function logicalGaps(state) {
  const gaps = new Map();
  for (const gap of state.contextGaps ?? []) {
    const previous = gaps.get(gap.id);
    if (previous) {
      assert.equal(gap.hiddenLines, previous.hiddenLines, "Both panes must report the same hidden line count");
      previous.buttons.push(...gap.buttons);
    } else gaps.set(gap.id, { ...gap, buttons: [...gap.buttons] });
  }
  return [...gaps.values()];
}

function gapCounts(state) {
  return logicalGaps(state)
    .map((gap) => gap.hiddenLines)
    .sort((a, b) => a - b);
}

async function readState(predicate, label) {
  let state;
  for (let attempt = 0; attempt < 100; attempt++) {
    await wait(100);
    try {
      state = await vscode.commands.executeCommand("diffviewer._captureActiveTestState");
    } catch {}
    if (state?.isReady && predicate(state)) return state;
  }
  throw new Error(
    `${label}: timed out; ${JSON.stringify({
      format: state?.outputFormat,
      gaps: state?.contextGaps,
      hidden: state?.hiddenContextRows,
      loading: state?.loadingVisible,
      findCount: state?.findCount,
    })}`,
  );
}

function hasVisible(state, text) {
  return state.visibleCodeLineTexts.some((line) => line.includes(text));
}

function assertState(state, expectedCounts, format) {
  const copies = format === "side-by-side" ? 2 : 1;
  assert.deepEqual(
    gapCounts(state),
    [...expectedCounts].sort((a, b) => a - b),
  );
  assert.equal(state.contextGaps.length, expectedCounts.length * copies, "Each pane must have a matching gap bar");
  assert.equal(
    state.hiddenContextRows,
    expectedCounts.reduce((sum, count) => sum + count, 0) * copies,
    "Only excess unchanged context should be hidden",
  );
  assert.equal(state.loadingVisible, false, "Expanding context must not show Loading");
  for (const line of changes) assert.ok(hasVisible(state, line), `Changed line must remain visible: ${line}`);
  for (const gap of logicalGaps(state)) {
    assert.ok(gap.buttons.length > 0, "Each gap must expose an expansion button");
    for (const button of gap.buttons)
      assert.match(
        button,
        new RegExp(`Expand ${Math.min(20, gap.hiddenLines)} lines`),
        "Button must show the actual step",
      );
  }
}

exports.run = async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "diff-context-folding-"));
  const settings = vscode.workspace.getConfiguration("diffviewer");
  const previous = { outputFormat: settings.get("outputFormat"), drawFileList: settings.get("drawFileList") };
  const update = (key, value) =>
    vscode.workspace.getConfiguration("diffviewer").update(key, value, vscode.ConfigurationTarget.Global);
  try {
    await update("drawFileList", true);
    for (const format of ["line-by-line", "side-by-side"]) {
      await update("outputFormat", format);
      const openFixture = async (name) => {
        const filename = path.join(dir, name + ".diff");
        fs.writeFileSync(filename, patch(name + ".py"));
        await vscode.commands.executeCommand("vscode.openWith", vscode.Uri.file(filename), "diffViewer");
        return readState(
          (state) => state.outputFormat === format && gapCounts(state).join(",") === "13,25,35",
          `${name}: initial folded context`,
        );
      };

      let state = await openFixture(format + "-expand");
      assertState(state, [25, 35, 13], format);
      for (const line of allCode)
        assert.ok(
          state.codeLineTexts.some((text) => text.includes(line)),
          `Source line must already exist in DOM: ${line}`,
        );
      assert.equal(hasVisible(state, "leading_025"), false);
      assert.equal(hasVisible(state, "leading_026"), true);
      assert.equal(hasVisible(state, "middle_050"), true);
      assert.equal(hasVisible(state, "middle_051"), false);
      assert.equal(hasVisible(state, "middle_085"), false);
      assert.equal(hasVisible(state, "middle_086"), true);
      assert.equal(hasVisible(state, "trailing_050"), true);
      assert.equal(hasVisible(state, "trailing_051"), false);

      const filePath = state.filePaths[0];
      const gaps = logicalGaps(state);
      const leadId = gaps.find((gap) => gap.hiddenLines === 25).id;
      const middleId = gaps.find((gap) => gap.hiddenLines === 35).id;
      const tailId = gaps.find((gap) => gap.hiddenLines === 13).id;
      const expand = async (gapId, direction, expected) => {
        const shell = state.shellGeneration;
        await vscode.commands.executeCommand("diffviewer._runActiveTestAction", {
          kind: "expandContext",
          path: filePath,
          gapId,
          direction,
        });
        state = await readState(
          (result) => gapCounts(result).join(",") === [...expected].sort((a, b) => a - b).join(","),
          `${format}: expand ${direction}`,
        );
        assertState(state, expected, format);
        assert.equal(state.shellGeneration, shell, "Expansion must not rebuild the webview shell");
      };

      await expand(leadId, "end", [5, 35, 13]);
      assert.equal(hasVisible(state, "leading_005"), false);
      assert.equal(hasVisible(state, "leading_006"), true);
      if (format === "line-by-line") {
        await update("outputFormat", "side-by-side");
        state = await readState(
          (result) =>
            result.outputFormat === "side-by-side" &&
            result.contextGaps.length === 6 &&
            gapCounts(result).join(",") === "5,13,35",
          "Retain partial expansion when switching layout",
        );
        assertState(state, [5, 35, 13], "side-by-side");
        await update("outputFormat", format);
        state = await readState(
          (result) =>
            result.outputFormat === format &&
            result.contextGaps.length === 3 &&
            gapCounts(result).join(",") === "5,13,35",
          "Retain partial expansion when switching back",
        );
        await update("drawFileList", false);
        state = await readState(
          (result) => !result.fileListVisible && gapCounts(result).join(",") === "5,13,35",
          "Retain partial expansion on configuration rerender",
        );
        assertState(state, [5, 35, 13], format);
        await update("drawFileList", true);
        state = await readState(
          (result) => result.fileListVisible && gapCounts(result).join(",") === "5,13,35",
          "Restore file list",
        );
      }
      await expand(leadId, "end", [35, 13]);
      assert.equal(hasVisible(state, "leading_001"), true);
      await expand(middleId, "start", [15, 13]);
      assert.equal(hasVisible(state, "middle_070"), true);
      assert.equal(hasVisible(state, "middle_071"), false);
      await expand(middleId, "end", [13]);
      await expand(tailId, "start", []);
      for (const line of allCode) assert.ok(hasVisible(state, line), `Fully expanded source line missing: ${line}`);
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");

      state = await openFixture(format + "-search");
      assert.equal(hasVisible(state, "leading_001"), false);
      await vscode.commands.executeCommand("diffviewer.find");
      await vscode.commands.executeCommand("diffviewer._runActiveTestAction", { kind: "find", query: "leading_001" });
      state = await readState(
        (result) => result.findOpen && hasVisible(result, "leading_001"),
        `${format}: search must reveal folded matches`,
      );
      assertState(state, [35, 13], format);
      assert.equal(state.findCount, format === "side-by-side" ? "1 / 2" : "1 / 1");
      await vscode.commands.executeCommand("diffviewer._runActiveTestAction", { kind: "findKey", key: "Escape" });
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      console.log(
        "Context folding passed:",
        format,
        "50-line context; 20/5/15/13-line expansion; search; retained state",
      );
    }
  } finally {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await update("outputFormat", previous.outputFormat);
    await update("drawFileList", previous.drawFileList);
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

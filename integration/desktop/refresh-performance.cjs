const vscode = require("vscode");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const baseline = process.env.DIFF_VIEWER_PERF_BASELINE === "1";
const semanticDelayMs = 1000;
const semanticColor = "rgb(255, 0, 255)";
const lineCount = 1600;
const linesFor = (value) => [
  "import math",
  `result = math.sqrt(${value}) # refresh_marker_${value}`,
  ...Array.from({ length: lineCount - 2 }, (_, index) => `value_${index + 3} = math.sqrt(${index + 3})`),
];
const patchFor = (sourceName, value) => {
  const lines = linesFor(value);
  return [
    `--- ${sourceName}\t(abcdef123456)`,
    `+++ ${sourceName}\t(working tree)`,
    `@@ -1,${lineCount} +1,${lineCount} @@`,
    ` ${lines[0]}`,
    "-result = math.sqrt(0) # original",
    `+${lines[1]}`,
    ...lines.slice(2).map((line) => ` ${line}`),
    "",
  ].join("\n");
};

async function readState(predicate, label) {
  const deadline = Date.now() + 12000;
  let state;
  while (Date.now() < deadline) {
    try {
      state = await vscode.commands.executeCommand("diffviewer._captureActiveTestState");
    } catch {}
    if (state?.isReady && predicate(state)) return state;
    await wait(20);
  }
  throw new Error(
    `${label}: timed out ${JSON.stringify({
      ready: state?.isReady,
      format: state?.outputFormat,
      tokens: state?.syntaxTokens?.slice(0, 12),
      lines: state?.visibleCodeLineTexts?.slice(0, 3),
      loading: state?.loadingVisible,
    })}`,
  );
}

function hasMarker(state, value) {
  return state.visibleCodeLineTexts?.some((line) => line.includes(`refresh_marker_${value}`));
}
function hasSemanticColor(state) {
  return state.syntaxTokens?.some((token) => token.text === "math" && token.color === semanticColor);
}
function gapCounts(state) {
  return state.contextGaps.map((gap) => gap.hiddenLines);
}

exports.run = async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "diff-refresh-performance-"));
  const workbench = vscode.workspace.getConfiguration("workbench");
  const editor = vscode.workspace.getConfiguration("editor");
  const viewer = vscode.workspace.getConfiguration("diffviewer");
  const previous = {
    theme: workbench.get("colorTheme"),
    semantic: editor.get("semanticHighlighting.enabled"),
    custom: editor.get("semanticTokenColorCustomizations"),
    layout: viewer.get("outputFormat"),
  };
  const requests = [];
  const measurements = [];
  const legend = new vscode.SemanticTokensLegend(["namespace"], []);
  const provider = vscode.languages.registerDocumentSemanticTokensProvider(
    { language: "python", scheme: "file", pattern: `${dir.replace(/\\/g, "/")}/*.py` },
    {
      async provideDocumentSemanticTokens(document) {
        const request = {
          uri: document.uri.toString(),
          version: document.version,
          marker: document.lineAt(1).text,
          startedAt: Date.now(),
          completedAt: undefined,
        };
        requests.push(request);
        await wait(semanticDelayMs);
        const tokens = new vscode.SemanticTokensBuilder(legend);
        tokens.push(new vscode.Range(0, 7, 0, 11), "namespace");
        request.completedAt = Date.now();
        return tokens.build();
      },
    },
    legend,
  );
  try {
    await workbench.update("colorTheme", "Dark+", vscode.ConfigurationTarget.Global);
    await editor.update("semanticHighlighting.enabled", true, vscode.ConfigurationTarget.Global);
    await editor.update(
      "semanticTokenColorCustomizations",
      { rules: { "namespace:python": "#ff00ff" } },
      vscode.ConfigurationTarget.Global,
    );
    for (const format of ["line-by-line", "side-by-side"]) {
      await viewer.update("outputFormat", format, vscode.ConfigurationTarget.Global);
      const sourceName = `${format}.py`;
      const sourcePath = path.join(dir, sourceName);
      const sourceUri = vscode.Uri.file(sourcePath);
      const diffPath = path.join(dir, `${format}.diff`);
      for (const value of [1, 2]) {
        const operation = value === 1 ? "open" : "rewrite";
        const sourceText = linesFor(value).join("\n") + "\n";
        if (value === 1) fs.writeFileSync(sourcePath, sourceText);
        else {
          // Keep the source document and disk snapshot identical before timing the
          // diff rewrite, so stale semantic offsets cannot pass as a speed win.
          const source = await vscode.workspace.openTextDocument(sourceUri);
          const edit = new vscode.WorkspaceEdit();
          edit.replace(
            sourceUri,
            new vscode.Range(source.positionAt(0), source.positionAt(source.getText().length)),
            sourceText,
          );
          assert.ok(await vscode.workspace.applyEdit(edit));
          assert.ok(await source.save());
        }
        const startedAt = Date.now();
        fs.writeFileSync(diffPath, patchFor(sourceName, value));
        if (value === 1)
          await vscode.commands.executeCommand("vscode.openWith", vscode.Uri.file(diffPath), "diffViewer");
        let state = await readState(
          (current) => current.outputFormat === format && !current.loadingVisible && hasMarker(current, value),
          `${format}/${operation}: new content`,
        );
        const contentAt = Date.now();
        const requestForOperation = () =>
          requests.find(
            (request) => request.uri === sourceUri.toString() && request.marker.includes(`refresh_marker_${value}`),
          );
        if (!baseline) {
          const request = requestForOperation();
          assert.ok(
            !request?.completedAt || contentAt < request.completedAt,
            `${format}/${operation}: visible content must not wait for the slow semantic provider`,
          );
          assert.equal(
            hasSemanticColor(state),
            false,
            `${format}/${operation}: first paint should precede semantic enrichment`,
          );
        }
        assert.equal(state.fileCount, 1);
        assert.ok(state.textMateTokenCount > 0, "First paint must already have TextMate syntax colors");
        const initialShell = state.shellGeneration;
        const initialRenderGeneration = state.renderGeneration;
        if (!baseline) assert.equal(typeof initialRenderGeneration, "number", "Render generation must be observable");
        const initialText = state.codeLineTexts;
        const gap = state.contextGaps.find((candidate) => candidate.hiddenLines > 20);
        assert.ok(gap, "1600-line fixture should have collapsed context");
        await vscode.commands.executeCommand("diffviewer._runActiveTestAction", {
          kind: "expandContext",
          path: state.filePaths[0],
          gapId: gap.id,
          direction: "start",
        });
        state = await readState(
          (current) => gapCounts(current).some((count) => count === gap.hiddenLines - 20),
          `${format}/${operation}: expanded reader state`,
        );
        const expandedCounts = gapCounts(state);
        const enriched = await readState(hasSemanticColor, `${format}/${operation}: semantic enrichment`);
        const enrichedAt = Date.now();
        assert.ok(requestForOperation()?.completedAt, "The native semantic provider must have completed");
        assert.equal(enriched.shellGeneration, initialShell, "Colors must update in the same webview shell");
        if (initialRenderGeneration !== undefined)
          assert.equal(enriched.renderGeneration, initialRenderGeneration, "Enrichment must not redraw diff content");
        assert.deepEqual(enriched.codeLineTexts, initialText, "Enrichment must preserve the rendered text");
        assert.deepEqual(gapCounts(enriched), expandedCounts, "Enrichment must preserve context expansion");
        assert.equal(enriched.loadingVisible, false, "Enrichment must not show Loading");
        measurements.push({
          format,
          operation,
          lines: lineCount,
          semanticDelayMs,
          contentMs: contentAt - startedAt,
          enrichedMs: enrichedAt - startedAt,
          contentBeforeSemanticResult: contentAt < requestForOperation().completedAt,
        });
      }
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    }
    const report = { mode: baseline ? "baseline" : "progressive", measurements };
    console.log("REFRESH_PERFORMANCE", JSON.stringify(report));
    if (process.env.DIFF_VIEWER_PERF_REPORT)
      fs.writeFileSync(process.env.DIFF_VIEWER_PERF_REPORT, JSON.stringify(report, null, 2) + "\n");
  } finally {
    provider.dispose();
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await workbench.update("colorTheme", previous.theme, vscode.ConfigurationTarget.Global);
    await editor.update("semanticTokenColorCustomizations", previous.custom, vscode.ConfigurationTarget.Global);
    await editor.update("semanticHighlighting.enabled", previous.semantic, vscode.ConfigurationTarget.Global);
    await viewer.update("outputFormat", previous.layout, vscode.ConfigurationTarget.Global);
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

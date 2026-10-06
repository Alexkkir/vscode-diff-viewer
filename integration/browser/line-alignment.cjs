// Run after build:prod: node integration/browser/line-alignment.cjs [artifact-directory]
// Serves the real webview bundle/skeleton on loopback with the VS Code API mocked.
// Optional private regression fixture: DIFF_VIEWER_EXTERNAL_FIXTURE=/path/to/diff
// DIFF_VIEWER_EXTERNAL_FILE_INDEX=0 DIFF_VIEWER_EXTERNAL_EXPECT_PAIRS='[[10,12]]'
// DIFF_VIEWER_EXTERNAL_DELETED_RANGES='[[20,30]]' DIFF_VIEWER_EXTERNAL_VIEW_OLD_LINE=10
// Private screenshots and numeric reports always go to a new OS temporary directory.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");
require("./load-typescript.cjs");
const { parseDiff } = require("../../src/shared/diff.ts");
const { realignDiffHunks } = require("../../src/shared/hunk-alignment.ts");

const root = path.resolve(__dirname, "../..");
const externalFixturePath = process.env.DIFF_VIEWER_EXTERNAL_FIXTURE;
const artifactDirectory = externalFixturePath
  ? fs.mkdtempSync(path.join(os.tmpdir(), "diff-viewer-private-alignment-"))
  : path.resolve(process.argv[2] || "/tmp/diff-viewer-line-alignment");
fs.mkdirSync(artifactDirectory, { recursive: true });
const privateDebug = { phase: "initializing", pageErrors: [] };
const colors = `:root {
  --vscode-editor-background: #1e1e1e; --vscode-editor-foreground: #d4d4d4;
  --vscode-foreground: #cccccc; --vscode-descriptionForeground: #a0a0a0;
  --vscode-editorGroupHeader-tabsBackground: #252526;
  --vscode-diffEditor-unchangedRegionBackground: #29292e;
  --vscode-diffEditor-unchangedRegionForeground: #cccccc;
  --vscode-diffEditor-unchangedRegionShadow: #38383d;
  --vscode-diffEditor-insertedLineBackground: #9bb95533;
  --vscode-diffEditor-removedLineBackground: #ff000033;
  --vscode-diffEditor-insertedTextBackground: #9ccc2c33;
  --vscode-diffEditor-removedTextBackground: #ff000055;
  --vscode-editorLineNumber-foreground: #858585; --vscode-panel-border: #454545;
  --vscode-font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  --vscode-editor-font-family: Menlo, monospace; --vscode-editor-font-size: 14px;
  --vscode-editor-font-weight: 400; --vscode-font-size: 13px;
  --vscode-textLink-foreground: #3794ff; --vscode-focusBorder: #007fd4;
  --vscode-toolbar-hoverBackground: #5a5d5e50;
  --vscode-button-background: #0e639c; --vscode-button-foreground: #fff;
  --vscode-input-background: #3c3c3c; --vscode-input-foreground: #ccc;
  --vscode-editorWidget-background: #252526; --vscode-editorWidget-foreground: #ccc;
}`;
const styleNames = ["reset.css", "diff2html@3.4.45.min.css", "diff2html-tweaks.css", "app.css"];
const html = fs
  .readFileSync(path.join(root, "src/extension/skeleton.html"), "utf8")
  .replace(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/, "")
  .replace(
    "{{COMMON_CSS_LINKS}}",
    styleNames.map((name) => `<link rel="stylesheet" href="/styles/${name}">`).join("") + `<style>${colors}</style>`,
  )
  .replace("{{LIGHT_HIGHLIGHT_CSS_URI}}", "/styles/highlight.js@11.9.0-github.min.css")
  .replace("{{DARK_HIGHLIGHT_CSS_URI}}", "/styles/highlight.js@11.9.0-github-dark.min.css")
  .replace(
    /<body\s+data-shell-generation="{{SHELL_GENERATION}}"/,
    '<body class="vscode-dark" data-shell-generation="1"',
  )
  .replace(
    '<script nonce="{{NONCE}}" src="{{WEBVIEW_URI}}"></script>',
    `<script>
    window.extensionMessages = [];
    let uiState;
    window.acquireVsCodeApi = () => ({
      postMessage: message => window.extensionMessages.push(message),
      getState: () => uiState,
      setState: value => { uiState = value; }
    });
    </script><script src="/dist/webview.js"></script>`,
  );

const constructor = (name, size) => [
  "    def __init__(self):",
  "        super().__init__(",
  `            model="${name}",`,
  `            system="${name}",`,
  `            mode="${name}",`,
  `            size=${size},`,
  "        )",
];
const old = [
  "# setup",
  '@FACTORY.register("image_heavy")',
  "class HeavyModel(Model):",
  '    """Heavy service from',
  '    quality/image/service/light."""',
  ...constructor("heavy", "6"),
  "",
  "# maximum image size matches",
  "# https://example.invalid/source/generator.py?rev=123456789",
  '@FACTORY.register("image_light")',
  "class LightModel(Model):",
  '    """Emulates the image-light service from',
  '    quality/image/service/light."""',
  ...constructor("light", "6"),
  "",
  '@FACTORY.register("image_1mp")',
  "class SmallModel(Model):",
  ...constructor("small", "1"),
  "",
  "class TestOne(Model):",
  ...constructor("test_one", "1"),
  "",
  "class TestTwo(Model):",
  ...constructor("test_two", "1"),
];
const next = [
  "# setup",
  '@FACTORY.register("image_light_6mp")',
  "class Config_Light_6mp(Model):",
  '    """Legacy version for the image-light service from',
  "    quality/image/service/light.",
  "    https://example.invalid/source/generator.py?rev=123456789",
  '    """',
  ...constructor("light", "6.1"),
  "",
  '@FACTORY.register("image_1mp")',
  "class SmallModel(Model):",
  '    """Legacy small model."""',
  ...constructor("small", "1"),
];
const patch = [
  "--- sample.py",
  "+++ sample.py",
  `@@ -1,${old.length} +1,${next.length} @@`,
  ...old.map((line) => `-${line}`),
  ...next.map((line) => `+${line}`),
].join("\n");

const oldOptions = [
  "groups = [",
  "    OptionGroupLeaf(",
  '        name="Inputs and Outputs",',
  '        option_names=["source", "output"],',
  "    ),",
  "    OptionGroupLeaf(",
  '        name="Params",',
  '        option_names=["model", "revision"],',
  "    ),",
  "]",
];
const nextOptions = [
  "groups = [",
  "    OptionGroupLeaf(",
  '        name="Входы и выходы",',
  '        code="inputs_and_outputs",',
  '        option_names=["source", "output"],',
  "    ),",
  "    OptionGroupLeaf(",
  '        name="Основное",',
  '        code="main",',
  '        option_names=["model", "revision"],',
  "    ),",
  "]",
];
function optionFixture(reverse) {
  const before = reverse ? nextOptions : oldOptions;
  const after = reverse ? oldOptions : nextOptions;
  return {
    name: `translated-option-groups${reverse ? "-reverse" : ""}`,
    patch: [
      "--- settings.py",
      "+++ settings.py",
      `@@ -1,${before.length} +1,${after.length} @@`,
      ...before.map((line) => `-${line}`),
      ...after.map((line) => `+${line}`),
      "",
    ].join("\n"),
    pairs: reverse
      ? [
          [3, 3],
          [8, 7],
        ]
      : [
          [3, 3],
          [7, 8],
        ],
    matchingModes: ["lines", "words", "none"],
    verifyUnifiedPairs: true,
    added: reverse ? [] : [4, 9],
    removed: reverse ? [4, 9] : [],
  };
}

const cases = [
  optionFixture(false),
  optionFixture(true),
  {
    name: "full-class-sequence",
    patch,
    pairs: [
      ['@FACTORY.register("image_light")', '@FACTORY.register("image_light_6mp")'],
      ["class LightModel(Model):", "class Config_Light_6mp(Model):"],
      ['            model="light",', '            model="light",'],
      ["class SmallModel(Model):", "class SmallModel(Model):"],
    ].map(([before, after]) => {
      assert(old.includes(before) && next.includes(after));
      return [old.indexOf(before) + 1, next.indexOf(after) + 1];
    }),
  },
  {
    name: "moved-url",
    patch: [
      "--- example.py (0123456789abcdef0123456789abcdef01234567)",
      "+++ example.py (working tree)",
      "@@ -1,8 +1,8 @@",
      " before",
      "-# maximum image size matches",
      "-# https://example.invalid/source/service/manager/editing/generator.py?rev=123456789",
      '-@FACTORY.register("image_light")',
      "-class LightModel(Model):",
      '-    """Emulates the image-light service from',
      '-    quality/image/service/light."""',
      '+@FACTORY.register("image_light_6mp")',
      "+class Config_Light_6mp(Model):",
      '+    """Legacy version for the image-light service from',
      "+    quality/image/service/light.",
      "+    https://example.invalid/source/service/manager/editing/generator.py?rev=123456789",
      '+    """',
      " after",
      "",
    ].join("\n"),
    pairs: [
      [4, 2],
      [5, 3],
      [6, 4],
      [7, 5],
    ],
  },
  {
    name: "repeated-constructors",
    patch: [
      "--- worker.py (0123456789abcdef0123456789abcdef01234567)",
      "+++ worker.py (working tree)",
      "@@ -1,12 +1,5 @@",
      " @task",
      " class Worker:",
      "-    def __init__(self, value):",
      "-        self.value = value",
      "-",
      "-class TestOne:",
      '+    """Stores a value."""',
      "     def __init__(self, value):",
      "         self.value = value",
      "-",
      "-class TestTwo:",
      "-    def __init__(self, value):",
      "-        self.value = value",
      "",
    ].join("\n"),
    pairs: [
      [1, 1],
      [2, 2],
      [3, 4],
      [4, 5],
    ],
  },
  {
    name: "changed-guard-and-return",
    patch: [
      "--- selection.py",
      "+++ selection.py",
      "@@ -51,11 +51,11 @@",
      " def pick_optional(value):",
      '     """Select a value for the next operation."""',
      "     value = normalize(value)",
      " ",
      "     # Keep the guard next to its early return.",
      "     record_request(value)",
      " ",
      "-    if not exists(value):",
      "-        return value",
      "+    if value is None:",
      "+        return None",
      " ",
      "     return transform(value)",
      "",
    ].join("\n"),
    pairs: [
      [58, 58],
      [59, 59],
    ],
    verifyUnifiedPairs: true,
  },
];
function externalFixture() {
  try {
    const pairList = (value) => {
      const pairs = JSON.parse(value || "[]");
      assert(
        Array.isArray(pairs) &&
          pairs.every((pair) => Array.isArray(pair) && pair.length === 2 && pair.every(Number.isInteger)),
      );
      return pairs;
    };
    const fileIndex = Number(process.env.DIFF_VIEWER_EXTERNAL_FILE_INDEX || 0);
    assert(Number.isInteger(fileIndex) && fileIndex >= 0);
    return {
      name: "external",
      private: true,
      fileIndex,
      patch: fs.readFileSync(externalFixturePath, "utf8"),
      pairs: pairList(process.env.DIFF_VIEWER_EXTERNAL_EXPECT_PAIRS),
      deletedRanges: pairList(process.env.DIFF_VIEWER_EXTERNAL_DELETED_RANGES),
      viewOldLine: Number(process.env.DIFF_VIEWER_EXTERNAL_VIEW_OLD_LINE || 0),
    };
  } catch {
    throw new Error("Unable to read external fixture or parse its numeric check configuration");
  }
}
function projection(files, side) {
  return files.flatMap((file) =>
    file.blocks.flatMap((block) =>
      block.lines
        .filter((line) => line[`${side}Number`] !== undefined)
        .map((line) => ({ number: line[`${side}Number`], text: line.content.slice(1) })),
    ),
  );
}
const payload = (outputFormat, files, matching = "lines") => ({
  config: {
    globalScrollbar: true,
    diff2html: { outputFormat, drawFileList: false, matching, colorScheme: "dark" },
  },
  diffFiles: files,
  accessiblePaths: [],
  viewedState: {},
  collapseAll: false,
  performance: { isLargeDiff: false, deferViewedStateHashing: false },
});
const server = http.createServer((request, response) => {
  if (request.url === "/") {
    response.setHeader("content-type", "text/html");
    response.end(html);
  } else if (/^\/(?:styles\/[a-z0-9@.\-]+\.css|dist\/webview\.js)$/.test(request.url)) {
    response.setHeader("content-type", request.url.endsWith(".css") ? "text/css" : "application/javascript");
    response.end(fs.readFileSync(path.join(root, request.url)));
  } else {
    response.statusCode = 404;
    response.end();
  }
});

(async () => {
  privateDebug.phase = "starting local server";
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  privateDebug.phase = "launching Chromium";
  const browser = await chromium.launch({ headless: true });
  const results = [];
  let activePage;
  try {
    for (const fixture of externalFixturePath ? [externalFixture()] : cases) {
      const allParsed = parseDiff(fixture.patch);
      const parsed = fixture.private ? allParsed.slice(fixture.fileIndex, fixture.fileIndex + 1) : allParsed;
      assert(parsed.length, "Requested fixture file index must exist");
      const originalProjections = { old: projection(parsed, "old"), new: projection(parsed, "new") };
      const files = realignDiffHunks(parsed);
      for (const side of ["old", "new"]) {
        if (fixture.private) continue;
        assert.deepEqual(
          projection(files, side),
          originalProjections[side],
          `${fixture.name}: model source projection ${side}`,
        );
      }
      for (const { format, matching } of ["side-by-side", "line-by-line"].flatMap((format) =>
        (fixture.matchingModes ?? ["lines"]).map((matching) => ({ format, matching })),
      )) {
        privateDebug.phase = `${format}: opening page`;
        const page = await browser.newPage({ viewport: { width: 1680, height: 900 }, deviceScaleFactor: 1 });
        activePage = page;
        const errors = [];
        page.on("pageerror", (error) => {
          errors.push(error.message);
          if (fixture.private) privateDebug.pageErrors.push({ format, message: error.message, stack: error.stack });
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        privateDebug.phase = `${format}: sending diff`;
        await page.evaluate(
          (value) => window.postMessage({ kind: "updateWebview", payload: value }, location.origin),
          payload(format, files, matching),
        );
        privateDebug.phase = `${format}: waiting for source rows`;
        // Large fixtures fold their first source row. Wait for its presence,
        // not its visibility, then wait separately for rendering to finish.
        await page.waitForSelector(".d2h-code-line-ctn", { state: "attached" });
        privateDebug.phase = `${format}: waiting for render completion`;
        await page.waitForFunction(
          () => getComputedStyle(document.getElementById("loading-container")).display === "none",
        );
        privateDebug.phase = `${format}: collecting geometry`;
        const snapshot = await page.evaluate(() => {
          const panes = Array.from(document.querySelectorAll(".d2h-file-side-diff"));
          const rows = (panes.length ? panes : [document.querySelector(".d2h-file-wrapper")]).map((pane, side) =>
            Array.from(pane.querySelectorAll("tbody > tr"), (row, index) => {
              const line = row.querySelector(".d2h-code-line-ctn");
              const sideNumber = Number(row.querySelector(".d2h-code-side-linenumber")?.textContent?.trim()) || 0;
              return {
                index,
                top: row.getBoundingClientRect().top,
                height: row.getBoundingClientRect().height,
                old: panes.length
                  ? side === 0
                    ? sideNumber
                    : 0
                  : Number(row.querySelector(".line-num1")?.textContent?.trim()) || 0,
                new: panes.length
                  ? side === 1
                    ? sideNumber
                    : 0
                  : Number(row.querySelector(".line-num2")?.textContent?.trim()) || 0,
                text: line?.textContent || "",
                kind: row.cells[row.cells.length - 1].className,
              };
            }),
          );
          return { rows, header: document.querySelector(".d2h-file-name").textContent };
        });
        if (fixture.private) {
          // Compare real source strings only in memory. Reports intentionally
          // contain no source text, source paths, or raw browser error strings.
          const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
          const oldRow = (number) => snapshot.rows[0].find((row) => row.old === number);
          const rightAt = (row) => {
            if (!row) return undefined;
            if (format === "side-by-side") return snapshot.rows[1][row.index];
            if (row.new) return row;
            // Unified context uses one row, but a matched replacement uses
            // adjacent deletion/insertion rows carrying inline change markup.
            const next = snapshot.rows[0][row.index + 1];
            return row.kind.includes("d2h-change") && next?.kind.includes("d2h-change") && next.new && !next.old
              ? next
              : row;
          };
          const modelProjectionPreserved = {};
          const renderedProjectionPreserved = {};
          for (const side of ["old", "new"]) {
            modelProjectionPreserved[side] = equal(projection(files, side), originalProjections[side]);
            renderedProjectionPreserved[side] = equal(
              snapshot.rows
                .flat()
                .filter((row) => row[side])
                .map((row) => ({ number: row[side], text: row.text })),
              originalProjections[side],
            );
          }
          const pairResults = fixture.pairs.map(([oldNumber, newNumber]) => {
            const left = oldRow(oldNumber);
            const right = rightAt(left);
            return {
              old: oldNumber,
              expectedNew: newNumber,
              actualNew: right?.new || 0,
              aligned: right?.new === newNumber,
              oldKind: left?.kind || "missing",
              newKind: right?.kind || "missing",
            };
          });
          const deletedRanges = fixture.deletedRanges.map(([start, end]) => {
            const rows = snapshot.rows[0].filter((row) => row.old >= start && row.old <= end);
            // Blank separators may retain valid context after source-preserving
            // whitespace restoration. Every nonblank line of removed classes
            // must still be deleted and unpaired; count every source row below.
            const codeRows = rows.filter((row) => row.text.trim().length > 0);
            const ignoredBlankLines = rows.filter((row) => !row.text.trim().length).map((row) => row.old);
            const nonDeletions = codeRows.filter((row) => !row.kind.includes("d2h-del")).map((row) => row.old);
            const pairedLines = codeRows
              .filter((row) => rightAt(row)?.new)
              .map((row) => ({ old: row.old, new: rightAt(row).new }));
            return {
              start,
              end,
              sourceLines: rows.length,
              ignoredBlankLines,
              nonDeletions,
              pairedLines,
              valid: rows.length === end - start + 1 && !nonDeletions.length && !pairedLines.length,
            };
          });
          const geometryAligned =
            format !== "side-by-side" ||
            equal(
              snapshot.rows[0].map((row) => [row.top, row.height]),
              snapshot.rows[1].map((row) => [row.top, row.height]),
            );
          const summary = {
            fixture: "external",
            fileIndex: fixture.fileIndex,
            format,
            sourceLines: { old: originalProjections.old.length, new: originalProjections.new.length },
            modelProjectionPreserved,
            renderedProjectionPreserved,
            pairResults,
            deletedRanges,
            geometryAligned,
            renderErrorCount: errors.length,
            rows: snapshot.rows.map((rows) => rows.map(({ text: _text, ...metrics }) => metrics)),
          };
          summary.valid =
            Object.values(modelProjectionPreserved).every(Boolean) &&
            Object.values(renderedProjectionPreserved).every(Boolean) &&
            pairResults.every((pair) => pair.aligned) &&
            deletedRanges.every((range) => range.valid) &&
            geometryAligned &&
            !errors.length;
          if (fixture.viewOldLine) {
            await page.evaluate((number) => {
              const pane = document.querySelector(".d2h-file-side-diff") || document.querySelector(".d2h-file-wrapper");
              const row = Array.from(pane.querySelectorAll("tr")).find(
                (row) =>
                  Number(row.querySelector(".d2h-code-side-linenumber, .line-num1")?.textContent?.trim()) === number,
              );
              row?.scrollIntoView({ block: "start" });
            }, fixture.viewOldLine);
          }
          privateDebug.phase = `${format}: saving private screenshot`;
          await page.screenshot({ path: path.join(artifactDirectory, `external-${format}.png`) });
          results.push(summary);
          await page.close();
          continue;
        }
        for (const side of ["old", "new"]) {
          const actual = snapshot.rows
            .flat()
            .filter((row) => row[side])
            .map((row) => ({ number: row[side], text: row.text }));
          assert.deepEqual(
            actual,
            projection(files, side),
            `${fixture.name}: rendered source projection ${side} in ${format}`,
          );
        }
        assert(
          !snapshot.header.includes("working tree") && !snapshot.header.includes("→"),
          "Revision labels must not create renamed headers",
        );
        const oldRow = (number) => snapshot.rows[0].find((row) => row.old === number);
        const newRow = (number) => snapshot.rows[format === "side-by-side" ? 1 : 0].find((row) => row.new === number);
        // Save failed-regression evidence too, before checking line pairing.
        await page.screenshot({
          fullPage: true,
          path: path.join(artifactDirectory, `line-alignment-${fixture.name}-${format}-${matching}.png`),
        });
        if (format === "side-by-side") {
          assert.deepEqual(
            snapshot.rows[0].map((row) => [row.top, row.height]),
            snapshot.rows[1].map((row) => [row.top, row.height]),
            "Paired table geometry",
          );
          for (const [oldNumber, newNumber] of fixture.pairs) {
            assert.equal(
              oldRow(oldNumber).index,
              newRow(newNumber).index,
              `${fixture.name}: old ${oldNumber} and new ${newNumber} must align`,
            );
          }
          for (const n of fixture.added ?? [])
            assert.equal(snapshot.rows[0][newRow(n).index].old, 0, "Added argument must face an empty cell");
          for (const n of fixture.removed ?? [])
            assert.equal(snapshot.rows[1][oldRow(n).index].new, 0, "Removed argument must face an empty cell");
          if (fixture.name === "moved-url") {
            assert.equal(snapshot.rows[1][oldRow(3).index].new, 0, "Removed URL comment must not displace decorators");
            assert.equal(snapshot.rows[0][newRow(6).index].old, 0, "Moved docstring URL belongs to its own added row");
          }
        } else if (fixture.verifyUnifiedPairs && matching !== "none") {
          for (const [oldNumber, newNumber] of fixture.pairs) {
            const left = oldRow(oldNumber);
            const right = newRow(newNumber);
            assert.equal(right.index, left.index + 1, `${fixture.name}: unified replacement rows must be adjacent`);
            assert(
              left.kind.includes("d2h-change") && right.kind.includes("d2h-change"),
              "Unified replacements need inline matching",
            );
          }
        }
        if (fixture.name === "repeated-constructors") {
          for (const number of [3, 4])
            assert(oldRow(number).kind.includes("d2h-cntx"), "The original surviving constructor must be context");
          for (const number of [6, 7, 8, 10, 11, 12]) {
            const row = oldRow(number);
            assert(row.kind.includes("d2h-del"), `Deleted test class line ${number} must remain a deletion`);
            if (format === "side-by-side")
              assert.equal(
                snapshot.rows[1][row.index].new,
                0,
                "Deleted class cannot become surviving constructor context",
              );
          }
          assert(newRow(3).kind.includes("d2h-ins"), "New docstring remains added");
        }
        assert.deepEqual(errors, []);
        results.push({ fixture: fixture.name, format, matching, snapshot, errors });
        await page.close();
      }
    }
    privateDebug.phase = "writing numeric report";
    fs.writeFileSync(
      path.join(artifactDirectory, "line-alignment-browser-results.json"),
      JSON.stringify(results, null, 2),
    );
    if (externalFixturePath) {
      console.log("Private alignment report (metrics and line numbers only):", artifactDirectory);
      console.log(
        JSON.stringify(
          results.map(({ format, valid, sourceLines, pairResults, deletedRanges, geometryAligned }) => ({
            format,
            valid,
            sourceLines,
            pairResults,
            deletedRanges,
            geometryAligned,
          })),
          null,
          2,
        ),
      );
      assert(
        results.every((result) => result.valid),
        "External fixture alignment checks failed; inspect the numeric report",
      );
      return;
    }
    console.log(
      "Line alignment browser checks passed: moved URL, repeated constructors, combined class sequence, changed guard/return and translated keyword arguments in both layouts; source projections and geometry preserved; screenshots:",
      artifactDirectory,
    );
  } catch (error) {
    if (externalFixturePath && activePage && !activePage.isClosed()) {
      privateDebug.dom = await activePage
        .evaluate(() => ({
          sourceRows: document.querySelectorAll(".d2h-code-line-ctn").length,
          hiddenRows: document.querySelectorAll(".diff-context-hidden").length,
          loadingDisplay:
            document.getElementById("loading-container") &&
            getComputedStyle(document.getElementById("loading-container")).display,
          messageKinds: (window.extensionMessages || []).map((message) => message.kind),
        }))
        .catch(() => undefined);
      await activePage
        .screenshot({ path: path.join(artifactDirectory, "external-failure.png") })
        .catch(() => undefined);
    }
    throw error;
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  if (externalFixturePath) {
    fs.writeFileSync(
      path.join(artifactDirectory, "private-debug-error.json"),
      JSON.stringify({ ...privateDebug, name: error.name, message: error.message, stack: error.stack }, null, 2),
    );
    console.error(
      `External fixture failed during ${privateDebug.phase} (${error.name}); private diagnostics: ${artifactDirectory}`,
    );
  } else console.error(error);
  server.close();
  process.exitCode = 1;
});

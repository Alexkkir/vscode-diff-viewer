// Run after build:prod: node integration/browser/line-alignment.cjs [artifact-directory]
// Serves the real webview bundle/skeleton on loopback with the VS Code API mocked.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");
require("./load-typescript.cjs");
const { parseDiff } = require("../../src/shared/diff.ts");
const { realignDiffHunks } = require("../../src/shared/hunk-alignment.ts");

const root = path.resolve(__dirname, "../..");
const artifactDirectory = path.resolve(process.argv[2] || "/tmp/diff-viewer-line-alignment");
fs.mkdirSync(artifactDirectory, { recursive: true });
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
    '<body data-shell-generation="{{SHELL_GENERATION}}">',
    '<body class="vscode-dark" data-shell-generation="1">',
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

const cases = [
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
];
function projection(files, side) {
  return files.flatMap((file) =>
    file.blocks.flatMap((block) =>
      block.lines
        .filter((line) => line[`${side}Number`] !== undefined)
        .map((line) => ({ number: line[`${side}Number`], text: line.content.slice(1) })),
    ),
  );
}
const payload = (outputFormat, files) => ({
  config: {
    globalScrollbar: true,
    diff2html: { outputFormat, drawFileList: false, matching: "lines", colorScheme: "dark" },
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
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const fixture of cases) {
      const parsed = parseDiff(fixture.patch);
      const originalProjections = { old: projection(parsed, "old"), new: projection(parsed, "new") };
      const files = realignDiffHunks(parsed);
      for (const side of ["old", "new"]) {
        assert.deepEqual(
          projection(files, side),
          originalProjections[side],
          `${fixture.name}: model source projection ${side}`,
        );
      }
      for (const format of ["side-by-side", "line-by-line"]) {
        const page = await browser.newPage({ viewport: { width: 1680, height: 900 }, deviceScaleFactor: 1 });
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.evaluate(
          (value) => window.postMessage({ kind: "updateWebview", payload: value }, location.origin),
          payload(format, files),
        );
        await page.waitForSelector(".d2h-code-line-ctn");
        await page.waitForFunction(
          () => getComputedStyle(document.getElementById("loading-container")).display === "none",
        );
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
          if (fixture.name === "moved-url") {
            assert.equal(snapshot.rows[1][oldRow(3).index].new, 0, "Removed URL comment must not displace decorators");
            assert.equal(snapshot.rows[0][newRow(6).index].old, 0, "Moved docstring URL belongs to its own added row");
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
        await page.screenshot({
          fullPage: true,
          path: path.join(artifactDirectory, `line-alignment-${fixture.name}-${format}.png`),
        });
        assert.deepEqual(errors, []);
        results.push({ fixture: fixture.name, format, snapshot, errors });
        await page.close();
      }
    }
    fs.writeFileSync(
      path.join(artifactDirectory, "line-alignment-browser-results.json"),
      JSON.stringify(results, null, 2),
    );
    console.log(
      "Line alignment browser checks passed: moved URL, repeated constructors and their combined class sequence in both layouts, source projections and geometry preserved; screenshots:",
      artifactDirectory,
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});

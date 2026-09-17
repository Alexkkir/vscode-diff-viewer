// Run after build:prod: node integration/browser/context-folding.cjs [artifact-directory]
// Serves the real webview bundle/skeleton on loopback with the VS Code API mocked.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");
const { parse } = require("diff2html");

const root = path.resolve(__dirname, "../..");
const artifactDirectory = path.resolve(process.argv[2] || "/tmp/diff-viewer-context-folding");
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

const rows = (prefix, count) =>
  Array.from({ length: count }, (_, index) => {
    const number = String(index + 1).padStart(3, "0");
    return `     self.${prefix}_${number} = measure("${prefix}_${number}", enabled=True)`;
  });
const diff = [
  "diff --git a/metrics.py b/metrics.py",
  "--- a/metrics.py",
  "+++ b/metrics.py",
  "@@ -1,275 +1,275 @@",
  ...rows("leading", 75),
  "-    self.first_threshold = 0.25",
  "+    self.first_threshold = 0.50",
  ...rows("middle", 135),
  "-    self.second_threshold = 0.75",
  "+    self.second_threshold = 0.95",
  ...rows("trailing", 63),
  "",
].join("\n");
const files = parse(diff);
const payload = (outputFormat) => ({
  config: {
    globalScrollbar: true,
    diff2html: {
      outputFormat,
      drawFileList: false,
      matching: "none",
      matchWordsThreshold: 0.25,
      matchingMaxComparisons: 2500,
      maxLineSizeInBlockForComparison: 200,
      maxLineLengthHighlight: 10000,
      renderNothingWhenEmpty: false,
      colorScheme: "dark",
    },
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
    for (const format of ["side-by-side", "line-by-line"]) {
      const page = await browser.newPage({ viewport: { width: 1680, height: 1050 }, deviceScaleFactor: 1 });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.evaluate(
        (value) => window.postMessage({ kind: "updateWebview", payload: value }, location.origin),
        payload(format),
      );
      await page.waitForSelector(".diff-context-gap");
      await page.waitForFunction(
        () => getComputedStyle(document.getElementById("loading-container")).display === "none",
      );
      const snapshot = () =>
        page.evaluate(() => ({
          bars: Array.from(document.querySelectorAll(".diff-context-gap"), (row) => ({
            id: row.dataset.contextId,
            hidden: Number(row.dataset.hiddenLines),
            top: row.getBoundingClientRect().top,
            height: row.getBoundingClientRect().height,
            buttons: Array.from(row.querySelectorAll("button"), (button) => ({
              direction: button.dataset.contextDirection,
              x: button.getBoundingClientRect().x,
              width: button.getBoundingClientRect().width,
              text: button.textContent,
            })),
          })),
          hiddenRows: document.querySelectorAll("tr.diff-context-hidden").length,
          visibleLines: Array.from(document.querySelectorAll(".d2h-code-line-ctn")).filter((line) =>
            line.checkVisibility(),
          ).length,
          scrollY: window.scrollY,
        }));
      const initial = await snapshot();
      assert.equal(initial.hiddenRows, format === "side-by-side" ? 146 : 73);
      assert.deepEqual(
        initial.bars.slice(0, 3).map((bar) => bar.hidden),
        [25, 35, 13],
      );
      const middleId = initial.bars[1].id;
      if (format === "side-by-side") {
        for (let index = 0; index < 3; index++) {
          assert.equal(initial.bars[index].height, initial.bars[index + 3].height);
          assert.equal(initial.bars[index].top, initial.bars[index + 3].top);
        }
        assert(initial.bars[1].buttons[0].x < 840);
        assert(initial.bars[4].buttons[0].x >= 840);
      }
      const selector = `.diff-context-gap[data-context-id="${middleId}"]`;
      await page
        .locator(selector)
        .first()
        .evaluate((row) => window.scrollTo(0, row.getBoundingClientRect().top + window.scrollY - 420));
      await page.screenshot({ path: path.join(artifactDirectory, `context-folding-${format}-before.png`) });
      const before = await snapshot();
      await page.locator(`${selector} [data-context-direction="start"]`).click();
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const after = await snapshot();
      assert.equal(after.hiddenRows, before.hiddenRows - (format === "side-by-side" ? 40 : 20));
      assert.equal(after.visibleLines, before.visibleLines + (format === "side-by-side" ? 40 : 20));
      const beforeBar = before.bars.find((bar) => bar.id === middleId);
      const afterBar = after.bars.find((bar) => bar.id === middleId);
      assert.equal(afterBar.hidden, 15);
      assert(
        Math.abs(beforeBar.top - afterBar.top) <= 1,
        `Gap scrolled ${afterBar.top - beforeBar.top}px on ${format} expansion`,
      );
      assert(afterBar.buttons.some((button) => button.text.includes("15")));
      await page.screenshot({ path: path.join(artifactDirectory, `context-folding-${format}-expanded.png`) });
      await page.locator(`${selector} [data-context-direction="end"]`).click();
      const final = await snapshot();
      assert(!final.bars.some((bar) => bar.id === middleId));
      assert.equal(final.hiddenRows, after.hiddenRows - (format === "side-by-side" ? 30 : 15));
      assert.deepEqual(errors, []);
      results.push({ format, initial, before, after, final, errors });
      await page.close();
    }
    fs.writeFileSync(
      path.join(artifactDirectory, "context-folding-browser-results.json"),
      JSON.stringify(results, null, 2),
    );
    console.log(
      "Context folding browser checks passed for side-by-side and line-by-line; screenshots:",
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

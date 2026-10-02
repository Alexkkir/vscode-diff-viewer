// Run after build:prod: node integration/browser/no-newline.cjs [artifact-directory]
// Serves the real webview bundle/skeleton on loopback with the VS Code API mocked.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");
require("./load-typescript.cjs");
const { parseDiff } = require("../../src/shared/diff.ts");

const root = path.resolve(__dirname, "../..");
const artifactDirectory = path.resolve(process.argv[2] || "/tmp/diff-viewer-no-newline");
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

const cases = [
  {
    name: "newline-added",
    patch:
      '--- a/system_prompt.py\n+++ b/system_prompt.py\n@@ -143,4 +143,4 @@\n </output_format>\n \n "Запрос пользователя: "\n-"""\n\\ No newline at end of file\n+"""\n',
    noNewline: { old: 146 },
  },
  {
    name: "newline-removed",
    patch:
      '--- a/system_prompt.py\n+++ b/system_prompt.py\n@@ -143,4 +143,4 @@\n </output_format>\n \n "Запрос пользователя: "\n-"""\n+"""\n\\ No newline at end of file\n',
    noNewline: { new: 146 },
  },
  {
    name: "unequal-replacement",
    patch:
      "--- a/a.py\n+++ b/a.py\n@@ -1,2 +1,3 @@\n stable\n-old\n\\ No newline at end of file\n+new\n+extra\n\\ No newline at end of file\n",
    noNewline: { old: 2, new: 3 },
  },
  {
    name: "new-file",
    patch: "--- /dev/null\n+++ b/new.py\n@@ -0,0 +1 @@\n+text\n\\ No newline at end of file\n",
    noNewline: { new: 1 },
  },
  {
    name: "deleted-file",
    patch: "--- a/old.py\n+++ /dev/null\n@@ -1 +0,0 @@\n-text\n\\ No newline at end of file\n",
    noNewline: { old: 1 },
  },
  {
    name: "shared-eof",
    patch: "--- a/a.py\n+++ b/a.py\n@@ -1,2 +1,2 @@\n-old\n+new\n last_line\n\\ No newline at end of file\n",
    noNewline: { old: 2, new: 2 },
  },
];
const payload = (outputFormat, fixture) => ({
  config: {
    globalScrollbar: true,
    diff2html: { outputFormat, drawFileList: false, matching: "none", colorScheme: "dark" },
  },
  diffFiles: parseDiff(fixture.patch),
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
      for (const fixture of cases) {
        const page = await browser.newPage({ viewport: { width: 1400, height: 700 }, deviceScaleFactor: 1 });
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.evaluate(
          (value) => window.postMessage({ kind: "updateWebview", payload: value }, location.origin),
          payload(format, fixture),
        );
        await page.waitForSelector(".diff-no-newline[data-no-newline-side]");
        await page.waitForFunction(
          () => getComputedStyle(document.getElementById("loading-container")).display === "none",
        );
        const snapshot = () =>
          page.evaluate(() => ({
            rows: Array.from(document.querySelectorAll(".d2h-file-side-diff"), (pane) =>
              Array.from(pane.querySelectorAll("tbody > tr"), (row) => ({
                top: row.getBoundingClientRect().top,
                height: row.getBoundingClientRect().height,
              })),
            ),
            markers: Array.from(document.querySelectorAll(".diff-no-newline[data-no-newline-side]"), (marker) => ({
              side: marker.dataset.noNewlineSide,
              text: marker.textContent,
              height: marker.getBoundingClientRect().height,
              code: marker.closest("tr").querySelector(".d2h-code-line-ctn").textContent,
            })),
            source: Array.from(document.querySelectorAll(".d2h-code-line-ctn"), (line) => line.textContent),
          }));
        const initial = await snapshot();
        for (const marker of initial.markers) {
          assert.equal(marker.text, "\\ No newline at end of file");
          assert.equal(marker.height, 21);
        }
        const sides = initial.markers.flatMap((marker) => marker.side.split(" ")).sort();
        assert.deepEqual(sides, Object.keys(fixture.noNewline).sort());
        assert(!initial.source.some((text) => text.includes("No newline at end of file")));
        if (format === "side-by-side") {
          assert.deepEqual(
            initial.rows[0],
            initial.rows[1],
            `${fixture.name}: paired rows must retain the same top and height`,
          );
        }
        await page.locator("#syntax-highlighting-toggle").uncheck();
        const uncolored = await snapshot();
        assert.deepEqual(uncolored, initial, "Syntax toggle must preserve EOF annotations and row geometry");
        if (fixture.name === "newline-added") {
          await page.screenshot({ path: path.join(artifactDirectory, `no-newline-${format}.png`) });
        }
        assert.deepEqual(errors, []);
        results.push({ format, fixture: fixture.name, snapshot: initial, errors });
        await page.close();
      }
    }
    fs.writeFileSync(path.join(artifactDirectory, "no-newline-browser-results.json"), JSON.stringify(results, null, 2));
    console.log(
      "EOF browser checks passed in both layouts for newline changes, unequal replacements, added/deleted files, shared context; screenshots:",
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

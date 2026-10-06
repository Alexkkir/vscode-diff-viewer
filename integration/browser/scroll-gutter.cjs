// Run after build:prod: node integration/browser/scroll-gutter.cjs [artifact-directory]
// Serves the real webview bundle/skeleton on loopback with the VS Code API mocked.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");
require("./load-typescript.cjs");
const { parseDiff } = require("../../src/shared/diff.ts");

const root = path.resolve(__dirname, "../..");
const artifactDirectory = path.resolve(process.argv[2] || "/tmp/diff-viewer-scroll-gutter");
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

const longText = "column_name=" + "long_value_".repeat(25);
const patch = [
  "--- sample.py",
  "+++ sample.py",
  "@@ -90,9 +90,10 @@",
  ` context_${longText}`,
  `-changed_${longText}old_value`,
  `+changed_${longText}new_value`,
  ` context_${longText}`,
  `-removed_${longText}`,
  ` context_${longText}`,
  `+inserted_${longText}`,
  `+another_${longText}`,
  ` context_${longText}`,
  `-changed_again_${longText}old_value`,
  `+changed_again_${longText}new_value`,
  ` context_${longText}`,
  ` context_${longText}`,
  "",
].join("\n");
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
    for (const theme of ["dark", "light"]) {
      for (const format of ["side-by-side", "line-by-line"]) {
        const page = await browser.newPage({ viewport: { width: 1300, height: 650 }, deviceScaleFactor: 1 });
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.evaluate(
          ({ theme, format, files }) => {
            document.body.className = `vscode-${theme}`;
            if (theme === "light") {
              for (const [key, value] of Object.entries({
                "editor-background": "#ffffff",
                "editor-foreground": "#333333",
                "editorLineNumber-foreground": "#237893",
                "editorGroupHeader-tabsBackground": "#f3f3f3",
                "diffEditor-insertedLineBackground": "#9bb95533",
                "diffEditor-removedLineBackground": "#ff000033",
              }))
                document.documentElement.style.setProperty(`--vscode-${key}`, value);
            }
            window.postMessage(
              {
                kind: "updateWebview",
                payload: {
                  config: {
                    globalScrollbar: true,
                    diff2html: { outputFormat: format, drawFileList: false, matching: "lines", colorScheme: theme },
                  },
                  diffFiles: files,
                  accessiblePaths: [],
                  viewedState: {},
                  collapseAll: false,
                  performance: { isLargeDiff: false, deferViewedStateHashing: false },
                },
              },
              location.origin,
            );
          },
          { theme, format, files: parseDiff(patch) },
        );
        await page.waitForSelector(".d2h-code-line-ctn");
        await page.waitForFunction(
          () => getComputedStyle(document.getElementById("loading-container")).display === "none",
        );
        const gutters = await page.evaluate(() =>
          Array.from(document.querySelectorAll(".d2h-code-linenumber, .d2h-code-side-linenumber"))
            .map((element, index) => {
              const rect = element.getBoundingClientRect();
              return {
                index,
                kind: element.className,
                x: Math.ceil(rect.x) + 2,
                y: Math.ceil(rect.y) + 2,
                width: Math.floor(rect.width) - 4,
                height: Math.floor(rect.height) - 4,
              };
            })
            .filter(({ x, y, width, height }) => x >= 0 && y >= 0 && width > 0 && height > 0),
        );
        const clips = gutters.map(({ index, kind, ...clip }) => clip);
        const before = [];
        for (const clip of clips) before.push(await page.screenshot({ clip }));
        await page.screenshot({ path: path.join(artifactDirectory, `${theme}-${format}-before.png`) });
        const scroll = await page.evaluate(() => {
          const panes = Array.from(document.querySelectorAll(".d2h-file-side-diff"));
          const targets = panes.length ? panes : Array.from(document.querySelectorAll(".d2h-file-diff"));
          return targets.map((target) => {
            target.scrollLeft = 290;
            return { actual: target.scrollLeft, max: target.scrollWidth - target.clientWidth };
          });
        });
        assert(
          scroll.every((target) => target.actual === 290),
          "Fixture must horizontally scroll both panes",
        );
        await page.evaluate(
          () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
        await page.screenshot({ path: path.join(artifactDirectory, `${theme}-${format}-after.png`) });
        const failures = [];
        for (const [i, clip] of clips.entries()) {
          const after = await page.screenshot({ clip });
          if (!before[i].equals(after)) failures.push(gutters[i]);
        }
        const track = await page.locator("#horizontal-scrollbar-container").boundingBox();
        assert(track, "Global scrollbar must be visible for long source lines");
        await page.mouse.click(track.x + track.width - 2, track.y + track.height / 2);
        await page.evaluate(
          () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
        const globalScroll = await page.evaluate(() => {
          const panes = Array.from(document.querySelectorAll(".d2h-file-side-diff"));
          const targets = panes.length ? panes : Array.from(document.querySelectorAll(".d2h-file-diff"));
          return targets.map((target) => target.scrollLeft);
        });
        assert(
          globalScroll.every((value) => value > 290),
          "Global scrollbar must move every pane further right",
        );
        const globalFailures = [];
        for (const [i, clip] of clips.entries()) {
          const after = await page.screenshot({ clip });
          if (!before[i].equals(after)) globalFailures.push(gutters[i]);
        }
        await page.screenshot({ path: path.join(artifactDirectory, `${theme}-${format}-global-after.png`) });
        results.push({
          theme,
          format,
          scroll,
          globalScroll,
          checkedGutters: gutters.length,
          changedGutters: failures,
          globalChangedGutters: globalFailures,
          errors,
        });
        await page.close();
      }
    }
    fs.writeFileSync(path.join(artifactDirectory, "scroll-gutter-results.json"), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
    assert(
      results.every(
        (result) => !result.changedGutters.length && !result.globalChangedGutters.length && !result.errors.length,
      ),
      "Scrolled source must not paint through fixed line numbers",
    );
    console.log("Scroll gutter checks passed:", artifactDirectory);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});

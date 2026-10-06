// Run after building: node integration/browser/carriage-return.cjs
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { mkdtempSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { chromium } = require("playwright");

const repository = resolve(__dirname, "../..");
require("ts-node").register({
  project: join(repository, "tsconfig.json"),
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node" },
});
const { parseDiff } = require("../../src/shared/diff.ts");
const version = JSON.parse(readFileSync(join(repository, "package.json"), "utf8")).version;
const bundle = readFileSync(join(repository, "dist/webview.js"), "utf8");
const bundleSha256 = createHash("sha256").update(bundle).digest("hex");
const patch =
  "diff --git a/rows.txt b/rows.txt\n--- a/rows.txt\n+++ b/rows.txt\n@@ -1,2 +1,2 @@\n-a\rb\n+ab\n context after\n";
const screenshots = mkdtempSync(join(tmpdir(), "diff-cr-browser-"));
const shell = readFileSync(join(repository, "src/extension/skeleton.html"), "utf8")
  .replace(/<meta\s+http-equiv="Content-Security-Policy"[^>]*\/>/g, "")
  .replace(/<script[^>]*>[\s\S]*?<\/script>/g, "")
  .replace(/<link[^>]*>/g, "")
  .replace("{{COMMON_CSS_LINKS}}", "")
  .replace("{{SHELL_GENERATION}}", "1");
const css = [
  "reset.css",
  "app.css",
  "diff2html@3.4.45.min.css",
  "diff2html-tweaks.css",
  "highlight.js@11.9.0-github.min.css",
]
  .map((file) => readFileSync(join(repository, "styles", file), "utf8"))
  .join("\n");

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const syntax of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      await page.setContent(shell);
      await page.addStyleTag({ content: css });
      await page.evaluate((syntax) => {
        window.acquireVsCodeApi = () => ({
          postMessage: () => {},
          getState: () => ({ syntaxHighlighting: syntax }),
          setState: () => {},
        });
      }, syntax);
      await page.addScriptTag({ content: bundle });
      await page.evaluate(
        (payload) => {
          window.dispatchEvent(
            new MessageEvent("message", { origin: window.origin, data: { kind: "updateWebview", payload } }),
          );
        },
        {
          renderId: 1,
          diffFiles: parseDiff(patch),
          accessiblePaths: [],
          viewedState: {},
          collapseAll: false,
          config: {
            globalScrollbar: false,
            diff2html: {
              outputFormat: "side-by-side",
              drawFileList: false,
              matching: "none",
              matchWordsThreshold: 0.25,
              matchingMaxComparisons: 2500,
              maxLineSizeInBlockForComparison: 200,
              maxLineLengthHighlight: 10000,
              renderNothingWhenEmpty: false,
              colorScheme: "light",
            },
          },
          performance: { isLargeDiff: false, deferViewedStateHashing: true },
        },
      );
      await page.waitForSelector(".d2h-file-side-diff .d2h-code-line-ctn", { timeout: 10000 });
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      const geometry = await page.evaluate(() =>
        Array.from(document.querySelectorAll(".d2h-file-side-diff"), (pane) =>
          Array.from(pane.querySelectorAll("tr"))
            .filter((row) => row.querySelector(".d2h-code-line-ctn"))
            .map((row) => ({
              line: Number(row.querySelector(".d2h-code-side-linenumber").textContent),
              text: row.querySelector(".d2h-code-line-ctn").textContent,
              top: row.getBoundingClientRect().top,
              height: row.getBoundingClientRect().height,
              codeHeight: row.querySelector(".d2h-code-line-ctn").getBoundingClientRect().height,
            })),
        ),
      );
      const screenshot = join(screenshots, `syntax-${syntax}.png`);
      await page.screenshot({ path: screenshot });
      console.log(JSON.stringify({ version, bundleSha256, syntax, geometry, errors, screenshot }));
      assert.deepEqual(errors, []);
      assert.deepEqual(
        geometry.map((pane) => pane.map((row) => row.text)),
        [
          ["a\rb", "context after"],
          ["ab", "context after"],
        ],
      );
      for (const [index, oldRow] of geometry[0].entries()) {
        assert.equal(oldRow.top, geometry[1][index].top);
        assert.equal(oldRow.height, geometry[1][index].height);
        assert.equal(oldRow.codeHeight, geometry[1][index].codeHeight);
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

// Run after building: node integration/browser/review-ui.cjs
// Synthetic browser regressions use the shipped webview bundle and CSS.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");
const { parse, defaultDiff2HtmlConfig } = require("diff2html");

const repositoryRoot = path.resolve(__dirname, "../..");
const webviewBundle = fs.readFileSync(path.join(repositoryRoot, "dist/webview.js"));
const styles = ["reset.css", "diff2html@3.4.45.min.css", "diff2html-tweaks.css", "app.css"];
const skeleton = fs
  .readFileSync(path.join(repositoryRoot, "src/extension/skeleton.html"), "utf8")
  .replace(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/, "")
  .replace(/<script[^>]*>[\s\S]*?<\/script>/g, "")
  .replace("{{COMMON_CSS_LINKS}}", styles.map((name) => `<link rel="stylesheet" href="/styles/${name}">`).join(""))
  .replace("{{LIGHT_HIGHLIGHT_CSS_URI}}", "/styles/highlight.js@11.9.0-github.min.css")
  .replace("{{DARK_HIGHLIGHT_CSS_URI}}", "/styles/highlight.js@11.9.0-github-dark.min.css")
  .replace(/\{\{[^}]+\}\}/g, "")
  .replace(
    "</body>",
    `<script>window.acquireVsCodeApi=()=>({postMessage:()=>{},getState:()=>({syntaxHighlighting:false}),setState:()=>{}});</script>
     <script src="/webview.js"></script></body>`,
  );

const server = http.createServer((request, response) => {
  if (request.url === "/") {
    response.setHeader("Content-Type", "text/html");
    response.end(skeleton);
  } else if (request.url === "/webview.js") {
    response.setHeader("Content-Type", "text/javascript");
    response.end(webviewBundle);
  } else if (/^\/styles\/[\w.@-]+\.css$/.test(request.url ?? "")) {
    response.setHeader("Content-Type", "text/css");
    response.end(fs.readFileSync(path.join(repositoryRoot, request.url)));
  } else {
    response.statusCode = 404;
    response.end();
  }
});

const settle = (page) =>
  page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 30)))),
  );

async function largeFind(page) {
  await page.evaluate(() => {
    const line = document.createElement("span");
    line.className = "d2h-code-line-ctn";
    line.textContent = "x ".repeat(150000);
    document.getElementById("diff-container").replaceChildren(line);
  });
  await page.keyboard.press("Control+f");
  await page.locator('#diff-find-widget input[type="text"]').fill("x");
  const result = await page.evaluate(() => ({
    count: document.querySelector("#diff-find-widget span").textContent,
    highlights: CSS.highlights.get("diff-find")?.size,
    current: CSS.highlights.get("diff-find-current")?.size,
  }));
  assert.equal(result.count, "1 / 150000");
  assert.ok(result.highlights > 0 && result.highlights <= 2000, "only a bounded range window should be painted");
  assert.equal(result.current, 1);
  await page.locator('#diff-find-widget input[type="text"]').press("Enter");
  assert.equal(await page.locator("#diff-find-widget span").textContent(), "2 / 150000");
  console.log("PASS browser find with 150000 matches");
}

function payload(globalScrollbar, narrowFirst) {
  const patch = ["one.py", "two.py"].flatMap((name) => [
    `--- a/${name}`,
    `+++ b/${name}`,
    "@@ -1,21 +1,21 @@",
    `-${"x".repeat(narrowFirst ? 200 : 1000)}`,
    `+${"y".repeat(narrowFirst ? 1000 : 200)}`,
    ...Array.from({ length: 20 }, (_, index) => ` context_line_${index}`),
  ]);
  return {
    config: {
      diff2html: {
        ...defaultDiff2HtmlConfig,
        outputFormat: "side-by-side",
        drawFileList: false,
        matching: "none",
        colorScheme: "light",
      },
      globalScrollbar,
    },
    diffFiles: parse(patch.join("\n")),
    accessiblePaths: [],
    viewedState: {},
    collapseAll: false,
    performance: { isLargeDiff: false, deferViewedStateHashing: false },
    syntax: [null, null],
  };
}

async function scrolling(page, globalScrollbar, narrowFirst) {
  await page.evaluate(
    (payload) => window.postMessage({ kind: "updateWebview", payload }, window.origin),
    payload(globalScrollbar, narrowFirst),
  );
  await page.waitForSelector(".d2h-file-side-diff");
  await page.evaluate(() => {
    for (const pane of document.querySelectorAll(".d2h-file-side-diff")) {
      pane.style.maxHeight = "120px";
      pane.style.overflowY = "auto";
    }
    window.dispatchEvent(new Event("resize"));
  });
  await settle(page);
  const limits = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".d2h-file-side-diff"), (pane) => pane.scrollWidth - pane.clientWidth),
  );
  const wideIndex = narrowFirst ? 1 : 0;
  const narrowIndex = narrowFirst ? 0 : 1;
  if (globalScrollbar) {
    const bar = page.locator("#horizontal-scrollbar-container");
    const box = await bar.boundingBox();
    await bar.click({ position: { x: box.width - 1, y: box.height / 2 } });
  } else {
    await page.evaluate((index) => {
      const pane = document.querySelectorAll(".d2h-file-side-diff")[index];
      pane.scrollLeft = pane.scrollWidth - pane.clientWidth;
    }, wideIndex);
  }
  await settle(page);
  const positions = () =>
    page.evaluate(() => Array.from(document.querySelectorAll(".d2h-file-side-diff"), (pane) => pane.scrollLeft));
  const expected = globalScrollbar ? limits : [...limits.slice(0, 2), 0, 0];
  assert.deepEqual(await positions(), expected, "clamped scroll events must not move the wide pane back");
  if (process.env.DIFF_UI_SCREENSHOTS) {
    fs.mkdirSync(process.env.DIFF_UI_SCREENSHOTS, { recursive: true });
    await page.screenshot({
      path: path.join(
        process.env.DIFF_UI_SCREENSHOTS,
        `scroll-global-${globalScrollbar}-narrow-first-${narrowFirst}.png`,
      ),
      fullPage: true,
    });
  }

  const thumbBefore = await page.locator("#horizontal-scrollbar-content").getAttribute("style");
  await page.evaluate((index) => {
    document.querySelectorAll(".d2h-file-side-diff")[index].scrollTop = 75;
  }, narrowIndex);
  await settle(page);
  assert.deepEqual(await positions(), expected, "vertical scrolling must preserve all horizontal offsets");
  assert.deepEqual(
    await page.evaluate(() => Array.from(document.querySelectorAll(".d2h-file-side-diff"), (pane) => pane.scrollTop)),
    [75, 75, 0, 0],
  );
  assert.equal(
    await page.locator("#horizontal-scrollbar-content").getAttribute("style"),
    thumbBefore,
    "vertical scrolling must preserve the global thumb",
  );

  await page.evaluate((index) => {
    document.querySelectorAll(".d2h-file-side-diff")[index].scrollLeft = 40;
  }, narrowIndex);
  await settle(page);
  assert.deepEqual(
    await positions(),
    globalScrollbar ? [40, 40, 40, 40] : [40, 40, 0, 0],
    "a later user scroll must still synchronize",
  );
  console.log(
    `PASS browser scrolling (global=${globalScrollbar}, narrowFirst=${narrowFirst}) offsets=${JSON.stringify(expected)}`,
  );
}

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  const watchdog = setTimeout(() => {
    console.error("Browser UI probes exceeded 30 seconds");
    process.exitCode = 1;
    void browser.close();
  }, 30000);
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(`${error.name}: ${error.message}`));
    const url = `http://127.0.0.1:${server.address().port}/`;
    await page.goto(url);
    if (!process.argv.includes("--scroll-only")) await largeFind(page);
    if (!process.argv.includes("--find-only")) {
      for (const globalScrollbar of [false, true]) {
        for (const narrowFirst of [false, true]) {
          await page.goto(url);
          await scrolling(page, globalScrollbar, narrowFirst);
        }
      }
    }
    assert.deepEqual(errors, [], "webview must not raise browser errors");
  } finally {
    clearTimeout(watchdog);
    await browser.close();
  }
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => server.close());

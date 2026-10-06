// Run after building: node integration/browser/view-state.cjs [artifact-directory]
// Serves the real webview bundle/skeleton on loopback with the VS Code API mocked.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");
const { parse } = require("diff2html");

const root = path.resolve(__dirname, "../..");
const artifactDirectory = path.resolve(process.argv[2] || "/tmp/diff-viewer-view-state");
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
    let uiState; window.viewedState = {};
    window.acquireVsCodeApi = () => ({
      postMessage: message => { window.extensionMessages.push(message); if (message.kind === "toggleFileViewed") { if (message.payload.viewedSha1) window.viewedState[message.payload.path] = message.payload.viewedSha1; else delete window.viewedState[message.payload.path]; } },
      getState: () => uiState,
      setState: value => { uiState = value; window.testUiState = value; }
    });
    </script><script src="/dist/webview.js"></script>`,
  );

const server = http.createServer((request, response) => {
  if (request.url === "/") {
    response.setHeader("Content-Type", "text/html");
    response.end(html);
  } else if (/^\/(?:styles\/[a-z0-9@.\-]+\.css|dist\/webview\.js)$/.test(request.url)) {
    response.setHeader("content-type", request.url.endsWith(".css") ? "text/css" : "application/javascript");
    response.end(fs.readFileSync(path.join(root, request.url)));
  } else {
    response.statusCode = 404;
    response.end();
  }
});
const wide = "wide_column_".repeat(40);
function patch(revision = 1, count = 5) {
  return Array.from({ length: count }, (_, i) =>
    [
      `diff --git a/file${i}.py b/file${i}.py`,
      `--- a/file${i}.py`,
      `+++ b/file${i}.py`,
      "@@ -1,280 +1,280 @@",
      ...Array.from({ length: 280 }, (_, n) =>
        n === 70 || n === 210
          ? `-file_${i}_line_${n}_before_${wide}\n+file_${i}_line_${n}_after_${revision}_${wide}`
          : ` file_${i}_line_${n}_${wide}`,
      ),
      "",
    ].join("\n"),
  ).join("\n");
}
function payload(format, revision = 1, theme = "dark", large = false) {
  return {
    renderId: revision,
    config: {
      globalScrollbar: true,
      diff2html: { outputFormat: format, drawFileList: false, matching: "none", colorScheme: theme },
    },
    diffFiles: parse(patch(revision, large ? 20 : 5)),
    accessiblePaths: [],
    viewedState: {},
    collapseAll: large,
    performance: { isLargeDiff: large, deferViewedStateHashing: large },
  };
}
const settle = (page) =>
  page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function send(page, value) {
  await page.evaluate((value) => {
    window.lastFile = document.querySelector(".d2h-file-wrapper");
    value.viewedState = window.viewedState;
    window.postMessage({ kind: "updateWebview", payload: value }, location.origin);
  }, value);
  await page.waitForFunction(
    () =>
      (!window.lastFile || !window.lastFile.isConnected) &&
      document.querySelector(".diff-viewer-copy-path") &&
      getComputedStyle(document.getElementById("loading-container")).display === "none",
  );
  await settle(page);
}
async function snapshot(page) {
  return page.evaluate(() => {
    const wrappers = Array.from(document.querySelectorAll(".d2h-file-wrapper"));
    const lines = Array.from(document.querySelectorAll(".d2h-code-line-ctn")).filter(
      (e) => e.checkVisibility() && e.getBoundingClientRect().top >= 45 && e.getBoundingClientRect().top < innerHeight,
    );
    return {
      y: scrollY,
      anchor: lines[0]?.textContent.slice(0, 70),
      anchorY: lines[0]?.getBoundingClientRect().top,
      x: Array.from(document.querySelectorAll(".d2h-file-side-diff,.d2h-file-diff:not(:has(.d2h-file-side-diff))")).map(
        (e) => e.scrollLeft,
      ),
      hidden: document.querySelectorAll(".diff-context-hidden").length,
      gaps: Array.from(document.querySelectorAll(".diff-context-gap")).map((e) => ({
        file: e.closest(".d2h-file-wrapper").dataset.diffPath,
        id: e.dataset.contextId,
        hidden: e.dataset.hiddenLines,
      })),
      expanded: wrappers
        .filter((w) => !w.querySelector(".d2h-file-diff,.d2h-files-diff")?.classList.contains("d2h-d-none"))
        .map((w) => w.dataset.diffPath),
      selection: window.getSelection()?.toString(),
      context: document.querySelector("#diff-container").dataset.vscodeContext,
      uiState: window.testUiState,
    };
  });
}
async function position(page) {
  await page.evaluate(() => {
    const w = document.querySelectorAll(".d2h-file-wrapper")[3];
    window.scrollTo(0, w.getBoundingClientRect().top + scrollY + 1000);
    document
      .querySelectorAll(".d2h-file-side-diff,.d2h-file-diff:not(:has(.d2h-file-side-diff))")
      .forEach((e) => (e.scrollLeft = 430));
  });
  await settle(page);
}
(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const format of ["line-by-line", "side-by-side"]) {
      const page = await browser.newPage({ viewport: { width: 1300, height: 800 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await send(page, payload(format));
      // Expand an unchanged context gap, select source text, and scroll deep into file 3.
      await page
        .locator(".d2h-file-wrapper")
        .nth(3)
        .locator('.diff-context-expand[data-context-direction="start"]')
        .first()
        .click();
      await position(page);
      const before = await snapshot(page);
      await page.screenshot({ path: path.join(artifactDirectory, `${format}-before-refresh.png`) });
      await send(page, payload(format));
      const identical = await snapshot(page);
      await page.screenshot({ path: path.join(artifactDirectory, `${format}-after-refresh.png`) });
      await position(page);
      const beforeTheme = await snapshot(page);
      await send(page, payload(format, 1, "light"));
      const theme = await snapshot(page);
      await position(page);
      const beforeUpdate = await snapshot(page);
      await send(page, payload(format, 2, "light"));
      const update = await snapshot(page);
      await position(page);
      const beforeLayout = await snapshot(page);
      await send(page, payload(format === "line-by-line" ? "side-by-side" : "line-by-line", 2, "light"));
      const layout = await snapshot(page);
      for (const [oldState, newState] of [
        [before, identical],
        [beforeTheme, theme],
        [beforeUpdate, update],
        [beforeLayout, layout],
      ]) {
        assert(
          oldState.x.every((value) => value === 430),
          "Fixture must start scrolled horizontally",
        );
        assert(
          newState.x.every((value) => value === 430),
          "Redraw must preserve horizontal offsets in every pane",
        );
        assert.equal(newState.anchor, oldState.anchor, "Redraw must preserve the source line at the viewport top");
        assert.equal(newState.anchorY, oldState.anchorY, "Redraw must preserve the source line viewport offset");
      }
      assert.equal(identical.hidden, before.hidden, "Unchanged context expansion must survive a redraw");
      assert.deepEqual(errors, []);
      results.push({
        format,
        before,
        identical,
        beforeTheme,
        theme,
        beforeUpdate,
        update,
        beforeLayout,
        layout,
        errors,
      });
      await page.close();

      const large = await browser.newPage({ viewport: { width: 1300, height: 800 } });
      await large.goto(`http://127.0.0.1:${server.address().port}/`);
      await send(large, payload(format, 1, "dark", true));
      assert.deepEqual((await snapshot(large)).expanded, [], "Large diff must initially be collapsed");
      await large.locator(".d2h-file-collapse-input").nth(12).uncheck();
      await large.evaluate(() => {
        const file = document.querySelectorAll(".d2h-file-wrapper")[12];
        window.scrollTo(0, file.getBoundingClientRect().top + scrollY + 1000);
        file.querySelectorAll(".d2h-file-side-diff,.d2h-file-diff:not(:has(.d2h-file-side-diff))").forEach((pane) => {
          pane.scrollLeft = 430;
        });
      });
      await settle(large);
      const manuallyExpanded = await snapshot(large);
      assert.deepEqual(manuallyExpanded.expanded, ["file12.py"]);
      assert(manuallyExpanded.y > 1000, "Large fixture must be scrolled deep inside the opened file");
      const stages = [];
      for (const [stage, next] of [
        ["identical", payload(format, 1, "dark", true)],
        ["theme", payload(format, 1, "light", true)],
        ["external-update", payload(format, 2, "light", true)],
      ]) {
        await send(large, next);
        const after = await snapshot(large);
        assert.deepEqual(after.expanded, ["file12.py"], `${stage}: manual expansion must survive large-diff redraw`);
        assert.equal(after.anchor, manuallyExpanded.anchor, `${stage}: opened file source line must stay visible`);
        assert.equal(after.anchorY, manuallyExpanded.anchorY, `${stage}: opened file viewport offset must remain`);
        assert.deepEqual(after.x, manuallyExpanded.x, `${stage}: opened file horizontal position must remain`);
        stages.push({ stage, ...after });
      }
      results.push({ format, large: { manuallyExpanded, stages } });
      await large.close();
    }
    fs.writeFileSync(path.join(artifactDirectory, "view-state-results.json"), JSON.stringify(results, null, 2));
    for (const r of results.filter((result) => !result.large))
      for (const [before, after] of [
        ["before", "identical"],
        ["beforeTheme", "theme"],
        ["beforeUpdate", "update"],
        ["beforeLayout", "layout"],
      ])
        console.log(
          r.format,
          after,
          JSON.stringify({
            y: [r[before].y, r[after].y],
            anchor: [r[before].anchor, r[after].anchor],
            x: [r[before].x, r[after].x],
            hidden: [r[before].hidden, r[after].hidden],
          }),
        );
    console.log("Results:", artifactDirectory);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});

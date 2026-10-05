// Run after build:prod: node integration/browser/expand-all.cjs [artifact-directory]
// Serves the real webview bundle/skeleton on loopback with the VS Code API mocked.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");
require("./load-typescript.cjs");
const { parseDiff } = require("../../src/shared/diff.ts");

const root = path.resolve(__dirname, "../..");
const artifactDirectory = path.resolve(process.argv[2] || "/tmp/diff-viewer-expand-all");
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
    window.viewedState = {};
    window.acquireVsCodeApi = () => ({
      postMessage: message => {
        window.extensionMessages.push(message);
        if (message.kind === "requestWebviewAction") {
          // The real extension host answers a request with a webview action.
          setTimeout(() => window.postMessage({ kind: "performWebviewAction", payload: message.payload }, location.origin), 0);
        } else if (message.kind === "toggleFileViewed") {
          if (message.payload.viewedSha1) window.viewedState[message.payload.path] = message.payload.viewedSha1;
          else delete window.viewedState[message.payload.path];
        }
      },
      getState: () => uiState,
      setState: value => { uiState = value; window.testUiState = value; }
    });
    </script><script src="/dist/webview.js"></script>`,
  );

const FILE_COUNT = 96;
function payload(outputFormat, revision, viewedState = {}, empty = false) {
  const patch = Array.from({ length: empty ? 0 : FILE_COUNT }, (_, index) => {
    const id = String(index).padStart(3, "0");
    return [
      `diff --git a/src/file_${id}.py b/src/file_${id}.py`,
      `--- a/src/file_${id}.py`,
      `+++ b/src/file_${id}.py`,
      "@@ -1 +1,2 @@",
      `-value_${id} = 0`,
      `+value_${id} = ${revision}`,
      `+# refresh_${revision}`,
      "",
    ].join("\n");
  }).join("\n");
  return {
    renderId: revision,
    config: {
      globalScrollbar: true,
      diff2html: {
        outputFormat,
        drawFileList: false,
        matching: "lines",
        renderNothingWhenEmpty: false,
        colorScheme: "dark",
      },
    },
    diffFiles: parseDiff(patch),
    accessiblePaths: [],
    viewedState,
    collapseAll: !empty,
    performance: {
      isLargeDiff: !empty,
      deferViewedStateHashing: true,
      warning: empty ? undefined : "Large diff detected. Files are collapsed initially.",
    },
  };
}
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

async function snapshot(page) {
  return page.evaluate(() => {
    const files = Array.from(document.querySelectorAll(".d2h-file-wrapper"));
    const collapsed = files.filter((file) =>
      file.querySelector(".d2h-file-diff, .d2h-files-diff")?.classList.contains("d2h-d-none"),
    ).length;
    const toggle = document.getElementById("expand-all-toggle");
    const rect = toggle.getBoundingClientRect();
    const syntax = document.getElementById("syntax-highlighting-toggle");
    return {
      files: files.length,
      expanded: files.length - collapsed,
      collapsed,
      checked: toggle.checked,
      indeterminate: toggle.indeterminate,
      disabled: toggle.disabled,
      visible: toggle.checkVisibility(),
      toggleRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      syntaxRect: { x: syntax.getBoundingClientRect().x, y: syntax.getBoundingClientRect().y },
      uiState: window.testUiState,
      requestedActions: window.extensionMessages
        .filter((message) => message.kind === "requestWebviewAction")
        .map((message) => message.payload.action),
      viewedMessages: window.extensionMessages.filter((message) => message.kind === "toggleFileViewed").length,
      loadingVisible: getComputedStyle(document.getElementById("loading-container")).display !== "none",
      emptyVisible: getComputedStyle(document.getElementById("empty-message-container")).display !== "none",
    };
  });
}
async function waitForState(page, expected) {
  await page.waitForFunction(
    (expected) => {
      const files = Array.from(document.querySelectorAll(".d2h-file-wrapper"));
      const collapsed = files.filter((file) =>
        file.querySelector(".d2h-file-diff, .d2h-files-diff")?.classList.contains("d2h-d-none"),
      ).length;
      const toggle = document.getElementById("expand-all-toggle");
      return (
        files.length === expected.files &&
        collapsed === expected.collapsed &&
        toggle.checked === expected.checked &&
        toggle.indeterminate === expected.indeterminate &&
        toggle.disabled === expected.disabled &&
        getComputedStyle(document.getElementById("loading-container")).display === "none"
      );
    },
    { files: FILE_COUNT, disabled: false, indeterminate: false, ...expected },
  );
}
async function sendPayload(page, outputFormat, revision, empty = false) {
  const viewedState = await page.evaluate(() => window.viewedState);
  await page.evaluate(
    (value) => window.postMessage({ kind: "updateWebview", payload: value }, location.origin),
    payload(outputFormat, revision, viewedState, empty),
  );
  if (!empty) {
    // The first source row may be hidden inside its collapsed file.
    await page.waitForFunction(
      (revision) =>
        Array.from(document.querySelectorAll(".d2h-code-line-ctn")).some(
          (line) => line.textContent === `# refresh_${revision}`,
        ),
      revision,
    );
  }
}

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const format of ["side-by-side", "line-by-line"]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.waitForSelector("#expand-all-toggle", { state: "attached" });
      const stages = [];
      const record = async (stage) => stages.push({ stage, ...(await snapshot(page)) });

      await sendPayload(page, format, 1);
      await waitForState(page, { collapsed: FILE_COUNT, checked: false });
      await record("initial-collapsed");
      assert.equal(stages[0].visible, true, "Expand all checkbox must be visible in the footer");
      assert(
        Math.abs(stages[0].toggleRect.y - stages[0].syntaxRect.y) <= 4,
        "Expand all and syntax highlighting controls should share the footer row",
      );
      await page.screenshot({ path: path.join(artifactDirectory, `expand-all-${format}-collapsed.png`) });

      await page.locator("#expand-all-toggle").check();
      await waitForState(page, { collapsed: 0, checked: true });
      await record("expanded");
      assert.equal(
        stages.at(-1).uiState?.expandAllFiles,
        true,
        "Expansion choice must be persisted for the current diff",
      );
      assert.deepEqual(stages.at(-1).requestedActions, ["expandAll"]);
      await page.screenshot({ path: path.join(artifactDirectory, `expand-all-${format}-expanded.png`) });

      await sendPayload(page, format, 2);
      await waitForState(page, { collapsed: 0, checked: true });
      await record("refresh-still-expanded");
      assert.equal(stages.at(-1).uiState?.expandAllFiles, true);
      assert.equal(stages.at(-1).loadingVisible, false);

      await page.locator(".d2h-file-collapse-input").first().check();
      await waitForState(page, { collapsed: 1, checked: false, indeterminate: true });
      await record("one-viewed-mixed");
      await page.screenshot({ path: path.join(artifactDirectory, `expand-all-${format}-mixed.png`) });

      // A real click clears the native mixed state and invokes the host action.
      await page.locator("#expand-all-toggle").click();
      await waitForState(page, { collapsed: 0, checked: true });
      await record("mixed-expanded-again");
      assert.deepEqual(stages.at(-1).requestedActions, ["expandAll", "expandAll"]);

      await page.locator("#expand-all-toggle").uncheck();
      await waitForState(page, { collapsed: FILE_COUNT, checked: false });
      await page.waitForFunction((count) => Object.keys(window.viewedState).length === count, FILE_COUNT);
      await record("all-collapsed-again");
      assert.deepEqual(stages.at(-1).requestedActions, ["expandAll", "expandAll", "collapseAll"]);

      await sendPayload(page, format, 3, true);
      await waitForState(page, { files: 0, collapsed: 0, checked: false, disabled: true });
      await record("empty-disabled");
      assert.equal(stages.at(-1).emptyVisible, true);
      assert.deepEqual(errors, []);
      results.push({ format, stages, errors });
      await page.close();
    }
    fs.writeFileSync(path.join(artifactDirectory, "expand-all-browser-results.json"), JSON.stringify(results, null, 2));
    console.log(
      "Expand all browser checks passed for 96 files in both layouts: initial collapse, expansion, refresh persistence, mixed Viewed state, re-expansion, collapse and empty disabled state; screenshots:",
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

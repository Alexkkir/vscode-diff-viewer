// Run after build:prod: node integration/browser/performance.cjs [artifact-directory]
// Serves the real webview bundle/skeleton on loopback with the VS Code API mocked.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");
const { parse } = require("diff2html");

const root = path.resolve(__dirname, "../..");
const artifactDirectory = path.resolve(process.argv[2] || "/tmp/diff-viewer-render-performance");
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

const makePayload = (count, revision) => {
  const lines = Array.from({ length: count }, (_, index) => `result_${index} = compute(items[${index}], enabled=True)`);
  const pivot = Math.floor(count / 2);
  const patch = [
    "diff --git a/large.py b/large.py",
    "--- a/large.py",
    "+++ b/large.py",
    `@@ -1,${count} +1,${count} @@`,
    ...lines.flatMap((line, index) =>
      index === pivot ? [`-${line}`, `+${line} # revision ${revision}`] : [` ${line}`],
    ),
    "",
  ].join("\n");
  const tokens = (text) => [
    { start: 0, end: text.indexOf(" ="), color: "#9CDCFE", fontStyle: 0 },
    { start: text.indexOf(" ="), end: text.indexOf("compute"), color: "#D4D4D4", fontStyle: 0 },
    { start: text.indexOf("compute"), end: text.indexOf("("), color: "#DCDCAA", fontStyle: 0 },
    { start: text.indexOf("("), end: text.length, color: "#CE9178", fontStyle: 0 },
  ];
  const syntax = { old: {}, new: {} };
  lines.forEach((line, index) => {
    syntax.old[index + 1] = tokens(line);
    syntax.new[index + 1] = tokens(line + (index === pivot ? ` # revision ${revision}` : ""));
  });
  return {
    renderId: revision,
    config: {
      globalScrollbar: true,
      diff2html: { outputFormat: "side-by-side", drawFileList: false, matching: "none", colorScheme: "dark" },
    },
    diffFiles: parse(patch),
    syntax: [syntax],
    accessiblePaths: [],
    viewedState: {},
    collapseAll: false,
    performance: { isLargeDiff: false, deferViewedStateHashing: false },
  };
};
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
    for (const count of [1600, 5000]) {
      const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      for (let revision = 0; revision < 4; revision++) {
        const elapsed = await page.evaluate(
          async (value) => {
            window.benchmarkPayload = value;
            const start = performance.now();
            window.postMessage({ kind: "updateWebview", payload: value }, location.origin);
            await new Promise((resolve, reject) => {
              const deadline = performance.now() + 10000;
              const check = () => {
                if (performance.now() > deadline) return reject(new Error("Diff render timed out"));
                const text = document.querySelector("#diff-container")?.textContent || "";
                if (
                  text.includes(
                    `revision ${value.diffFiles[0].blocks[0].lines.find((line) => line.type === "insert").content.match(/revision (\d+)/)[1]}`,
                  ) &&
                  document.querySelector(".diff-textmate-token") &&
                  document.querySelector(".diff-context-gap") &&
                  getComputedStyle(document.getElementById("loading-container")).display === "none"
                )
                  requestAnimationFrame(resolve);
                else requestAnimationFrame(check);
              };
              requestAnimationFrame(check);
            });
            return {
              milliseconds: Math.round(performance.now() - start),
              native: document.querySelectorAll(".diff-textmate-token").length,
              hiddenRows: document.querySelectorAll(".diff-context-hidden").length,
            };
          },
          makePayload(count, revision),
        );
        results.push({ count, revision, ...elapsed });
      }
      // Expansion and hidden-text search must reveal colored rows without a redraw.
      const beforeExpand = await page.locator(".diff-textmate-token").count();
      await page.locator(".diff-context-expand").first().click();
      const afterExpand = await page.locator(".diff-textmate-token").count();
      assert(afterExpand >= beforeExpand);
      await page.evaluate(() =>
        window.postMessage({ kind: "performWebviewAction", payload: { action: "find" } }, location.origin),
      );
      await page.locator('#diff-find-widget input[type="text"]').fill("result_10 =");
      const revealed = await page.evaluate(() => {
        const line = Array.from(document.querySelectorAll(".d2h-code-line-ctn")).find((line) =>
          line.textContent.includes("result_10 ="),
        );
        return {
          visible: !line.closest("tr").hidden,
          colored: !!line.querySelector(".diff-textmate-token"),
          match: Array.from(CSS.highlights.get("diff-find-current"))[0]?.toString(),
        };
      });
      assert.deepEqual(revealed, { visible: true, colored: true, match: "result_10 =" });
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(JSON.stringify(results, null, 2));
    fs.writeFileSync(path.join(artifactDirectory, "render-performance.json"), JSON.stringify(results, null, 2));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});

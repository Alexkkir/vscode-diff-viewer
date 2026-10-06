// Run after build:prod: node integration/browser/large-diff.cjs [output-directory]
// DIFF_BENCH_ASSETS selects a saved bundle/styles/skeleton root for comparisons.
// Optional private inputs: DIFF_BENCH_FIXTURE (collapsed), DIFF_BENCH_SCROLL_FIXTURE (expanded).
// DIFF_BENCH_ONLY=expanded limits a CSS/scroll comparison to the 6k fixture.
// Reports contain only counts/timings: no patch text, paths, screenshots, or raw traces.
// Headless Chromium isolates webview work; this does not measure VS Code host/remote FS or GPU smoothness.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { chromium } = require("playwright");
require("./load-typescript.cjs");
const { parseDiff } = require("../../src/shared/diff.ts");
const { realignDiffHunks } = require("../../src/shared/hunk-alignment.ts");

const root = path.resolve(__dirname, "../..");
const assets = path.resolve(process.env.DIFF_BENCH_ASSETS || root);
const output = path.resolve(process.argv[2] || "/tmp/diff-viewer-large-diff");
const expectLazy = process.env.DIFF_BENCH_EXPECT_LAZY === "1";
const formats = process.env.DIFF_BENCH_FORMAT ? [process.env.DIFF_BENCH_FORMAT] : ["line-by-line", "side-by-side"];
const colors = `:root {
  --vscode-editor-background:#1e1e1e; --vscode-editor-foreground:#d4d4d4;
  --vscode-foreground:#ccc; --vscode-descriptionForeground:#aaa;
  --vscode-editorGroupHeader-tabsBackground:#252526;
  --vscode-diffEditor-unchangedRegionBackground:#29292e;
  --vscode-diffEditor-unchangedRegionForeground:#ccc;
  --vscode-diffEditor-insertedLineBackground:#9bb95533;
  --vscode-diffEditor-removedLineBackground:#ff000033;
  --vscode-diffEditor-insertedTextBackground:#9ccc2c33;
  --vscode-diffEditor-removedTextBackground:#ff000055;
  --vscode-editorLineNumber-foreground:#858585; --vscode-panel-border:#454545;
  --vscode-font-family:-apple-system,BlinkMacSystemFont,sans-serif;
  --vscode-editor-font-family:Menlo,monospace; --vscode-editor-font-size:14px;
  --vscode-editor-font-weight:400; --vscode-font-size:13px;
  --vscode-textLink-foreground:#3794ff; --vscode-focusBorder:#007fd4;
  --vscode-button-background:#0e639c; --vscode-button-foreground:#fff;
  --vscode-input-background:#3c3c3c; --vscode-input-foreground:#ccc;
}`;
const styleNames = ["reset.css", "diff2html@3.4.45.min.css", "diff2html-tweaks.css", "app.css"];
const html = fs
  .readFileSync(path.join(assets, "src/extension/skeleton.html"), "utf8")
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
      postMessage: message => {
        window.extensionMessages.push(message);
        if (message.kind === "requestWebviewAction") setTimeout(() =>
          window.postMessage({kind:"performWebviewAction",payload:message.payload}, location.origin), 0);
      },
      getState: () => uiState,
      setState: value => { uiState = value; }
    });
    window.frameTimes = []; window.longTasks = [];
    const frame = time => {
      window.frameTimes.push(time);
      if (window.progressSamples) window.progressSamples.push({time, rendered:
        document.querySelectorAll('.d2h-file-wrapper:not([data-diff-body-pending]) .d2h-file-collapse-input:not(:checked)').length});
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    new PerformanceObserver(list => window.longTasks.push(...list.getEntries().map(entry => ({start:entry.startTime,duration:entry.duration}))))
      .observe({type:"longtask",buffered:true});
    </script><script src="/dist/webview.js"></script>`,
  );

function synthetic(count) {
  const linesPerFile = 100;
  return Array.from({ length: count / linesPerFile }, (_, file) =>
    [
      `diff --git a/src/module_${file}.py b/src/module_${file}.py`,
      `--- a/src/module_${file}.py`,
      `+++ b/src/module_${file}.py`,
      `@@ -0,0 +1,${linesPerFile} @@`,
      ...Array.from(
        { length: linesPerFile },
        (_, line) => `+value_${line} = compute(items[${line}], enabled=True) # module ${file}`,
      ),
      "",
    ].join("\n"),
  ).join("\n");
}
function fixture(environmentName, count, label) {
  const supplied = process.env[environmentName];
  const patch = supplied ? fs.readFileSync(supplied, "utf8") : synthetic(count);
  const started = performance.now();
  const files = realignDiffHunks(parseDiff(patch));
  return {
    label,
    files,
    metadata: {
      input: supplied ? "private" : "synthetic",
      characters: patch.length,
      patchLines: patch.split("\n").length,
      files: files.length,
      sourceRows: files.reduce((sum, file) => sum + file.blocks.reduce((n, block) => n + block.lines.length, 0), 0),
      parseAndAlignmentMs: +(performance.now() - started).toFixed(1),
    },
  };
}
function payload(fixture, format, collapsed, renderId) {
  return {
    renderId,
    config: {
      globalScrollbar: true,
      diff2html: { outputFormat: format, drawFileList: false, matching: "none", colorScheme: "dark" },
    },
    diffFiles: fixture.files,
    accessiblePaths: [],
    viewedState: {},
    collapseAll: collapsed,
    performance: { isLargeDiff: true, deferViewedStateHashing: true, lazyFiles: true },
  };
}
const server = http.createServer((request, response) => {
  if (request.url === "/") {
    response.setHeader("content-type", "text/html");
    response.end(html);
  } else if (/^\/(?:styles\/[a-z0-9@.\-]+\.css|dist\/webview\.js)$/.test(request.url)) {
    response.setHeader("content-type", request.url.endsWith(".css") ? "text/css" : "application/javascript");
    response.end(fs.readFileSync(path.join(assets, request.url)));
  } else {
    response.statusCode = 404;
    response.end();
  }
});
async function mark(page) {
  return page.evaluate(() => performance.now());
}
async function painted(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function settled(page, count, allExpanded = false) {
  await page.waitForFunction(
    ({ count, allExpanded }) => {
      const wrappers = [...document.querySelectorAll(".d2h-file-wrapper")];
      return (
        wrappers.length === count &&
        getComputedStyle(document.getElementById("loading-container")).display === "none" &&
        (!allExpanded ||
          wrappers.every(
            (wrapper) =>
              !wrapper.querySelector(".d2h-file-collapse-input")?.checked &&
              !wrapper.dataset.diffBodyPending &&
              wrapper.getAttribute("aria-busy") !== "true",
          ))
      );
    },
    { count, allExpanded },
    { timeout: 60000 },
  );
  await painted(page);
  if (allExpanded) {
    await page.waitForFunction(
      () => document.getElementById("horizontal-scrollbar-container")?.getAttribute("aria-busy") !== "true",
    );
    await painted(page);
  }
}
async function measurement(page, start) {
  return page.evaluate((start) => {
    const times = window.frameTimes.filter((time) => time >= start);
    // Include a busy first frame: dropping it can hide a fully synchronous render.
    const gaps = times.map((time, index) => time - (index ? times[index - 1] : start));
    const tasks = window.longTasks.filter((task) => task.start >= start);
    return {
      milliseconds: +(performance.now() - start).toFixed(1),
      rows: document.querySelectorAll(".d2h-code-line-ctn").length,
      elements: document.querySelectorAll("*").length,
      pendingFiles: document.querySelectorAll("[data-diff-body-pending]").length,
      syntaxRequestedFiles: window.extensionMessages
        .filter((message) => message.kind === "requestSyntax")
        .reduce((count, message) => count + message.payload.fileIndexes.length, 0),
      frameCount: gaps.length,
      maxFrameGapMs: +Math.max(0, ...gaps).toFixed(1),
      longTasks: tasks.length,
      maxLongTaskMs: +Math.max(0, ...tasks.map((task) => task.duration)).toFixed(1),
    };
  }, start);
}
async function startPaintMetrics(page) {
  const client = await page.context().newCDPSession(page);
  let layers = [],
    maxLayers = 0,
    paints = 0,
    paintedArea = 0;
  client.on("LayerTree.layerTreeDidChange", (event) => {
    layers = event.layers || [];
    maxLayers = Math.max(maxLayers, layers.length);
  });
  client.on("LayerTree.layerPainted", (event) => {
    paints++;
    paintedArea += event.clip.width * event.clip.height;
  });
  await client.send("Performance.enable");
  await client.send("LayerTree.enable");
  const before = Object.fromEntries(
    (await client.send("Performance.getMetrics")).metrics.map((item) => [item.name, item.value]),
  );
  return async () => {
    const after = Object.fromEntries(
      (await client.send("Performance.getMetrics")).metrics.map((item) => [item.name, item.value]),
    );
    const result = {
      maxLayers,
      layers: layers.length,
      drawingLayers: layers.filter((layer) => layer.drawsContent).length,
      paints,
      paintedArea,
      layoutCount: after.LayoutCount - before.LayoutCount,
      styleRecalcCount: after.RecalcStyleCount - before.RecalcStyleCount,
      layoutMs: +((after.LayoutDuration - before.LayoutDuration) * 1000).toFixed(1),
      scriptMs: +((after.ScriptDuration - before.ScriptDuration) * 1000).toFixed(1),
      taskMs: +((after.TaskDuration - before.TaskDuration) * 1000).toFixed(1),
      heapMB: +(after.JSHeapUsedSize / 1024 / 1024).toFixed(1),
    };
    await client.detach();
    return result;
  };
}
async function verticalScroll(page) {
  const finishMetrics = await startPaintMetrics(page);
  const start = await mark(page);
  const result = await page.evaluate(async () => {
    const container = document.getElementById("diff-container");
    const scroll =
      container.scrollHeight > container.clientHeight && /(auto|scroll)/.test(getComputedStyle(container).overflowY)
        ? container
        : document.scrollingElement;
    const maximum = scroll.scrollHeight - scroll.clientHeight;
    const gaps = [];
    let previous = performance.now();
    for (let index = 0; index < 90; index++) {
      await new Promise((resolve) =>
        requestAnimationFrame((time) => {
          gaps.push(time - previous);
          previous = time;
          scroll.scrollTop = Math.round((maximum * (index % 45)) / 44);
          resolve();
        }),
      );
    }
    const sorted = gaps.slice(1).sort((a, b) => a - b);
    return {
      scrollRange: maximum,
      frames: sorted.length,
      p95FrameGapMs: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1),
      maxFrameGapMs: +Math.max(...sorted).toFixed(1),
      over34ms: sorted.filter((gap) => gap > 34).length,
    };
  });
  return { ...(await measurement(page, start)), ...result, paint: await finishMetrics() };
}
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const collapsed = fixture("DIFF_BENCH_FIXTURE", 20000, "collapsed-20k");
  const expanded = fixture("DIFF_BENCH_SCROLL_FIXTURE", 6000, "expanded-6k");
  const fixtures = process.env.DIFF_BENCH_ONLY === "expanded" ? [expanded] : [collapsed, expanded];
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const format of formats)
      for (const entry of fixtures) {
        const isCollapsed = entry === collapsed;
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
        const errors = [];
        page.on("pageerror", () => errors.push("browser-script-error"));
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.waitForFunction(() => window.extensionMessages.some((message) => message.kind === "ready"));
        const initialPaint = await startPaintMetrics(page);
        const start = await page.evaluate(
          (value) => {
            const started = performance.now();
            window.postMessage({ kind: "updateWebview", payload: value }, location.origin);
            return started;
          },
          payload(entry, format, isCollapsed, 1),
        );
        await settled(page, entry.files.length, !isCollapsed);
        const initial = { ...(await measurement(page, start)), paint: await initialPaint() };
        const result = { fixture: entry.label, format, ...entry.metadata, initial };
        if (isCollapsed) {
          if (expectLazy) {
            assert.equal(initial.rows, 0, "Collapsed large diff must not create code rows");
            assert.equal(initial.syntaxRequestedFiles, 0, "Collapsed diff must not request syntax");
          }
          let started = await page.evaluate(() => {
            const started = performance.now();
            document.querySelector(".d2h-file-collapse-input").click();
            return started;
          });
          await page.waitForFunction(() => {
            const file = document.querySelector(".d2h-file-wrapper");
            return !file.dataset.diffBodyPending && file.getAttribute("aria-busy") !== "true";
          });
          await painted(page);
          result.expandFirst = await measurement(page, started);
          const finishPaint = await startPaintMetrics(page);
          started = await page.evaluate(() => {
            const started = performance.now();
            window.progressSamples = [];
            window.postMessage({ kind: "performWebviewAction", payload: { action: "expandAll" } }, location.origin);
            return started;
          });
          await settled(page, entry.files.length, true);
          const progress = await page.evaluate(
            ({ started, count }) => {
              const samples = window.progressSamples;
              window.progressSamples = undefined;
              const partial = samples.filter((sample) => sample.rendered > 1 && sample.rendered < count);
              return {
                partialProgressFrames: partial.length,
                firstProgressMs: partial.length ? +(partial[0].time - started).toFixed(1) : null,
              };
            },
            { started, count: entry.files.length },
          );
          result.expandAll = { ...(await measurement(page, started)), ...progress, paint: await finishPaint() };
        } else result.verticalScroll = await verticalScroll(page);
        const invalidated = await page.evaluate(async () => {
          const started = performance.now();
          window.postMessage({ kind: "invalidate", payload: { renderId: 2 } }, location.origin);
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const container = document.getElementById("diff-container");
          return {
            milliseconds: +(performance.now() - started).toFixed(1),
            staleContentVisible: container.checkVisibility() && !!container.querySelector(".d2h-file-wrapper"),
            rows: container.querySelectorAll(".d2h-code-line-ctn").length,
          };
        });
        result.invalidate = invalidated;
        if (expectLazy)
          assert.equal(invalidated.staleContentVisible, false, "Obsolete source must disappear on invalidation");
        assert.deepEqual(errors, []);
        results.push(result);
        fs.writeFileSync(
          path.join(output, "large-diff-results.json"),
          JSON.stringify(
            {
              mode: "headless-chromium-webview-only",
              browser: browser.version(),
              webviewSha256: createHash("sha256")
                .update(fs.readFileSync(path.join(assets, "dist/webview.js")))
                .digest("hex"),
              results,
            },
            null,
            2,
          ),
        );
        console.log(JSON.stringify(result));
        await page.close();
      }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error.message);
  server.close();
  process.exitCode = 1;
});

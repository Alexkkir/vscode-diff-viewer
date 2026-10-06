// Validate continuous gap pixels with the real renderer/CSS. Run after build:prod: node integration/browser/diagonal-fill.cjs [artifact-directory]
// Serves the real webview bundle/skeleton on loopback with the VS Code API mocked.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");
const { PNG } = require(path.join(path.dirname(require.resolve("playwright-core/package.json")), "lib/utilsBundle.js"));
require("./load-typescript.cjs");
const { parseDiff } = require("../../src/shared/diff.ts");

const root = path.resolve(__dirname, "../..");
const artifactDirectory = path.resolve(process.argv[2] || "/tmp/diff-viewer-diagonal-fill");
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

const patch = ["+", "-"]
  .map((sign, i) =>
    [
      `--- sample${i}.py`,
      `+++ sample${i}.py`,
      sign === "+" ? "@@ -1,4 +1,64 @@" : "@@ -1,64 +1,4 @@",
      " # heading",
      " ",
      ...Array.from({ length: 60 }, (_, n) => sign + (n % 10 ? `value_${n} = ${n} # ` + "wide ".repeat(40) : "")),
      " ",
      " # end",
      "",
    ].join("\n"),
  )
  .join("\n");
const server = http.createServer((request, response) => {
  if (request.url === "/") {
    response.setHeader("content-type", "text/html");
    response.end(html);
  } else if (/^\/(?:styles\/[a-z0-9@.\-]+\.css|dist\/webview\.js)$/.test(request.url)) {
    response.setHeader("content-type", request.url.endsWith(".css") ? "text/css" : "application/javascript");
    response.end(
      fs.readFileSync(
        request.url === "/styles/diff2html-tweaks.css" && process.env.DIFF_DIAGONAL_BASELINE_CSS
          ? process.env.DIFF_DIAGONAL_BASELINE_CSS
          : path.join(root, request.url),
      ),
    );
  } else {
    response.statusCode = 404;
    response.end();
  }
});
function pixels(buffer) {
  return PNG.sync.read(buffer);
}
function pixelErrors(actual, expected) {
  const a = pixels(actual),
    b = pixels(expected);
  assert.equal(a.width, b.width);
  assert.equal(a.height, b.height);
  let errors = 0,
    total = a.width * a.height;
  for (let i = 0; i < a.data.length; i += 4) {
    if (Math.max(...[0, 1, 2].map((c) => Math.abs(a.data[i + c] - b.data[i + c]))) > 5) errors++;
  }
  return { errors, total, fraction: errors / total };
}
(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const theme of ["dark", "light"])
      for (const [font, zoom, dpr] of [
        [14, 1, 1],
        [13, 1, 2],
        [17.5, 1.25, 2],
        [20, 0.8, 1],
      ]) {
        const page = await browser.newPage({ viewport: { width: 1300, height: 750 }, deviceScaleFactor: dpr });
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.evaluate(
          ({ theme, font, zoom, files }) => {
            document.body.className = `vscode-${theme}`;
            document.body.style.zoom = zoom;
            document.documentElement.style.setProperty("--vscode-editor-font-size", `${font}px`);
            if (theme === "light") {
              document.documentElement.style.setProperty("--vscode-editor-background", "#fff");
              document.documentElement.style.setProperty("--vscode-editor-foreground", "#333");
            }
            window.postMessage(
              {
                kind: "updateWebview",
                payload: {
                  config: {
                    globalScrollbar: true,
                    diff2html: {
                      outputFormat: "side-by-side",
                      drawFileList: false,
                      matching: "none",
                      colorScheme: theme,
                    },
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
          { theme, font, zoom, files: parseDiff(patch) },
        );
        await page.waitForSelector("td.d2h-emptyplaceholder:not(.d2h-code-side-linenumber)");
        // Sample actual pixels in blank source rows: no stripes, and diff tint is preserved.
        for (const name of ["d2h-ins", "d2h-del", "d2h-cntx"]) {
          const clip = await page.evaluate((name) => {
            const cell = Array.from(document.querySelectorAll(`td.${name}:not(.d2h-code-side-linenumber)`)).find(
              (td) => td.querySelector(".d2h-code-line-ctn")?.textContent === "",
            );
            cell.scrollIntoView({ block: "center" });
            const r = cell.getBoundingClientRect(),
              p = cell.closest(".d2h-file-side-diff").getBoundingClientRect();
            return { x: Math.ceil(p.x + 180), y: Math.ceil(r.y) + 3, width: 40, height: 8 };
          }, name);
          const { data } = pixels(await page.screenshot({ clip }));
          const base = theme === "dark" ? 30 : 255;
          const tint = name === "d2h-ins" ? [155, 185, 85] : name === "d2h-del" ? [255, 0, 0] : [base, base, base];
          const expected = tint.map((c) => (name === "d2h-cntx" ? base : Math.round(0.2 * c + 0.8 * base)));
          for (let i = 0; i < data.length; i += 4)
            for (let c = 0; c < 3; c++)
              assert(Math.abs(data[i + c] - expected[c]) <= 2, `${name} lost its tint or shows stripes`);
        }
        for (const file of [0, 1])
          for (const scrolled of [false, true]) {
            const sample = await page.evaluate(
              ({ file, scrolled }) => {
                const wrapper = document.querySelectorAll(".d2h-file-wrapper")[file];
                const gaps = wrapper.querySelectorAll("td.d2h-emptyplaceholder:not(.d2h-code-side-linenumber)");
                const target = gaps[scrolled ? 20 : 0];
                target.scrollIntoView({ block: "center" });
                wrapper.querySelectorAll(".d2h-file-side-diff").forEach((p) => (p.scrollLeft = scrolled ? 173 : 0));
                const rect = target.getBoundingClientRect();
                const pane = target.closest(".d2h-file-side-diff").getBoundingClientRect();
                const clip = { x: Math.ceil(pane.x + 180), y: Math.ceil(rect.y) + 3, width: 80, height: 150 };
                const blank = Array.from(wrapper.querySelectorAll("td.d2h-cntx,td.d2h-ins,td.d2h-del"))
                  .filter((td) => !td.matches(".d2h-code-side-linenumber"))
                  .find((td) => td.querySelector(".d2h-code-line-ctn")?.textContent === "");
                return {
                  clip,
                  attachment: getComputedStyle(target.closest("table")).backgroundAttachment,
                  blankOpaque: blank && getComputedStyle(blank).backgroundColor !== "rgba(0, 0, 0, 0)",
                };
              },
              { file, scrolled },
            );
            await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
            const buffer = await page.screenshot({ clip: sample.clip });
            await page.evaluate(
              ({ file }) => {
                const table = document
                  .querySelectorAll(".d2h-file-wrapper")
                  [file].querySelector("td.d2h-emptyplaceholder:not(.d2h-code-side-linenumber)")
                  .closest("table");
                table.style.position = "relative";
                const reference = document.createElement("div");
                reference.id = "stripe-reference";
                reference.style.cssText = `position:absolute;inset:0;pointer-events:none;z-index:10;
            background-color:var(--vscode-editor-background);
            background-image:linear-gradient(-45deg,var(--vscode-diffEditor-diagonalFill,#80808055) 12.5%,transparent 12.5%,transparent 50%,var(--vscode-diffEditor-diagonalFill,#80808055) 50%,var(--vscode-diffEditor-diagonalFill,#80808055) 62.5%,transparent 62.5%,transparent 100%);
            background-size:8px 8px;`;
                table.append(reference);
              },
              { file },
            );
            const reference = await page.screenshot({ clip: sample.clip });
            await page.evaluate(() => {
              const ref = document.getElementById("stripe-reference");
              ref.parentElement.style.position = "";
              ref.remove();
            });
            const continuity = pixelErrors(buffer, reference);
            if (continuity.fraction >= 0.005) {
              fs.writeFileSync(path.join(artifactDirectory, "failure.png"), buffer);
              await page.screenshot({ path: path.join(artifactDirectory, "failure-full.png") });
            }
            results.push({ theme, font, zoom, dpr, file, scrolled, ...continuity });
            // Compare the actual gaps against one uninterrupted reference surface.
            // Pixel sampling also works at fractional zoom where diagonal aliasing varies.
            assert(continuity.fraction < 0.005, JSON.stringify(results.at(-1)));
            assert.equal(sample.attachment, "scroll");
            assert(sample.blankOpaque, "Blank source line must cover stripes");
          }
        await page.evaluate(() => {
          window.scrollTo(0, 0);
          document.querySelectorAll(".d2h-file-side-diff").forEach((p) => (p.scrollLeft = 0));
        });
        if (font === 14) await page.screenshot({ path: path.join(artifactDirectory, `${theme}.png`) });
        assert.deepEqual(errors, []);
        await page.close();
      }
    fs.writeFileSync(path.join(artifactDirectory, "results.json"), JSON.stringify(results, null, 2) + "\n");
    console.log(
      `PASS: ${results.length} diagonal continuity checks at multiple fonts/zoom/DPR, both themes and gap sides`,
    );
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  server.close();
});

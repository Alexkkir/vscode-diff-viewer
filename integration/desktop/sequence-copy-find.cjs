// Reproduction probes use real input and real extension messages in a disposable desktop profile.
const vscode = require("vscode");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { chromium } = require("playwright");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

exports.run = async () => {
  const output = process.env.DIFF_SEQUENCE_OUTPUT;
  fs.mkdirSync(output, { recursive: true });
  const workspace = vscode.workspace.workspaceFolders[0].uri.fsPath;
  assert.equal(workspace, process.env.DIFF_SEQUENCE_WORKSPACE);
  const originalClipboard = await vscode.env.clipboard.readText();
  const root = path.resolve(__dirname, "../..");
  // The remaining keyboard-menu probes are opt-in: Chromium on macOS does not
  // synthesize contextmenu from Shift+F10, so they are not regression contracts.
  const filter = process.env.DIFF_SEQUENCE_ONLY || "find-active|semantic";
  const report = {
    version: JSON.parse(fs.readFileSync(path.join(root, "package.json"))).version,
    build: Object.fromEntries(
      ["extension", "webview"].map((key) => [
        key,
        createHash("sha256")
          .update(fs.readFileSync(path.join(root, `dist/${key}.js`)))
          .digest("hex"),
      ]),
    ),
    vscode: vscode.version,
    filter,
    results: [],
  };
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.DIFF_SEQUENCE_PORT}`);
  const page = browser
    .contexts()
    .flatMap((c) => c.pages())
    .find((p) => /workbench/.test(p.url()));
  assert.ok(page);
  page.setDefaultTimeout(3500);
  let frame;
  let releaseSemantic;
  let semanticCalls = 0;
  let provider;
  const cmd = async (name, ...args) => vscode.commands.executeCommand(name, ...args);
  const config = async (key, value) =>
    vscode.workspace.getConfiguration("diffviewer").update(key, value, vscode.ConfigurationTarget.Global);
  async function until(check, label, attempts = 100) {
    for (let i = 0; i < attempts; i++) {
      const value = await check();
      if (value) return value;
      await wait(60);
    }
    throw new Error("Timed out: " + label);
  }
  async function activeFrame() {
    return until(async () => {
      for (const candidate of page.frames()) {
        try {
          if (await candidate.locator(".d2h-file-wrapper").first().isVisible()) {
            frame = candidate;
            return frame;
          }
        } catch {}
      }
    }, "active webview");
  }
  async function open(file) {
    await cmd("vscode.openWith", vscode.Uri.file(file), "diffViewer");
    await activeFrame();
  }
  async function trace() {
    await frame.evaluate(() => {
      window.__sequenceTrace = [];
      for (const type of ["pointerdown", "contextmenu", "keydown", "selectionchange", "blur"]) {
        document.addEventListener(
          type,
          (event) =>
            window.__sequenceTrace.push({
              type,
              key: event.key,
              button: event.button,
              target: event.target?.tagName,
              selection: getSelection()?.toString(),
              bodyContext: document.body.dataset.vscodeContext,
              containerContext: document.querySelector("#diff-container")?.dataset.vscodeContext,
              time: performance.now(),
            }),
          true,
        );
      }
      window.addEventListener("message", (event) => {
        if (["performWebviewAction", "updateWebview", "updateSyntax"].includes(event.data?.kind))
          window.__sequenceTrace.push({
            type: "message",
            kind: event.data.kind,
            time: performance.now(),
            selection: getSelection()?.toString(),
          });
      });
    });
  }
  async function snapshot() {
    return frame.evaluate(() => ({
      selection: getSelection()?.toString(),
      active: document.activeElement?.outerHTML.slice(0, 450),
      bodyContext: document.body.dataset.vscodeContext,
      containerContext: document.querySelector("#diff-container")?.dataset.vscodeContext,
      events: window.__sequenceTrace,
    }));
  }
  async function menuLabels() {
    await wait(180);
    return page
      .locator('[role="menuitem"]')
      .evaluateAll((els) => els.map((el) => ({ text: el.textContent, disabled: el.getAttribute("aria-disabled") })));
  }
  const line = (text) => frame.locator(".d2h-code-line-ctn").filter({ hasText: text }).first();
  async function probe(name, fn) {
    if (!new RegExp(filter).test(name)) return;
    const result = { name };
    report.results.push(result);
    try {
      await fn(result);
      result.status = "pass";
    } catch (error) {
      result.status = "fail";
      result.error = String(error);
      await page.screenshot({ path: path.join(output, name + ".png") }).catch(() => {});
    }
    result.state = await snapshot().catch(() => ({}));
    console.log("SEQUENCE", JSON.stringify(result));
    await page.keyboard.press("Escape");
    await frame
      ?.locator('#diff-find-widget button[aria-label="Close find"]')
      .click({ timeout: 200 })
      .catch(() => {});
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  }
  const lines = Array.from({ length: 160 }, (_, i) => `line_${String(i).padStart(3, "0")} = ${i}`);
  const patch = [
    "--- a/sample.py",
    "+++ b/sample.py",
    "@@ -1,163 +1,163 @@",
    "-old_alpha = 0",
    "+Alpha = 2",
    ...lines.map((text) => " " + text),
    "-old_beta = 3",
    "+Beta = 4",
    " trailing = 0",
    "--- a/second.py",
    "+++ b/second.py",
    "@@ -1 +1 @@",
    "-second = 1",
    "+second = 2",
    "",
  ].join("\n");
  const diff = path.join(workspace, "sample.diff");
  fs.writeFileSync(diff, patch);
  fs.writeFileSync(
    path.join(workspace, "sample.py"),
    ["Alpha = 2", ...lines, "Beta = 4", "trailing = 0", ""].join("\n"),
  );
  fs.writeFileSync(path.join(workspace, "second.py"), "second = 2\n");
  try {
    await vscode.workspace.getConfiguration("window").update("menuStyle", "custom", vscode.ConfigurationTarget.Global);
    await config("outputFormat", "line-by-line");
    await config("arcMode", false);
    await cmd("workbench.action.closeAllEditors");
    await cmd("workbench.action.closeSidebar");
    await cmd("workbench.action.closeAuxiliaryBar");
    await cmd("notifications.clearAll");
    await open(diff);
    await wait(300);
    await trace();
    await probe("keyboard-menu-selected-code", async (r) => {
      await line("Alpha = 2").click({ clickCount: 3 });
      await wait(100);
      r.selected = await frame.evaluate(() => getSelection()?.toString());
      assert.ok(r.selected.includes("Alpha = 2"));
      await vscode.env.clipboard.writeText("sequence sentinel");
      await page.keyboard.press("Shift+F10");
      r.menu = await menuLabels();
      r.beforeCopy = await snapshot();
      assert.ok(
        r.menu.some((m) => m.text.startsWith("Copy selected text") && m.disabled !== "true"),
        "keyboard menu must offer enabled Copy selected text",
      );
      await page.getByRole("menuitem", { name: "Copy selected text", exact: true }).click();
      await wait(200);
      r.copied = await vscode.env.clipboard.readText();
      assert.equal(r.copied, r.selected);
    });
    await probe("cancel-menu-update-keyboard-menu", async (r) => {
      await line("Alpha = 2").click({ clickCount: 3 });
      await wait(80);
      r.selected = await frame.evaluate(() => getSelection()?.toString());
      await line("Alpha = 2").click({ button: "right" });
      r.firstMenu = await menuLabels();
      await page.keyboard.press("Escape");
      fs.writeFileSync(diff, patch.replace("+Alpha = 2", "+Gamma = 9"));
      await until(() => line("Gamma = 9").isVisible(), "external diff refresh");
      await wait(80);
      r.afterUpdate = await snapshot();
      await vscode.env.clipboard.writeText("sequence sentinel");
      await page.keyboard.press("Shift+F10");
      r.menu = await menuLabels();
      if (r.menu.some((m) => m.text.startsWith("Copy selected text") && m.disabled !== "true")) {
        await page.getByRole("menuitem", { name: "Copy selected text", exact: true }).click();
        await wait(200);
      }
      r.copied = await vscode.env.clipboard.readText();
      assert.equal(r.copied, "sequence sentinel", "cancelled menu must not retain removed code as current selection");
      fs.writeFileSync(diff, patch);
      await until(() => line("Alpha = 2").isVisible(), "fixture restored");
    });
    await probe("find-active-match-after-layout-config", async (r) => {
      const denseDiff = path.join(workspace, "dense.diff");
      const dense = [];
      for (let i = 0; i < 401; i++) dense.push(`-old_value_${i} = 0`, i === 200 ? "+Beta = 4" : `+new_value_${i} = 1`);
      fs.writeFileSync(denseDiff, ["--- a/dense.py", "+++ b/dense.py", "@@ -1,401 +1,401 @@", ...dense, ""].join("\n"));
      await cmd("workbench.action.closeAllEditors");
      await config("outputFormat", "line-by-line");
      await open(denseDiff);
      await trace();
      await cmd("diffviewer.find");
      const input = frame.getByRole("textbox", { name: "Find in diff" });
      await input.fill("Beta = 4");
      await wait(120);
      const geometry = () =>
        frame.evaluate(() => {
          const range = [...CSS.highlights.get("diff-find-current")][0];
          const rect = range?.getBoundingClientRect();
          const headers = [
            ...document.querySelectorAll(".d2h-file-header,#viewed-progress-container,#diff-find-widget"),
          ].map((el) => ({
            cls: el.className,
            id: el.id,
            top: el.getBoundingClientRect().top,
            bottom: el.getBoundingClientRect().bottom,
          }));
          return {
            count: document.querySelector("#diff-find-widget span")?.textContent,
            y: rect?.y,
            bottom: rect?.bottom,
            height: innerHeight,
            scrollY,
            headers,
          };
        });
      r.before = await geometry();
      await cmd("diffviewer.showSideBySide");
      await until(async () => (await frame.locator(".d2h-file-side-diff").count()) > 0, "layout redraw");
      await wait(100);
      r.after = await geometry();
      assert.ok(
        r.after.y >= 35 && r.after.bottom <= r.after.height,
        "active Find match must remain visible after layout redraw",
      );
    });
    await probe("semantic-enrichment-preserves-selection", async (r) => {
      await cmd("workbench.action.closeAllEditors");
      await config("outputFormat", "line-by-line");
      await vscode.workspace
        .getConfiguration("editor")
        .update("semanticHighlighting.enabled", true, vscode.ConfigurationTarget.Global);
      await vscode.workspace
        .getConfiguration("editor")
        .update(
          "semanticTokenColorCustomizations",
          { enabled: true, rules: { variable: "#123456" } },
          vscode.ConfigurationTarget.Global,
        );
      const semanticFile = path.join(workspace, "semantic.py");
      const semanticDiff = path.join(workspace, "semantic.diff");
      fs.writeFileSync(semanticFile, "selected_token = 12\n");
      fs.writeFileSync(
        semanticDiff,
        "--- a/semantic.py\n+++ b/semantic.py\n@@ -1 +1 @@\n-old_token = 10\n+selected_token = 12\n",
      );
      provider = vscode.languages.registerDocumentSemanticTokensProvider(
        { language: "python", scheme: "file", pattern: "**/semantic.py" },
        {
          async provideDocumentSemanticTokens() {
            semanticCalls++;
            await new Promise((resolve) => {
              releaseSemantic = resolve;
            });
            return new vscode.SemanticTokens(new Uint32Array([0, 0, 14, 0, 0]));
          },
        },
        new vscode.SemanticTokensLegend(["variable"], []),
      );
      await open(semanticDiff);
      await trace();
      await line("selected_token = 12").click({ clickCount: 3 });
      r.before = await snapshot();
      r.semanticCalls = semanticCalls;
      assert.ok(r.before.selection.includes("selected_token = 12"), "real triple click selects the source line");
      assert.ok(releaseSemantic, "real semantic provider must be pending");
      releaseSemantic();
      await until(
        async () => (await line("selected_token = 12").innerHTML()).includes("rgb(18, 52, 86)"),
        "semantic color delivered",
        30,
      );
      r.after = await snapshot();
      r.html = await line("selected_token = 12").innerHTML();
      await vscode.env.clipboard.writeText("semantic sentinel");
      await page.keyboard.press(process.platform === "darwin" ? "Meta+c" : "Control+c");
      await wait(150);
      r.copied = await vscode.env.clipboard.readText();
      assert.equal(r.after.selection, r.before.selection, "late semantic enrichment must preserve selected text");
      assert.equal(r.copied, r.before.selection);
    });
  } finally {
    releaseSemantic?.();
    provider?.dispose();
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    await cmd("workbench.action.closeAllEditors");
    await browser.close();
    await vscode.env.clipboard.writeText(originalClipboard);
  }
  console.log("Sequence audit report:", path.join(output, "report.json"));
  assert.equal(
    report.results.filter((result) => result.status === "fail").length,
    0,
    "Sequential UI contracts must pass",
  );
};

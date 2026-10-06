// Real clicks, keyboard input, clipboard and context menus in an isolated VS Code.
// Run via: node scripts/test-ui-controls-desktop.mjs (after npm run build:dev).
const vscode = require("vscode");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { createHash } = require("node:crypto");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

exports.run = async () => {
  const output = process.env.DIFF_UI_AUDIT_OUTPUT;
  fs.mkdirSync(output, { recursive: true });
  const fixture = vscode.workspace.workspaceFolders[0].uri.fsPath;
  assert.equal(fixture, process.env.DIFF_UI_WORKSPACE, "Only run against the disposable launcher workspace");
  const originalClipboard = await vscode.env.clipboard.readText();
  const bundleRoot = path.resolve(__dirname, "../..");
  const report = {
    build: {
      version: JSON.parse(fs.readFileSync(path.join(bundleRoot, "package.json"), "utf8")).version,
      extensionSha256: createHash("sha256")
        .update(fs.readFileSync(path.join(bundleRoot, "dist/extension.js")))
        .digest("hex"),
      webviewSha256: createHash("sha256")
        .update(fs.readFileSync(path.join(bundleRoot, "dist/webview.js")))
        .digest("hex"),
    },
    filter: process.env.DIFF_UI_ONLY || null,
    vscode: vscode.version,
    phase: process.env.DIFF_UI_AUDIT_PHASE || "audit",
    observations: [],
    results: [],
  };
  const longLine = 'wide_example = "' + "0123456789".repeat(100) + '"';
  const context = (prefix, n) =>
    Array.from({ length: n }, (_, i) => `${prefix}_${String(i + 1).padStart(3, "0")} = ${i + 1}`);
  const lead = context("leading", 75),
    mid = context("middle", 135),
    tail = context("trailing", 63);
  fs.mkdirSync(path.join(fixture, "src"), { recursive: true });
  const content = [...lead, "Alpha = 2", ...mid, "alpha = 4", ...tail, longLine].join("\n");
  fs.writeFileSync(path.join(fixture, "src/example.py"), content);
  fs.writeFileSync(path.join(fixture, "second.py"), "second = 2\n");
  const patch = [
    "diff --git a/src/example.py b/src/example.py",
    "--- a/src/example.py",
    "+++ b/src/example.py",
    "@@ -1,276 +1,276 @@",
    ...lead.map((l) => " " + l),
    "-old_first_value = 1",
    "+Alpha = 2",
    ...mid.map((l) => " " + l),
    "-old_second_value = 3",
    "+alpha = 4",
    ...tail.map((l) => " " + l),
    " " + longLine,
    "diff --git a/second.py b/second.py",
    "--- a/second.py",
    "+++ b/second.py",
    "@@ -1 +1 @@",
    "-second = 1",
    "+second = 2",
    "",
  ].join("\n");
  const diffPath = path.join(fixture, "sample.diff");
  fs.writeFileSync(diffPath, patch);
  const config = vscode.workspace.getConfiguration("diffviewer");
  const saved = Object.fromEntries(
    ["outputFormat", "drawFileList", "globalScrollbar", "arcMode"].map((k) => [k, config.inspect(k)?.globalValue]),
  );
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.DIFF_UI_CDP_PORT || 9345}`);
  const page = browser
    .contexts()
    .flatMap((c) => c.pages())
    .find((p) => /workbench/.test(p.url()));
  assert.ok(page, "isolated VS Code workbench must exist");
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  let frame;
  async function activeFrame(selector = ".d2h-file-wrapper") {
    for (let i = 0; i < 100; i++) {
      for (const candidate of page.frames()) {
        try {
          if ((await candidate.locator(selector).count()) && (await candidate.locator(selector).first().isVisible())) {
            frame = candidate;
            return frame;
          }
        } catch {}
      }
      await wait(100);
    }
    throw new Error(
      "Diff Viewer frame not found: " +
        page
          .frames()
          .map((f) => f.url())
          .join("\n"),
    );
  }
  async function settle() {
    await wait(180);
  }
  async function reopen() {
    await vscode.commands.executeCommand("vscode.openWith", vscode.Uri.file(diffPath), "diffViewer");
    await activeFrame();
    await settle();
  }
  async function until(check, label) {
    for (let i = 0; i < 60; i++) {
      const value = await check();
      if (value) return value;
      await wait(100);
    }
    throw new Error("Timed out: " + label);
  }
  async function clickToolbar(label) {
    const button = page.locator(`[aria-label^="${label}"]`).first();
    await button.click();
    await settle();
  }
  const wrappers = () => frame.locator(".d2h-file-wrapper");
  const state = () =>
    frame.evaluate(() => ({
      names: [...document.querySelectorAll(".d2h-file-header .d2h-file-name")].map((x) => x.textContent),
      controls: [...document.querySelectorAll("button,input,a[href]")].map((x) => ({
        tag: x.tagName,
        text: x.textContent,
        aria: x.getAttribute("aria-label"),
        title: x.title,
        id: x.id,
        cls: x.className,
        href: x.getAttribute("href"),
      })),
      header: document.querySelector(".d2h-file-header")?.outerHTML,
      selection: getSelection()?.toString(),
    }));
  async function probe(name, work) {
    if (process.env.DIFF_UI_ONLY && !new RegExp(process.env.DIFF_UI_ONLY).test(name)) return;
    try {
      const evidence = await work();
      report.results.push({ name, status: "pass", evidence });
      console.log("UI PASS", name, JSON.stringify(evidence));
    } catch (e) {
      report.results.push({ name, status: "fail", error: e.stack || String(e) });
      console.error("UI FAIL", name, String(e));
      await page.screenshot({ path: path.join(output, name.replace(/[^a-z0-9]+/gi, "-") + ".png") }).catch(() => {});
      await page.keyboard.press("Escape").catch(() => {});
      if (
        frame &&
        (await frame
          .locator("#diff-find-widget")
          .isVisible()
          .catch(() => false))
      )
        await frame
          .getByRole("button", { name: "Close find" })
          .click()
          .catch(() => {});
    }
  }
  async function contextMenu(locator) {
    await locator.click({ button: "right" });
    await wait(300);
    const menus = await page.locator(".context-view").allTextContents();
    const labels = await page.locator('[role="menuitem"]').allTextContents();
    return { menus, labels };
  }
  try {
    await vscode.workspace.getConfiguration("window").update("menuStyle", "custom", vscode.ConfigurationTarget.Global);
    for (const [k, v] of Object.entries({
      outputFormat: "line-by-line",
      drawFileList: true,
      globalScrollbar: false,
      arcMode: false,
    }))
      await vscode.workspace.getConfiguration("diffviewer").update(k, v, vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await vscode.commands.executeCommand("workbench.action.closeSidebar");
    await vscode.commands.executeCommand("notifications.clearAll");
    await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");
    await vscode.commands.executeCommand("vscode.openWith", vscode.Uri.file(diffPath), "diffViewer");
    await activeFrame();
    await settle();
    report.observations.push(await state());
    report.observations.push({
      workbenchControls: await page
        .locator(".editor-actions [aria-label]")
        .evaluateAll((items) =>
          items.map((x) => ({ role: x.getAttribute("role"), aria: x.getAttribute("aria-label") })),
        ),
    });
    const name = frame.locator(".d2h-file-header .d2h-file-name").first();
    await probe("filename-selection-copy", async () => {
      await vscode.env.clipboard.writeText("selection sentinel");
      await name.click({ clickCount: 3 });
      await settle();
      const selected = await frame.evaluate(() => getSelection()?.toString());
      await page.keyboard.press(process.platform === "darwin" ? "Meta+c" : "Control+c");
      await settle();
      const copied = await vscode.env.clipboard.readText();
      const computed = await name.evaluate((el) => ({
        userSelect: getComputedStyle(el).userSelect,
        parentUserSelect: getComputedStyle(el.parentElement).userSelect,
      }));
      report.observations.push({ filenameSelection: { selected, copied, computed } });
      assert.ok(selected?.includes("src/example.py"), "real triple click must select file path");
      assert.ok(copied.includes("src/example.py"), "native copy keyboard must reach OS clipboard");
      assert.ok(await name.isVisible(), "triple click must keep diff visible");
      return { selected, copied, computed };
    });
    await probe("filename-context-menu", async () => {
      await reopen();
      const menu = await contextMenu(frame.locator(".d2h-file-header .d2h-file-name").first());
      report.observations.push({ filenameMenu: menu });
      await page.screenshot({ path: path.join(output, "filename-context-menu.png") });
      await page.keyboard.press("Escape");
      assert.ok(menu.labels.length, "real context menu must be visible");
      assert.ok(!menu.labels.some((x) => /^(Cut|Paste)/.test(x)), "read-only filename must not offer Cut or Paste");
      return menu;
    });
    await probe("code-context-menu", async () => {
      await reopen();
      const menu = await contextMenu(frame.locator(".d2h-code-line-ctn").filter({ hasText: "Alpha = 2" }).first());
      report.observations.push({ codeMenu: menu });
      await page.keyboard.press("Escape");
      assert.ok(menu.labels.length, "real context menu must be visible");
      assert.ok(!menu.labels.some((x) => /^(Cut|Paste)/.test(x)), "read-only code must not offer Cut or Paste");
      return menu;
    });
    await probe("copy-path-button", async () => {
      await reopen();
      await vscode.env.clipboard.writeText("button sentinel");
      await frame.locator("button.diff-viewer-copy-path").first().click();
      await until(async () => (await vscode.env.clipboard.readText()) === "src/example.py", "copy button clipboard");
      assert.ok(await name.isVisible(), "copy button must keep diff visible");
      return { clipboard: await vscode.env.clipboard.readText() };
    });
    await probe("filename-drag-copy", async () => {
      await reopen();
      const target = frame.locator(".d2h-file-header .d2h-file-name").first();
      await target.scrollIntoViewIfNeeded();
      const box = await target.boundingBox();
      await page.mouse.move(box.x + 1, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 12 });
      await page.mouse.up();
      const selected = await frame.evaluate(() => getSelection()?.toString());
      await page.keyboard.press(process.platform === "darwin" ? "Meta+c" : "Control+c");
      await settle();
      const copied = await vscode.env.clipboard.readText();
      assert.ok(selected.includes("src/example.py"), "drag selects full filename");
      assert.equal(copied, selected);
      assert.ok(await target.isVisible(), "drag must not open source");
      return { selected, copied };
    });
    await probe("filename-context-copy-path-and-name", async () => {
      const copied = {};
      for (const label of ["Copy file path", "Copy file name"]) {
        await reopen();
        const menu = await contextMenu(frame.locator(".d2h-file-header .d2h-file-name").first());
        assert.ok(
          menu.labels.some((x) => x.startsWith(label)),
          label + " present",
        );
        await vscode.env.clipboard.writeText("context sentinel");
        await page.getByRole("menuitem", { name: label, exact: true }).click();
        await until(
          async () =>
            (await vscode.env.clipboard.readText()) === (label === "Copy file path" ? "src/example.py" : "example.py"),
          label + " clipboard",
        );
        copied[label] = await vscode.env.clipboard.readText();
      }
      return copied;
    });
    await probe("code-selection-context-copy", async () => {
      await reopen();
      if (process.env.DIFF_UI_EVENT_TRACE)
        await frame.evaluate(() => {
          window.__copyEvents = [];
          const record = (event, scope) =>
            window.__copyEvents.push({
              type: event.type,
              scope,
              button: event.button,
              selection: getSelection()?.toString(),
              data: event.type === "message" ? event.data : undefined,
            });
          for (const type of ["selectionchange", "pointerdown", "mousedown", "mouseup", "contextmenu", "blur"]) {
            document.addEventListener(type, (event) => record(event, "document"), true);
            document
              .getElementById("diff-container")
              .addEventListener(type, (event) => record(event, "container"), true);
          }
          window.addEventListener("message", (event) => {
            if (event.data?.kind === "performWebviewAction") record(event, "window");
          });
        });
      const line = frame.locator(".d2h-code-line-ctn").filter({ hasText: "Alpha = 2" }).first();
      await line.click({ clickCount: 3 });
      await settle();
      const selected = await frame.evaluate(() => getSelection()?.toString());
      assert.ok(selected.includes("Alpha = 2"));
      const menu = await contextMenu(line);
      assert.ok(menu.labels.some((x) => x.startsWith("Copy selected text")));
      await vscode.env.clipboard.writeText("code sentinel");
      const selectedInMenu = await frame.evaluate(() => getSelection()?.toString());
      await page.getByRole("menuitem", { name: "Copy selected text", exact: true }).click();
      await settle();
      const copied = await vscode.env.clipboard.readText();
      const selectionAfter = await frame.evaluate(() => getSelection()?.toString());
      const events = process.env.DIFF_UI_EVENT_TRACE ? await frame.evaluate(() => window.__copyEvents) : undefined;
      report.observations.push({ contextCopyDebug: { selected, selectedInMenu, copied, selectionAfter, events } });
      if (events) console.log("UI COPY EVENTS", JSON.stringify(events));
      console.log("UI COPY DEBUG", JSON.stringify({ selected, selectedInMenu, copied, selectionAfter }));
      await until(async () => (await vscode.env.clipboard.readText()) === selected, "code context clipboard");
      return { selected, clipboard: await vscode.env.clipboard.readText() };
    });
    await probe("summary-show-hide-and-anchor", async () => {
      await reopen();
      if (await frame.locator(".d2h-file-switch.d2h-show").isVisible())
        await frame.locator(".d2h-file-switch.d2h-show").click();
      assert.equal(await frame.locator(".d2h-file-list").isVisible(), true);
      await frame.locator(".d2h-file-switch.d2h-hide").click();
      assert.equal(await frame.locator(".d2h-file-list").isVisible(), false);
      await frame.locator(".d2h-file-switch.d2h-show").click();
      await frame.locator(".d2h-file-list a").filter({ hasText: "second.py" }).click();
      await settle();
      const box = await wrappers().nth(1).locator(".d2h-file-header").boundingBox();
      const viewport = await frame.evaluate(() => innerHeight);
      assert.ok(box && box.y >= 0 && box.y < viewport, "summary anchor reveals second file");
      return { target: "second.py", headerY: box.y };
    });
    await probe("viewed-toggle-and-footer-expand-all", async () => {
      await reopen();
      const toggle = wrappers().first().locator(".d2h-file-collapse-input");
      assert.equal(await toggle.isChecked(), false);
      await toggle.check();
      await settle();
      assert.equal(await wrappers().first().locator(".d2h-file-diff").isVisible(), false);
      assert.equal(await frame.locator("#viewed-indicator").textContent(), "1 / 2 files viewed");
      assert.equal(await frame.locator("#expand-all-toggle").evaluate((e) => e.indeterminate), true);
      await frame.locator("#expand-all-toggle").click();
      await settle();
      assert.equal(await wrappers().first().locator(".d2h-file-diff").isVisible(), true);
      assert.equal(await frame.locator("#viewed-indicator").textContent(), "0 / 2 files viewed");
      await frame.locator("#expand-all-toggle").click();
      await settle();
      assert.equal(await frame.locator("#viewed-indicator").textContent(), "2 / 2 files viewed");
      assert.equal(await frame.locator("#viewed-progress-container").evaluate((e) => e.value), 100);
      await frame.locator("#expand-all-toggle").click();
      await settle();
      assert.equal(await frame.locator("#viewed-indicator").textContent(), "0 / 2 files viewed");
      return { viewed: true, indeterminate: true, footerCollapseAndExpand: true };
    });
    await probe("syntax-toggle", async () => {
      const tokens = () => frame.locator('.diff-textmate-token, .d2h-code-line-ctn [class^="hljs-"]').count();
      await frame.locator("#syntax-highlighting-toggle").uncheck();
      assert.equal(await tokens(), 0);
      await frame.locator("#syntax-highlighting-toggle").check();
      const count = await until(async () => await tokens(), "highlight tokens");
      return { tokenCount: count };
    });
    await probe("find-all-controls-and-editable-context-menu", async () => {
      await clickToolbar("Find in diff");
      const widget = frame.locator("#diff-find-widget");
      const input = widget.getByRole("textbox", { name: "Find in diff" });
      const count = widget.locator("span");
      assert.ok(await widget.isVisible());
      await input.fill("alpha");
      assert.equal(await count.textContent(), "1 / 2");
      await widget.getByRole("button", { name: "Next match", exact: true }).click();
      assert.equal(await count.textContent(), "2 / 2");
      await widget.getByRole("button", { name: "Previous match", exact: true }).click();
      assert.equal(await count.textContent(), "1 / 2");
      await input.press("Enter");
      assert.equal(await count.textContent(), "2 / 2");
      await input.press("Shift+Enter");
      assert.equal(await count.textContent(), "1 / 2");
      await widget.getByRole("checkbox", { name: "Match case" }).check();
      assert.equal(await count.textContent(), "1 / 1");
      await widget.getByRole("checkbox", { name: "Match case" }).uncheck();
      assert.equal(await count.textContent(), "1 / 2");
      await input.fill("not-present-anywhere");
      assert.equal(await count.textContent(), "0 / 0");
      await widget.getByRole("button", { name: "Next match", exact: true }).click();
      assert.equal(await count.textContent(), "0 / 0");
      await input.fill("alpha");
      await input.press(process.platform === "darwin" ? "Meta+a" : "Control+a");
      const menu = await contextMenu(input);
      assert.ok(
        menu.labels.some((x) => x.startsWith("Cut")) && menu.labels.some((x) => x.startsWith("Paste")),
        "editable find menu retains Cut/Paste",
      );
      await page.locator('[role="menuitem"]').filter({ hasText: /^Cut/ }).click();
      await settle();
      assert.equal(await input.inputValue(), "");
      assert.equal(await vscode.env.clipboard.readText(), "alpha");
      await contextMenu(input);
      await page
        .locator('[role="menuitem"]')
        .filter({ hasText: /^Paste/ })
        .click();
      await settle();
      assert.equal(await input.inputValue(), "alpha");
      assert.equal(await count.textContent(), "1 / 2");
      await widget.getByRole("button", { name: "Close find" }).click();
      assert.equal(await widget.isVisible(), false);
      await frame.locator("#syntax-highlighting-toggle").click();
      await page.keyboard.press(process.platform === "darwin" ? "Meta+f" : "Control+f");
      await until(() => widget.isVisible(), "keyboard find opens");
      await input.press("Escape");
      assert.equal(await widget.isVisible(), false);
      return { matchCounts: ["1 / 2", "2 / 2", "1 / 1", "0 / 0"], keyboardOpenClose: true, editableMenu: menu.labels };
    });
    await probe("toolbar-collapse-and-expand-all", async () => {
      await clickToolbar("Collapse all files");
      assert.equal(await frame.locator("#viewed-indicator").textContent(), "2 / 2 files viewed");
      await clickToolbar("Expand all files");
      assert.equal(await frame.locator("#viewed-indicator").textContent(), "0 / 2 files viewed");
      return true;
    });
    for (const format of ["side-by-side", "line-by-line"]) {
      await probe("toolbar-layout-" + format, async () => {
        await clickToolbar(format === "side-by-side" ? "Show diff side by side" : "Show diff line by line");
        await until(
          async () =>
            format === "side-by-side"
              ? (await frame.locator(".d2h-file-side-diff").count()) > 0
              : (await frame.locator(".d2h-file-side-diff").count()) === 0,
          "layout changed",
        );
        return { format, panes: await frame.locator(".d2h-file-side-diff").count() };
      });
    }
    await probe("context-expansion-final-steps", async () => {
      const gap = (count) => frame.locator(`.diff-context-gap[data-hidden-lines="${count}"]`).first();
      await gap(25).locator('[data-context-direction="end"]').click();
      assert.equal(await gap(5).count(), 1);
      assert.match(await gap(5).textContent(), /Expand 5 lines above/);
      await gap(5).locator("button").click();
      assert.equal(await gap(5).count(), 0);
      await gap(35).locator('[data-context-direction="start"]').click();
      assert.equal(await gap(15).count(), 1);
      assert.match(await gap(15).textContent(), /Expand 15 lines above/);
      await gap(15).locator('[data-context-direction="end"]').click();
      await gap(14).locator('[data-context-direction="start"]').click();
      assert.equal(await frame.locator(".diff-context-gap").count(), 0);
      assert.equal(await frame.locator("tr.diff-context-hidden").count(), 0);
      return { steps: [20, 5, 20, 15, 14], remaining: 0 };
    });
    await probe("local-horizontal-scroll-wheel", async () => {
      await clickToolbar("Show diff side by side");
      await until(async () => (await frame.locator(".d2h-file-side-diff").count()) > 0, "side panes");
      const pane = frame.locator(".d2h-file-side-diff").first();
      await pane.locator(".d2h-code-line-ctn").last().scrollIntoViewIfNeeded();
      await pane.hover();
      await page.mouse.wheel(260, 0);
      await wait(350);
      const offsets = await frame.locator(".d2h-file-side-diff").evaluateAll((items) => items.map((x) => x.scrollLeft));
      assert.ok(offsets[0] > 0 && offsets[1] > 0, "horizontal wheel scrolls/synchronizes the two panes");
      assert.equal(offsets[2], 0, "other file stays at its local offset");
      return offsets;
    });
    await probe("global-scrollbar-track-drag-wheel", async () => {
      await vscode.workspace
        .getConfiguration("diffviewer")
        .update("globalScrollbar", true, vscode.ConfigurationTarget.Global);
      const bar = frame.locator("#horizontal-scrollbar-container");
      await until(() => bar.isVisible(), "global bar visible");
      const box = await bar.boundingBox();
      await bar.click({ position: { x: box.width - 2, y: box.height / 2 } });
      await settle();
      const limits = await frame
        .locator(".d2h-file-side-diff")
        .evaluateAll((items) => items.map((x) => ({ left: x.scrollLeft, max: x.scrollWidth - x.clientWidth })));
      assert.ok(limits[0].left > 0);
      assert.equal(limits[0].left, limits[0].max);
      const thumb = await frame.locator("#horizontal-scrollbar-content").boundingBox();
      await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + 5, thumb.y + thumb.height / 2, { steps: 8 });
      await page.mouse.up();
      await settle();
      const afterDrag = await frame
        .locator(".d2h-file-side-diff")
        .evaluateAll((items) => items.map((x) => x.scrollLeft));
      assert.equal(afterDrag[0], 0);
      await bar.hover();
      await page.mouse.wheel(180, 0);
      await settle();
      const afterWheel = await frame
        .locator(".d2h-file-side-diff")
        .evaluateAll((items) => items.map((x) => x.scrollLeft));
      assert.ok(afterWheel[0] > 0);
      await page.keyboard.down("Shift");
      await page.mouse.wheel(0, 180);
      await page.keyboard.up("Shift");
      await settle();
      const afterShiftWheel = await frame
        .locator(".d2h-file-side-diff")
        .evaluateAll((items) => items.map((x) => x.scrollLeft));
      assert.ok(afterShiftWheel[0] > afterWheel[0]);
      return { limits, afterDrag, afterWheel, afterShiftWheel };
    });
    await probe("open-file-button", async () => {
      await reopen();
      await frame.getByRole("button", { name: "Open file: src/example.py", exact: true }).click();
      await until(
        () => vscode.window.activeTextEditor?.document.uri.fsPath === path.join(fixture, "src/example.py"),
        "Open file editor",
      );
      return { document: vscode.window.activeTextEditor.document.fileName };
    });
    await probe("filename-click-select-and-modifier-open", async () => {
      await reopen();
      const target = frame.locator(".d2h-file-header .d2h-file-name").first();
      await target.click();
      await settle();
      assert.ok(await target.isVisible(), "plain filename click keeps diff visible");
      assert.equal(
        await wrappers()
          .first()
          .evaluate((el) => el.classList.contains("selected-file")),
        true,
      );
      await target.click({ modifiers: [process.platform === "darwin" ? "Meta" : "Control"] });
      await until(
        () => vscode.window.activeTextEditor?.document.uri.fsPath === path.join(fixture, "src/example.py"),
        "modifier filename editor",
      );
      return true;
    });
    await probe("filename-keyboard-open", async () => {
      await reopen();
      await frame.locator(".d2h-file-header .d2h-file-name").first().focus();
      await page.keyboard.press("Enter");
      await until(
        () => vscode.window.activeTextEditor?.document.uri.fsPath === path.join(fixture, "src/example.py"),
        "filename Enter editor",
      );
      return true;
    });
    await probe("line-number-navigation", async () => {
      await reopen();
      const pane = frame.locator(".d2h-file-side-diff").nth(1);
      const row = pane.locator("tr").filter({ hasText: "Alpha = 2" }).first();
      await row.locator(".d2h-code-side-linenumber").click();
      await until(
        () =>
          vscode.window.activeTextEditor?.document.uri.fsPath === path.join(fixture, "src/example.py") &&
          vscode.window.activeTextEditor?.selection.active.line === 75,
        "line number editor position",
      );
      return { line: vscode.window.activeTextEditor.selection.active.line + 1 };
    });
    await probe("toolbar-show-raw", async () => {
      await reopen();
      await clickToolbar("Show raw file");
      await until(() => vscode.window.activeTextEditor?.document.uri.fsPath === diffPath, "raw editor");
      assert.equal(vscode.window.activeTextEditor.document.getText(), patch);
      return { document: "sample.diff", contentEqualsFixture: true };
    });

    await probe("diagnostics-command-palette", async () => {
      await reopen();
      await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+p" : "Control+Shift+p");
      const input = page.locator(".quick-input-widget input");
      await input.fill(">Diff Viewer: Show diagnostics");
      await input.press("Enter");
      await until(() => vscode.window.activeTextEditor?.document.languageId === "json", "diagnostics editor");
      const diagnostics = JSON.parse(vscode.window.activeTextEditor.document.getText());
      assert.ok(diagnostics.extensionVersion);
      assert.ok(diagnostics.read);
      return { extensionVersion: diagnostics.extensionVersion };
    });
    await probe("explorer-open-collapsed", async () => {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await vscode.commands.executeCommand("workbench.view.explorer");
      const item = page.getByText("sample.diff", { exact: true });
      await item.click({ button: "right" });
      await settle();
      await page.getByRole("menuitem", { name: "Open diff collapsed (all viewed)", exact: true }).click();
      await activeFrame();
      await until(
        async () => (await frame.locator("#viewed-indicator").textContent()) === "2 / 2 files viewed",
        "explorer collapsed view",
      );
      await vscode.commands.executeCommand("workbench.action.closeSidebar");
      return { viewed: "2 / 2" };
    });
    await probe("side-by-side-context-expansion", async () => {
      const sidePath = path.join(fixture, "side-context.diff");
      fs.writeFileSync(sidePath, patch);
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await vscode.commands.executeCommand("vscode.openWith", vscode.Uri.file(sidePath), "diffViewer");
      await activeFrame();
      await settle();
      assert.equal(await frame.locator(".d2h-file-side-diff").count(), 4);
      const gap = (count) => frame.locator(`.diff-context-gap[data-hidden-lines="${count}"]`);
      assert.equal(await gap(25).count(), 2);
      await gap(25).locator('[data-context-direction="end"]').click();
      assert.equal(await gap(5).count(), 2);
      await gap(5).locator("button").click();
      await gap(35).locator('[data-context-direction="start"]').click();
      assert.equal(await gap(15).count(), 2);
      await gap(15).locator('[data-context-direction="end"]').click();
      await gap(14).locator("button").click();
      assert.equal(await frame.locator(".diff-context-gap").count(), 0);
      assert.equal(await frame.locator("tr.diff-context-hidden").count(), 0);
      return { steps: [20, 5, 20, 15, 14], matchingPanes: true };
    });
    await probe("renamed-file-open-old-and-new", async () => {
      fs.writeFileSync(path.join(fixture, "old.py"), "old = 1\n");
      fs.writeFileSync(path.join(fixture, "new.py"), "new = 2\n");
      const renamed = path.join(fixture, "renamed.diff");
      fs.writeFileSync(
        renamed,
        "diff --git a/old.py b/new.py\nsimilarity index 50%\nrename from old.py\nrename to new.py\n--- a/old.py\n+++ b/new.py\n@@ -1 +1 @@\n-old = 1\n+new = 2\n",
      );
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      const opened = [];
      for (const [label, file] of [
        ["Open old", "old.py"],
        ["Open new", "new.py"],
      ]) {
        await vscode.commands.executeCommand("vscode.openWith", vscode.Uri.file(renamed), "diffViewer");
        await activeFrame();
        await frame.getByRole("button", { name: `${label}: ${file}`, exact: true }).click();
        await until(
          () => vscode.window.activeTextEditor?.document.uri.fsPath === path.join(fixture, file),
          label + " destination",
        );
        opened.push(file);
      }
      return opened;
    });
    await probe("large-diff-notice-dismiss-and-expand", async () => {
      const large = path.join(fixture, "large.diff");
      fs.writeFileSync(
        large,
        Array.from(
          { length: 150 },
          (_, i) => `--- a/file-${i}.txt\n+++ b/file-${i}.txt\n@@ -1 +1 @@\n-old\n+new\n`,
        ).join(""),
      );
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await vscode.commands.executeCommand("vscode.openWith", vscode.Uri.file(large), "diffViewer");
      await activeFrame();
      const notice = frame.locator("#large-diff-notice-container");
      await until(() => notice.isVisible(), "large notice");
      assert.equal(await frame.locator("#viewed-indicator").textContent(), "150 / 150 files viewed");
      await frame.getByRole("button", { name: "Dismiss large diff notice" }).click();
      assert.equal(await notice.isVisible(), false);
      await frame.locator("#expand-all-toggle").check();
      await until(
        async () => (await frame.locator("#viewed-indicator").textContent()) === "0 / 150 files viewed",
        "150 files expanded",
      );
      return { dismissed: true, filesExpanded: 150 };
    });
    await probe("empty-diff-control-states", async () => {
      const empty = path.join(fixture, "empty.diff");
      fs.writeFileSync(empty, "");
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await vscode.commands.executeCommand("vscode.openWith", vscode.Uri.file(empty), "diffViewer");
      await activeFrame("#empty-message-container");
      assert.equal(await frame.locator("#empty-message-container").isVisible(), true);
      assert.equal(await frame.locator("#expand-all-toggle").isDisabled(), true);
      assert.equal(await frame.locator("#viewed-indicator").textContent(), "0 / 0 files viewed");
      return true;
    });
  } finally {
    report.browserErrors = errors;
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(
      "UI audit report:",
      path.join(output, "report.json"),
      JSON.stringify(report.results.map((r) => ({ name: r.name, status: r.status }))),
    );
    for (const [k, v] of Object.entries(saved))
      await vscode.workspace.getConfiguration("diffviewer").update(k, v, vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await browser.close();
    await vscode.env.clipboard.writeText(originalClipboard);
  }
  assert.equal(report.results.filter((r) => r.status === "fail").length, 0, "All real UI controls must pass");
};

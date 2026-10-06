/** @jest-environment jsdom */
import { parse } from "diff2html";
import { ColorSchemeType } from "diff2html/lib/types";
import { MessageToWebviewHandlerImpl } from "..";
import type { UpdateWebviewPayload, WebviewUiState } from "../../api";
import { findTextRanges } from "../find";

jest.mock("../../hash", () => ({ getSha1Hash: jest.fn(async (value: string) => `sha:${value}`) }));

function file(path: string, lines = 200) {
  return parse(
    [
      `--- a/${path}`,
      `+++ b/${path}`,
      `@@ -1,${lines + 1} +1,${lines + 1} @@`,
      ...Array.from({ length: lines }, (_, i) => ` const value${i} = ${i};`),
      "-old",
      "+new",
      "",
    ].join("\n"),
  )[0];
}
function payload(
  format: "line-by-line" | "side-by-side",
  files = [file("first.ts"), file("second.ts")],
): UpdateWebviewPayload {
  return {
    renderId: 1,
    config: {
      globalScrollbar: false,
      diff2html: {
        outputFormat: format,
        drawFileList: true,
        matching: "none",
        matchWordsThreshold: 0.25,
        matchingMaxComparisons: 2500,
        maxLineSizeInBlockForComparison: 200,
        maxLineLengthHighlight: 10000,
        renderNothingWhenEmpty: false,
        colorScheme: ColorSchemeType.LIGHT,
      },
    },
    diffFiles: files,
    accessiblePaths: files.map((file) => file.newName),
    viewedState: {},
    collapseAll: true,
    performance: { isLargeDiff: true, deferViewedStateHashing: true },
  };
}

describe("large diffs with deferred file bodies", () => {
  let handler: MessageToWebviewHandlerImpl;
  let messages: jest.Mock;
  let saved: WebviewUiState;
  beforeEach(() => {
    document.body.innerHTML = '<input id="syntax-highlighting-toggle" type="checkbox"><div id="diff-container"></div>';
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: jest.fn() });
    messages = jest.fn();
    saved = { scrollTop: 0 };
    handler = new MessageToWebviewHandlerImpl({
      postMessageToExtensionFn: messages,
      state: {
        getState: () => saved,
        setState: (state) => {
          saved = state;
        },
      },
    });
  });
  async function open(path: string) {
    await handler.runTestAction({ requestId: "open", action: { kind: "toggleViewed", path, viewed: false } });
  }
  it.each(["line-by-line", "side-by-side"] as const)(
    "renders only headers while collapsed, then one complete %s file",
    async (format) => {
      const update = payload(
        format,
        Array.from({ length: 100 }, (_, i) => file(`file${i}.ts`)),
      );
      await handler.updateWebview(update);
      expect(document.querySelectorAll(".d2h-file-wrapper")).toHaveLength(100);
      expect(document.querySelectorAll(".d2h-code-line-ctn")).toHaveLength(0);
      expect(document.querySelectorAll(".diff-context-gap")).toHaveLength(0);
      const wrapper = document.querySelector<HTMLElement>('[data-diff-path="file7.ts"]')!;
      const header = wrapper.querySelector(".d2h-file-header");
      expect(header?.getAttribute("data-vscode-context")).toContain('"diffviewerFilePath":"file7.ts"');
      wrapper.querySelector<HTMLButtonElement>('[data-action="copy"]')!.click();
      expect(messages).toHaveBeenCalledWith({ kind: "copyText", payload: { text: "file7.ts" } });
      await open("file7.ts");
      expect(wrapper.querySelector(".d2h-file-header")).toBe(header);
      expect(wrapper.querySelectorAll(".d2h-code-line-ctn").length).toBeGreaterThan(200);
      expect(document.querySelectorAll("[data-diff-body-pending]")).toHaveLength(99);
      expect(wrapper.querySelector(".diff-context-gap")).not.toBeNull();
      expect(findTextRanges(wrapper, "value12").length).toBeGreaterThan(0);
      expect(saved.fileCollapsedOverrides?.["file7.ts"]).toBe(false);
    },
  );
  it("uses original source indices for semantic syntax arriving before a deferred file opens", async () => {
    const update = payload("line-by-line");
    await handler.updateWebview(update);
    handler.updateSyntax({
      renderId: 1,
      syntax: [null, { old: {}, new: { 201: [{ start: 0, end: 3, color: "#123456", fontStyle: 0 }] } }],
    });
    await open("second.ts");
    const token = document.querySelector<HTMLElement>(".diff-textmate-token");
    expect(token?.textContent).toBe("new");
    expect(token?.style.color).toBe("rgb(18, 52, 86)");
    expect(document.querySelector('[data-diff-path="first.ts"] .d2h-code-line-ctn')).toBeNull();
  });
  it("cancels queued Expand all work when Collapse all runs before the next frame", async () => {
    await handler.updateWebview(payload("line-by-line"));
    handler.performWebviewAction({ action: "expandAll" });
    handler.performWebviewAction({ action: "collapseAll" });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(document.querySelectorAll(".d2h-code-line-ctn")).toHaveLength(0);
    expect(
      Array.from(document.querySelectorAll<HTMLInputElement>(".d2h-file-collapse-input"), (toggle) => toggle.checked),
    ).toEqual([true, true]);
    handler.performWebviewAction({ action: "expandAll" });
    await open("first.ts");
    expect(document.querySelectorAll("[data-diff-body-pending]")).toHaveLength(0);
    expect(document.querySelectorAll(".d2h-file-header")).toHaveLength(2);
  });
  it("hides an invalidated snapshot immediately and ignores a superseded body render", async () => {
    await handler.updateWebview(payload("line-by-line"));
    handler.performWebviewAction({ action: "expandAll" });
    handler.invalidate({ renderId: 3 });
    expect(document.getElementById("diff-container")!.style.display).toBe("none");
    await handler.updateWebview({ ...payload("line-by-line", [file("stale.ts")]), renderId: 2 });
    expect(document.getElementById("diff-container")!.style.display).toBe("none");
    await handler.updateWebview({ ...payload("line-by-line", [file("latest.ts")]), renderId: 3 });
    expect(document.getElementById("diff-container")!.style.display).toBe("block");
    expect(document.querySelector('[data-diff-path="stale.ts"]')).toBeNull();
    expect(document.querySelector('[data-diff-path="first.ts"]')).toBeNull();
    expect(document.querySelector('[data-diff-path="latest.ts"]')).not.toBeNull();
  });

  it("updates accessibility on existing headers without redrawing or losing Viewed state", async () => {
    const update = { ...payload("line-by-line"), accessiblePaths: [] };
    await handler.updateWebview(update);
    const header = document.querySelector(".d2h-file-header");
    handler.updateAccessiblePaths({ renderId: 0, accessiblePaths: ["first.ts"] });
    expect(document.querySelector(".diff-file-link")).toBeNull();
    handler.updateAccessiblePaths({ renderId: 1, accessiblePaths: ["first.ts"] });
    expect(document.querySelector(".d2h-file-header")).toBe(header);
    expect(header!.querySelector(".diff-file-link")).not.toBeNull();
    expect(header!.querySelector<HTMLButtonElement>('button[aria-label="Open file: first.ts"]')).not.toBeNull();
    expect(header!.querySelector<HTMLInputElement>("input")!.checked).toBe(true);
    handler.updateAccessiblePaths({ renderId: 1, accessiblePaths: [] });
    expect(header!.querySelector(".diff-file-link")).toBeNull();
    expect(header!.querySelector('button[aria-label="Open file: first.ts"]')).toBeNull();
    expect(header!.querySelectorAll('[data-action="copy"]')).toHaveLength(1);
  });

  it("merges per-file syntax patches without dropping previously colored files", async () => {
    await handler.updateWebview(payload("line-by-line"));
    await open("first.ts");
    await open("second.ts");
    const first = { old: {}, new: { 201: [{ start: 0, end: 3, color: "#123456", fontStyle: 0 }] } };
    const second = { old: {}, new: { 201: [{ start: 0, end: 3, color: "#654321", fontStyle: 0 }] } };
    handler.updateSyntax({ renderId: 1, syntax: [first], fileIndexes: [0] });
    handler.updateSyntax({ renderId: 1, syntax: [null, second], fileIndexes: [1] });
    const tokens = Array.from(document.querySelectorAll<HTMLElement>(".diff-textmate-token"));
    expect(tokens.map((token) => token.style.color)).toEqual(["rgb(18, 52, 86)", "rgb(101, 67, 33)"]);
    const requests = messages.mock.calls
      .map(([message]) => message)
      .filter((message) => message.kind === "requestSyntax");
    expect(requests).toEqual([
      { kind: "requestSyntax", payload: { renderId: 1, fileIndexes: [0] } },
      { kind: "requestSyntax", payload: { renderId: 1, fileIndexes: [1] } },
    ]);
  });
  it("keeps source indices and EOF annotations when empty-file wrappers are omitted", async () => {
    const update = payload("side-by-side");
    const empty = { ...file("empty.ts"), blocks: [], addedLines: 0, deletedLines: 0 };
    update.diffFiles.unshift(empty);
    update.config.diff2html.renderNothingWhenEmpty = true;
    update.diffFiles[2].noNewline = { new: 201 };
    await handler.updateWebview(update);
    expect(document.querySelectorAll(".d2h-file-wrapper")).toHaveLength(2);
    await open("second.ts");
    expect(document.querySelector('.diff-no-newline[data-no-newline-side="new"]')?.textContent).toContain("No newline");
    expect(messages).toHaveBeenCalledWith({ kind: "requestSyntax", payload: { renderId: 1, fileIndexes: [2] } });
    expect(document.querySelector('[data-diff-path="second.ts"]')?.id).toBe("diff-viewer-file-2");
  });
});

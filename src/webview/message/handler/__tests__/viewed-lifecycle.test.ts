/** @jest-environment jsdom */
import { parse } from "diff2html";
import { ColorSchemeType } from "diff2html/lib/types";
import { UpdateWebviewPayload } from "../../api";
import { MessageToWebviewHandlerImpl } from "..";
import { getSha1Hash } from "../../hash";

jest.mock("../../hash", () => ({ getSha1Hash: jest.fn() }));
const mockGetSha1Hash = jest.mocked(getSha1Hash);
const createUpdatePayload = (overrides: Partial<UpdateWebviewPayload>): UpdateWebviewPayload => ({
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
      colorScheme: ColorSchemeType.LIGHT,
    },
  },
  diffFiles: [],
  accessiblePaths: [],
  viewedState: {},
  collapseAll: false,
  performance: { isLargeDiff: true, deferViewedStateHashing: true },
  ...overrides,
});

describe("Viewed actions across redraws", () => {
  let handler: MessageToWebviewHandlerImpl;
  let postMessageToExtensionFn: jest.Mock;
  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = '<div id="diff-container"></div>';
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { value: jest.fn(), configurable: true });
    postMessageToExtensionFn = jest.fn();
    mockGetSha1Hash.mockImplementation(async (value) => `sha:${value}`);
    handler = new MessageToWebviewHandlerImpl({
      postMessageToExtensionFn,
      state: { getState: () => ({ scrollTop: 0 }), setState: jest.fn() },
    });
  });
  const file = (revision = 0) =>
    parse(["--- a/one.ts", "+++ b/one.ts", "@@ -1 +1 @@", "-old_value", `+value_${revision}`, ""].join("\n"))[0];
  const payload = (revision = 0) =>
    createUpdatePayload({
      diffFiles: [file(revision)],
      accessiblePaths: ["one.ts"],
      performance: { isLargeDiff: true, deferViewedStateHashing: true },
    });
  const toggle = () => document.querySelector<HTMLInputElement>(".d2h-file-collapse-input")!;
  const viewedMessages = () =>
    postMessageToExtensionFn.mock.calls
      .map(([message]) => message)
      .filter((message) => message.kind === "toggleFileViewed");

  it("reveals a file changed while the preceding Viewed check is hashing", async () => {
    await handler.updateWebview(payload());
    let finish!: (hash: string) => void;
    mockGetSha1Hash.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    toggle().click();
    expect(toggle().checked).toBe(true);
    await handler.updateWebview(payload(1));
    finish("previous-file-hash");
    for (let n = 0; n < 5; n++) await Promise.resolve();
    expect(toggle().checked).toBe(false);
    expect(toggle().classList.contains("changed-since-last-view")).toBe(true);
    expect(viewedMessages()).toEqual([]);
    await handler.updateWebview(payload(1));
    expect(toggle().checked).toBe(false);
    expect(viewedMessages()).toEqual([]);
  });

  it("persists a Viewed check if a redraw retains the exact same file", async () => {
    await handler.updateWebview(payload());
    let finish!: (hash: string) => void;
    mockGetSha1Hash.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    toggle().click();
    await handler.updateWebview(payload());
    finish("current-file-hash");
    for (let n = 0; n < 5; n++) await Promise.resolve();
    expect(toggle().checked).toBe(true);
    expect(viewedMessages()).toEqual([
      {
        kind: "toggleFileViewed",
        payload: { path: "one.ts", viewedSha1: `sha:${JSON.stringify(file())}` },
      },
    ]);
  });

  it.each([false, true])(
    "keeps a queued Viewed action coherent across two incoming payloads (file changed: %s)",
    async (changed) => {
      await handler.updateWebview(payload());
      let finish!: (hash: string) => void;
      mockGetSha1Hash.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const older = handler.updateWebview({
        ...payload(),
        performance: { isLargeDiff: false, deferViewedStateHashing: false },
      });
      toggle().click();
      await handler.updateWebview(payload(changed ? 1 : 0));
      finish("obsolete-render-hash");
      await older;
      for (let n = 0; n < 5; n++) await Promise.resolve();
      expect(toggle().checked).toBe(!changed);
      expect(toggle().classList.contains("changed-since-last-view")).toBe(changed);
      if (!changed)
        expect(postMessageToExtensionFn).toHaveBeenCalledWith({
          kind: "toggleFileViewed",
          payload: { path: "one.ts", viewedSha1: expect.any(String) },
        });
    },
  );

  it.each(["uncheck", "expandAll"] as const)(
    "keeps %s after a Viewed request is transferred to the next render",
    async (action) => {
      await handler.updateWebview(payload());
      let finishOld!: (hash: string) => void;
      let finishCurrent!: (hash: string) => void;
      mockGetSha1Hash
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finishOld = resolve;
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finishCurrent = resolve;
            }),
        );
      toggle().click();
      await handler.updateWebview(payload());
      if (action === "uncheck") toggle().click();
      else handler.performWebviewAction({ action });
      finishOld("obsolete-before-render");
      finishCurrent("obsolete-after-render");
      for (let n = 0; n < 5; n++) await Promise.resolve();
      expect(toggle().checked).toBe(false);
      expect(viewedMessages()).toEqual([{ kind: "toggleFileViewed", payload: { path: "one.ts", viewedSha1: null } }]);
    },
  );

  it("preserves only the final rapid check-uncheck-check before a redraw", async () => {
    await handler.updateWebview(payload());
    let finishFirst!: (hash: string) => void;
    let finishLast!: (hash: string) => void;
    mockGetSha1Hash
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishLast = resolve;
          }),
      );
    toggle().click();
    toggle().click();
    toggle().click();
    await handler.updateWebview(payload());
    finishLast("obsolete-last-check");
    finishFirst("obsolete-first-check");
    for (let n = 0; n < 5; n++) await Promise.resolve();
    expect(toggle().checked).toBe(true);
    expect(viewedMessages()).toEqual([
      { kind: "toggleFileViewed", payload: { path: "one.ts", viewedSha1: null } },
      { kind: "toggleFileViewed", payload: { path: "one.ts", viewedSha1: `sha:${JSON.stringify(file())}` } },
    ]);
  });

  it("gives a queued Expand all priority over a check transferred from the previous render", async () => {
    await handler.updateWebview(payload());
    let finishCheck!: (hash: string) => void;
    let finishRender!: (hash: string) => void;
    mockGetSha1Hash
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishCheck = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishRender = resolve;
          }),
      );
    toggle().click();
    const older = handler.updateWebview({
      ...payload(),
      performance: { isLargeDiff: false, deferViewedStateHashing: false },
    });
    handler.performWebviewAction({ action: "expandAll" });
    await handler.updateWebview(payload());
    finishRender("obsolete-render");
    await older;
    finishCheck("obsolete-check");
    for (let n = 0; n < 5; n++) await Promise.resolve();
    expect(toggle().checked).toBe(false);
    expect(viewedMessages()).toEqual([{ kind: "toggleFileViewed", payload: { path: "one.ts", viewedSha1: null } }]);
  });

  it("persists an uncheck made while a changed replacement is being prepared", async () => {
    const viewedState = { "one.ts": `sha:${JSON.stringify(file())}` };
    await handler.updateWebview({ ...payload(), viewedState });
    expect(toggle().checked).toBe(true);
    let finish!: (hash: string) => void;
    mockGetSha1Hash.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const update = handler.updateWebview({ ...payload(1), viewedState });
    toggle().click();
    finish(`sha:${JSON.stringify(file(1))}`);
    await update;
    expect(toggle().checked).toBe(false);
    expect(toggle().classList.contains("changed-since-last-view")).toBe(false);
    expect(viewedMessages()).toEqual([{ kind: "toggleFileViewed", payload: { path: "one.ts", viewedSha1: null } }]);
  });

  it("reopens every repeated file section when an earlier section changes after being viewed", async () => {
    const initial = createUpdatePayload({ diffFiles: [file(1), file(2)], accessiblePaths: ["one.ts"] });
    await handler.updateWebview(initial);
    handler.performWebviewAction({ action: "collapseAll" });
    for (let n = 0; n < 5; n++) await Promise.resolve();
    const hashes = viewedMessages();
    expect(hashes).toEqual([
      { kind: "toggleFileViewed", payload: { path: "one.ts", viewedSha1: `sha:${JSON.stringify(initial.diffFiles)}` } },
    ]);
    const updated = {
      ...initial,
      diffFiles: [file(3), file(2)],
      viewedState: { "one.ts": hashes[0].payload.viewedSha1 },
    };
    await handler.updateWebview(updated);
    const toggles = Array.from(document.querySelectorAll<HTMLInputElement>(".d2h-file-collapse-input"));
    expect(toggles).toHaveLength(2);
    for (const checkbox of toggles) {
      expect(checkbox.checked).toBe(false);
      expect(checkbox.classList.contains("changed-since-last-view")).toBe(true);
    }
  });
});

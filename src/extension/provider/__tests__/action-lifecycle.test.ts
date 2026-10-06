/** @jest-environment jsdom */

import * as vscode from "vscode";
import { DiffViewerProvider } from "..";
import { MessageToExtension, MessageToWebview } from "../../../shared/message";
import { SkeletonElementIds } from "../../../shared/css/elements";
import { MessageToWebviewHandlerImpl } from "../../../webview/message/handler";
import { UpdateWebviewPayload, WebviewUiState } from "../../../webview/message/api";
import { getSha1Hash } from "../../../webview/message/hash";

jest.mock("../textmate", () => ({ highlightDiffProgressively: jest.fn(async () => undefined) }));
jest.mock("../paths", () => ({
  collectAccessiblePaths: jest.fn(async () => ["one.ts"]),
  clearAccessiblePathsCache: jest.fn(),
}));
jest.mock("../document", () => ({
  readDiffText: (document: vscode.TextDocument) => document.getText(),
  watchDiffFile: jest.fn(() => ({ dispose: jest.fn() })),
}));
jest.mock("../shell", () => ({
  ensureWebviewShell: ({
    webviewContext,
  }: {
    webviewContext: { shellInitialized: boolean; shellGeneration: number };
  }) => {
    if (!webviewContext.shellInitialized) {
      webviewContext.shellInitialized = true;
      webviewContext.shellGeneration += 1;
    }
  },
}));
jest.mock("../../../webview/message/hash", () => ({ getSha1Hash: jest.fn(async (text: string) => `sha:${text}`) }));
jest.mock("vscode", () => {
  const event = () => jest.fn(() => ({ dispose: jest.fn() }));
  return {
    window: {
      registerCustomEditorProvider: jest.fn(),
      showWarningMessage: jest.fn(),
      onDidChangeWindowState: event(),
      onDidChangeActiveColorTheme: event(),
      activeColorTheme: { kind: 1 },
    },
    commands: { registerCommand: jest.fn(), executeCommand: jest.fn(async () => undefined) },
    workspace: {
      getConfiguration: jest.fn(() => ({ get: (_key: string, fallback: unknown) => fallback })),
      onDidChangeTextDocument: event(),
      onDidChangeConfiguration: event(),
      onDidChangeWorkspaceFolders: event(),
      onDidCreateFiles: event(),
      onDidDeleteFiles: event(),
      onDidRenameFiles: event(),
    },
    ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3 },
    Disposable: { from: jest.fn(() => ({ dispose: jest.fn() })) },
  };
});

const diff = "diff --git a/one.ts b/one.ts\n--- a/one.ts\n+++ b/one.ts\n@@ -1 +1 @@\n-old\n+new\n";

// Transport deliberately drops messages until the iframe attaches its listener,
// as a real Webview.postMessage does before the script has loaded. After ready,
// both production handlers are used, including asynchronous DOM rendering.
describe("editor action lifecycle", () => {
  let receive: (message: MessageToExtension) => void;
  let handler: MessageToWebviewHandlerImpl;
  let listening: boolean;
  let provider: DiffViewerProvider;
  let panel: vscode.WebviewPanel;
  let doc: vscode.TextDocument;
  let lastUpdate: UpdateWebviewPayload | undefined;
  let rendered: Promise<void>[];
  let state: WebviewUiState | undefined;

  const command = (name: string) => {
    const callback = jest.mocked(vscode.commands.registerCommand).mock.calls.find(([id]) => id === name)?.[1];
    if (!callback) throw new Error(`Missing command ${name}`);
    return callback();
  };
  const settle = async () => {
    await jest.advanceTimersByTimeAsync(25);
    await Promise.all(rendered);
    await Promise.resolve();
  };
  const ready = async () => {
    listening = true;
    receive({ kind: "ready", payload: { shellGeneration: 1 } });
    await settle();
  };
  const viewed = () =>
    Array.from(document.querySelectorAll<HTMLInputElement>(".d2h-file-collapse-input")).map((x) => x.checked);
  const savedViewed = () => document.getElementById(SkeletonElementIds.ViewedIndicator)?.textContent;

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    jest.mocked(getSha1Hash).mockImplementation(async (text) => `sha:${text}`);
    listening = false;
    rendered = [];
    lastUpdate = undefined;
    state = undefined;
    Object.defineProperty(globalThis, "CSS", { configurable: true, value: { highlights: new Map() } });
    Object.defineProperty(globalThis, "Highlight", { configurable: true, value: Set });
    document.body.innerHTML = `
      <div id="${SkeletonElementIds.LoadingContainer}"></div>
      <div id="${SkeletonElementIds.EmptyMessageContainer}"></div>
      <div id="${SkeletonElementIds.DiffContainer}"></div>
      <input id="${SkeletonElementIds.ExpandAllToggle}" type="checkbox" />
      <span id="${SkeletonElementIds.ViewedIndicator}"></span>
      <progress id="${SkeletonElementIds.ViewedProgressContainer}"></progress>`;
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: jest.fn() });
    handler = new MessageToWebviewHandlerImpl({
      state: { getState: () => state, setState: (value) => (state = value) },
      postMessageToExtensionFn: (message) => receive(message),
    });
    const stored = new Map<string, unknown>();
    DiffViewerProvider.registerContributions({
      extensionContext: {
        workspaceState: {
          get: (key: string) => stored.get(key),
          update: async (key: string, value: unknown) => {
            stored.set(key, value);
          },
        },
      } as unknown as vscode.ExtensionContext,
      webviewPath: "webview.js",
    });
    provider = jest.mocked(vscode.window.registerCustomEditorProvider).mock.calls.at(-1)?.[1] as DiffViewerProvider;
    panel = {
      active: true,
      visible: true,
      onDidDispose: jest.fn(),
      onDidChangeViewState: jest.fn(),
      dispose: jest.fn(),
      webview: {
        options: {},
        onDidReceiveMessage: (callback: typeof receive) => {
          receive = callback;
          return { dispose: jest.fn() };
        },
        postMessage: async (message: MessageToWebview) => {
          if (!listening) return false;
          if (message.kind === "updateWebview") {
            lastUpdate = message.payload;
            rendered.push(handler.updateWebview(message.payload));
          } else handler.onMessageReceived(message);
          return true;
        },
      },
    } as unknown as vscode.WebviewPanel;
    doc = {
      uri: { fsPath: "/workspace/change.diff", query: "" },
      fileName: "/workspace/change.diff",
      getText: () => diff,
    } as unknown as vscode.TextDocument;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("applies Collapse all clicked before the iframe is ready to the first rendered files", async () => {
    await provider.resolveCustomTextEditor(doc, panel, { isCancellationRequested: false } as vscode.CancellationToken);
    command("diffviewer.collapseAll");
    await ready();
    expect(viewed()).toEqual([true]);
    expect(savedViewed()).toBe("1 / 1 files viewed");
  });

  it("preserves Open collapsed across a configuration event before ready", async () => {
    Object.assign(doc.uri, { query: "collapsed" });
    await provider.resolveCustomTextEditor(doc, panel, { isCancellationRequested: false } as vscode.CancellationToken);
    jest
      .mocked(vscode.workspace.onDidChangeConfiguration)
      .mock.calls.at(-1)?.[0]({ affectsConfiguration: () => true });
    await ready();
    expect(viewed()).toEqual([true]);
  });

  it("lets an early Expand all override Open collapsed", async () => {
    Object.assign(doc.uri, { query: "collapsed" });
    await provider.resolveCustomTextEditor(doc, panel, { isCancellationRequested: false } as vscode.CancellationToken);
    command("diffviewer.expandAll");
    await ready();
    expect(viewed()).toEqual([false]);
    expect(savedViewed()).toBe("0 / 1 files viewed");
  });

  it("preserves Open collapsed when refresh replaces the pending first render after ready", async () => {
    Object.assign(doc.uri, { query: "collapsed" });
    await provider.resolveCustomTextEditor(doc, panel, { isCancellationRequested: false } as vscode.CancellationToken);
    listening = true;
    receive({ kind: "ready", payload: { shellGeneration: 1 } });
    jest
      .mocked(vscode.workspace.onDidChangeConfiguration)
      .mock.calls.at(-1)?.[0]({ affectsConfiguration: () => true });
    await settle();
    expect(viewed()).toEqual([true]);
  });

  it("opens and focuses Find clicked before the iframe is ready", async () => {
    await provider.resolveCustomTextEditor(doc, panel, { isCancellationRequested: false } as vscode.CancellationToken);
    command("diffviewer.find");
    await ready();
    const input = document.querySelector<HTMLInputElement>('#diff-find-widget input[type="text"]');
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    expect(document.getElementById("diff-find-widget")?.hidden).toBe(false);
  });

  it.each(["collapseAll", "expandAll"] as const)("keeps %s clicked during async redraw", async (action) => {
    await provider.resolveCustomTextEditor(doc, panel, { isCancellationRequested: false } as vscode.CancellationToken);
    await ready();
    if (action === "expandAll") {
      command("diffviewer.collapseAll");
      await Promise.resolve();
    }
    let finishHash: ((value: string) => void) | undefined;
    const hash = `sha:${JSON.stringify(lastUpdate!.diffFiles[0])}`;
    jest.mocked(getSha1Hash).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishHash = resolve;
        }),
    );
    const redraw = handler.updateWebview({
      ...lastUpdate!,
      viewedState: action === "expandAll" ? { "one.ts": hash } : {},
    });
    command(`diffviewer.${action}`);
    finishHash!(hash);
    await redraw;
    expect(viewed()).toEqual([action === "collapseAll"]);
    expect(savedViewed()).toBe(`${action === "collapseAll" ? 1 : 0} / 1 files viewed`);
  });

  it("keeps an individual Viewed click made while unchanged content is redrawing", async () => {
    await provider.resolveCustomTextEditor(doc, panel, { isCancellationRequested: false } as vscode.CancellationToken);
    await ready();
    let finishHash: ((value: string) => void) | undefined;
    const hash = `sha:${JSON.stringify(lastUpdate!.diffFiles[0])}`;
    jest.mocked(getSha1Hash).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishHash = resolve;
        }),
    );
    const redraw = handler.updateWebview(lastUpdate!);
    const toggle = document.querySelector<HTMLInputElement>(".d2h-file-collapse-input")!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    finishHash!(hash);
    await redraw;
    expect(viewed()).toEqual([true]);
    expect(savedViewed()).toBe("1 / 1 files viewed");
  });

  it("opens raw before ready without waiting for rendered content", async () => {
    await provider.resolveCustomTextEditor(doc, panel, { isCancellationRequested: false } as vscode.CancellationToken);
    command("diffviewer.showRaw");
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith("vscode.openWith", doc.uri, "default");
  });

  it("keeps viewed state after a refresh of unchanged text", async () => {
    await provider.resolveCustomTextEditor(doc, panel, { isCancellationRequested: false } as vscode.CancellationToken);
    await ready();
    command("diffviewer.collapseAll");
    await Promise.resolve();
    jest
      .mocked(vscode.workspace.onDidChangeConfiguration)
      .mock.calls.at(-1)?.[0]({ affectsConfiguration: () => true });
    await settle();
    expect(viewed()).toEqual([true]);
    expect(savedViewed()).toBe("1 / 1 files viewed");
  });

  it("opens an unsupported multi-parent merge patch as the exact original text document", async () => {
    const combined =
      "diff --cc one.ts\nindex 123,456..789\n--- a/one.ts\n+++ b/one.ts\n@@@ -1,1 -1,1 +1,1 @@@\n  merged\n";
    Object.assign(doc, { getText: () => combined });
    await provider.resolveCustomTextEditor(doc, panel, { isCancellationRequested: false } as vscode.CancellationToken);
    await ready();
    expect(document.querySelector(".d2h-file-wrapper")).toBeNull();
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith("vscode.openWith", doc.uri, "default");
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining("multiple parent versions"));
    expect(doc.getText()).toBe(combined);
  });
});

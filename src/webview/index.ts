import { isMessageToWebview, MessageToExtension, MessageToWebview } from "../shared/message";
import { MessageToWebviewHandlerImpl } from "./message/handler";
import { WebviewUiState } from "./message/api";

const webviewApi = acquireVsCodeApi<WebviewUiState>();
function postMessageToExtensionWrapper(message: MessageToExtension): void {
  webviewApi.postMessage(message);
}

const messageReceivedHandler = new MessageToWebviewHandlerImpl({
  postMessageToExtensionFn: postMessageToExtensionWrapper,
  state: {
    getState: () => webviewApi.getState() ?? undefined,
    setState: (state) => {
      webviewApi.setState(state);
    },
  },
});

const shellGeneration = Number(document.body.dataset.shellGeneration ?? "0");
postMessageToExtensionWrapper({
  kind: "ready",
  payload: {
    shellGeneration: Number.isFinite(shellGeneration) ? shellGeneration : 0,
  },
});

globalThis.addEventListener("message", (event: MessageEvent<MessageToWebview>) => {
  if (event.origin !== globalThis.origin) {
    return;
  }

  if (!isMessageToWebview(event.data)) {
    return;
  }

  try {
    messageReceivedHandler.onMessageReceived(event.data);
  } catch {
    // ignore malformed or unknown messages posted to the webview
  }
});

// Handle Find while focus is inside the iframe as well as the editor command.
globalThis.addEventListener("keydown", (event: KeyboardEvent) => {
  if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "f") {
    event.preventDefault();
    event.stopPropagation();
    messageReceivedHandler.performWebviewAction({ action: "find" });
  }
});

// Reopening an already-active custom editor with `code file.diff` need not
// change its WebviewPanel state. Actual iframe focus happens after VS Code has
// restored the editor from a maximized terminal, so hide the panel at that point.
let focusFrame: number | undefined;
const notifyFocus = () => {
  if (focusFrame !== undefined) cancelAnimationFrame(focusFrame);
  focusFrame = requestAnimationFrame(() => {
    focusFrame = undefined;
    if (document.hasFocus()) {
      postMessageToExtensionWrapper({
        kind: "focused",
        payload: { shellGeneration: Number.isFinite(shellGeneration) ? shellGeneration : 0 },
      });
    }
  });
};
globalThis.addEventListener("focus", notifyFocus);
globalThis.addEventListener("blur", () => {
  if (focusFrame !== undefined) cancelAnimationFrame(focusFrame);
  focusFrame = undefined;
});
if (document.hasFocus()) notifyFocus();

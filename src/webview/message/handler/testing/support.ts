import { AppConfig } from "../../../../extension/configuration";
import { SkeletonElementIds } from "../../../../shared/css/elements";
import { MessageToExtension } from "../../../../shared/message";
import { Diff2HtmlCssClassElements } from "../../../css/elements";
import { WebviewTestAction, WebviewTestState } from "../../testing/api";
import { FileDomBinding } from "../types";

export class WebviewHandlerTestSupport {
  public constructor(
    private readonly args: {
      postMessageToExtensionFn: (message: MessageToExtension) => void;
      getCurrentConfig: () => AppConfig | undefined;
      getRenderGeneration?: () => number;
      getFileBindings: () => FileDomBinding[];
      getSelectedPath: () => string | undefined;
      getClickedLineNumber: (element: HTMLElement) => number | undefined;
    },
  ) {}

  public captureTestState(payload: { requestId: string }): void {
    this.args.postMessageToExtensionFn({
      kind: "reportTestState",
      payload: {
        requestId: payload.requestId,
        state: this.buildTestState(),
      },
    });
  }

  public async runTestAction(payload: { requestId: string; action: WebviewTestAction }): Promise<void> {
    try {
      await this.executeTestAction(payload.action);
      this.args.postMessageToExtensionFn({
        kind: "reportTestActionResult",
        payload: { requestId: payload.requestId },
      });
    } catch (error) {
      this.args.postMessageToExtensionFn({
        kind: "reportTestActionResult",
        payload: {
          requestId: payload.requestId,
          error: error instanceof Error ? error.message : "Unknown test action failure.",
        },
      });
    }
  }

  private async executeTestAction(action: WebviewTestAction): Promise<void> {
    if (action.kind === "find" || action.kind === "findKey") {
      const input = document.querySelector<HTMLInputElement>('#diff-find-widget input[type="text"]');
      if (!input) throw new Error("Find widget is not open");
      if (action.kind === "find") {
        input.value = action.query;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      } else {
        input.dispatchEvent(
          new KeyboardEvent("keydown", { key: action.key, shiftKey: action.shiftKey, bubbles: true }),
        );
      }
      return;
    }
    const binding = this.args.getFileBindings().find((candidate) => candidate.filePath === action.path);
    if (!binding) {
      throw new Error(`No rendered file binding found for ${action.path}.`);
    }

    switch (action.kind) {
      case "expandContext": {
        const gap = Array.from(binding.fileContainer.querySelectorAll<HTMLElement>(".diff-context-gap")).find(
          (row) =>
            row.dataset.contextId === action.gapId &&
            row.querySelector(`[data-context-direction="${action.direction}"]`),
        );
        const button = gap?.querySelector<HTMLButtonElement>(`[data-context-direction="${action.direction}"]`);
        if (!button) throw new Error(`No context expansion button for ${action.gapId}/${action.direction}`);
        button.click();
        return;
      }
      case "clickFileName": {
        const fileNameLink = binding.fileContainer.querySelector<HTMLElement>(Diff2HtmlCssClassElements.A__FileName);
        if (!fileNameLink?.classList.contains("diff-file-link")) {
          throw new Error(`No file name link found for ${action.path}.`);
        }
        fileNameLink.click();
        return;
      }
      case "clickLineNumber": {
        const lineNumberElement = this.findRenderedLineNumberElement(binding.fileContainer, action.line);
        if (!lineNumberElement) {
          throw new Error(`No rendered line number ${action.line} found for ${action.path}.`);
        }
        lineNumberElement.click();
        return;
      }
      case "toggleViewed": {
        const toggle = binding.viewedToggle;
        if (!toggle) {
          throw new Error(`No viewed toggle found for ${action.path}.`);
        }
        if (toggle.checked !== action.viewed) {
          toggle.checked = action.viewed;
          toggle.dispatchEvent(new Event("change", { bubbles: true }));
        }
        return;
      }
    }
  }

  private findRenderedLineNumberElement(fileContainer: HTMLElement, line: number): HTMLElement | undefined {
    const currentConfig = this.args.getCurrentConfig();
    if (!currentConfig) {
      return undefined;
    }

    const selector =
      currentConfig.diff2html.outputFormat === "line-by-line"
        ? Diff2HtmlCssClassElements.Td__LineNumberOnLineByLine
        : Diff2HtmlCssClassElements.Td__LineNumberOnSideBySide;

    return Array.from(fileContainer.querySelectorAll<HTMLElement>(selector)).find(
      (element) => this.args.getClickedLineNumber(element) === line,
    );
  }

  private buildTestState(): WebviewTestState {
    const currentConfig = this.args.getCurrentConfig();
    const fileBindings = this.args.getFileBindings();
    const diffContainer = document.getElementById(SkeletonElementIds.DiffContainer);
    const fileList = diffContainer?.querySelector<HTMLElement>(".d2h-file-list-wrapper");
    const scrollbar = document.getElementById(SkeletonElementIds.HorizontalScrollbarContainer);
    const lightStylesheet = document.getElementById(SkeletonElementIds.HighlightLightStylesheet);
    const darkStylesheet = document.getElementById(SkeletonElementIds.HighlightDarkStylesheet);
    const fileHeaders = fileBindings
      .map(({ fileContainer }) =>
        fileContainer.querySelector(Diff2HtmlCssClassElements.A__FileName)?.textContent?.trim(),
      )
      .flatMap((header) => (header ? [header] : []));
    const collapsedFilePaths = fileBindings
      .filter(({ viewedToggle }) => viewedToggle?.checked)
      .map(({ filePath }) => filePath);
    const largeDiffNotice = document.getElementById(SkeletonElementIds.LargeDiffNoticeMessage)?.textContent?.trim();
    const codeLineTexts = Array.from(
      diffContainer?.querySelectorAll<HTMLElement>(".d2h-code-line, .d2h-code-side-line") ?? [],
    )
      .map((element) => element.textContent?.trim())
      .flatMap((text) => (text ? [text] : []))
      .slice(0, 2000);
    const inlineHighlightCount =
      diffContainer?.querySelectorAll(".d2h-code-line .d2h-change, .d2h-code-side-line .d2h-change").length ?? 0;

    return {
      clickableFilePaths: fileBindings
        .filter((binding) => binding.fileContainer.querySelector(".d2h-file-name.diff-file-link"))
        .map((binding) => binding.filePath),
      contextGaps: Array.from(diffContainer?.querySelectorAll<HTMLElement>(".diff-context-gap") ?? []).map((row) => ({
        id: row.dataset.contextId ?? "",
        hiddenLines: Number(row.dataset.hiddenLines),
        buttons: Array.from(row.querySelectorAll("button"), (button) => button.textContent ?? ""),
      })),
      hiddenContextRows: diffContainer?.querySelectorAll("tr.diff-context-hidden").length ?? 0,
      visibleCodeLineTexts: Array.from(diffContainer?.querySelectorAll<HTMLElement>(".d2h-code-line-ctn") ?? [])
        .filter((line) => !line.closest("[hidden]"))
        .slice(0, 2000)
        .map((line) => line.textContent ?? ""),
      loadingVisible: (() => {
        const loading = document.getElementById(SkeletonElementIds.LoadingContainer);
        return Boolean(loading && getComputedStyle(loading).display !== "none");
      })(),
      findOpen: Boolean(
        document.getElementById("diff-find-widget") && !document.getElementById("diff-find-widget")!.hidden,
      ),
      findCount: document.querySelector("#diff-find-widget span")?.textContent ?? undefined,
      findHighlights: globalThis.CSS?.highlights?.get("diff-find")?.size,
      syntaxTokens: Array.from(
        document.querySelectorAll<HTMLElement>(".d2h-code-line-ctn [class*=hljs-], .diff-textmate-token"),
      )
        .slice(0, 100)
        .map((el) => ({
          text: el.textContent ?? "",
          color: getComputedStyle(el).color,
          baseColor: getComputedStyle(el.closest(".d2h-code-line-ctn")!).color,
        })),
      textMateTokenCount: document.querySelectorAll(".diff-textmate-token").length,
      isReady: Boolean(currentConfig),
      shellGeneration: Number(document.body.dataset.shellGeneration ?? "0"),
      renderGeneration: this.args.getRenderGeneration?.() ?? 0,
      outputFormat: currentConfig?.diff2html.outputFormat,
      colorScheme: currentConfig?.diff2html.colorScheme,
      fileCount: fileBindings.length,
      filePaths: fileBindings.map(({ filePath }) => filePath),
      fileHeaders,
      fileListVisible: Boolean(fileList),
      collapsedFilePaths,
      selectedPath: this.args.getSelectedPath(),
      largeDiffWarning: largeDiffNotice || undefined,
      scrollbarVisible: scrollbar instanceof HTMLElement && scrollbar.style.display === "block",
      inlineHighlightCount,
      lightHighlightDisabled: lightStylesheet instanceof HTMLLinkElement ? lightStylesheet.disabled : false,
      darkHighlightDisabled: darkStylesheet instanceof HTMLLinkElement ? darkStylesheet.disabled : false,
      codeLineTexts,
    };
  }
}

import { LazyFileRenderer } from "./lazy-files";
import type { FileSyntax } from "../../../shared/syntax";
import { renderNoNewlineMarkers } from "./no-newline";
import { captureViewState, restoreViewState } from "./view-state";
import { getRenderedFileWrappers, linkRenderedFileSummaries } from "./rendered-file-wrappers";
import { SyntaxHighlightingController } from "./syntax-highlighting";
import { FindController } from "./find";
import { ContextFoldingController } from "./context-folding";
import { ColorSchemeType, DiffFile } from "diff2html/lib/types";
import { AlignedDiff2HtmlUI as Diff2HtmlUI } from "./aligned-diff-renderer";
import { AppConfig } from "../../../extension/configuration";
import { ViewedState } from "../../../extension/viewed-state";
import { SkeletonElementIds } from "../../../shared/css/elements";
import { extractNumberFromString } from "../../../shared/extract";
import { MessageToExtension, MessageToWebviewHandler } from "../../../shared/message";
import { GenericMessageHandlerImpl } from "../../../shared/message-handler";
import { Diff2HtmlCssClasses } from "../../css/classes";
import { Diff2HtmlCssClassElements } from "../../css/elements";
import { UpdateSyntaxPayload, UpdateWebviewPayload, WebviewAction, WebviewUiState } from "../api";
import { getSha1Hash } from "../hash";
import { buildDiffFileMap, buildDiffFileViewModel, buildDiffHashes } from "./models";
import { HorizontalScrollbarController } from "./scrollbar";
import { WebviewHandlerTestSupport } from "./testing/support";
import {
  CHANGED_SINCE_VIEWED,
  DEFAULT_UI_STATE,
  DiffFileHashMap,
  DiffFileViewModel,
  FILE_ACTION_BUTTON_CLASS,
  FILE_ACTIONS_CLASS,
  FileDomBinding,
  SELECTED_FILE,
  WebviewStateAdapter,
} from "./types";
import { setupTheme, showEmpty, showLoading, updateFooter, updateHighlightTheme, updateLargeDiffNotice } from "./ui";

const FILE_NAME_LINK_CLASS = "diff-file-link";

export class MessageToWebviewHandlerImpl extends GenericMessageHandlerImpl implements MessageToWebviewHandler {
  private readonly syntaxHighlightingController = new SyntaxHighlightingController({
    getEnabled: () => this.currentUiState.syntaxHighlighting !== false,
    setEnabled: (syntaxHighlighting) => {
      this.persistUiState({ syntaxHighlighting });
      this.horizontalScrollbarController.invalidateMeasurements();
      this.horizontalScrollbarController.scheduleRefresh(!!this.lazyFiles);
    },
  });
  private lazyFiles: LazyFileRenderer | undefined;
  private currentSyntax: Array<FileSyntax | null> | undefined;
  private requestedSyntax = new Set<number>();
  private pendingRenderId: number | undefined;
  private hiddenViewState: ReturnType<typeof captureViewState> | undefined;
  private currentDiffFiles: DiffFile[] = [];
  private pendingAccessibility: { renderId: number; accessiblePaths: string[] } | undefined;
  private hasRendered = false;
  private updateGeneration = 0;
  private currentRenderId: number | undefined;
  private rendering = false;
  private pendingSyntax: UpdateSyntaxPayload | undefined;
  private pendingInteractions: Array<
    { action: WebviewAction } | { path: string; file: DiffFileHashMap[string]; viewed: boolean }
  > = [];
  private readonly contextFoldingController = new ContextFoldingController({
    getState: () => this.currentUiState.contextExpansions ?? {},
    setState: (contextExpansions) => this.persistUiState({ contextExpansions }),
    onChange: () => {
      this.syntaxHighlightingController.refreshVisible();
      this.horizontalScrollbarController.invalidateMeasurements();
      this.horizontalScrollbarController.scheduleRefresh(!!this.lazyFiles);
      this.findController.refresh();
    },
  });
  private readonly findController = new FindController({
    revealMatch: (element) => this.contextFoldingController.revealLine(element),
  });
  private currentConfig: AppConfig | undefined = undefined;
  private accessiblePaths = new Set<string>();
  private currentDiffHashes: Record<string, string> = {};
  private currentUiState: WebviewUiState;
  private currentDiffFilesByPath: DiffFileHashMap = {};
  private pendingViewedRequests = new Map<string, { file: DiffFileHashMap[string]; viewed: boolean }>();
  private fileBindings: FileDomBinding[] = [];
  private diffContainerHandlersRegistered = false;
  private contextSelection: string | undefined;
  private readonly horizontalScrollbarController: HorizontalScrollbarController;
  private readonly testSupport: WebviewHandlerTestSupport;

  constructor(
    private readonly args: {
      postMessageToExtensionFn: (message: MessageToExtension) => void;
      state: WebviewStateAdapter;
    },
  ) {
    super();
    this.currentUiState = {
      ...DEFAULT_UI_STATE,
      ...this.args.state.getState(),
    };
    this.horizontalScrollbarController = new HorizontalScrollbarController({
      getConfig: () => this.currentConfig,
      getFileBindings: () => this.fileBindings,
    });
    this.testSupport = new WebviewHandlerTestSupport({
      postMessageToExtensionFn: this.args.postMessageToExtensionFn,
      getCurrentConfig: () => this.currentConfig,
      getRenderGeneration: () => this.updateGeneration,
      getFileBindings: () => this.fileBindings,
      getSelectedPath: () => this.currentUiState.selectedPath,
      afterAction: () => this.lazyFiles?.whenIdle() ?? Promise.resolve(),
      getClickedLineNumber: (element) => this.getClickedLineNumber(element),
    });
  }

  public prepare(): void {
    if (this.hasRendered) return;
    showLoading(true);
    showEmpty(false);
  }

  public invalidate(payload: { renderId: number }): void {
    if (!Number.isFinite(payload.renderId) || payload.renderId < (this.pendingRenderId ?? this.currentRenderId ?? 0))
      return;
    this.hiddenViewState ??= captureViewState(this.fileBindings);
    this.pendingRenderId = payload.renderId;
    ++this.updateGeneration;
    this.lazyFiles?.dispose();
    this.lazyFiles = undefined;
    this.contextFoldingController.reset();
    this.rendering = true;
    this.pendingSyntax = undefined;
    this.contextSelection = undefined;
    globalThis.getSelection()?.removeAllRanges();
    this.findController.suspend();
    this.pendingInteractions.unshift(
      ...Array.from(this.pendingViewedRequests, ([path, request]) => ({ path, ...request })),
    );
    this.pendingViewedRequests.clear();
    const container = document.getElementById(SkeletonElementIds.DiffContainer);
    if (container) container.style.display = "none";
    const footer = document.querySelector("footer");
    if (footer) footer.style.display = "none";
    updateLargeDiffNotice();
    showEmpty(false);
    showLoading(true, "Updating diff…");
  }

  public updateAccessiblePaths(payload: { renderId: number; accessiblePaths: string[] }): void {
    if (
      payload.renderId !== this.currentRenderId ||
      (this.pendingRenderId !== undefined && payload.renderId < this.pendingRenderId)
    )
      return;
    if (this.rendering) {
      this.pendingAccessibility = payload;
      return;
    }
    const paths = new Set(payload.accessiblePaths);
    if (paths.size === this.accessiblePaths.size && [...paths].every((path) => this.accessiblePaths.has(path))) return;
    this.accessiblePaths = paths;
    const container = document.getElementById(SkeletonElementIds.DiffContainer);
    if (!container) return;
    for (const { file, wrapper } of getRenderedFileWrappers(container, this.currentDiffFiles)) {
      const model = buildDiffFileViewModel(file, this.accessiblePaths);
      const name = wrapper.querySelector<HTMLElement>(Diff2HtmlCssClassElements.A__FileName);
      if (name && !this.accessiblePaths.has(model.primaryPath)) {
        name.classList.remove(FILE_NAME_LINK_CLASS);
        for (const attribute of ["role", "tabindex", "title", "aria-label"]) name.removeAttribute(attribute);
      }
      this.enhanceFileNameLink(wrapper, model);
      wrapper.querySelector(`.${FILE_ACTIONS_CLASS}`)?.remove();
      this.appendFileNavigationActions(wrapper, model);
    }
  }

  public async updateWebview(payload: UpdateWebviewPayload): Promise<void> {
    if (payload.renderId !== undefined && this.pendingRenderId !== undefined && payload.renderId < this.pendingRenderId)
      return;

    const diffContainer = document.getElementById(SkeletonElementIds.DiffContainer);
    if (!diffContainer) {
      return;
    }

    const generation = ++this.updateGeneration;
    this.lazyFiles?.dispose();
    this.lazyFiles = undefined;
    // A check can still be hashing when a refresh begins. Preserve that user
    // intent before canceling the old async write, just like actions made while
    // a refresh is already pending. Later queued interactions must win.
    this.pendingInteractions.unshift(
      ...Array.from(this.pendingViewedRequests, ([path, request]) => ({ path, ...request })),
    );
    this.pendingViewedRequests.clear();
    this.currentRenderId = payload.renderId;
    this.currentSyntax = payload.syntax;
    if (this.pendingAccessibility?.renderId !== payload.renderId) this.pendingAccessibility = undefined;
    this.requestedSyntax.clear();
    this.rendering = true;
    this.pendingSyntax = undefined;
    await this.withLoading(generation, async () => {
      // Keep pending data separate from the rendered view while hashes are built.
      const accessiblePaths = new Set(payload.accessiblePaths);
      const currentDiffFilesByPath = buildDiffFileMap(payload.diffFiles, accessiblePaths);
      const currentDiffHashes = await buildDiffHashes({
        payload,
        currentDiffFilesByPath,
        accessiblePaths,
      });
      if (generation !== this.updateGeneration) return;

      const lazyFiles = payload.performance.lazyFiles ?? payload.performance.isLargeDiff;
      if (lazyFiles) this.contextFoldingController.reset();
      else await this.contextFoldingController.prepare(payload.diffFiles);
      if (generation !== this.updateGeneration) return;

      const viewState = this.hiddenViewState ?? captureViewState(this.fileBindings);
      this.currentDiffFiles = payload.diffFiles;
      this.currentConfig = payload.config;
      this.accessiblePaths = accessiblePaths;
      this.currentDiffFilesByPath = currentDiffFilesByPath;
      this.currentDiffHashes = currentDiffHashes;
      showEmpty(payload.diffFiles.length === 0);

      const appTheme = this.currentConfig.diff2html.colorScheme === ColorSchemeType.DARK ? "dark" : "light";
      setupTheme(appTheme);
      updateHighlightTheme(appTheme);
      updateLargeDiffNotice(payload.performance.warning);

      const collapseAll = payload.collapseAll && !this.currentUiState.expandAllFiles;
      if (collapseAll) {
        diffContainer.style.display = "none";
      }

      diffContainer.classList.toggle("diff-lazy-files", lazyFiles);
      const rendererConfig = { ...this.currentConfig.diff2html, highlight: false };
      const diff2html = new Diff2HtmlUI(diffContainer, payload.diffFiles, rendererConfig, lazyFiles);
      diff2html.draw();
      linkRenderedFileSummaries(diffContainer, payload.diffFiles);
      if (!lazyFiles) {
        renderNoNewlineMarkers(diffContainer, payload.diffFiles);
        await this.contextFoldingController.render(diffContainer, payload.diffFiles);
      }
      if (generation !== this.updateGeneration) return;

      this.syntaxHighlightingController.render(diffContainer, this.currentSyntax, payload.diffFiles);
      if (lazyFiles) {
        this.lazyFiles = new LazyFileRenderer(
          diffContainer,
          payload.diffFiles,
          rendererConfig,
          async (container, file, fileIndex) => {
            if (generation !== this.updateGeneration) return;
            renderNoNewlineMarkers(container, [file]);
            await this.contextFoldingController.render(container, [file], true);
            if (generation !== this.updateGeneration) return;
            this.syntaxHighlightingController.render(container, this.currentSyntax, [file], fileIndex);
            if (payload.renderId !== undefined && !this.requestedSyntax.has(fileIndex)) {
              this.requestedSyntax.add(fileIndex);
              this.args.postMessageToExtensionFn({
                kind: "requestSyntax",
                payload: { renderId: payload.renderId, fileIndexes: [fileIndex] },
              });
            }
          },
          () => {
            if (generation !== this.updateGeneration) return;
            this.horizontalScrollbarController.scheduleRefresh(!!this.lazyFiles);
            this.findController.refresh();
          },
        );
      }
      this.fileBindings = this.enhanceRenderedDiff(diffContainer, payload.diffFiles);
      this.registerDiffContainerHandlers(diffContainer);
      this.horizontalScrollbarController.ensureWindowHandlersRegistered();

      if (collapseAll) {
        if (payload.performance.isLargeDiff) {
          this.setAllCollapsedStates(true);
          await this.hideViewedFiles(payload.viewedState, generation);
          if (generation !== this.updateGeneration) return;
        } else {
          this.setAllViewedStates(true);
        }
      } else {
        await this.hideViewedFiles(payload.viewedState, generation);
        if (generation !== this.updateGeneration) return;
      }

      for (const binding of this.fileBindings) {
        const collapsed = this.currentUiState.fileCollapsedOverrides?.[binding.filePath];
        if (
          binding.viewedToggle &&
          typeof collapsed === "boolean" &&
          !binding.viewedToggle.classList.contains(CHANGED_SINCE_VIEWED)
        ) {
          this.updateDiff2HtmlFileCollapsed(binding.viewedToggle, collapsed);
        }
      }
      await this.lazyFiles?.renderExpanded();
      if (generation !== this.updateGeneration) return;
      this.restoreSelection();
      const expandAllToggle = document.getElementById(SkeletonElementIds.ExpandAllToggle);
      if (expandAllToggle instanceof HTMLInputElement) {
        expandAllToggle.onchange = () => {
          this.args.postMessageToExtensionFn({
            kind: "requestWebviewAction",
            payload: { action: expandAllToggle.checked ? "expandAll" : "collapseAll" },
          });
        };
      }
      updateFooter(this.fileBindings);

      diffContainer.style.display = "block";
      const footer = document.querySelector("footer");
      if (footer) footer.style.display = "";
      this.hiddenViewState = undefined;
      this.pendingRenderId = undefined;
      this.findController.resume();
      if (this.lazyFiles) await this.horizontalScrollbarController.refreshCooperatively();
      if (generation !== this.updateGeneration) return;
      restoreViewState(viewState, this.fileBindings, (pane, left) =>
        this.horizontalScrollbarController.recordScrollLeft(pane, left),
      );
      this.horizontalScrollbarController.refresh();
      this.horizontalScrollbarController.scheduleRefresh(!!this.lazyFiles);
      this.findController.refresh();
    });
    if (generation === this.updateGeneration) {
      this.rendering = false;
      if (this.pendingAccessibility) {
        const paths = this.pendingAccessibility;
        this.pendingAccessibility = undefined;
        this.updateAccessiblePaths(paths);
      }
      if (this.pendingSyntax) this.updateSyntax(this.pendingSyntax);
      const pending = this.pendingInteractions;
      this.pendingInteractions = [];
      for (const interaction of pending) {
        if ("action" in interaction) {
          this.performWebviewAction(interaction);
        } else {
          const toggles = this.fileBindings.flatMap((file) =>
            file.filePath === interaction.path && file.viewedToggle ? [file.viewedToggle] : [],
          );
          if (!toggles.length) continue;
          const unchanged =
            JSON.stringify(interaction.file) === JSON.stringify(this.currentDiffFilesByPath[interaction.path]);
          if (unchanged || !interaction.viewed) {
            for (const toggle of toggles) {
              this.updateDiff2HtmlFileCollapsed(toggle, interaction.viewed);
              toggle.classList.remove(CHANGED_SINCE_VIEWED);
              this.getViewedToggleLabel(toggle)?.classList.remove(CHANGED_SINCE_VIEWED);
            }
            this.onViewedToggleChangedHandler(toggles[0]);
          } else {
            for (const toggle of toggles) {
              this.updateDiff2HtmlFileCollapsed(toggle, false);
              toggle.classList.add(CHANGED_SINCE_VIEWED);
              this.getViewedToggleLabel(toggle)?.classList.add(CHANGED_SINCE_VIEWED);
            }
            this.persistUiState({
              fileCollapsedOverrides: { ...this.currentUiState.fileCollapsedOverrides, [interaction.path]: false },
            });
          }
        }
      }
      updateFooter(this.fileBindings);
      this.horizontalScrollbarController.refresh();
    }
  }

  public updateSyntax(payload: UpdateSyntaxPayload): void {
    if (
      payload.renderId !== this.currentRenderId ||
      (this.pendingRenderId !== undefined && payload.renderId < this.pendingRenderId)
    )
      return;
    if (payload.fileIndexes) {
      this.currentSyntax ??= [];
      for (const index of payload.fileIndexes) this.currentSyntax[index] = payload.syntax[index] ?? null;
    } else this.currentSyntax = payload.syntax;
    if (this.rendering) {
      // Several lazily opened files can finish while the initial view is still
      // being assembled. Retain every patch, not just the last file's tokens.
      this.pendingSyntax = { renderId: payload.renderId, syntax: this.currentSyntax };
      return;
    }
    this.pendingSyntax = undefined;
    this.syntaxHighlightingController.updateNative(this.currentSyntax, payload.fileIndexes);
    if (payload.fileIndexes) {
      const changed = new Set(payload.fileIndexes);
      const container = document.getElementById(SkeletonElementIds.DiffContainer);
      if (container)
        for (const { fileIndex, wrapper } of getRenderedFileWrappers(container, this.currentDiffFiles)) {
          if (changed.has(fileIndex)) this.horizontalScrollbarController.invalidateMeasurements(wrapper);
        }
    } else this.horizontalScrollbarController.invalidateMeasurements();
    this.horizontalScrollbarController.scheduleRefresh(!!this.lazyFiles);
    this.findController.refresh();
  }

  public performWebviewAction(payload: { action: WebviewAction }): void {
    if (payload.action === "copySelection") {
      // Opening VS Code's native context menu can clear the iframe selection.
      // Copy the text selected when that menu was requested, not its later state.
      const text = this.contextSelection ?? globalThis.getSelection()?.toString();
      this.contextSelection = undefined;
      if (text) this.args.postMessageToExtensionFn({ kind: "copyText", payload: { text } });
      return;
    }
    if (this.rendering) {
      this.pendingInteractions.push(payload);
      return;
    }
    switch (payload.action) {
      case "find":
        this.findController.open();
        return;
      case "collapseAll":
        this.persistUiState({ expandAllFiles: false, fileCollapsedOverrides: {} });
        this.setAllViewedStates(true);
        this.clearChangedSinceViewedIndicators();
        updateFooter(this.fileBindings);
        this.horizontalScrollbarController.refresh();
        return;
      case "expandAll":
        this.setAllViewedStates(false);
        this.clearChangedSinceViewedIndicators();
        this.persistUiState({ selectedPath: undefined, expandAllFiles: true, fileCollapsedOverrides: {} });
        updateFooter(this.fileBindings);
        this.horizontalScrollbarController.refresh();
        return;
      case "showRaw":
        return;
    }
  }

  public captureTestState(payload: Parameters<WebviewHandlerTestSupport["captureTestState"]>[0]): void {
    this.testSupport.captureTestState(payload);
  }

  public runTestAction(payload: Parameters<WebviewHandlerTestSupport["runTestAction"]>[0]): Promise<void> {
    return this.testSupport.runTestAction(payload);
  }

  private registerDiffContainerHandlers(diffContainer: HTMLElement): void {
    if (this.diffContainerHandlersRegistered) {
      return;
    }

    diffContainer.addEventListener("click", this.onDiffClickedHandler.bind(this));
    diffContainer.addEventListener("keydown", this.onDiffKeyDownHandler.bind(this));
    diffContainer.addEventListener("change", this.onDiffContainerChangedHandler.bind(this));
    const rememberContextSelection = () => {
      this.contextSelection = globalThis.getSelection()?.toString() ?? "";
      diffContainer.dataset.vscodeContext = JSON.stringify({ diffviewerHasSelection: !!this.contextSelection });
    };
    diffContainer.addEventListener(
      "pointerdown",
      (event) => {
        this.contextSelection = undefined;
        // Chromium can clear a text selection between right pointerdown and
        // contextmenu. Capture both its contents and menu enablement first.
        if (event.button === 2) rememberContextSelection();
      },
      true,
    );
    diffContainer.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) rememberContextSelection();
      },
      true,
    );
    diffContainer.addEventListener(
      "contextmenu",
      () => {
        if (this.contextSelection === undefined) rememberContextSelection();
      },
      true,
    );

    this.diffContainerHandlersRegistered = true;
  }

  private onDiffContainerChangedHandler(event: Event): void {
    const viewedToggle = event.target;
    if (!(viewedToggle instanceof HTMLInputElement)) {
      return;
    }

    if (!viewedToggle.matches(Diff2HtmlCssClassElements.Input__ViewedToggle)) {
      return;
    }

    this.onViewedToggleChangedHandler(viewedToggle);
  }

  private onViewedToggleChangedHandler(viewedToggle: HTMLInputElement): void {
    this.updateDiff2HtmlFileCollapsed(viewedToggle, viewedToggle.checked);
    viewedToggle.classList.remove(CHANGED_SINCE_VIEWED);
    this.getViewedToggleLabel(viewedToggle)?.classList.remove(CHANGED_SINCE_VIEWED);
    this.scrollDiffFileHeaderIntoView(viewedToggle);
    this.selectDiffFile(this.getDiffElementFileName(viewedToggle));
    updateFooter(this.fileBindings);
    this.horizontalScrollbarController.refresh();
    const path = this.getDiffElementFileName(viewedToggle);
    const file = path && this.currentDiffFilesByPath[path];
    if (path)
      this.persistUiState({
        fileCollapsedOverrides: { ...this.currentUiState.fileCollapsedOverrides, [path]: viewedToggle.checked },
      });
    if (this.rendering && path && file) {
      this.pendingInteractions.push({ path, file, viewed: viewedToggle.checked });
    } else void this.sendFileViewedMessage(viewedToggle, viewedToggle.checked);
  }

  private onDiffClickedHandler(event: Event): void {
    const diffElement = event.target;
    if (!(diffElement instanceof HTMLElement)) {
      return;
    }

    const filePath = this.getDiffElementFileName(diffElement);
    if (filePath) {
      this.selectDiffFile(filePath);
    }

    const actionButton = diffElement.closest<HTMLElement>(`button.${FILE_ACTION_BUTTON_CLASS}`);
    const actionPath = actionButton?.dataset.path;
    if (actionPath) {
      if (actionButton?.dataset.action === "copy") {
        this.args.postMessageToExtensionFn({ kind: "copyText", payload: { text: actionPath } });
      } else this.openFileAtPath(actionPath);
      return;
    }

    // Names are selectable text. Explicit open controls, keyboard activation,
    // or the editor's usual modifier-click gesture avoid stealing Copy focus.
    if (
      diffElement.closest(Diff2HtmlCssClassElements.A__FileName) &&
      !(event instanceof MouseEvent && (event.ctrlKey || event.metaKey))
    )
      return;
    this.maybeOpenFile(diffElement);
  }

  private onDiffKeyDownHandler(event: KeyboardEvent): void {
    if (event.key !== "Enter" || event.repeat || !(event.target instanceof HTMLElement)) {
      return;
    }

    const fileLink = event.target.closest<HTMLElement>(`.${FILE_NAME_LINK_CLASS}`);
    if (!fileLink) {
      return;
    }

    event.preventDefault();
    this.selectDiffFile(this.getDiffElementFileName(fileLink));
    this.maybeOpenFile(fileLink);
  }

  private maybeOpenFile(diffElement: HTMLElement): void {
    const fileName = this.getDiffElementFileName(diffElement);
    if (!fileName || !this.accessiblePaths.has(fileName)) {
      return;
    }

    const lineNumber = this.getClickedLineNumber(diffElement);
    const ignoreOtherClicks = !lineNumber && !diffElement.closest(Diff2HtmlCssClassElements.A__FileName);
    if (ignoreOtherClicks) {
      return;
    }

    this.openFileAtPath(fileName, lineNumber);
  }

  private openFileAtPath(path: string, line?: number): void {
    this.args.postMessageToExtensionFn({
      kind: "openFile",
      payload: {
        path,
        line,
      },
    });
  }

  private getDiffFileContainer(diffElement: HTMLElement): HTMLElement | null {
    return diffElement.closest(Diff2HtmlCssClassElements.Div__File);
  }

  private getDiffElementFileName(diffElement: HTMLElement): string | undefined {
    const fileContainer = this.getDiffFileContainer(diffElement);
    return fileContainer?.dataset.diffPath;
  }

  private getClickedLineNumber(diffElement: HTMLElement): number | undefined {
    if (!this.currentConfig) {
      return;
    }

    return this.currentConfig.diff2html.outputFormat === "line-by-line"
      ? this.getClickedLineNumberOnLineByLine(diffElement)
      : this.getClickedLineNumberOnSideBySide(diffElement);
  }

  private getClickedLineNumberOnLineByLine(diffElement: HTMLElement): number | undefined {
    const lineNumberElement = diffElement.closest(Diff2HtmlCssClassElements.Td__LineNumberOnLineByLine);
    if (!lineNumberElement) {
      return;
    }

    const blockList = [Diff2HtmlCssClassElements.Td__DeletedLine, Diff2HtmlCssClassElements.Td__DiffInfo];
    if (blockList.some((item) => lineNumberElement.matches(item))) {
      return;
    }

    const lineNumberValue = lineNumberElement.querySelector(
      Diff2HtmlCssClassElements.Div__LineNumberRightOnLineByLine,
    )?.textContent;
    if (!lineNumberValue) {
      return;
    }

    return extractNumberFromString(lineNumberValue);
  }

  private getClickedLineNumberOnSideBySide(diffElement: HTMLElement): number | undefined {
    const lineNumberElement = diffElement.closest(Diff2HtmlCssClassElements.Td__LineNumberOnSideBySide);
    if (!lineNumberElement?.textContent) {
      return;
    }

    if (lineNumberElement.closest(Diff2HtmlCssClassElements.Div__LeftDiffOnSideBySide__FirstChild)) {
      return;
    }

    return extractNumberFromString(lineNumberElement.textContent);
  }

  private enhanceRenderedDiff(diffContainer: HTMLElement, diffFiles: DiffFile[]): FileDomBinding[] {
    return getRenderedFileWrappers(diffContainer, diffFiles).flatMap(({ file: diffFile, wrapper: fileContainer }) => {
      const viewModel = buildDiffFileViewModel(diffFile, this.accessiblePaths);
      fileContainer.dataset.diffPath = viewModel.primaryPath;
      const header = fileContainer.querySelector<HTMLElement>(Diff2HtmlCssClassElements.Div__DiffFileHeader);
      if (header && viewModel.primaryPath)
        header.dataset.vscodeContext = JSON.stringify({
          webviewSection: "fileHeader",
          diffviewerFilePath: viewModel.primaryPath,
          diffviewerFileName: viewModel.primaryPath.split("/").pop(),
        });
      this.enhanceFileNameLink(fileContainer, viewModel);
      this.appendFileNavigationActions(fileContainer, viewModel);
      return viewModel.primaryPath
        ? [
            {
              fileContainer,
              filePath: viewModel.primaryPath,
              fileNameText:
                fileContainer.querySelector(Diff2HtmlCssClassElements.A__FileName)?.textContent?.toLowerCase() ?? "",
              viewedToggle:
                fileContainer.querySelector<HTMLInputElement>(Diff2HtmlCssClassElements.Input__ViewedToggle) ??
                undefined,
            },
          ]
        : [];
    });
  }

  private enhanceFileNameLink(fileContainer: HTMLElement, viewModel: DiffFileViewModel): void {
    const fileName = fileContainer.querySelector<HTMLElement>(Diff2HtmlCssClassElements.A__FileName);
    if (!fileName || !this.accessiblePaths.has(viewModel.primaryPath)) {
      return;
    }

    fileName.classList.add(FILE_NAME_LINK_CLASS);
    fileName.setAttribute("role", "link");
    fileName.tabIndex = 0;
    fileName.title = `${viewModel.primaryPath}\nCtrl/Cmd+click or Enter to open`;
    fileName.setAttribute("aria-label", `Open file: ${viewModel.primaryPath}`);
  }

  private appendFileNavigationActions(fileContainer: HTMLElement, viewModel: DiffFileViewModel): void {
    const header = fileContainer.querySelector<HTMLElement>(Diff2HtmlCssClassElements.Div__DiffFileHeader);
    if (!header) {
      return;
    }

    const actionsContainer = document.createElement("div");
    actionsContainer.className = FILE_ACTIONS_CLASS;

    if (viewModel.oldPath && viewModel.newPath && viewModel.oldPath !== viewModel.newPath) {
      if (viewModel.isOldPathAccessible) {
        actionsContainer.append(this.createFileActionButton("Open old", viewModel.oldPath));
      }
      if (viewModel.isNewPathAccessible) {
        actionsContainer.append(this.createFileActionButton("Open new", viewModel.newPath));
      }
    } else if (viewModel.primaryPath && (viewModel.isNewPathAccessible || viewModel.isOldPathAccessible)) {
      actionsContainer.append(this.createFileActionButton("Open file", viewModel.primaryPath));
    }

    if (viewModel.primaryPath) {
      const copy = this.createFileActionButton("Copy path", viewModel.primaryPath);
      copy.classList.add("diff-viewer-copy-path");
      copy.dataset.action = "copy";
      actionsContainer.append(copy);
    }

    if (actionsContainer.childElementCount > 0) {
      const viewedToggleLabel = header.querySelector<HTMLElement>(Diff2HtmlCssClassElements.Label__ViewedToggle);
      if (viewedToggleLabel) {
        viewedToggleLabel.before(actionsContainer);
        return;
      }

      header.append(actionsContainer);
    }
  }

  private createFileActionButton(label: string, path: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = FILE_ACTION_BUTTON_CLASS;
    button.textContent = label;
    button.dataset.path = path;
    button.setAttribute("aria-label", `${label}: ${path}`);
    return button;
  }

  private async hideViewedFiles(viewedState: ViewedState, generation: number): Promise<void> {
    const togglesToRevisit: Array<{ toggle: HTMLInputElement; oldSha1: string }> = [];
    for (const binding of this.fileBindings) {
      if (binding.viewedToggle && viewedState[binding.filePath]) {
        togglesToRevisit.push({ toggle: binding.viewedToggle, oldSha1: viewedState[binding.filePath] });
        this.updateDiff2HtmlFileCollapsed(binding.viewedToggle, true);
      }
    }

    for (const { toggle, oldSha1 } of togglesToRevisit) {
      const fileName = this.getDiffElementFileName(toggle);
      const diffHash = fileName ? await this.getOrCreateDiffHash(fileName) : null;
      if (generation !== this.updateGeneration) return;
      if (diffHash !== oldSha1) {
        this.updateDiff2HtmlFileCollapsed(toggle, false);
        toggle.classList.add(CHANGED_SINCE_VIEWED);
        this.getViewedToggleLabel(toggle)?.classList.add(CHANGED_SINCE_VIEWED);
      }
    }
  }

  private updateDiff2HtmlFileCollapsed(toggleElement: HTMLInputElement, collapse: boolean): void {
    toggleElement.checked = collapse;
    const fileContainer = this.getDiffFileContainer(toggleElement);
    const label = fileContainer?.querySelector(Diff2HtmlCssClassElements.Label__ViewedToggle);
    label?.classList.toggle(Diff2HtmlCssClasses.Input__ViewedToggle__Selected, collapse);
    const fileContent = fileContainer?.querySelector(Diff2HtmlCssClassElements.Div__DiffFileContent);
    fileContent?.classList.toggle(Diff2HtmlCssClasses.Div__DiffFileContent__Collapsed, collapse);
    if (!collapse && fileContainer && !this.rendering) void this.lazyFiles?.request(fileContainer);
  }

  private setAllViewedStates(viewed: boolean): void {
    const allToggles = this.getViewedToggles();

    for (const toggle of Array.from(allToggles)) {
      this.updateDiff2HtmlFileCollapsed(toggle, viewed);
      toggle.classList.remove(CHANGED_SINCE_VIEWED);
      this.getViewedToggleLabel(toggle)?.classList.remove(CHANGED_SINCE_VIEWED);
      void this.sendFileViewedMessage(toggle, viewed);
    }
  }

  private setAllCollapsedStates(collapse: boolean): void {
    for (const toggle of this.getViewedToggles()) {
      this.updateDiff2HtmlFileCollapsed(toggle, collapse);
      toggle.classList.remove(CHANGED_SINCE_VIEWED);
    }
  }

  private async sendFileViewedMessage(diffElement: HTMLInputElement, viewed: boolean): Promise<void> {
    const fileName = this.getDiffElementFileName(diffElement);
    if (!fileName) {
      return;
    }

    const file = this.currentDiffFilesByPath[fileName];
    if (!file) return;
    const request = { file, viewed };
    this.pendingViewedRequests.set(fileName, request);
    const viewedSha1 = viewed ? await this.getOrCreateDiffHash(fileName) : null;
    // Hashing can finish after an uncheck, Expand all, or a new diff render.
    // Only the latest action on the currently rendered file may be persisted.
    if (this.pendingViewedRequests.get(fileName) !== request) return;
    this.pendingViewedRequests.delete(fileName);

    this.args.postMessageToExtensionFn({
      kind: "toggleFileViewed",
      payload: {
        path: fileName,
        viewedSha1,
      },
    });
  }

  private async getOrCreateDiffHash(fileName: string): Promise<string | null> {
    const hashes = this.currentDiffHashes;
    const cachedHash = hashes[fileName];
    if (cachedHash) {
      return cachedHash;
    }

    const diffFile = this.currentDiffFilesByPath[fileName];
    if (!diffFile) {
      return null;
    }

    const hash = await getSha1Hash(JSON.stringify(diffFile));
    // A redraw may replace the cache while this file is being hashed.
    hashes[fileName] = hash;
    return hash;
  }

  private restoreSelection(): void {
    if (!this.currentUiState.selectedPath) {
      return;
    }

    this.selectDiffFile(this.currentUiState.selectedPath);
  }

  private selectDiffFile(path?: string): void {
    this.fileBindings.forEach(({ fileContainer }) => {
      fileContainer.classList.remove(SELECTED_FILE);
    });

    if (!path) {
      this.persistUiState({ selectedPath: undefined });
      return;
    }

    const selectedBinding = this.fileBindings.find((binding) => binding.filePath === path);
    if (!selectedBinding) {
      return;
    }

    selectedBinding.fileContainer.classList.add(SELECTED_FILE);
    this.persistUiState({ selectedPath: path });
  }

  private persistUiState(patch: Partial<WebviewUiState>): void {
    this.currentUiState = {
      ...this.currentUiState,
      ...patch,
    };
    this.args.state.setState(this.currentUiState);
  }

  private scrollDiffFileHeaderIntoView(viewedToggle: HTMLInputElement): void {
    const diffFileHeader = viewedToggle.closest(Diff2HtmlCssClassElements.Div__DiffFileHeader);
    if (!diffFileHeader) {
      return;
    }

    diffFileHeader.scrollIntoView({ block: "nearest" });
  }

  private clearChangedSinceViewedIndicators(): void {
    this.getViewedToggles().forEach((toggle) => {
      toggle.classList.remove(CHANGED_SINCE_VIEWED);
      this.getViewedToggleLabel(toggle)?.classList.remove(CHANGED_SINCE_VIEWED);
    });
  }

  private getViewedToggles(): HTMLInputElement[] {
    return this.fileBindings.flatMap(({ viewedToggle }) => (viewedToggle ? [viewedToggle] : []));
  }

  private getViewedToggleLabel(toggle: HTMLInputElement): HTMLElement | null {
    return toggle.closest(Diff2HtmlCssClassElements.Label__ViewedToggle);
  }

  private async withLoading(generation: number, runnable: () => Promise<void>): Promise<void> {
    if (!this.hasRendered) showLoading(true);
    showEmpty(false);
    try {
      await runnable();
      if (generation === this.updateGeneration) this.hasRendered = true;
    } finally {
      if (generation === this.updateGeneration) showLoading(false);
    }
  }
}

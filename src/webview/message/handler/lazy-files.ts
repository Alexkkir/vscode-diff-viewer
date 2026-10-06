import type { DiffFileWithMetadata } from "../../../shared/diff";
import type { Diff2HtmlUIConfig } from "diff2html/lib/ui/js/diff2html-ui-slim.js";
import { AlignedDiff2HtmlUI } from "./aligned-diff-renderer";
import { getRenderedFileWrappers } from "./rendered-file-wrappers";

const CONTENT_SELECTOR = ".d2h-file-diff, .d2h-files-diff";

interface PendingFile {
  file: DiffFileWithMetadata;
  fileIndex: number;
  wrapper: HTMLElement;
}

/** Keep collapsed files as headers, and spend at most one file at a time drawing bodies. */
export class LazyFileRenderer {
  private readonly pending = new Map<HTMLElement, PendingFile>();
  private readonly queue = new Set<HTMLElement>();
  private running?: Promise<void>;
  private disposed = false;
  private readonly lineHeight: number;

  constructor(
    container: HTMLElement,
    files: DiffFileWithMetadata[],
    private readonly config: Diff2HtmlUIConfig,
    private readonly enhance: (container: HTMLElement, file: DiffFileWithMetadata, fileIndex: number) => Promise<void>,
    private readonly onRendered: () => void,
  ) {
    const table = container.querySelector<HTMLElement>(".d2h-diff-table");
    const style = getComputedStyle(table ?? container);
    this.lineHeight = Number.parseFloat(style.lineHeight) || (Number.parseFloat(style.fontSize) || 14) * 1.5;
    for (const entry of getRenderedFileWrappers(container, files)) {
      this.pending.set(entry.wrapper, entry);
      entry.wrapper.dataset.diffBodyPending = "true";
    }
  }

  public dispose(): void {
    this.disposed = true;
    this.queue.clear();
    this.pending.clear();
  }

  public request(wrapper: HTMLElement): Promise<void> {
    if (this.disposed || !this.pending.has(wrapper)) return Promise.resolve();
    this.queue.add(wrapper);
    wrapper.setAttribute("aria-busy", "true");
    const content = wrapper.querySelector<HTMLElement>(CONTENT_SELECTOR);
    if (content && !content.querySelector(".diff-file-loading")) {
      const loading = document.createElement("div");
      loading.className = "diff-file-loading";
      loading.textContent = "Rendering diff…";
      content.replaceChildren(loading);
    }
    this.start();
    return this.whenIdle();
  }

  public async whenIdle(): Promise<void> {
    while (this.running) await this.running;
  }

  private start(): void {
    this.running ??= this.drain().finally(() => {
      this.running = undefined;
      if (!this.disposed && this.queue.size) this.start();
    });
  }

  public async renderExpanded(): Promise<void> {
    for (const wrapper of this.pending.keys()) {
      const toggle = wrapper.querySelector<HTMLInputElement>(".d2h-file-collapse-input");
      if (!toggle?.checked) void this.request(wrapper);
    }
    await this.whenIdle();
  }

  private async drain(): Promise<void> {
    // Allow the clicked checkbox and the lightweight headers to paint first.
    await this.nextFrame();
    let frameStarted = performance.now();
    while (!this.disposed && this.queue.size) {
      const wrapper = this.queue.values().next().value as HTMLElement;
      this.queue.delete(wrapper);
      const entry = this.pending.get(wrapper);
      const collapsed = wrapper.querySelector<HTMLInputElement>(".d2h-file-collapse-input")?.checked;
      if (!entry || !wrapper.isConnected || collapsed) {
        wrapper.removeAttribute("aria-busy");
        continue;
      }
      const staging = document.createElement("div");
      new AlignedDiff2HtmlUI(staging, [entry.file], { ...this.config, drawFileList: false }).draw();
      await this.enhance(staging, entry.file, entry.fileIndex);
      if (this.disposed) return;
      const content = staging.querySelector<HTMLElement>(CONTENT_SELECTOR);
      const previous = wrapper.querySelector<HTMLElement>(CONTENT_SELECTOR);
      if (content && previous) {
        // Offscreen bodies need an initial height estimate. Chromium remembers
        // the actual height once visited; folded rows must not inflate it.
        const table = content.querySelector("tbody");
        const visibleRows = table ? Array.from(table.rows).filter((row) => !row.hidden) : [];
        const rows = visibleRows.length + visibleRows.filter((row) => row.querySelector(".diff-no-newline")).length;
        content.style.containIntrinsicBlockSize = `auto ${Math.max(1, rows) * this.lineHeight}px`;
        // The header and its focus, Viewed state, selection and native menu stay put.
        content.classList.toggle(
          "d2h-d-none",
          !!wrapper.querySelector<HTMLInputElement>(".d2h-file-collapse-input")?.checked,
        );
        previous.replaceWith(content);
      }
      this.pending.delete(wrapper);
      delete wrapper.dataset.diffBodyPending;
      wrapper.removeAttribute("aria-busy");
      if (performance.now() - frameStarted >= 8 && this.queue.size) {
        await this.nextFrame();
        frameStarted = performance.now();
      }
    }
    if (!this.disposed) this.onRendered();
  }

  private nextFrame(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }
}

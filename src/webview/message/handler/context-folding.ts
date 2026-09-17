import { DiffFile } from "diff2html/lib/types";
import { getSha1Hash } from "../hash";
import {
  buildContextGaps,
  ContextGap,
  ContextExpansionDirection,
  CONTEXT_EXPAND_STEP,
  expandContextGap,
} from "./context-ranges";

export type ContextExpansionState = Record<string, Record<string, { start: number; end: number }>>;
interface RenderedGap {
  original: ContextGap;
  remaining: ContextGap;
  fileKey: string;
  // One row per source line in unified mode, paired rows in side-by-side mode.
  rows: HTMLTableRowElement[][];
  bars: HTMLTableRowElement[];
}

export class ContextFoldingController {
  private prepared?: { files: DiffFile[]; entries: Array<{ key: string; gaps: ContextGap[] }> };
  private rowGaps = new WeakMap<HTMLElement, { gap: RenderedGap; index: number }>();
  private state: ContextExpansionState = {};
  private generation = 0;

  constructor(
    private readonly args: {
      getState: () => ContextExpansionState;
      setState: (state: ContextExpansionState) => void;
      onChange: () => void;
    },
  ) {}

  // Compute keys before drawing, so no frame briefly shows all the folded rows.
  public async prepare(files: DiffFile[]): Promise<void> {
    const entries = await Promise.all(
      files.map(async (file) => {
        const gaps = file.isCombined ? [] : buildContextGaps(file);
        return { gaps, key: gaps.length ? await getSha1Hash(JSON.stringify(file)) : "" };
      }),
    );
    this.prepared = { files, entries };
  }

  public async render(container: HTMLElement, files: DiffFile[]): Promise<void> {
    const generation = ++this.generation;
    if (this.prepared?.files !== files) await this.prepare(files);
    if (generation !== this.generation) return;
    const prepared = this.prepared!;
    this.rowGaps = new WeakMap();
    const previous = this.args.getState();
    this.state = {};
    const wrappers = container.querySelectorAll<HTMLElement>(".d2h-file-wrapper");
    files.forEach((file, fileIndex) => {
      const wrapper = wrappers[fileIndex];
      const { key, gaps } = prepared.entries[fileIndex];
      if (!wrapper || !gaps.length) return;
      if (previous[key]) this.state[key] = { ...previous[key] };
      const panes = Array.from(wrapper.querySelectorAll<HTMLElement>(".d2h-file-side-diff"));
      const rowMaps = (panes.length ? panes : [wrapper]).map((pane, side) => {
        const map = new Map<number, HTMLTableRowElement>();
        for (const row of pane.querySelectorAll<HTMLTableRowElement>("tr")) {
          const cell = row.querySelector(
            panes.length ? ".d2h-code-side-linenumber.d2h-cntx" : ".d2h-code-linenumber.d2h-cntx",
          );
          const value = panes.length
            ? cell?.textContent
            : cell?.querySelector(side ? ".line-num2" : ".line-num1")?.textContent;
          if (value && /^\s*\d+\s*$/.test(value)) map.set(Number(value), row);
        }
        return map;
      });
      for (const original of gaps) {
        const lines = file.blocks[original.blockIndex].lines.slice(original.start, original.end);
        const rows = lines.map((line) =>
          rowMaps.map((map, side) => map.get((side ? line.newNumber : line.oldNumber)!)),
        );
        // Unsupported/abbreviated renderer output must stay readable.
        if (rows.some((pair) => pair.some((row) => !row))) continue;
        const saved = previous[key]?.[original.id];
        const clamp = (value: number | undefined, fallback: number) =>
          Number.isFinite(value) ? Math.max(original.start, Math.min(original.end, Math.floor(value!))) : fallback;
        const start = clamp(saved?.start, original.start);
        const remaining = { ...original, start, end: Math.max(start, clamp(saved?.end, original.end)) };
        const gap: RenderedGap = { original, remaining, fileKey: key, rows: rows as HTMLTableRowElement[][], bars: [] };
        gap.rows.forEach((pair, offset) =>
          pair.forEach((row) => this.rowGaps.set(row, { gap, index: original.start + offset })),
        );
        gap.bars = rowMaps.map(() => document.createElement("tr"));
        this.update(gap);
      }
    });
    if (JSON.stringify(previous) !== JSON.stringify(this.state)) this.args.setState(this.state);
  }

  public revealLine(element: HTMLElement): void {
    const row = element.closest<HTMLTableRowElement>("tr.diff-context-hidden");
    const target = row && this.rowGaps.get(row);
    if (!target) return;
    const { gap, index } = target;
    const { start, end, canExpandBefore, canExpandAfter } = gap.remaining;
    // Reveal from the nearest available edge, retaining the rest of a large gap.
    const fromStart = canExpandBefore && (!canExpandAfter || index - start < end - index);
    gap.remaining = { ...gap.remaining, ...(fromStart ? { start: index + 1 } : { end: index }) };
    this.update(gap);
    this.save(gap);
    this.args.onChange();
  }

  private expand(gap: RenderedGap, direction: ContextExpansionDirection, button: HTMLButtonElement): void {
    const bar = button.closest<HTMLTableRowElement>("tr")!;
    const top = bar.getBoundingClientRect().top;
    const focused = document.activeElement === button;
    const next = expandContextGap(gap.remaining, direction);
    gap.remaining = next ?? { ...gap.remaining, start: gap.remaining.end };
    this.update(gap);
    this.save(gap);
    if (bar.isConnected) {
      const delta = bar.getBoundingClientRect().top - top;
      if (delta) window.scrollBy(0, delta);
      if (focused)
        bar
          .querySelector<HTMLButtonElement>(`button[data-context-direction="${direction}"]`)
          ?.focus({ preventScroll: true });
    }
    this.args.onChange();
  }

  private save(gap: RenderedGap): void {
    this.state = {
      ...this.state,
      [gap.fileKey]: {
        ...this.state[gap.fileKey],
        [gap.original.id]: { start: gap.remaining.start, end: gap.remaining.end },
      },
    };
    this.args.setState(this.state);
  }

  private update(gap: RenderedGap): void {
    const { start, end } = gap.remaining;
    gap.rows.forEach((pair, offset) => {
      const index = gap.original.start + offset;
      const hidden = index >= start && index < end;
      for (const row of pair) {
        if (row.hidden !== hidden) row.hidden = hidden;
        if (row.classList.contains("diff-context-hidden") !== hidden)
          row.classList.toggle("diff-context-hidden", hidden);
      }
    });
    gap.bars.forEach((bar, side) => {
      if (start >= end) {
        bar.remove();
        return;
      }
      bar.className = "diff-context-gap";
      bar.dataset.contextId = gap.original.id;
      bar.dataset.hiddenLines = String(end - start);
      const cell = document.createElement("td");
      cell.colSpan = gap.rows[0][side].cells.length;
      const toolbar = document.createElement("div");
      toolbar.className = "diff-context-toolbar";
      const count = document.createElement("span");
      count.textContent = `${end - start} unchanged lines hidden`;
      count.className = "diff-context-count";
      toolbar.append(count);
      const unified = gap.bars.length === 1;
      for (const direction of ["start", "end"] as const) {
        if (direction === "start" ? !gap.remaining.canExpandBefore : !gap.remaining.canExpandAfter) continue;
        if (!unified && side !== (direction === "start" ? 0 : 1)) continue;
        const number = Math.min(CONTEXT_EXPAND_STEP, end - start);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "diff-context-expand";
        button.dataset.contextDirection = direction;
        button.textContent = `${direction === "start" ? "↓" : "↑"} Expand ${number} ${number === 1 ? "line" : "lines"} ${direction === "start" ? "below" : "above"}`;
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.expand(gap, direction, button);
        });
        toolbar.append(button);
      }
      cell.append(toolbar);
      bar.replaceChildren(cell);
      gap.rows[start - gap.original.start][side].before(bar);
    });
  }
}

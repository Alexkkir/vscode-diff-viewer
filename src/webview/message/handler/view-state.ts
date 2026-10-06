import { Diff2HtmlCssClassElements } from "../../css/elements";
import { setProgrammaticScroll } from "./scroll-synchronization";
import { FileDomBinding } from "./types";

interface FilePosition {
  path: string;
  occurrence: number;
  left: number[];
}

interface SourceAnchor {
  path: string;
  occurrence: number;
  top: number;
  line?: { side: "old" | "new"; number: number };
  gap?: string;
}

export interface RenderedViewState {
  scrollTop: number;
  files: FilePosition[];
  anchor?: SourceAnchor;
}

function panes(wrapper: HTMLElement): HTMLElement[] {
  const sides = Array.from(wrapper.querySelectorAll<HTMLElement>(".d2h-file-side-diff"));
  return sides.length ? sides : Array.from(wrapper.querySelectorAll<HTMLElement>(".d2h-file-diff"));
}

function numberedBindings(bindings: FileDomBinding[]) {
  const occurrences = new Map<string, number>();
  return bindings.map((binding) => {
    const occurrence = occurrences.get(binding.filePath) ?? 0;
    occurrences.set(binding.filePath, occurrence + 1);
    return { ...binding, occurrence };
  });
}

function lineNumber(value: string | null | undefined): number | undefined {
  return value && /^\s*\d+\s*$/.test(value) ? Number(value) : undefined;
}

function sourceLine(row: HTMLElement): SourceAnchor["line"] {
  const unified = row.querySelector(".d2h-code-linenumber");
  if (unified) {
    const next = lineNumber(unified.querySelector(".line-num2")?.textContent);
    if (next !== undefined) return { side: "new", number: next };
    const previous = lineNumber(unified.querySelector(".line-num1")?.textContent);
    return previous === undefined ? undefined : { side: "old", number: previous };
  }
  const number = lineNumber(row.querySelector(".d2h-code-side-linenumber")?.textContent);
  if (number === undefined) return;
  const pane = row.closest(".d2h-file-side-diff");
  return { side: pane?.previousElementSibling ? "new" : "old", number };
}

function captureAnchor(bindings: FileDomBinding[]): SourceAnchor | undefined {
  for (const binding of numberedBindings(bindings)) {
    const { fileContainer, filePath: path, occurrence } = binding;
    const bounds = fileContainer.getBoundingClientRect();
    if (bounds.bottom <= 0 || bounds.top >= window.innerHeight) continue;
    const header = fileContainer.querySelector<HTMLElement>(Diff2HtmlCssClassElements.Div__DiffFileHeader);
    const headerBounds = header?.getBoundingClientRect();
    if (bounds.top >= 0 && headerBounds && headerBounds.height > 0 && headerBounds.bottom > 0) {
      return { path, occurrence, top: headerBounds.top };
    }
    const visibleTop = Math.max(0, headerBounds?.bottom ?? 0);
    const candidates: SourceAnchor[] = [];
    // Prefer the new side on tied rows, retaining old-side deletions when the new side is empty.
    for (const pane of panes(fileContainer).reverse()) {
      for (const row of pane.querySelectorAll("tr")) {
        const rect = row.getBoundingClientRect();
        if (rect.height <= 0 || rect.bottom <= visibleTop || rect.top >= window.innerHeight) continue;
        const line = sourceLine(row);
        const gap = row.dataset.contextId;
        if (line || gap) {
          candidates.push({ path, occurrence, top: rect.top, line, gap });
          break;
        }
      }
    }
    if (candidates.length) return candidates.sort((left, right) => left.top - right.top)[0];
  }
}

/** Capture immediately before replacing the DOM, after any asynchronous preparation. */
export function captureViewState(bindings: FileDomBinding[]): RenderedViewState {
  return {
    scrollTop: window.scrollY,
    files: numberedBindings(bindings).map(({ filePath: path, fileContainer, occurrence }) => ({
      path,
      occurrence,
      left: panes(fileContainer).map((pane) => pane.scrollLeft),
    })),
    anchor: captureAnchor(bindings),
  };
}

function resolveAnchor(wrapper: HTMLElement, anchor: SourceAnchor): HTMLElement | undefined {
  if (!anchor.line && !anchor.gap) {
    return wrapper.querySelector<HTMLElement>(Diff2HtmlCssClassElements.Div__DiffFileHeader) ?? undefined;
  }
  return Array.from(wrapper.querySelectorAll<HTMLElement>("tr")).find((row) => {
    if (row.getBoundingClientRect().height <= 0) return false;
    if (anchor.gap) return row.dataset.contextId === anchor.gap;
    if (!anchor.line) return false;
    const unified = row.querySelector(".d2h-code-linenumber");
    if (unified) {
      const selector = anchor.line.side === "new" ? ".line-num2" : ".line-num1";
      return lineNumber(unified.querySelector(selector)?.textContent) === anchor.line.number;
    }
    const line = sourceLine(row);
    return line?.side === anchor.line.side && line?.number === anchor.line.number;
  });
}

/** Restore only once the new DOM is visible and its collapsed states have been applied. */
export function restoreViewState(state: RenderedViewState, bindings: FileDomBinding[]): void {
  const nextBindings = numberedBindings(bindings);
  const savedFiles = new Map(state.files.map((file) => [`${file.occurrence}:${file.path}`, file]));
  for (const binding of nextBindings) {
    const saved = savedFiles.get(`${binding.occurrence}:${binding.filePath}`);
    if (!saved) continue;
    const targets = panes(binding.fileContainer);
    targets.forEach((pane, index) => {
      // Changing layout carries the furthest visible column into the new pane(s).
      const left = targets.length === saved.left.length ? saved.left[index] : Math.max(0, ...saved.left);
      setProgrammaticScroll(pane, "scrollLeft", left ?? 0);
    });
  }
  let top = state.scrollTop;
  if (state.anchor) {
    const anchor = state.anchor;
    const binding = nextBindings.find((file) => file.filePath === anchor.path && file.occurrence === anchor.occurrence);
    const target = binding && resolveAnchor(binding.fileContainer, anchor);
    if (target && target.getBoundingClientRect().height > 0) {
      top = window.scrollY + target.getBoundingClientRect().top - anchor.top;
    }
  }
  if (window.scrollY !== top) window.scrollTo(window.scrollX, top);
}

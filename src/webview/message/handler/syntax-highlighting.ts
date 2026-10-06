import type { FileSyntax, SyntaxToken } from "../../../shared/syntax";
import { closeTags, getLanguage, nodeStream, mergeStreams } from "diff2html/lib/ui/js/highlight.js-helpers";
import { hljs } from "diff2html/lib/ui/js/highlight.js-slim";
import type { DiffFile } from "diff2html/lib/types";
import { getRenderedFileWrappers } from "./rendered-file-wrappers";

interface CodeLine {
  element: HTMLElement;
  row: HTMLTableRowElement;
  html: string;
  className: string;
  text: string;
  language: string;
  fileIndex: number;
  oldNumber: number;
  newNumber: number;
  tokens?: SyntaxToken[];
  highlighted: boolean;
}

function sameTokens(left?: SyntaxToken[], right?: SyntaxToken[]): boolean {
  return (
    left === right ||
    (!!left &&
      !!right &&
      left.length === right.length &&
      left.every(
        (token, index) =>
          token.start === right[index].start &&
          token.end === right[index].end &&
          token.color === right[index].color &&
          token.fontStyle === right[index].fontStyle,
      ))
  );
}

// HTML parsing normalizes literal CR to LF, even when source text must retain it.
function preserveCarriageReturns(html: string): string {
  return html.replace(/\r/g, "&#13;");
}

interface SelectionPoint {
  node: Node;
  offset: number;
  line?: { element: HTMLElement; text: string; firstChild: ChildNode | null; offset: number };
}

// Native tokens and highlight.js only color text; neither renders diagnostics.
export class SyntaxHighlightingController {
  private lines: CodeLine[] = [];

  constructor(private readonly args: { getEnabled: () => boolean; setEnabled: (enabled: boolean) => void }) {}

  public render(
    container: HTMLElement,
    syntax?: Array<FileSyntax | null>,
    files?: readonly DiffFile[],
    appendAtFileIndex?: number,
  ): void {
    if (appendAtFileIndex === undefined) this.lines = [];
    const firstNewLine = this.lines.length;
    const wrappers = files
      ? getRenderedFileWrappers(container, files)
      : Array.from(container.querySelectorAll<HTMLElement>(".d2h-file-wrapper"), (wrapper, fileIndex) => ({
          wrapper,
          fileIndex,
        }));
    wrappers.forEach(({ wrapper: file, fileIndex: index }) => {
      const fileIndex = appendAtFileIndex ?? index;
      // Parsing has already removed actual Arc revision labels. A Git filename
      // may literally end with the same text, so keep its parsed extension intact.
      const extension = file.dataset.lang ?? "";
      const detected = getLanguage(extension);
      const language = hljs.getLanguage(detected) ? detected : "plaintext";
      const sides = Array.from(file.querySelectorAll(".d2h-file-side-diff"));
      for (const element of file.querySelectorAll<HTMLElement>(".d2h-code-line-ctn")) {
        const row = element.closest<HTMLTableRowElement>("tr");
        if (!row) continue;
        let oldNumber = 0;
        let newNumber = 0;
        if (sides.length) {
          const number = Number(row.querySelector(".d2h-code-side-linenumber")?.textContent?.trim());
          if (element.closest(".d2h-file-side-diff") === sides[0]) oldNumber = number;
          else newNumber = number;
        } else {
          newNumber = Number(row.querySelector(".line-num2")?.textContent?.trim());
          oldNumber = Number(row.querySelector(".line-num1")?.textContent?.trim());
        }
        this.lines.push({
          element,
          row,
          html: element.innerHTML,
          className: element.className,
          text: element.textContent ?? "",
          language,
          fileIndex,
          oldNumber,
          newNumber,
          tokens: syntax?.[fileIndex]?.new[newNumber] ?? syntax?.[fileIndex]?.old[oldNumber],
          highlighted: false,
        });
      }
    });
    const toggle = document.getElementById("syntax-highlighting-toggle");
    if (toggle instanceof HTMLInputElement) {
      toggle.checked = this.args.getEnabled();
      toggle.onchange = () => {
        this.args.setEnabled(toggle.checked);
        this.apply();
      };
    }
    this.apply(this.lines.slice(firstNewLine));
  }

  // Semantic providers can enrich the already-visible lexical colors without
  // rebuilding the diff DOM, losing expanded context, or moving the viewport.
  public updateNative(syntax?: Array<FileSyntax | null>, fileIndexes?: number[]): void {
    const changed = fileIndexes ? new Set(fileIndexes) : undefined;
    this.preserveSelection(() => {
      for (const line of this.lines) {
        if (changed && !changed.has(line.fileIndex)) continue;
        const file = syntax?.[line.fileIndex];
        const tokens = file?.new[line.newNumber] ?? file?.old[line.oldNumber];
        if (sameTokens(line.tokens, tokens)) continue;
        line.tokens = tokens;
        if (this.args.getEnabled()) {
          this.restore(line);
          if (!line.row.hidden) this.highlight(line);
        }
      }
    });
  }

  public refreshVisible(): void {
    this.apply();
  }

  private restore(line: CodeLine): void {
    if (!line.highlighted) return;
    line.element.innerHTML = preserveCarriageReturns(line.html);
    line.element.className = line.className;
    line.highlighted = false;
  }

  private apply(lines = this.lines): void {
    const enabled = this.args.getEnabled();
    this.preserveSelection(() => {
      for (const line of lines) {
        if (enabled) {
          if (!line.highlighted && !line.row.hidden) this.highlight(line);
        } else this.restore(line);
      }
    });
  }

  // Recoloring replaces text nodes. Save logical endpoints once for the entire
  // update so a cross-line or backwards selection survives all changed rows.
  private preserveSelection(update: () => void): void {
    const selection = globalThis.getSelection?.();
    const capture = (node: Node | null, offset: number): SelectionPoint | undefined => {
      if (!node) return;
      const element = this.lines.find((line) => line.element.contains(node))?.element;
      if (!element) return { node, offset };
      const range = document.createRange();
      range.selectNodeContents(element);
      range.setEnd(node, offset);
      return {
        node,
        offset,
        line: {
          element,
          text: element.textContent ?? "",
          firstChild: element.firstChild,
          offset: range.toString().length,
        },
      };
    };
    const anchor = capture(selection?.anchorNode ?? null, selection?.anchorOffset ?? 0);
    const focus = capture(selection?.focusNode ?? null, selection?.focusOffset ?? 0);
    update();
    if (!selection || !anchor || !focus) return;
    if (![anchor, focus].some((point) => point.line && point.line.firstChild !== point.line.element.firstChild)) return;
    const resolve = (point: SelectionPoint): { node: Node; offset: number } | undefined => {
      if (!point.line) return point.node.isConnected ? point : undefined;
      const { element, text } = point.line;
      if (!element.isConnected || element.textContent !== text) return;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let offset = point.line.offset;
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const length = node.textContent?.length ?? 0;
        if (offset <= length) return { node, offset };
        offset -= length;
      }
      return { node: element, offset: element.childNodes.length };
    };
    const nextAnchor = resolve(anchor);
    const nextFocus = resolve(focus);
    if (nextAnchor && nextFocus)
      selection.setBaseAndExtent(nextAnchor.node, nextAnchor.offset, nextFocus.node, nextFocus.offset);
  }

  private highlight(line: CodeLine): void {
    if (line.tokens) this.applyTextMate(line, line.tokens);
    else if (line.text) this.applyFallback(line);
    line.highlighted = true;
  }

  private applyFallback({ element, language, text }: CodeLine): void {
    const result = closeTags(hljs.highlight(text, { language, ignoreIllegals: true }));
    const original = nodeStream(element);
    if (original.length) {
      const highlighted = document.createElement("span");
      highlighted.innerHTML = preserveCarriageReturns(result.value);
      result.value = mergeStreams(original, nodeStream(highlighted), text);
    }
    element.classList.add("hljs");
    if (result.language) element.classList.add(result.language);
    element.innerHTML = preserveCarriageReturns(result.value);
  }

  private applyTextMate({ element, text }: CodeLine, tokens: SyntaxToken[]): void {
    const highlighted = document.createDocumentFragment();
    let offset = 0;
    for (const token of tokens) {
      if (offset < token.start) highlighted.append(document.createTextNode(text.slice(offset, token.start)));
      const span = document.createElement("span");
      span.className = "diff-textmate-token";
      span.textContent = text.slice(token.start, token.end);
      span.style.color = token.color;
      if (token.fontStyle & 1) span.style.fontStyle = "italic";
      if (token.fontStyle & 2) span.style.fontWeight = "bold";
      if (token.fontStyle & 4) span.style.textDecoration = "underline";
      highlighted.append(span);
      offset = token.end;
    }
    if (offset < text.length) highlighted.append(document.createTextNode(text.slice(offset)));
    const original = nodeStream(element);
    if (original.length) {
      element.innerHTML = preserveCarriageReturns(mergeStreams(original, nodeStream(highlighted), text));
    } else {
      // Most rows have no intraline <ins>/<del> markup. Avoid serializing and
      // reparsing thousands of native spans just to insert those same nodes.
      element.replaceChildren(highlighted);
    }
  }
}

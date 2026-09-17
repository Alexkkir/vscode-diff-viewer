import type { FileSyntax, SyntaxToken } from "../../../shared/syntax";
import { nodeStream, mergeStreams } from "diff2html/lib/ui/js/highlight.js-helpers";

interface SyntaxRenderer {
  highlightCode(): void;
}

// highlight.js only tokenizes text. No language server or diagnostics are involved.
export class SyntaxHighlightingController {
  private container?: HTMLElement;
  private syntax?: Array<FileSyntax | null>;
  private renderer: SyntaxRenderer | undefined;
  private originalLines: Array<{ element: HTMLElement; html: string; className: string }> = [];

  constructor(private readonly args: { getEnabled: () => boolean; setEnabled: (enabled: boolean) => void }) {}

  public render(renderer: SyntaxRenderer, container: HTMLElement, syntax?: Array<FileSyntax | null>): void {
    this.container = container;
    this.syntax = syntax;
    this.renderer = renderer;
    // Revision-labelled diffs append metadata to the filename. diff2html includes
    // that suffix in data-lang, e.g. "md (working tree)", which resolves to plaintext.
    for (const file of container.querySelectorAll<HTMLElement>(".d2h-file-wrapper[data-lang]")) {
      const language = file.dataset.lang ?? "";
      file.dataset.lang = language.replace(/[ \t]+\((?:working tree|[a-f0-9]{7,64})\)$/i, "");
    }
    this.originalLines = Array.from(container.querySelectorAll<HTMLElement>(".d2h-code-line-ctn"), (element) => ({
      element,
      html: element.innerHTML,
      className: element.className,
    }));
    const toggle = document.getElementById("syntax-highlighting-toggle");
    if (toggle instanceof HTMLInputElement) {
      toggle.checked = this.args.getEnabled();
      toggle.onchange = () => {
        this.args.setEnabled(toggle.checked);
        this.apply();
      };
    }
    this.apply();
  }

  private apply(): void {
    for (const { element, html, className } of this.originalLines) {
      element.innerHTML = html;
      element.className = className;
    }
    if (this.args.getEnabled()) {
      this.renderer?.highlightCode();
      this.applyTextMate();
    }
  }
  private applyTextMate(): void {
    const originals = new Map(this.originalLines.map((line) => [line.element, line]));
    this.container?.querySelectorAll<HTMLElement>(".d2h-file-wrapper").forEach((file, index) => {
      const syntax = this.syntax?.[index];
      if (!syntax) return;
      const sides = Array.from(file.querySelectorAll(".d2h-file-side-diff"));
      file.querySelectorAll<HTMLElement>(".d2h-code-line-ctn").forEach((line) => {
        const row = line.closest("tr");
        if (!row) return;
        let tokens: SyntaxToken[] | undefined;
        if (sides.length) {
          const side = line.closest(".d2h-file-side-diff") === sides[0] ? "old" : "new";
          const number = Number(row.querySelector(".d2h-code-side-linenumber")?.textContent?.trim());
          tokens = syntax[side][number];
        } else {
          const newNumber = Number(row.querySelector(".line-num2")?.textContent?.trim());
          const oldNumber = Number(row.querySelector(".line-num1")?.textContent?.trim());
          tokens = syntax.new[newNumber] ?? syntax.old[oldNumber];
        }
        if (!tokens) return;
        const original = originals.get(line);
        if (!original) return;
        line.innerHTML = original.html;
        line.className = original.className;
        const text = line.textContent ?? "";
        const highlighted = document.createElement("span");
        for (const token of tokens) {
          const span = document.createElement("span");
          span.className = "diff-textmate-token";
          span.textContent = text.slice(token.start, token.end);
          span.style.color = token.color;
          if (token.fontStyle & 1) span.style.fontStyle = "italic";
          if (token.fontStyle & 2) span.style.fontWeight = "bold";
          if (token.fontStyle & 4) span.style.textDecoration = "underline";
          highlighted.append(span);
        }
        line.innerHTML = mergeStreams(nodeStream(line), nodeStream(highlighted), text);
      });
    });
  }
}

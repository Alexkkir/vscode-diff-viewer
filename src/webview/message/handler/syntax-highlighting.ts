interface SyntaxRenderer {
  highlightCode(): void;
}

// highlight.js only tokenizes text. No language server or diagnostics are involved.
export class SyntaxHighlightingController {
  private renderer: SyntaxRenderer | undefined;
  private originalLines: Array<{ element: HTMLElement; html: string; className: string }> = [];

  constructor(private readonly args: { getEnabled: () => boolean; setEnabled: (enabled: boolean) => void }) {}

  public render(renderer: SyntaxRenderer, container: HTMLElement): void {
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
    if (this.args.getEnabled()) this.renderer?.highlightCode();
  }
}

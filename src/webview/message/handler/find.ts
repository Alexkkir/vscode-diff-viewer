// Search DOM text rather than HTML so syntax-highlight spans do not split matches.
export function findTextRanges(root: HTMLElement, query: string, matchCase = false): Range[] {
  if (!query) return [];
  const ranges: Range[] = [];
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), matchCase ? "gu" : "giu");
  for (const block of root.querySelectorAll<HTMLElement>(".d2h-code-line-ctn, .d2h-file-name")) {
    const matches = Array.from((block.textContent ?? "").matchAll(pattern));
    if (!matches.length) continue;
    // Folded context remains searchable, but collapsed files and other hidden
    // content are excluded, like the native browser find widget.
    let hidden = false;
    for (let parent: HTMLElement | null = block; parent; parent = parent.parentElement) {
      const foldedContext = parent.matches("tr.diff-context-hidden");
      if (
        parent.classList.contains("d2h-file-collapse") ||
        (!foldedContext && (parent.hidden || getComputedStyle(parent).display === "none"))
      ) {
        hidden = true;
        break;
      }
    }
    if (hidden) continue;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) nodes.push(node as Text);
    for (const match of matches) {
      const range = document.createRange();
      const start = match.index;
      const end = start + match[0].length;
      let offset = 0;
      for (const textNode of nodes) {
        const next = offset + textNode.length;
        if (start >= offset && start < next) range.setStart(textNode, start - offset);
        if (end > offset && end <= next) {
          range.setEnd(textNode, end - offset);
          break;
        }
        offset = next;
      }
      ranges.push(range);
    }
  }
  return ranges;
}

export class FindController {
  // Keep all matches navigable, but avoid asking Chromium to paint hundreds of
  // thousands of off-screen ranges on every keystroke or content update.
  private static readonly maxPaintedMatches = 2000;
  private suspended = false;
  private restoreOpen = false;
  private panel: HTMLElement | undefined;
  private input!: HTMLInputElement;
  private count!: HTMLElement;
  private matchCase!: HTMLInputElement;
  private ranges: Range[] = [];
  private index = 0;

  constructor(private readonly options: { revealMatch?: (element: HTMLElement) => void } = {}) {}

  public suspend(): void {
    this.suspended = true;
    this.restoreOpen ||= !!this.panel && !this.panel.hidden;
    if (this.panel) this.panel.hidden = true;
    if (globalThis.CSS?.highlights) {
      CSS.highlights.delete("diff-find");
      CSS.highlights.delete("diff-find-current");
    }
    this.ranges = [];
  }

  public resume(): void {
    this.suspended = false;
    if (this.panel && this.restoreOpen) this.panel.hidden = false;
    this.restoreOpen = false;
    this.refresh();
  }

  public open(): void {
    this.ensurePanel();
    this.panel!.hidden = false;
    this.refresh();
    // Focus only in response to the user's Find command, never on resize/visibility changes.
    this.input.focus({ preventScroll: true });
    this.input.select();
  }

  public refresh(): void {
    if (this.suspended || !this.panel || this.panel.hidden) return;
    const root = document.getElementById("diff-container");
    this.ranges = root ? findTextRanges(root, this.input.value, this.matchCase.checked) : [];
    this.index = Math.min(this.index, Math.max(0, this.ranges.length - 1));
    this.paint();
  }

  private close(): void {
    this.panel!.hidden = true;
    CSS.highlights.delete("diff-find");
    CSS.highlights.delete("diff-find-current");
    this.input.blur();
  }

  private move(step: number): void {
    if (!this.ranges.length) return;
    this.index = (this.index + step + this.ranges.length) % this.ranges.length;
    this.paint();
    this.reveal();
  }

  private reveal(): void {
    const element = this.ranges[this.index]?.startContainer.parentElement;
    if (!element) return;
    this.options.revealMatch?.(element);
    element.scrollIntoView({ block: "center", inline: "nearest" });
  }

  private paint(): void {
    const first = Math.max(0, this.index - Math.floor(FindController.maxPaintedMatches / 2));
    const last = Math.min(this.ranges.length, first + FindController.maxPaintedMatches);
    const matches = new Highlight();
    for (let index = first; index < last; index++) matches.add(this.ranges[index]);
    CSS.highlights.set("diff-find", matches);
    const current = this.ranges[this.index];
    CSS.highlights.set("diff-find-current", new Highlight(...(current ? [current] : [])));
    this.count.textContent = this.input.value ? `${current ? this.index + 1 : 0} / ${this.ranges.length}` : "";
  }

  private ensurePanel(): void {
    if (this.panel) return;
    this.panel = document.createElement("div");
    this.panel.id = "diff-find-widget";
    this.panel.setAttribute("role", "search");
    this.panel.setAttribute("aria-label", "Find in diff");
    this.panel.innerHTML = `<input type="text" aria-label="Find in diff" placeholder="Find in diff" />
      <span aria-live="polite"></span>
      <label title="Match case"><input type="checkbox" aria-label="Match case" />Aa</label>
      <button type="button" aria-label="Previous match" title="Previous match (Shift+Enter)">↑</button>
      <button type="button" aria-label="Next match" title="Next match (Enter)">↓</button>
      <button type="button" aria-label="Close find" title="Close (Escape)">×</button>`;
    document.body.append(this.panel);
    const root = document.getElementById("diff-container");
    if (root) {
      new MutationObserver(() => this.refresh()).observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "style", "hidden"],
      });
    }
    this.input = this.panel.querySelector<HTMLInputElement>('input[type="text"]')!;
    this.input.dataset.vscodeContext = JSON.stringify({
      webviewSection: "findInput",
      preventDefaultContextMenuItems: false,
    });
    this.matchCase = this.panel.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    this.count = this.panel.querySelector("span")!;
    const update = () => {
      this.index = 0;
      this.refresh();
      this.reveal();
    };
    this.input.addEventListener("input", update);
    this.matchCase.addEventListener("change", update);
    const buttons = this.panel.querySelectorAll("button");
    buttons[0].addEventListener("click", () => this.move(-1));
    buttons[1].addEventListener("click", () => this.move(1));
    buttons[2].addEventListener("click", () => this.close());
    this.panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape" || event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        if (event.key === "Escape") this.close();
        else this.move(event.shiftKey ? -1 : 1);
      }
    });
  }
}

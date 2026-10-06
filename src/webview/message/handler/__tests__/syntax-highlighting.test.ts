/** @jest-environment jsdom */
import { Diff2HtmlUI } from "diff2html/lib/ui/js/diff2html-ui-slim.js";
import { hljs } from "diff2html/lib/ui/js/highlight.js-slim";
import { SyntaxHighlightingController } from "../syntax-highlighting";
import { parseDiff } from "../../../../shared/diff";
import { AlignedDiff2HtmlUI } from "../aligned-diff-renderer";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("syntax highlighting toggle", () => {
  const diff =
    "diff --git a/demo.py b/demo.py\n--- a/demo.py\n+++ b/demo.py\n@@ -1 +1,3 @@\n-old\n+from missing_module import unknown_name\n+def example():\n+    return 42\n";
  beforeEach(() => {
    document.body.innerHTML = '<input type="checkbox" id="syntax-highlighting-toggle"><div id="diff-container"></div>';
  });
  it("colors Python tokens without resolving imports and restores exact markup when disabled", () => {
    const root = document.getElementById("diff-container")!;
    const renderer = new Diff2HtmlUI(root, diff, { highlight: false });
    renderer.draw();
    const original = root.textContent;
    const originalMarkup = Array.from(root.querySelectorAll(".d2h-code-line-ctn"), (line) => line.innerHTML);
    let enabled = true;
    const save = jest.fn((value: boolean) => {
      enabled = value;
    });
    const controller = new SyntaxHighlightingController({ getEnabled: () => enabled, setEnabled: save });
    controller.render(root);
    expect(root.querySelectorAll(".hljs-keyword").length).toBeGreaterThan(0);
    expect(root.textContent).toBe(original);
    const toggle = document.getElementById("syntax-highlighting-toggle") as HTMLInputElement;
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));
    expect(save).toHaveBeenCalledWith(false);
    expect(root.querySelectorAll('[class^="hljs-"]')).toHaveLength(0);
    expect(Array.from(root.querySelectorAll(".d2h-code-line-ctn"), (line) => line.innerHTML)).toEqual(originalMarkup);
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    expect(root.querySelectorAll(".hljs-keyword").length).toBeGreaterThan(0);
    expect(root.textContent).toBe(original);
  });
  it.each([
    " (working tree)",
    "\t(working tree)",
    " (446896b256014781a4d94f1ccc267c8615eb1474)",
    "\t(446896b256014781a4d94f1ccc267c8615eb1474)",
  ])("highlights Markdown with a revision suffix (%s)", (revision) => {
    const root = document.getElementById("diff-container")!;
    const name = `docs/failure_handling.md${revision}`;
    const patch = `--- ${name}\n+++ ${name}\n@@ -1 +1,2 @@\n-old\n+# Failure Handling\n+Use \`code\` here\n`;
    const files = parseDiff(patch);
    const renderer = new AlignedDiff2HtmlUI(root, files, { highlight: false });
    renderer.draw();
    const original = root.textContent;
    new SyntaxHighlightingController({ getEnabled: () => true, setEnabled: jest.fn() }).render(root);
    expect(root.querySelector(".hljs-section")?.textContent).toBe("# Failure Handling");
    expect(root.querySelector(".hljs-code")?.textContent).toBe("`code`");
    expect(root.textContent).toBe(original);
  });
  it("keeps a literal Git filename ending in an Arc-like suffix as plaintext", () => {
    const fixtures: Array<{ id: string; patch: string }> = JSON.parse(
      readFileSync(join(__dirname, "../../../../shared/testing/git-source-fidelity.json"), "utf8"),
    );
    const fixture = fixtures.find(({ id }) => id === "arc-literal-extension")!;
    const files = parseDiff(fixture.patch);
    expect(files[0].language).toBe("py (working tree)");
    const root = document.getElementById("diff-container")!;
    new AlignedDiff2HtmlUI(root, files, { highlight: false }).draw();
    const original = root.textContent;
    new SyntaxHighlightingController({ getEnabled: () => true, setEnabled: jest.fn() }).render(root);
    expect(root.querySelector(".d2h-code-line-ctn")?.classList.contains("plaintext")).toBe(true);
    expect(root.querySelector(".hljs-string")).toBeNull();
    expect(root.textContent).toBe(original);
  });
  it.each(["line-by-line", "side-by-side"] as const)(
    "applies native theme tokens in %s and preserves toggle restoration",
    (outputFormat) => {
      const root = document.getElementById("diff-container")!;
      const renderer = new Diff2HtmlUI(root, diff, { highlight: false, outputFormat });
      renderer.draw();
      const original = root.textContent;
      let enabled = true;
      const controller = new SyntaxHighlightingController({
        getEnabled: () => enabled,
        setEnabled: (value) => {
          enabled = value;
        },
      });
      controller.render(root, [
        {
          old: {},
          new: {
            2: [
              { start: 0, end: 3, color: "#569cd6", fontStyle: 0 },
              { start: 3, end: 14, color: "#dcdcaa", fontStyle: 0 },
            ],
          },
        },
      ]);
      const native = root.querySelector<HTMLElement>(".diff-textmate-token")!;
      expect(native.textContent).toBe("def");
      expect(native.style.color).toBe("rgb(86, 156, 214)");
      expect(root.textContent).toBe(original);
      const toggle = document.getElementById("syntax-highlighting-toggle") as HTMLInputElement;
      toggle.checked = false;
      toggle.dispatchEvent(new Event("change"));
      expect(root.querySelector(".diff-textmate-token")).toBeNull();
      expect(root.textContent).toBe(original);
    },
  );
  it("keeps highlighting disabled after rendering updated diff contents", () => {
    const root = document.getElementById("diff-container")!;
    const controller = new SyntaxHighlightingController({ getEnabled: () => false, setEnabled: jest.fn() });
    for (const value of [diff, diff.replace("42", "99")]) {
      const renderer = new Diff2HtmlUI(root, value, { highlight: false });
      renderer.draw();
      controller.render(root);
      expect(root.querySelectorAll('[class^="hljs-"]')).toHaveLength(0);
      expect((document.getElementById("syntax-highlighting-toggle") as HTMLInputElement).checked).toBe(false);
    }
    expect(root.textContent).toContain("99");
  });
  it("uses highlight.js only for lines without native tokens", () => {
    const root = document.getElementById("diff-container")!;
    const renderer = new Diff2HtmlUI(root, diff, { highlight: false, outputFormat: "side-by-side" });
    renderer.draw();
    const fallback = jest.spyOn(hljs, "highlight");
    try {
      const controller = new SyntaxHighlightingController({ getEnabled: () => true, setEnabled: jest.fn() });
      controller.render(root, [
        {
          old: { 1: [{ start: 0, end: 3, color: "#aaaaaa", fontStyle: 0 }] },
          new: { 2: [{ start: 0, end: 14, color: "#bbbbbb", fontStyle: 0 }] },
        },
      ]);
      expect(fallback.mock.calls.map(([text]) => text)).toEqual([
        "from missing_module import unknown_name",
        "    return 42",
      ]);
      expect(root.querySelector(".hljs-keyword")?.textContent).toBe("from");
      expect(root.querySelector(".diff-textmate-token")?.textContent).toBe("old");
    } finally {
      fallback.mockRestore();
    }
  });

  it.each(["line-by-line", "side-by-side"] as const)(
    "updates only changed native colors in %s while preserving diff markup and toggle state",
    (outputFormat) => {
      const root = document.getElementById("diff-container")!;
      const patch = "--- a/demo.py\n+++ b/demo.py\n@@ -1,2 +1,2 @@\n stable = 0\n-value = 12\n+value = 13\n";
      const renderer = new Diff2HtmlUI(root, patch, { highlight: false, outputFormat, matching: "lines" });
      renderer.draw();
      const original = root.textContent;
      const originalMarkup = Array.from(root.querySelectorAll(".d2h-code-line-ctn"), (line) => line.innerHTML);
      expect(root.querySelectorAll("ins, del").length).toBeGreaterThan(0);
      let enabled = true;
      const controller = new SyntaxHighlightingController({
        getEnabled: () => enabled,
        setEnabled: (value) => {
          enabled = value;
        },
      });
      const native = (color: string) => [
        {
          old: {
            1: [{ start: 0, end: 10, color: "#aabbcc", fontStyle: 0 }],
            2: [{ start: 0, end: 10, color: "#aabbcc", fontStyle: 0 }],
          },
          new: {
            1: [{ start: 0, end: 10, color: "#aabbcc", fontStyle: 0 }],
            2: [{ start: 0, end: 10, color, fontStyle: 0 }],
          },
        },
      ];
      controller.render(root, native("#112233"));
      const stable = Array.from(root.querySelectorAll(".d2h-code-line-ctn")).find(
        (line) => line.textContent === "stable = 0",
      )!.firstChild;
      controller.updateNative(native("#abcdef"));
      expect(stable?.isConnected).toBe(true);
      expect(root.querySelectorAll("ins, del").length).toBeGreaterThan(0);
      expect(root.textContent).toBe(original);
      expect(
        Array.from(root.querySelectorAll<HTMLElement>(".diff-textmate-token")).some(
          (token) => token.style.color === "rgb(171, 205, 239)",
        ),
      ).toBe(true);
      const toggle = document.getElementById("syntax-highlighting-toggle") as HTMLInputElement;
      toggle.checked = false;
      toggle.dispatchEvent(new Event("change"));
      controller.updateNative(native("#123456"));
      expect(root.querySelector(".diff-textmate-token")).toBeNull();
      expect(Array.from(root.querySelectorAll(".d2h-code-line-ctn"), (line) => line.innerHTML)).toEqual(originalMarkup);
      toggle.checked = true;
      toggle.dispatchEvent(new Event("change"));
      expect(
        Array.from(root.querySelectorAll<HTMLElement>(".diff-textmate-token")).some(
          (token) => token.style.color === "rgb(18, 52, 86)",
        ),
      ).toBe(true);
      expect(root.textContent).toBe(original);
    },
  );
  it("colors folded lines only when revealed, using the latest native tokens", () => {
    const root = document.getElementById("diff-container")!;
    new Diff2HtmlUI(root, diff, { highlight: false }).draw();
    const line = Array.from(root.querySelectorAll<HTMLElement>(".d2h-code-line-ctn")).find(
      (element) => element.textContent === "def example():",
    )!;
    const row = line.closest("tr")!;
    row.hidden = true;
    row.classList.add("diff-context-hidden");
    const controller = new SyntaxHighlightingController({ getEnabled: () => true, setEnabled: jest.fn() });
    const native = (color: string) => [{ old: {}, new: { 2: [{ start: 0, end: 14, color, fontStyle: 0 }] } }];
    controller.render(root, native("#112233"));
    expect(line.querySelector(".diff-textmate-token")).toBeNull();
    expect(line.textContent).toBe("def example():");
    controller.updateNative(native("#abcdef"));
    expect(line.querySelector(".diff-textmate-token")).toBeNull();
    row.hidden = false;
    row.classList.remove("diff-context-hidden");
    controller.refreshVisible();
    expect(line.querySelector<HTMLElement>(".diff-textmate-token")?.style.color).toBe("rgb(171, 205, 239)");
    expect(line.textContent).toBe("def example():");
    const colored = line.firstChild;
    controller.refreshVisible();
    expect(line.firstChild).toBe(colored);
  });

  it.each([false, true])("preserves partial cross-line selection and its direction (backwards=%s)", (backwards) => {
    const root = document.getElementById("diff-container")!;
    new Diff2HtmlUI(
      root,
      "--- a/demo.py\n+++ b/demo.py\n@@ -1,2 +1,2 @@\n-old_first = 0\n-old_second = 0\n+first_value = 12\n+second_value = 34\n",
      {
        highlight: false,
        matching: "lines",
      },
    ).draw();
    let enabled = true;
    const controller = new SyntaxHighlightingController({
      getEnabled: () => enabled,
      setEnabled: (value) => {
        enabled = value;
      },
    });
    const native = (color: string) => [
      {
        old: {},
        new: {
          1: [
            { start: 0, end: 5, color, fontStyle: 0 },
            { start: 5, end: 16, color: "#aabbcc", fontStyle: 0 },
          ],
          2: [
            { start: 0, end: 6, color, fontStyle: 0 },
            { start: 6, end: 17, color: "#aabbcc", fontStyle: 0 },
          ],
        },
      },
    ];
    controller.render(root, native("#123456"));
    const code = (text: string) =>
      Array.from(root.querySelectorAll<HTMLElement>(".d2h-code-line-ctn")).find((line) => line.textContent === text)!;
    const first = code("first_value = 12");
    const second = code("second_value = 34");
    const selection = getSelection()!;
    const point = (line: HTMLElement, offset: number) => {
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode()!;
      while (offset > node.textContent!.length) {
        offset -= node.textContent!.length;
        node = walker.nextNode()!;
      }
      return { node, offset };
    };
    const start = point(first, 2),
      end = point(second, 10);
    const [anchor, focus] = backwards ? [end, start] : [start, end];
    selection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
    const selected = selection.toString();
    const logicalEndpoint = (node: Node | null, offset: number) => {
      const line = node === first || first.contains(node) ? first : second;
      const range = document.createRange();
      range.selectNodeContents(line);
      range.setEnd(node!, offset);
      return { line: line.textContent, offset: range.toString().length };
    };
    const endpoints = () => [
      logicalEndpoint(selection.anchorNode, selection.anchorOffset),
      logicalEndpoint(selection.focusNode, selection.focusOffset),
    ];
    const expectedEndpoints = endpoints();
    controller.updateNative(native("#abcdef"));
    expect(selection.toString()).toBe(selected);
    expect(endpoints()).toEqual(expectedEndpoints);
    expect(anchor.node.isConnected).toBe(false);
    const unchangedAnchor = selection.anchorNode;
    controller.updateNative(native("#abcdef"));
    expect(selection.anchorNode).toBe(unchangedAnchor);
    const toggle = document.getElementById("syntax-highlighting-toggle") as HTMLInputElement;
    for (const checked of [false, true]) {
      toggle.checked = checked;
      toggle.dispatchEvent(new Event("change"));
      expect(selection.toString()).toBe(selected);
      expect(endpoints()).toEqual(expectedEndpoints);
    }
  });

  it.each([false, true])(
    "preserves CR characters through native/fallback coloring, recoloring and toggle (markup=%s)",
    (markup) => {
      const root = document.getElementById("diff-container")!;
      const text = 'value = "left\rright"';
      root.innerHTML = `<div class="d2h-file-wrapper" data-lang="py"><table><tbody><tr><td><span class="line-num2">1</span></td><td><span class="d2h-code-line-ctn">${markup ? "<ins>value</ins>" : "value"} = &quot;left&#13;right&quot;</span></td></tr></tbody></table></div>`;
      const line = root.querySelector<HTMLElement>(".d2h-code-line-ctn")!;
      let enabled = true;
      const controller = new SyntaxHighlightingController({
        getEnabled: () => enabled,
        setEnabled: (value) => {
          enabled = value;
        },
      });
      const native = (color: string) => [
        { old: {}, new: { 1: [{ start: 0, end: text.length, color, fontStyle: 0 }] } },
      ];
      controller.render(root);
      expect(line.textContent).toBe(text);
      controller.updateNative(native("#123456"));
      expect(line.textContent).toBe(text);
      controller.updateNative(native("#abcdef"));
      expect(line.textContent).toBe(text);
      const toggle = document.getElementById("syntax-highlighting-toggle") as HTMLInputElement;
      for (const checked of [false, true]) {
        toggle.checked = checked;
        toggle.dispatchEvent(new Event("change"));
        expect(line.textContent).toBe(text);
      }
      if (markup) expect(line.querySelector("ins")?.textContent).toBe("value");
    },
  );
});

/** @jest-environment jsdom */
import { Diff2HtmlUI } from "diff2html/lib/ui/js/diff2html-ui-slim.js";
import { SyntaxHighlightingController } from "../syntax-highlighting";

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
    controller.render(renderer, root);
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
    const renderer = new Diff2HtmlUI(root, patch, { highlight: false });
    renderer.draw();
    const original = root.textContent;
    new SyntaxHighlightingController({ getEnabled: () => true, setEnabled: jest.fn() }).render(renderer, root);
    expect(root.querySelector(".hljs-section")?.textContent).toBe("# Failure Handling");
    expect(root.querySelector(".hljs-code")?.textContent).toBe("`code`");
    expect(root.textContent).toBe(original);
  });
  it("keeps highlighting disabled after rendering updated diff contents", () => {
    const root = document.getElementById("diff-container")!;
    const controller = new SyntaxHighlightingController({ getEnabled: () => false, setEnabled: jest.fn() });
    for (const value of [diff, diff.replace("42", "99")]) {
      const renderer = new Diff2HtmlUI(root, value, { highlight: false });
      renderer.draw();
      controller.render(renderer, root);
      expect(root.querySelectorAll('[class^="hljs-"]')).toHaveLength(0);
      expect((document.getElementById("syntax-highlighting-toggle") as HTMLInputElement).checked).toBe(false);
    }
    expect(root.textContent).toContain("99");
  });
});

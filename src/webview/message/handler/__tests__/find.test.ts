/** @jest-environment jsdom */
import { FindController, findTextRanges } from "../find";

describe("diff find", () => {
  let highlights: Map<string, unknown>;
  beforeEach(() => {
    document.body.innerHTML = `<div id="diff-container"><span class="d2h-code-line-ctn"><b>Hello</b> World hello</span><span class="d2h-code-line-ctn">a.b [x]</span><div style="display:none"><span class="d2h-code-line-ctn">hello</span></div></div>`;
    highlights = new Map();
    Object.defineProperty(globalThis, "CSS", { configurable: true, value: { highlights } });
    Object.defineProperty(globalThis, "Highlight", {
      configurable: true,
      value: class {
        constructor(...ranges: Range[]) {
          return ranges;
        }
      },
    });
    HTMLElement.prototype.scrollIntoView = jest.fn();
  });
  it("matches text across syntax spans, respects case and excludes collapsed content", () => {
    const root = document.getElementById("diff-container")!;
    expect(findTextRanges(root, "hello world").map((r) => r.toString())).toEqual(["Hello World"]);
    expect(findTextRanges(root, "hello")).toHaveLength(2);
    expect(findTextRanges(root, "hello", true)).toHaveLength(1);
    expect(findTextRanges(root, "[x]").map((r) => r.toString())).toEqual(["[x]"]);
    expect(findTextRanges(root, "a.b").map((r) => r.toString())).toEqual(["a.b"]);
    expect(findTextRanges(root, "")).toHaveLength(0);
  });
  it("searches folded context while respecting collapsed files and other hidden ancestors", () => {
    const root = document.getElementById("diff-container")!;
    const folded = `<table><tbody><tr class="diff-context-hidden" hidden style="display:none"><td><span class="d2h-code-line-ctn"><b>folded</b> match</span></td></tr></tbody></table>`;
    root.innerHTML = `${folded}
      <div class="d2h-file-collapse">${folded}</div>
      <div hidden>${folded}</div>
      <div style="display:none">${folded}</div>
      <div class="diff-context-hidden" hidden><span class="d2h-code-line-ctn">folded match</span></div>
      <table><tbody><tr class="diff-context-hidden" hidden><td hidden><span class="d2h-code-line-ctn">folded match</span></td></tr></tbody></table>`;
    expect(findTextRanges(root, "folded match").map((range) => range.toString())).toEqual(["folded match"]);
  });
  it("reveals folded matches on user input and navigation, but not on refresh", () => {
    document.getElementById("diff-container")!.innerHTML = `<table><tbody>
      <tr class="diff-context-hidden" hidden><td><span class="d2h-code-line-ctn"><b>match</b> one</span></td></tr>
      <tr class="diff-context-hidden" hidden><td><span class="d2h-code-line-ctn"><b>match</b> two</span></td></tr>
      </tbody></table>`;
    const revealMatch = jest.fn((element: HTMLElement) => {
      const row = element.closest("tr")!;
      row.classList.remove("diff-context-hidden");
      row.hidden = false;
    });
    const controller = new FindController({ revealMatch });
    controller.open();
    const input = document.querySelector<HTMLInputElement>('#diff-find-widget input[type="text"]')!;
    input.value = "match";
    input.dispatchEvent(new Event("input"));
    expect(revealMatch).toHaveBeenCalledTimes(1);
    expect(revealMatch.mock.calls[0][0].closest("tr")!.hidden).toBe(false);
    expect(revealMatch.mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(HTMLElement.prototype.scrollIntoView).mock.invocationCallOrder[0],
    );
    expect(document.querySelector("#diff-find-widget span")!.textContent).toBe("1 / 2");
    input.blur();
    const focus = jest.spyOn(input, "focus");
    jest.mocked(HTMLElement.prototype.scrollIntoView).mockClear();
    controller.refresh();
    expect(revealMatch).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll("tr[hidden]")).toHaveLength(1);
    expect(focus).not.toHaveBeenCalled();
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(revealMatch).toHaveBeenCalledTimes(2);
    expect(document.querySelectorAll("tr[hidden]")).toHaveLength(0);
    expect(document.querySelector("#diff-find-widget span")!.textContent).toBe("2 / 2");
  });
  it("navigates and wraps matches, closes, and never takes focus on refresh", () => {
    const controller = new FindController();
    controller.open();
    const input = document.querySelector<HTMLInputElement>('#diff-find-widget input[type="text"]')!;
    const count = document.querySelector("#diff-find-widget span")!;
    input.value = "hello";
    input.dispatchEvent(new Event("input"));
    expect(count.textContent).toBe("1 / 2");
    expect(highlights.get("diff-find")).toHaveLength(2);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(count.textContent).toBe("2 / 2");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(count.textContent).toBe("1 / 2");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }));
    expect(count.textContent).toBe("2 / 2");
    input.blur();
    const focus = jest.spyOn(input, "focus");
    jest.mocked(HTMLElement.prototype.scrollIntoView).mockClear();
    controller.refresh();
    expect(focus).not.toHaveBeenCalled();
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.getElementById("diff-find-widget")!.hidden).toBe(true);
    expect(highlights.size).toBe(0);
  });
  it("rebuilds ranges after a diff rerender and reports no matches", () => {
    const controller = new FindController();
    controller.open();
    const input = document.querySelector<HTMLInputElement>('#diff-find-widget input[type="text"]')!;
    input.value = "hello";
    input.dispatchEvent(new Event("input"));
    document.getElementById("diff-container")!.innerHTML = '<span class="d2h-code-line-ctn">goodbye</span>';
    controller.refresh();
    expect(document.querySelector("#diff-find-widget span")!.textContent).toBe("0 / 0");
    expect(highlights.get("diff-find")).toHaveLength(0);
  });
});

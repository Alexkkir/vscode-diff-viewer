/** @jest-environment jsdom */

import { FileDomBinding } from "../types";
import { captureViewState, restoreViewState } from "../view-state";
import { parseDiff } from "../../../../shared/diff";
import { renderAlignedDiffHtml } from "../aligned-diff-renderer";

function rect(element: HTMLElement, top: number, height: number): void {
  element.getBoundingClientRect = () => ({ top, bottom: top + height, height }) as DOMRect;
}

function binding(path: string, offsets: number[]): FileDomBinding {
  const fileContainer = document.createElement("div");
  fileContainer.innerHTML = `<div class="d2h-file-header"></div><div class="d2h-file-diff">${
    offsets.length === 2 ? '<div class="d2h-file-side-diff"></div><div class="d2h-file-side-diff"></div>' : ""
  }</div>`;
  const panes = Array.from(
    fileContainer.querySelectorAll<HTMLElement>(offsets.length === 2 ? ".d2h-file-side-diff" : ".d2h-file-diff"),
  );
  panes.forEach((pane, index) => (pane.scrollLeft = offsets[index]));
  return { fileContainer, fileNameText: path, filePath: path };
}

function row(binding: FileDomBinding, side: "old" | "new" | "unified", number: number, top: number): HTMLElement {
  const element = document.createElement("tr");
  element.innerHTML =
    side === "unified"
      ? `<td class="d2h-code-linenumber"><span class="line-num1">${number}</span><span class="line-num2">${number}</span></td>`
      : `<td class="d2h-code-side-linenumber">${number}</td>`;
  const target =
    side === "unified"
      ? binding.fileContainer.querySelector(".d2h-file-diff")
      : binding.fileContainer.querySelectorAll(".d2h-file-side-diff")[side === "old" ? 0 : 1];
  target!.append(element);
  rect(element, top, 20);
  return element;
}

describe("rendered view position across redraws", () => {
  beforeEach(() => {
    jest.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    Object.defineProperty(window, "scrollY", { configurable: true, value: 1000 });
  });

  afterEach(() => jest.restoreAllMocks());

  it("keeps separate file/pane offsets after file reordering, including clamped narrow panes", () => {
    const state = captureViewState([binding("first.ts", [80, 430]), binding("second.ts", [190, 190])]);
    const next = [binding("second.ts", [0, 0]), binding("first.ts", [0, 0])];
    restoreViewState(state, next);
    expect(
      next.map((file) =>
        Array.from(file.fileContainer.querySelectorAll(".d2h-file-side-diff"), (pane) => pane.scrollLeft),
      ),
    ).toEqual([
      [190, 190],
      [80, 430],
    ]);
  });

  it("retains duplicate-path occurrences and leaves new files at their initial position", () => {
    const state = captureViewState([binding("same.ts", [123]), binding("same.ts", [234])]);
    const next = [binding("same.ts", [0]), binding("same.ts", [0]), binding("new.ts", [0])];
    restoreViewState(state, next);
    expect(next.map((file) => file.fileContainer.querySelector(".d2h-file-diff")!.scrollLeft)).toEqual([123, 234, 0]);
  });

  it.each([
    { before: [430], after: [0, 0], expected: [430, 430] },
    { before: [80, 430], after: [0], expected: [430] },
  ])("maps horizontal offsets when changing layouts ($before)", ({ before, after, expected }) => {
    const state = captureViewState([binding("file.ts", before)]);
    const next = binding("file.ts", after);
    restoreViewState(state, [next]);
    const selector = after.length === 2 ? ".d2h-file-side-diff" : ".d2h-file-diff";
    expect(Array.from(next.fileContainer.querySelectorAll(selector), (pane) => pane.scrollLeft)).toEqual(expected);
  });

  it("keeps the source line below a sticky header at the same viewport offset on layout changes", () => {
    const previous = binding("file.ts", [120]);
    rect(previous.fileContainer, -100, 1500);
    rect(previous.fileContainer.querySelector<HTMLElement>(".d2h-file-header")!, 0, 40);
    row(previous, "unified", 80, 12);
    row(previous, "unified", 81, 32);
    row(previous, "unified", 82, 52);
    const state = captureViewState([previous]);
    expect(state.anchor?.line).toEqual({ side: "new", number: 81 });

    const next = binding("file.ts", [0, 0]);
    row(next, "old", 81, -28);
    row(next, "new", 81, -28);
    restoreViewState(state, [next]);
    expect(window.scrollTo).toHaveBeenCalledWith(0, 940);
  });

  it("uses a visible deletion when the new pane begins lower, then resolves its old line in unified layout", () => {
    const previous = binding("file.ts", [120, 120]);
    rect(previous.fileContainer, -100, 1500);
    rect(previous.fileContainer.querySelector<HTMLElement>(".d2h-file-header")!, 0, 40);
    row(previous, "old", 81, 40);
    row(previous, "new", 82, 60);
    const state = captureViewState([previous]);
    expect(state.anchor?.line).toEqual({ side: "old", number: 81 });
    const next = binding("file.ts", [0]);
    const deleted = row(next, "unified", 81, 140);
    deleted.querySelector(".line-num2")!.textContent = "";
    restoreViewState(state, [next]);
    expect(window.scrollTo).toHaveBeenCalledWith(0, 1100);
  });

  it("falls back to the prior page position when the source row disappears or becomes hidden", () => {
    const previous = binding("file.ts", [120]);
    rect(previous.fileContainer, -100, 1500);
    row(previous, "unified", 81, 40);
    const state = captureViewState([previous]);
    Object.defineProperty(window, "scrollY", { configurable: true, value: 200 });
    const next = binding("file.ts", [0]);
    const hidden = row(next, "unified", 81, 0);
    rect(hidden, 0, 0);
    restoreViewState(state, [next]);
    expect(window.scrollTo).toHaveBeenCalledWith(0, 1000);
  });

  it.each(["line-by-line", "side-by-side"] as const)(
    "retains the same rendered source after lines are inserted above it in %s",
    (outputFormat) => {
      const render = (inserted: number): FileDomBinding => {
        const patch = [
          "diff --git a/file.ts b/file.ts",
          "--- a/file.ts",
          "+++ b/file.ts",
          `@@ -1,160 +1,${160 + inserted} @@`,
          ...Array.from({ length: inserted }, (_, index) => `+inserted_${index}`),
          ...Array.from({ length: 160 }, (_, index) => (index === 119 ? "-old120\n+new120" : ` source_${index + 1}`)),
        ].join("\n");
        const root = document.createElement("div");
        root.innerHTML = renderAlignedDiffHtml(parseDiff(patch), { outputFormat, drawFileList: false });
        return {
          fileContainer: root.querySelector<HTMLElement>(".d2h-file-wrapper")!,
          filePath: "file.ts",
          fileNameText: "file.ts",
        };
      };
      const sourceRow = (file: FileDomBinding) =>
        Array.from(file.fileContainer.querySelectorAll<HTMLTableRowElement>("tr")).find(
          (row) => row.querySelector(".d2h-code-line-ctn")?.textContent === "source_100",
        )!;
      const previous = render(0);
      const offset = 40 - sourceRow(previous).rowIndex * 20;
      const position = (file: FileDomBinding) => {
        rect(file.fileContainer, -2000, 5000);
        rect(file.fileContainer.querySelector<HTMLElement>(".d2h-file-header")!, 0, 40);
        file.fileContainer.querySelectorAll<HTMLTableRowElement>("tr").forEach((row) => {
          rect(row, offset + row.rowIndex * 20, 20);
        });
      };
      position(previous);
      const state = captureViewState([previous]);
      expect(state.anchor?.source).toEqual({ text: "source_100", old: 100, new: 100 });
      const next = render(20);
      position(next);
      expect(sourceRow(next).getBoundingClientRect().top).toBe(440);
      restoreViewState(state, [next]);
      expect(window.scrollTo).toHaveBeenCalledWith(0, 1400);
    },
  );

  it("uses unique source text when an added line moves, but does not guess among repeated lines", () => {
    const previous = binding("file.ts", [0]);
    rect(previous.fileContainer, -100, 1500);
    const before = row(previous, "unified", 80, 40);
    before.querySelector(".line-num1")!.textContent = "";
    before.insertAdjacentHTML("beforeend", '<td><span class="d2h-code-line-ctn">added source</span></td>');
    const state = captureViewState([previous]);
    const next = binding("file.ts", [0]);
    const after = row(next, "unified", 100, 440);
    after.querySelector(".line-num1")!.textContent = "";
    after.insertAdjacentHTML("beforeend", '<td><span class="d2h-code-line-ctn">added source</span></td>');
    const sameNumber = row(next, "unified", 80, 40);
    sameNumber.insertAdjacentHTML("beforeend", '<td><span class="d2h-code-line-ctn">other source</span></td>');
    restoreViewState(state, [next]);
    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 1400);

    const duplicate = row(next, "unified", 110, 640);
    duplicate.insertAdjacentHTML("beforeend", '<td><span class="d2h-code-line-ctn">added source</span></td>');
    jest.mocked(window.scrollTo).mockClear();
    restoreViewState(state, [next]);
    expect(window.scrollTo).not.toHaveBeenCalled();
  });
});

/** @jest-environment jsdom */
import { parse } from "diff2html";
import { DiffFile } from "diff2html/lib/types";
import { Diff2HtmlUI } from "diff2html/lib/ui/js/diff2html-ui-slim.js";
import { ContextFoldingController } from "../context-folding";

jest.mock("../../hash", () => ({
  getSha1Hash: jest.fn(async (text: string) => {
    const { createHash } = jest.requireActual("crypto");
    return createHash("sha1").update(text).digest("hex");
  }),
}));

type Format = "line-by-line" | "side-by-side";
type ExpansionState = Record<string, Record<string, { start: number; end: number }>>;

const context = (prefix: string, count: number): string[] =>
  Array.from({ length: count }, (_, index) => ` ${prefix}_${String(index + 1).padStart(3, "0")}`);

function patch(leading = 75, middle = 135, trailing = 63, replacement = "after_first"): string {
  const length = leading + middle + trailing + 2;
  return [
    "diff --git a/demo.py b/demo.py",
    "--- a/demo.py",
    "+++ b/demo.py",
    `@@ -1,${length} +1,${length} @@`,
    ...context("leading", leading),
    "-before_first",
    `+${replacement}`,
    ...context("middle", middle),
    "-before_second",
    "+after_second",
    ...context("trailing", trailing),
    "",
  ].join("\n");
}

function codeRows(root: ParentNode, text: string): HTMLTableRowElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(".d2h-code-line-ctn"))
    .filter((element) => element.textContent === text)
    .map((element) => element.closest("tr")!);
}

function expectHidden(root: ParentNode, text: string, hidden: boolean): void {
  const rows = codeRows(root, text);
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.hidden).toBe(hidden);
    expect(row.classList.contains("diff-context-hidden")).toBe(hidden);
  }
}

function firstTable(root: ParentNode): HTMLTableSectionElement {
  return root.querySelector<HTMLTableSectionElement>("tbody")!;
}

function gaps(root: ParentNode): HTMLTableRowElement[] {
  return Array.from(root.querySelectorAll<HTMLTableRowElement>(".diff-context-gap"));
}

function button(gap: HTMLTableRowElement, direction: "start" | "end"): HTMLButtonElement {
  // Side-by-side mode places the two boundary controls in opposite panes.
  const counterparts = Array.from(
    gap.closest(".d2h-file-wrapper")!.querySelectorAll<HTMLTableRowElement>(".diff-context-gap"),
  ).filter((row) => row.dataset.contextId === gap.dataset.contextId);
  const result = counterparts.flatMap((row) =>
    Array.from(row.querySelectorAll<HTMLButtonElement>(`.diff-context-expand[data-context-direction="${direction}"]`)),
  )[0];
  expect(result).toBeDefined();
  return result!;
}

function createHarness() {
  const root = document.createElement("div");
  document.body.append(root);
  let state: ExpansionState = {};
  const setState = jest.fn((value: ExpansionState) => {
    state = value;
  });
  const onChange = jest.fn();
  const controller = new ContextFoldingController({ getState: () => state, setState, onChange });
  const draw = async (files: DiffFile[], format: Format) => {
    new Diff2HtmlUI(root, files, { highlight: false, outputFormat: format, drawFileList: false }).draw();
    await controller.render(root, files);
  };
  return { root, controller, draw, setState, onChange };
}

describe("folded diff context", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    window.scrollTo = jest.fn();
    HTMLElement.prototype.scrollIntoView = jest.fn();
  });

  it.each(["line-by-line", "side-by-side"] as const)(
    "shows fifty context lines around every change in %s without discarding diff contents",
    async (format) => {
      const files = parse(patch());
      const original = JSON.stringify(files);
      const { root, controller } = createHarness();
      new Diff2HtmlUI(root, files, { highlight: false, outputFormat: format }).draw();
      const lineNodes = Array.from(root.querySelectorAll(".d2h-code-line-ctn"));
      const hiddenLine = codeRows(root, "leading_001")[0].querySelector(".d2h-code-line-ctn")!;
      hiddenLine.innerHTML = '<span class="diff-textmate-token" style="color: #569cd6">leading_001</span>';
      const syntaxToken = hiddenLine.firstElementChild;
      await controller.render(root, files);

      for (const text of ["leading_025", "middle_051", "middle_085", "trailing_051", "trailing_063"]) {
        expectHidden(root, text, true);
      }
      for (const text of ["leading_026", "leading_075", "middle_050", "middle_086", "trailing_050"]) {
        expectHidden(root, text, false);
      }
      for (const text of ["before_first", "after_first", "before_second", "after_second"]) {
        expectHidden(root, text, false);
      }
      expect(root.querySelectorAll(".diff-context-hidden")).toHaveLength(73 * (format === "side-by-side" ? 2 : 1));
      expect(gaps(firstTable(root))).toHaveLength(3);
      expect(Array.from(root.querySelectorAll(".d2h-code-line-ctn"))).toEqual(lineNodes);
      expect(hiddenLine.firstElementChild).toBe(syntaxToken);
      expect(JSON.stringify(files)).toBe(original);
    },
  );

  it.each(["line-by-line", "side-by-side"] as const)(
    "expands leading/trailing context in twenty-line steps and labels the smaller remainder in %s",
    async (format) => {
      const { root, draw, onChange } = createHarness();
      await draw(parse(patch()), format);
      const table = firstTable(root);
      let leading = gaps(table)[0];
      expect(button(leading, "end").textContent).toContain("20");
      button(leading, "end").click();
      expectHidden(root, "leading_005", true);
      expectHidden(root, "leading_006", false);
      expectHidden(root, "leading_025", false);
      leading = gaps(table)[0];
      expect(button(leading, "end").textContent).toContain("5");
      button(leading, "end").click();
      expectHidden(root, "leading_001", false);
      expect(gaps(table)).toHaveLength(2);

      const trailing = gaps(table)[1];
      expect(button(trailing, "start").textContent).toContain("13");
      button(trailing, "start").click();
      expectHidden(root, "trailing_063", false);
      expect(gaps(table)).toHaveLength(1);
      expect(onChange).toHaveBeenCalled();
    },
  );

  it.each(["line-by-line", "side-by-side"] as const)(
    "can expand a middle gap from either boundary without duplicate or missing rows in %s",
    async (format) => {
      const { root, draw } = createHarness();
      await draw(parse(patch()), format);
      const table = firstTable(root);
      const before = Array.from(root.querySelectorAll(".d2h-code-line-ctn"));
      const middle = gaps(table)[1];
      expect(button(middle, "start").textContent).toContain("20");
      expect(button(middle, "end").textContent).toContain("20");
      button(middle, "start").click();
      expectHidden(root, "middle_070", false);
      expectHidden(root, "middle_071", true);
      expectHidden(root, "middle_085", true);
      const remaining = gaps(table)[1];
      expect(button(remaining, "start").textContent).toContain("15");
      expect(button(remaining, "end").textContent).toContain("15");
      button(remaining, "end").click();
      expectHidden(root, "middle_071", false);
      expectHidden(root, "middle_085", false);
      expect(gaps(table)).toHaveLength(2);
      expect(Array.from(root.querySelectorAll(".d2h-code-line-ctn"))).toEqual(before);
    },
  );

  it("retains expansions across redraws and layout switches, and resets when file contents change", async () => {
    const files = parse(patch());
    const { root, draw, setState } = createHarness();
    await draw(files, "line-by-line");
    button(gaps(firstTable(root))[0], "end").click();
    button(gaps(firstTable(root))[1], "start").click();
    expect(setState).toHaveBeenCalled();

    for (const format of ["side-by-side", "line-by-line"] as const) {
      await draw(files, format);
      expectHidden(root, "leading_006", false);
      expectHidden(root, "leading_005", true);
      expectHidden(root, "middle_070", false);
      expectHidden(root, "middle_071", true);
    }
    await draw(parse(patch(75, 135, 63, "another_change")), "side-by-side");
    expectHidden(root, "leading_006", true);
    expectHidden(root, "middle_070", true);
  });

  it("keeps both panes aligned when the number of deleted and inserted lines differs", async () => {
    const value = patch()
      .replace("@@ -1,275 +1,275 @@", "@@ -1,275 +1,277 @@")
      .replace("+after_first", "+after_first\n+extra_insert_one\n+extra_insert_two");
    const { root, draw } = createHarness();
    await draw(parse(value), "side-by-side");
    const tables = root.querySelectorAll<HTMLTableSectionElement>("tbody");
    const assertAlignment = () => {
      const left = Array.from(tables[0].rows);
      const right = Array.from(tables[1].rows);
      expect(left.length).toBe(right.length);
      expect(left.map((row) => row.hidden)).toEqual(right.map((row) => row.hidden));
      expect(left.map((row) => row.classList.contains("diff-context-gap"))).toEqual(
        right.map((row) => row.classList.contains("diff-context-gap")),
      );
    };
    assertAlignment();
    button(gaps(tables[1])[1], "end").click();
    assertAlignment();
    expectHidden(root, "extra_insert_one", false);
    expectHidden(root, "extra_insert_two", false);
  });

  it("reveals a search target and its counterpart without discarding its highlighted node", async () => {
    const { root, draw, controller } = createHarness();
    await draw(parse(patch()), "side-by-side");
    const target = codeRows(root, "middle_068")[1].querySelector<HTMLElement>(".d2h-code-line-ctn")!;
    target.innerHTML = '<span class="diff-textmate-token">middle_068</span>';
    const token = target.firstElementChild!;
    expectHidden(root, "middle_068", true);
    controller.revealLine(token as HTMLElement);
    expectHidden(root, "middle_068", false);
    expect(target.firstElementChild).toBe(token);
    expect(token.isConnected).toBe(true);
  });

  it.each(["line-by-line", "side-by-side"] as const)("leaves short context visible in %s", async (format) => {
    const { root, draw } = createHarness();
    await draw(parse(patch(50, 100, 50)), format);
    expect(root.querySelectorAll(".diff-context-hidden")).toHaveLength(0);
    expect(gaps(root)).toHaveLength(0);
  });
});

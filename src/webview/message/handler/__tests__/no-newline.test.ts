/** @jest-environment jsdom */
import { parse } from "diff2html";
import { Diff2HtmlUI } from "diff2html/lib/ui/js/diff2html-ui-slim.js";
import { parseDiff } from "../../../../shared/diff";
import type { DiffFileWithMetadata } from "../../../../shared/diff";
import { AlignedDiff2HtmlUI } from "../aligned-diff-renderer";
import { ContextFoldingController } from "../context-folding";
import { renderNoNewlineMarkers } from "../no-newline";
import { SyntaxHighlightingController } from "../syntax-highlighting";

jest.mock("../../hash", () => ({ getSha1Hash: jest.fn(async (text: string) => text) }));

type Format = "line-by-line" | "side-by-side";
const formats: Format[] = ["line-by-line", "side-by-side"];
const unchangedLastLine =
  '--- a/prompt.py\n+++ b/prompt.py\n@@ -143,4 +143,4 @@\n </output_format>\n \n "Запрос пользователя: "\n-"""\n+"""\n';

function draw(patch: string, format: Format, noNewline?: DiffFileWithMetadata["noNewline"]) {
  const files: DiffFileWithMetadata[] = parse(patch);
  files[0].noNewline = noNewline;
  const root = document.createElement("div");
  document.body.append(root);
  new Diff2HtmlUI(root, files, { highlight: false, drawFileList: false, outputFormat: format }).draw();
  return { root, files };
}

function markers(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(".diff-no-newline[data-no-newline-side]"));
}

function source(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll(".d2h-code-line-ctn"), (line) => line.textContent ?? "");
}

describe("end-of-file newline annotations", () => {
  beforeEach(() => {
    document.body.innerHTML = '<input type="checkbox" id="syntax-highlighting-toggle">';
  });

  it.each(formats)("keeps EOF metadata on the correct file when renderer IDs collide in %s", (outputFormat) => {
    const patch = [
      "--- a/Aa.py",
      "+++ b/Aa.py",
      "@@ -1 +1 @@",
      "-first_before",
      "\\ No newline at end of file",
      "+first_after",
      "--- a/BB.py",
      "+++ b/BB.py",
      "@@ -1 +1 @@",
      "-second_before",
      "+second_after",
    ].join("\n");
    const files = parseDiff(patch);
    const root = document.createElement("div");
    new AlignedDiff2HtmlUI(root, files, { outputFormat, highlight: false, drawFileList: false }).draw();
    renderNoNewlineMarkers(root, files);
    const wrappers = root.querySelectorAll(".d2h-file-wrapper");
    expect(wrappers[0].id).toBe(wrappers[1].id);
    expect(markers(wrappers[0])).toHaveLength(1);
    expect(markers(wrappers[1])).toHaveLength(0);
    expect(markers(wrappers[0])[0].closest("tr")?.querySelector(".d2h-code-line-ctn")?.textContent).toBe(
      "first_before",
    );
  });

  it.each(formats)("leaves normal diff markup unchanged in %s", (format) => {
    const { root, files } = draw(unchangedLastLine, format);
    const html = root.innerHTML;
    renderNoNewlineMarkers(root, files);
    expect(root.innerHTML).toBe(html);
  });

  it.each(formats.flatMap((format) => ["old", "new"].map((side) => ({ format, side }))))(
    "makes a newline-only change explicit on the $side side in $format",
    ({ format, side }) => {
      const { root, files } = draw(unchangedLastLine, format, { [side]: 146 });
      const lines = source(root);
      const rows = root.querySelectorAll("tr").length;
      const numbers = Array.from(
        root.querySelectorAll(".d2h-code-side-linenumber, .line-num1, .line-num2"),
        (cell) => cell.textContent,
      );
      renderNoNewlineMarkers(root, files);
      expect(markers(root)).toHaveLength(1);
      const marker = markers(root)[0];
      expect(marker.textContent).toBe("\\ No newline at end of file");
      expect(marker.dataset.noNewlineSide).toBe(side);
      expect(marker.closest(".d2h-code-line-ctn")).toBeNull();
      expect(marker.closest("tr")?.querySelector(".d2h-code-line-ctn")?.textContent).toBe('"""');
      expect(source(root)).toEqual(lines);
      expect(root.querySelectorAll("tr")).toHaveLength(rows);
      expect(
        Array.from(
          root.querySelectorAll(".d2h-code-side-linenumber, .line-num1, .line-num2"),
          (cell) => cell.textContent,
        ),
      ).toEqual(numbers);
      if (format === "side-by-side") {
        const placeholder = root.querySelector<HTMLElement>(".diff-no-newline-placeholder")!;
        expect(placeholder).not.toBeNull();
        expect(placeholder.textContent).toBe("");
        expect(placeholder.getAttribute("aria-hidden")).toBe("true");
        expect(placeholder.closest("tr")?.rowIndex).toBe(marker.closest("tr")?.rowIndex);
      } else expect(root.querySelector(".diff-no-newline-placeholder")).toBeNull();
      const html = root.innerHTML;
      renderNoNewlineMarkers(root, files);
      expect(root.innerHTML).toBe(html);
      files[0].noNewline = undefined;
      renderNoNewlineMarkers(root, files);
      expect(root.querySelector(".diff-no-newline")).toBeNull();
    },
  );

  it("reserves matching space for EOF markers at different visual rows in unequal replacements", () => {
    const patch = "--- a/a.py\n+++ b/a.py\n@@ -1,2 +1,3 @@\n stable\n-old\n+new\n+extra\n";
    const { root, files } = draw(patch, "side-by-side", { old: 2, new: 3 });
    renderNoNewlineMarkers(root, files);
    const panes = Array.from(root.querySelectorAll(".d2h-file-side-diff"));
    const annotationRows = panes.map((pane) =>
      Array.from(pane.querySelectorAll(".diff-no-newline"), (marker) => marker.closest("tr")!.rowIndex),
    );
    expect(annotationRows[0]).toEqual(annotationRows[1]);
    expect(annotationRows[0]).toHaveLength(2);
    expect(markers(root).map((marker) => marker.dataset.noNewlineSide)).toEqual(["old", "new"]);
    expect(
      markers(root).map((marker) => marker.closest("tr")!.querySelector(".d2h-code-line-ctn")?.textContent),
    ).toEqual(["old", "extra"]);
    expect(panes[0].querySelector(".d2h-emptyplaceholder .diff-no-newline-placeholder")).not.toBeNull();
  });

  it.each(formats)("annotates shared EOF context once per pane in %s", (format) => {
    const patch = "--- a/a.py\n+++ b/a.py\n@@ -1,2 +1,2 @@\n-old\n+new\n same_last_line\n";
    const { root, files } = draw(patch, format, { old: 2, new: 2 });
    renderNoNewlineMarkers(root, files);
    expect(markers(root).map((marker) => marker.dataset.noNewlineSide)).toEqual(
      format === "side-by-side" ? ["old", "new"] : ["old new"],
    );
    expect(root.querySelector(".diff-no-newline-placeholder")).toBeNull();
  });

  it.each(formats)("keeps markers through lazy syntax coloring, native updates and toggle changes in %s", (format) => {
    const { root, files } = draw(unchangedLastLine, format, { old: 146 });
    const original = source(root);
    renderNoNewlineMarkers(root, files);
    const marker = markers(root)[0];
    const row = marker.closest("tr")!;
    row.hidden = true;
    let enabled = true;
    const syntax = new SyntaxHighlightingController({
      getEnabled: () => enabled,
      setEnabled: (value) => {
        enabled = value;
      },
    });
    const tokens = [{ old: { 146: [{ start: 0, end: 3, color: "#ce9178", fontStyle: 0 }] }, new: {} }];
    syntax.render(root, tokens);
    expect(marker.isConnected).toBe(true);
    row.hidden = false;
    syntax.refreshVisible();
    expect(row.querySelector(".diff-textmate-token")?.textContent).toBe('"""');
    syntax.updateNative(tokens);
    const toggle = document.getElementById("syntax-highlighting-toggle") as HTMLInputElement;
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));
    expect(marker.isConnected).toBe(true);
    expect(source(root)).toEqual(original);
    expect(markers(root)).toEqual([marker]);
  });

  it.each(formats)("folds and reveals annotations together with their source rows in %s", async (format) => {
    const patch = [
      "--- a/a.py",
      "+++ b/a.py",
      "@@ -1,62 +1,62 @@",
      "-old",
      "+new",
      ...Array.from({ length: 61 }, (_, index) => ` context_${index + 1}`),
      "",
    ].join("\n");
    const { root, files } = draw(patch, format, { old: 62, new: 62 });
    renderNoNewlineMarkers(root, files);
    const controller = new ContextFoldingController({ getState: () => ({}), setState: jest.fn(), onChange: jest.fn() });
    await controller.render(root, files);
    expect(markers(root).every((marker) => marker.closest("tr")?.hidden)).toBe(true);
    controller.revealLine(markers(root)[0].closest("tr")!.querySelector<HTMLElement>(".d2h-code-line-ctn")!);
    expect(markers(root).every((marker) => !marker.closest("tr")?.hidden)).toBe(true);
    expect(source(root).filter((line) => line === "context_61")).toHaveLength(format === "side-by-side" ? 2 : 1);
  });

  it.each(formats)("ignores metadata for lines absent from the rendered diff in %s", (format) => {
    const { root, files } = draw(unchangedLastLine, format, { old: 200, new: 0 });
    renderNoNewlineMarkers(root, files);
    expect(root.querySelector(".diff-no-newline")).toBeNull();
  });

  it.each(formats)("finds the correct file after an omitted empty wrapper in %s", (format) => {
    const files: DiffFileWithMetadata[] = parse(
      "diff --git a/mode.py b/mode.py\nold mode 100644\nnew mode 100755\ndiff --git a/prompt.py b/prompt.py\n" +
        unchangedLastLine,
    );
    files[1].noNewline = { old: 146 };
    const root = document.createElement("div");
    new Diff2HtmlUI(root, files, { outputFormat: format, renderNothingWhenEmpty: true, highlight: false }).draw();
    expect(root.querySelectorAll(".d2h-file-wrapper")).toHaveLength(1);
    renderNoNewlineMarkers(root, files);
    expect(markers(root)).toHaveLength(1);
    expect(markers(root)[0].closest("tr")!.querySelector(".d2h-code-line-ctn")?.textContent).toBe('"""');
  });
});

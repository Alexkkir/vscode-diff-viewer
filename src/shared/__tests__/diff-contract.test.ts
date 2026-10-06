/** @jest-environment jsdom */
import { LineType } from "diff2html/lib/types";
import { TextDecoder } from "util";
import { hasCombinedDiff, parseDiff, type DiffFileWithMetadata } from "../diff";
import { realignDiffHunks } from "../hunk-alignment";
import {
  combinedDiffContractCorpus,
  diffContractCorpus,
  generatedDiffContractCorpus,
  type SourceRow,
} from "../testing/diff-contract-corpus";
import { renderAlignedDiffHtml } from "../../webview/message/handler/aligned-diff-renderer";
import { renderNoNewlineMarkers } from "../../webview/message/handler/no-newline";

const formats = ["side-by-side", "line-by-line"] as const;
const matchingModes = ["none", "lines", "words"] as const;

// The webview and Node provide TextDecoder; Jest's jsdom environment does not.
Object.defineProperty(globalThis, "TextDecoder", { value: TextDecoder, configurable: true });

function projectModel(file: DiffFileWithMetadata, side: "old" | "new"): SourceRow[] {
  return file.blocks.flatMap((block) =>
    block.lines.flatMap((line) => {
      const number = side === "old" ? line.oldNumber : line.newNumber;
      return number === undefined ? [] : [{ number, text: line.content.slice(1) }];
    }),
  );
}

function projectDom(wrapper: Element, side: "old" | "new", format: (typeof formats)[number]): SourceRow[] {
  const pane =
    format === "side-by-side" ? wrapper.querySelectorAll(".d2h-file-side-diff")[side === "old" ? 0 : 1] : wrapper;
  if (!pane) return [];
  return Array.from(pane.querySelectorAll("tbody tr")).flatMap((row) => {
    const numberText = row
      .querySelector(
        format === "side-by-side" ? ".d2h-code-side-linenumber" : side === "old" ? ".line-num1" : ".line-num2",
      )
      ?.textContent?.trim();
    const content = row.querySelector(".d2h-code-line-ctn");
    return numberText && /^\d+$/.test(numberText) && content
      ? [{ number: Number(numberText), text: content.textContent ?? "" }]
      : [];
  });
}

describe("synthetic diff source contract", () => {
  it.each([...diffContractCorpus, ...generatedDiffContractCorpus()])(
    "preserves both numbered sources and EOF: $name",
    ({ patch, files: expected }) => {
      const parsed = parseDiff(patch);
      const original = JSON.stringify(parsed);
      const aligned = realignDiffHunks(parsed);
      expect(JSON.stringify(parsed)).toBe(original);
      expect(aligned).toHaveLength(expected.length);
      expect(realignDiffHunks(aligned)).toEqual(aligned);
      for (const [index, file] of aligned.entries()) {
        const source = expected[index];
        for (const version of [parsed[index], file]) {
          expect(version.oldName).toBe(source.oldName);
          expect(version.newName).toBe(source.newName);
          expect(projectModel(version, "old")).toEqual(source.old);
          expect(projectModel(version, "new")).toEqual(source.next);
          expect(version.noNewline).toEqual(source.noNewline);
          const lines = version.blocks.flatMap((block) => block.lines);
          expect(version.addedLines).toBe(lines.filter((line) => line.type === LineType.INSERT).length);
          expect(version.deletedLines).toBe(lines.filter((line) => line.type === LineType.DELETE).length);
        }
      }
      for (const outputFormat of formats) {
        for (const matching of matchingModes) {
          const root = document.createElement("div");
          const beforeRender = JSON.stringify(aligned);
          root.innerHTML = renderAlignedDiffHtml(aligned, { outputFormat, matching, drawFileList: false });
          renderNoNewlineMarkers(root, aligned);
          const wrappers = root.querySelectorAll(".d2h-file-wrapper");
          expect(wrappers).toHaveLength(expected.length);
          for (const [index, source] of expected.entries()) {
            expect(projectDom(wrappers[index], "old", outputFormat)).toEqual(source.old);
            expect(projectDom(wrappers[index], "new", outputFormat)).toEqual(source.next);
            for (const side of ["old", "new"] as const) {
              const markers = wrappers[index].querySelectorAll(`[data-no-newline-side~="${side}"]`);
              expect(markers).toHaveLength(source.noNewline?.[side] === undefined ? 0 : 1);
              if (markers.length) {
                expect(markers[0].closest(".d2h-code-line-ctn")).toBeNull();
                const row = markers[0].closest("tr")!;
                const number = row.querySelector(
                  outputFormat === "side-by-side"
                    ? ".d2h-code-side-linenumber"
                    : side === "old"
                      ? ".line-num1"
                      : ".line-num2",
                );
                expect(Number(number?.textContent?.trim())).toBe(source.noNewline![side]);
              }
            }
            if (outputFormat === "side-by-side" && (source.old.length || source.next.length)) {
              const panes = Array.from(wrappers[index].querySelectorAll(".d2h-diff-tbody"));
              if (panes.length === 2)
                expect(panes[0].querySelectorAll("tr").length).toBe(panes[1].querySelectorAll("tr").length);
            }
          }
          expect(JSON.stringify(aligned)).toBe(beforeRender);
        }
      }
    },
  );
});

describe("combined merge classification", () => {
  it.each(combinedDiffContractCorpus)("detects unsupported parent topology: $name", ({ patch }) => {
    expect(hasCombinedDiff(patch)).toBe(true);
    expect(hasCombinedDiff(patch.replace("diff --cc", "diff --combined"))).toBe(true);
    expect(hasCombinedDiff(patch.split("\n").slice(1).join("\n"))).toBe(true);
    expect(hasCombinedDiff(patch.replaceAll("\n", "\r\n"))).toBe(true);
  });

  it("ignores merge-looking source text in an ordinary patch", () => {
    const source = ["diff --cc file.py", "diff --combined file.py", "@@@ -10 -20 +30 @@@", "@@@@ -10 -20 -30 +40 @@@@"];
    const patch = replacementCaseForClassifier(source);
    expect(hasCombinedDiff(patch)).toBe(false);
    expect(
      hasCombinedDiff(
        ["--- sample.py", "+++ sample.py", "@@ -1,4 +1,4 @@", ...source.map((line) => ` ${line}`)].join("\n"),
      ),
    ).toBe(false);
    expect(hasCombinedDiff("@@ -1 +1 @@\n-before\n+after\n")).toBe(false);
  });
});

function replacementCaseForClassifier(source: string[]): string {
  return [
    "--- sample.py",
    "+++ sample.py",
    "@@ -1,4 +1,4 @@",
    ...source.map((line) => `-${line}`),
    ...source.map((line) => `+${line}`),
  ].join("\n");
}

describe("synthetic visual pairing contract", () => {
  it.each([
    ['value = "# this is a very long string literal"', 'value = "# x"', "very long string literal"],
    ['value = """some # long literal content"""', 'value = """x"""', "long literal content"],
    [
      'value = f"{mapping["# this is a very long dictionary string key"]}"',
      'value = f"{mapping["# x"]}"',
      "very long dictionary string key",
    ],
    ['import "widgets#this-is-a-long-string-specifier"', 'import "widgets"', "#this-is-a-long-string-specifier"],
    ["if (ready) {} # a long non-Python suffix", "if (ready) {}", "# a long non-Python suffix"],
  ])(
    "highlights rewritten operands and suffixes without treating them as removable metadata: %s",
    (old, next, changed) => {
      for (const outputFormat of formats) {
        for (const matching of ["lines", "words"] as const) {
          const root = document.createElement("div");
          const patch = ["--- example.py", "+++ example.py", "@@ -1 +1 @@", `-${old}`, `+${next}`].join("\n");
          root.innerHTML = renderAlignedDiffHtml(realignDiffHunks(parseDiff(patch)), { outputFormat, matching });
          expect(Array.from(root.querySelectorAll(".d2h-code-line-ctn"), (line) => line.textContent)).toEqual([
            old,
            next,
          ]);
          expect(Array.from(root.querySelectorAll("del"), (span) => span.textContent).join("")).toContain(changed);
        }
      }
    },
  );

  it.each(diffContractCorpus.filter(({ files }) => files.some((file) => file.pairs || file.removed || file.added)))(
    "keeps intended review rows adjacent: $name",
    ({ patch, files: expected }) => {
      for (const matching of ["lines", "words"] as const) {
        const root = document.createElement("div");
        root.innerHTML = renderAlignedDiffHtml(realignDiffHunks(parseDiff(patch)), {
          outputFormat: "side-by-side",
          matching,
          drawFileList: false,
        });
        const wrappers = root.querySelectorAll(".d2h-file-wrapper");
        expected.forEach((file, index) => {
          const [left, right] = Array.from(wrappers[index].querySelectorAll(".d2h-diff-tbody"), (pane) =>
            Array.from(pane.querySelectorAll("tr")),
          );
          const number = (row: Element) => row.querySelector(".d2h-code-side-linenumber")?.textContent?.trim();
          for (const [oldNumber, newNumber] of file.pairs ?? []) {
            const oldRow = left.findIndex((row) => number(row) === String(oldNumber));
            const newRow = right.findIndex((row) => number(row) === String(newNumber));
            expect(oldRow).toBeGreaterThanOrEqual(0);
            expect({ oldNumber, newNumber, oldRow }).toEqual({ oldNumber, newNumber, oldRow: newRow });
          }
          for (const oldNumber of file.removed ?? []) {
            const oldRow = left.findIndex((row) => number(row) === String(oldNumber));
            expect(oldRow).toBeGreaterThanOrEqual(0);
            expect(number(right[oldRow])).toBe("");
            expect(right[oldRow].querySelector(".d2h-code-line-ctn")?.textContent ?? "").toBe("");
          }
          for (const newNumber of file.added ?? []) {
            const newRow = right.findIndex((row) => number(row) === String(newNumber));
            expect(newRow).toBeGreaterThanOrEqual(0);
            expect(number(left[newRow])).toBe("");
            expect(left[newRow].querySelector(".d2h-code-line-ctn")?.textContent ?? "").toBe("");
          }
        });
      }
    },
  );
});

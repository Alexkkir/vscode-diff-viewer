/** @jest-environment jsdom */
import { TextDecoder } from "node:util";
import { parseDiff } from "../diff";
import { realignDiffHunks } from "../hunk-alignment";
import { conversationMatchingCorpus } from "../testing/conversation-matching-corpus";
import { replacementCase, type DiffContractCase, type ExpectedDiffFile } from "../testing/diff-contract-corpus";
import { renderAlignedDiffHtml } from "../../webview/message/handler/aligned-diff-renderer";
import { renderNoNewlineMarkers } from "../../webview/message/handler/no-newline";

const formats = ["side-by-side", "line-by-line"] as const;
const matchingModes = ["none", "lines", "words"] as const;
type Format = (typeof formats)[number];
Object.defineProperty(globalThis, "TextDecoder", { value: TextDecoder, configurable: true });

// Build variants from the handwritten source/oracle, never from parser or
// matcher output. Prefix-only context leaves EOF metadata at the actual EOF.
function variant(fixture: DiffContractCase, reverse: boolean, prefix: boolean): DiffContractCase {
  const [file] = fixture.files;
  // These transformations are for full, single-file stories. Boundary patches
  // below intentionally bypass them rather than silently losing their gaps.
  if (
    fixture.files.length !== 1 ||
    (fixture.patch.match(/^@@ /gm) ?? []).length !== 1 ||
    file.oldName !== file.newName ||
    [file.old, file.next].some((rows) => !rows.length || rows.some((row, i) => row.number !== rows[0].number + i))
  )
    throw new Error(`Cannot build a contiguous matching variant for ${fixture.name}`);
  const old = reverse ? file.next : file.old;
  const next = reverse ? file.old : file.next;
  const leading = prefix ? ["# Independent leading context", ""] : [];
  const oldStart = prefix ? 137 : old[0].number;
  const newStart = prefix ? 211 : next[0].number;
  const oldShift = oldStart + leading.length - old[0].number;
  const newShift = newStart + leading.length - next[0].number;
  return replacementCase(
    `${fixture.name}/${reverse ? "reverse" : "forward"}/${prefix ? "offset-context" : "original"}`,
    [...leading, ...old.map((row) => row.text)],
    [...leading, ...next.map((row) => row.text)],
    {
      path: file.oldName,
      oldStart,
      newStart,
      oldEof: file.noNewline?.[reverse ? "new" : "old"] !== undefined,
      newEof: file.noNewline?.[reverse ? "old" : "new"] !== undefined,
      pairs: file.pairs?.map(([left, right]) =>
        reverse ? [right + oldShift, left + newShift] : [left + oldShift, right + newShift],
      ),
      removed: (reverse ? file.added : file.removed)?.map((number) => number + oldShift),
      added: (reverse ? file.removed : file.added)?.map((number) => number + newShift),
    },
  );
}

const variants = conversationMatchingCorpus.flatMap((fixture) => [
  fixture,
  variant(fixture, true, false),
  variant(fixture, false, true),
  variant(fixture, true, true),
]);

// Keep these patches verbatim: reconstructing a full replacement would erase
// the context/hunk boundary whose protection this test is meant to exercise.
const boundaries: DiffContractCase[] = [
  {
    name: "similar-names-across-an-unchanged-context-row",
    patch: [
      "--- boundary.py",
      "+++ boundary.py",
      "@@ -10,2 +40,2 @@",
      '-    name="Inputs and Outputs",',
      "     divider()",
      '+    name="Входы и выходы",',
      "",
    ].join("\n"),
    files: [
      {
        oldName: "boundary.py",
        newName: "boundary.py",
        old: [
          { number: 10, text: '    name="Inputs and Outputs",' },
          { number: 11, text: "    divider()" },
        ],
        next: [
          { number: 40, text: "    divider()" },
          { number: 41, text: '    name="Входы и выходы",' },
        ],
        pairs: [[11, 40]],
        removed: [10],
        added: [41],
      },
    ],
  },
  {
    name: "similar-list-keys-across-an-omitted-hunk-range",
    patch: [
      "--- boundary.py",
      "+++ boundary.py",
      "@@ -10 +10,0 @@",
      '-    "pool-worker-console",',
      "@@ -80,0 +80 @@",
      '+    "console-worker-pool",',
      "",
    ].join("\n"),
    files: [
      {
        oldName: "boundary.py",
        newName: "boundary.py",
        old: [{ number: 10, text: '    "pool-worker-console",' }],
        next: [{ number: 80, text: '    "console-worker-pool",' }],
        removed: [10],
        added: [80],
      },
    ],
  },
];

interface RenderedRow {
  node: Element;
  index: number;
  old?: number;
  next?: number;
  text: string;
  changed: boolean;
}

function renderedRows(wrapper: Element, format: Format): RenderedRow[][] {
  const panes = format === "side-by-side" ? Array.from(wrapper.querySelectorAll(".d2h-diff-tbody")) : [wrapper];
  const number = (row: Element, selector: string): number | undefined => {
    const value = row.querySelector(selector)?.textContent?.trim();
    return value && /^\d+$/.test(value) ? Number(value) : undefined;
  };
  return panes.map((pane, side) =>
    Array.from(pane.querySelectorAll("tr"), (node, index) => ({
      node,
      index,
      old:
        format === "side-by-side"
          ? side === 0
            ? number(node, ".d2h-code-side-linenumber")
            : undefined
          : number(node, ".line-num1"),
      next:
        format === "side-by-side"
          ? side === 1
            ? number(node, ".d2h-code-side-linenumber")
            : undefined
          : number(node, ".line-num2"),
      text: node.querySelector(".d2h-code-line-ctn")?.textContent ?? "",
      changed: node.querySelector(".d2h-code-line-ctn")?.closest("td")?.classList.contains("d2h-change") ?? false,
    })),
  );
}

function assertPairs(rows: RenderedRow[][], file: ExpectedDiffFile, format: Format): void {
  const left = rows[0];
  const right = rows[format === "side-by-side" ? 1 : 0];
  const oldRow = (number: number) => left.find((row) => row.old === number)!;
  const newRow = (number: number) => right.find((row) => row.next === number)!;
  for (const [oldNumber, newNumber] of file.pairs ?? []) {
    const before = oldRow(oldNumber),
      after = newRow(newNumber);
    expect(before).toBeDefined();
    expect(after).toBeDefined();
    if (format === "side-by-side") {
      expect({ oldNumber, newNumber, index: before.index }).toEqual({ oldNumber, newNumber, index: after.index });
    } else if (before.node === after.node) {
      expect(before.changed).toBe(false);
    } else {
      // Adjacency alone could mistake two independent changes for a pair.
      // The actual renderer must mark both as a paired replacement as well.
      expect(before.node.nextElementSibling).toBe(after.node);
      expect([before.next, after.old]).toEqual([undefined, undefined]);
      expect([before.changed, after.changed]).toEqual([true, true]);
    }
  }
  for (const [side, numbers] of [
    ["old", file.removed],
    ["next", file.added],
  ] as const) {
    for (const number of numbers ?? []) {
      const own = side === "old" ? oldRow(number) : newRow(number);
      expect(own).toBeDefined();
      expect(own.changed).toBe(false);
      if (format === "side-by-side") {
        const other = (side === "old" ? right : left)[own.index];
        expect([other.old, other.next, other.text]).toEqual([undefined, undefined, ""]);
        expect(other.node.querySelector(".d2h-emptyplaceholder")).not.toBeNull();
      } else {
        expect(own[side === "old" ? "next" : "old"]).toBeUndefined();
      }
    }
  }
}

describe("conversation matching regressions through parser, hunk alignment and renderer", () => {
  it.each([...variants, ...boundaries])("keeps review semantics and both sources: $name", (fixture) => {
    const parsed = parseDiff(fixture.patch);
    const original = JSON.stringify(parsed);
    const files = realignDiffHunks(parsed);
    expect(JSON.stringify(parsed)).toBe(original);
    expect(realignDiffHunks(files)).toEqual(files);
    expect(files).toHaveLength(fixture.files.length);
    for (const [index, expected] of fixture.files.entries()) {
      for (const [side, source] of [
        ["old", expected.old],
        ["new", expected.next],
      ] as const) {
        expect(
          files[index].blocks
            .flatMap((block) => block.lines)
            .filter((line) => line[`${side}Number`] !== undefined)
            .map((line) => ({ number: line[`${side}Number`], text: line.content.slice(1) })),
        ).toEqual(source);
      }
      expect(files[index].noNewline).toEqual(expected.noNewline);
    }
    const beforeRender = JSON.stringify(files);
    for (const format of formats)
      for (const matching of matchingModes) {
        const root = document.createElement("div");
        root.innerHTML = renderAlignedDiffHtml(files, { outputFormat: format, matching, drawFileList: false });
        renderNoNewlineMarkers(root, files);
        const wrappers = Array.from(root.querySelectorAll(".d2h-file-wrapper"));
        expect(wrappers).toHaveLength(fixture.files.length);
        fixture.files.forEach((expected, index) => {
          const rows = renderedRows(wrappers[index], format);
          if (format === "side-by-side") expect(rows[0].length).toBe(rows[1].length);
          for (const [side, source] of [
            ["old", expected.old],
            ["next", expected.next],
          ] as const) {
            const projected = rows
              .flat()
              .filter((row) => row[side] !== undefined)
              .map((row) => ({ number: row[side], text: row.text }));
            expect({ format, matching, side, projected }).toEqual({ format, matching, side, projected: source });
          }
          // Opt-out keeps positional pairing; its source contract still applies.
          if (matching !== "none") assertPairs(rows, expected, format);
        });
        expect(JSON.stringify(files)).toBe(beforeRender);
      }
  });
});

import { parse } from "diff2html";
import { DiffBlock, DiffFile, DiffLine, LineType } from "diff2html/lib/types";
import { buildContextGaps, ContextGap, expandContextGap } from "../context-ranges";

function block(...runs: Array<number | "+" | "-">): DiffBlock {
  let oldNumber = 1;
  let newNumber = 1;
  const lines: DiffLine[] = [];
  for (const run of runs) {
    if (run === "+") {
      lines.push({ type: LineType.INSERT, content: "+added", oldNumber: undefined, newNumber: newNumber++ });
    } else if (run === "-") {
      lines.push({ type: LineType.DELETE, content: "-removed", oldNumber: oldNumber++, newNumber: undefined });
    } else {
      for (let index = 0; index < run; index++) {
        lines.push({ type: LineType.CONTEXT, content: " unchanged", oldNumber: oldNumber++, newNumber: newNumber++ });
      }
    }
  }
  return { oldStartLine: 1, newStartLine: 1, header: "@@ -1 +1 @@", lines };
}

function file(...blocks: DiffBlock[]): DiffFile {
  return {
    oldName: "example.py",
    newName: "example.py",
    addedLines: 0,
    deletedLines: 0,
    isCombined: false,
    isGitDiff: true,
    language: "py",
    blocks,
  };
}

function shape(gaps: ContextGap[]) {
  return gaps.map(({ blockIndex, start, end, canExpandBefore, canExpandAfter }) => ({
    blockIndex,
    start,
    end,
    canExpandBefore,
    canExpandAfter,
  }));
}

describe("context ranges", () => {
  it("shows 50 lines on both sides of a replacement in a large-context patch", () => {
    const input = file(block(1000, "-", "+", 1000));
    const original = JSON.stringify(input);
    const gaps = buildContextGaps(input);
    expect(shape(gaps)).toEqual([
      { blockIndex: 0, start: 0, end: 950, canExpandBefore: false, canExpandAfter: true },
      { blockIndex: 0, start: 1052, end: 2002, canExpandBefore: true, canExpandAfter: false },
    ]);
    expect(JSON.stringify(input)).toBe(original);
    expect(new Set(gaps.map(({ id }) => id)).size).toBe(gaps.length);
  });

  it.each([0, 1, 49, 50, 51, 99, 100])("keeps overlapping context between changes (%i lines) visible", (count) => {
    expect(buildContextGaps(file(block("-", "+", count, "-", "+")))).toEqual([]);
  });

  it("collapses only the excess between two changes and offers both expansion directions", () => {
    expect(shape(buildContextGaps(file(block("+", 101, "-"))))).toEqual([
      { blockIndex: 0, start: 51, end: 52, canExpandBefore: true, canExpandAfter: true },
    ]);
    expect(shape(buildContextGaps(file(block("+", 300, "-"))))).toEqual([
      { blockIndex: 0, start: 51, end: 251, canExpandBefore: true, canExpandAfter: true },
    ]);
  });

  it.each([0, 1, 49, 50])("does not hide short leading or trailing context (%i lines)", (count) => {
    expect(buildContextGaps(file(block(count, "+", count)))).toEqual([]);
  });

  it("hides even a single excess line at either end", () => {
    expect(shape(buildContextGaps(file(block(51, "+", 51))))).toEqual([
      { blockIndex: 0, start: 0, end: 1, canExpandBefore: false, canExpandAfter: true },
      { blockIndex: 0, start: 102, end: 103, canExpandBefore: true, canExpandAfter: false },
    ]);
  });

  it("leaves an unchanged-only file and unchanged-only blocks readable", () => {
    expect(buildContextGaps(file(block(1000)))).toEqual([]);
    expect(buildContextGaps(file(block(1000), block(3, "+", 3)))).toEqual([]);
    expect(buildContextGaps(file())).toEqual([]);
  });

  it("does not offer to expand source lines absent between real hunks", () => {
    const patch = [
      "diff --git a/example.py b/example.py",
      "--- a/example.py",
      "+++ b/example.py",
      "@@ -1,3 +1,3 @@",
      " before",
      "-old",
      "+new",
      " after",
      "@@ -1000,3 +1000,3 @@",
      " before",
      "-old",
      "+new",
      " after",
      "",
    ].join("\n");
    const [parsed] = parse(patch);
    expect(parsed.blocks).toHaveLength(2);
    expect(buildContextGaps(parsed)).toEqual([]);
  });

  it("keeps ranges and IDs distinct across blocks", () => {
    const gaps = buildContextGaps(file(block(80, "+"), block(80, "-")));
    expect(gaps.map(({ blockIndex, start, end }) => [blockIndex, start, end])).toEqual([
      [0, 0, 30],
      [1, 0, 30],
    ]);
    expect(gaps[0].id).not.toBe(gaps[1].id);
  });

  it("never hides changed lines, including whole-file additions or deletions", () => {
    expect(buildContextGaps(file(block("+", "+", "+")))).toEqual([]);
    expect(buildContextGaps(file(block("-", "-", "-")))).toEqual([]);
    const input = file(block(150, "-", "-", "+", 300, "+", "+", 170));
    const gaps = buildContextGaps(input);
    expect(gaps).toHaveLength(3);
    for (const gap of gaps) {
      expect(
        input.blocks[gap.blockIndex].lines.slice(gap.start, gap.end).every((line) => line.type === LineType.CONTEXT),
      ).toBe(true);
    }
  });

  it("supports a custom context size and zero context without changing source coordinates", () => {
    const input = file(block(10, "+", 25, "-", 10));
    expect(buildContextGaps(input, 10).map(({ start, end }) => [start, end])).toEqual([[21, 26]]);
    expect(buildContextGaps(input, 0).map(({ start, end }) => [start, end])).toEqual([
      [0, 10],
      [11, 36],
      [37, 47],
    ]);
  });
});

describe("context expansion", () => {
  it("reveals leading context upwards in steps of 20, then only the final 7 lines", () => {
    const [gap] = buildContextGaps(file(block(97, "+")));
    const once = expandContextGap(gap, "end")!;
    const twice = expandContextGap(once, "end")!;
    expect([gap.start, gap.end]).toEqual([0, 47]);
    expect([once.start, once.end]).toEqual([0, 27]);
    expect([twice.start, twice.end]).toEqual([0, 7]);
    expect(expandContextGap(twice, "end")).toBeNull();
    expect(once.id).toBe(gap.id);
    expect(twice.id).toBe(gap.id);
  });

  it("reveals trailing context downwards", () => {
    const [gap] = buildContextGaps(file(block("+", 83)));
    const next = expandContextGap(gap, "start")!;
    expect([gap.start, gap.end]).toEqual([51, 84]);
    expect([next.start, next.end]).toEqual([71, 84]);
    expect(expandContextGap(next, "start")).toBeNull();
  });

  it("can expand both edges of an internal gap without duplicating lines", () => {
    const [gap] = buildContextGaps(file(block("+", 145, "-")));
    const fromStart = expandContextGap(gap, "start")!;
    const fromBoth = expandContextGap(fromStart, "end")!;
    expect([gap.start, gap.end]).toEqual([51, 96]);
    expect([fromStart.start, fromStart.end]).toEqual([71, 96]);
    expect([fromBoth.start, fromBoth.end]).toEqual([71, 76]);
    expect(expandContextGap(fromBoth, "start")).toBeNull();
  });

  it("does not expand from an edge without adjacent visible changes", () => {
    const [leading, trailing] = buildContextGaps(file(block(100, "+", 100)));
    expect(expandContextGap(leading, "start")).toEqual(leading);
    expect(expandContextGap(trailing, "end")).toEqual(trailing);
  });

  it("does not mutate an input gap and supports a custom step", () => {
    const [gap] = buildContextGaps(file(block("+", 100)));
    const original = { ...gap };
    expect(expandContextGap(gap, "start", 5)?.start).toBe(56);
    expect(gap).toEqual(original);
  });
});

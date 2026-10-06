import { LineType, type DiffLine } from "diff2html/lib/types";
import { alignChangedLines } from "../line-alignment";

function change(old: string[], next: string[]): [DiffLine[], DiffLine[]] {
  return [
    old.map((text, index) => ({
      type: LineType.DELETE,
      content: `-${text}`,
      oldNumber: index + 1,
      newNumber: undefined,
    })),
    next.map((text, index) => ({
      type: LineType.INSERT,
      content: `+${text}`,
      oldNumber: undefined,
      newNumber: index + 1,
    })),
  ];
}

describe("coherent code replacement gaps", () => {
  it("pairs every related row of a wholly rewritten block in both directions", () => {
    const old = ["if not exists(value):", "    return build(value)"];
    const next = ["if value is None:", "    raise Missing(value)"];
    for (const [left, right] of [
      [old, next],
      [next, old],
    ]) {
      const [before, after] = change(left, right);
      expect(alignChangedLines(before, after)).toEqual(before.map((line, index) => [[line], [after[index]]]));
    }
  });

  it.each([
    ["if x:", "if renamed_condition:"],
    ["return old_name", "return replacement"],
    ["raise OldError()", "raise CompletelyDifferentException()"],
    ["config.flag = True", "options.enabled = False"],
    ["const alpha = 111111;", "let bravo = 222222;"],
    ['old_name("old argument")', 'different_operation("new argument")'],
    ["old_name() # previous comment", "different_operation() # updated comment"],
  ])("compares the same statement role despite entirely different operands (%s)", (old, next) => {
    const [before, after] = change([old], [next]);
    expect(alignChangedLines(before, after)).toEqual([[before, after]]);
  });

  it("fills a compatible gap between existing anchors without changing either anchor", () => {
    const [before, after] = change(
      ["# first old", "return old_name", "# last old"],
      ["# first new", "return replacement", "# last new"],
    );
    expect(alignChangedLines(before, after)).toEqual(before.map((line, index) => [[line], [after[index]]]));
  });

  it.each([
    [["if not exists(value):"], ["    if value is None:"]],
    [["if not exists(value):"], ["while other is None:"]],
    [["if not exists(value):"], ["if value is None:", "    raise Missing(value)"]],
    [["# value comes from here"], ["# reject value"]],
    [['"value comes from here"'], ['"reject value"']],
    [['old_name("value")'], ['return "value"']],
    [["old_name() # value"], ["different_operation = 0 # value"]],
    [["old_name() // value"], ["different_operation = 0 // value"]],
    [["import old_module"], ["result = replacement()"]],
    [["from old_module import ("], ["old_module = replacement()"]],
    [
      ["if old_name:", "    previous()"],
      ["if replacement:", '    """A new docstring."""'],
    ],
    [["value comes from the input"], ["the return value is missing"]],
    [
      ["    def __init__(self):", "        super().__init__(config=Config())"],
      ['    """Legacy image model.', '    """'],
    ],
  ])("does not force incompatible statement roles, topology or non-code text (%j)", (old, next) => {
    const [before, after] = change(old, next);
    expect(alignChangedLines(before, after).filter(([left, right]) => left.length && right.length)).toEqual([]);
  });
});

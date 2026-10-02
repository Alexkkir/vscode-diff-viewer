import { DiffLine, LineType } from "diff2html/lib/types";
import { alignChangedLines } from "../line-alignment";

function lines(type: LineType.DELETE | LineType.INSERT, text: string[], start = 1): DiffLine[] {
  return text.map((content, index) =>
    type === LineType.DELETE
      ? { type, content: `-${content}`, oldNumber: start + index, newNumber: undefined }
      : { type, content: `+${content}`, oldNumber: undefined, newNumber: start + index },
  );
}

export const oldRegistration = [
  "# maximum image size matches",
  "# https://example.invalid/source/service/manager/editing/generator.py?rev=123456789",
  '@FACTORY.register("image_light")',
  "class LightModel(Model):",
  '    """Emulates the image-light service from',
  '    quality/image/service/light."""',
];

export const newRegistration = [
  '@FACTORY.register("image_light_6mp")',
  "class Config_Light_6mp(Model):",
  '    """Legacy version for the image-light service from',
  "    quality/image/service/light.",
  "    https://example.invalid/source/service/manager/editing/generator.py?rev=123456789",
  '    """',
];

describe("changed line alignment", () => {
  it("keeps a related declaration and docstring together instead of anchoring on a moved URL", () => {
    const before = lines(LineType.DELETE, oldRegistration, 569);
    const after = lines(LineType.INSERT, newRegistration, 569);
    const result = alignChangedLines(before, after);
    expect(result.filter(([old, next]) => old.length && next.length)).toEqual([
      [[before[2]], [after[0]]],
      [[before[3]], [after[1]]],
      [[before[4]], [after[2]]],
      [[before[5]], [after[3]]],
    ]);
    expect(result.flatMap(([old]) => old)).toEqual(before);
    expect(result.flatMap(([, next]) => next)).toEqual(after);
    expect(result[1][0][0]).toBe(before[2]);
  });

  it("chooses the related registration after an entirely removed similar class", () => {
    const before = lines(LineType.DELETE, [
      '@FACTORY.register("image_heavy")',
      "class HeavyModel(Model):",
      '    """High quality model from image-heavy service."""',
      "    def __init__(self):",
      "        super().__init__(config=HeavyConfig())",
      "",
      ...oldRegistration,
    ]);
    const after = lines(LineType.INSERT, newRegistration);
    const pairs = alignChangedLines(before, after).filter(([old, next]) => old.length && next.length);
    expect(pairs.map(([old, next]) => [old[0].oldNumber, next[0].newNumber])).toEqual([
      [9, 1],
      [10, 2],
      [11, 3],
      [12, 4],
    ]);
  });

  it("does not produce inline comparisons between an unrelated deleted method and an inserted docstring", () => {
    const before = lines(LineType.DELETE, ["    def __init__(self):", "        super().__init__(config=Config())"]);
    const after = lines(LineType.INSERT, ['    """Legacy image model.', '    """']);
    expect(alignChangedLines(before, after)).toEqual([
      [before, []],
      [[], after],
    ]);
  });

  it("keeps a coherent renamed declaration group together despite a longer new class name", () => {
    const before = lines(LineType.DELETE, [
      '@FACTORY.register("image_heavy")',
      "class HeavyModel(Model):",
      '    """Heavy service from',
      '    quality/image/service/light."""',
      "    def __init__(self):",
      '        super().__init__(model="heavy")',
      "",
      ...oldRegistration.map((line) => line.replace("LightModel", "ImgLight")),
    ]);
    const after = lines(
      LineType.INSERT,
      newRegistration.map((line) => line.replace("Config_Light_6mp", "Config_image_light_6mp")),
    );
    const pairs = alignChangedLines(before, after).filter(([old, next]) => old.length && next.length);
    expect(pairs.map(([old, next]) => [old[0].oldNumber, next[0].newNumber])).toEqual([
      [10, 1],
      [11, 2],
      [12, 3],
      [13, 4],
    ]);
  });

  it("does not reorder, drop or mutate source lines and their attached metadata", () => {
    const before = lines(LineType.DELETE, ["alpha = 1", "# removed", "beta = 2"]);
    const after = lines(LineType.INSERT, ["alpha = 3", "beta = 4", "# inserted"]);
    Object.assign(before[2], { noNewline: true });
    const original = JSON.stringify([before, after]);
    const result = alignChangedLines(before, after);
    expect(result.flatMap(([old]) => old)).toEqual(before);
    expect(result.flatMap(([, next]) => next)).toEqual(after);
    expect(result.flatMap(([old]) => old)[2]).toBe(before[2]);
    expect(JSON.stringify([before, after])).toBe(original);
  });

  it("retains positional fallback when the changed run would exceed the comparison budget", () => {
    const before = lines(
      LineType.DELETE,
      Array.from({ length: 320 }, (_, index) => `value_${index} = 1`),
    );
    const after = lines(
      LineType.INSERT,
      Array.from({ length: 320 }, (_, index) => `value_${index} = 2`),
    );
    expect(alignChangedLines(before, after)).toEqual([[before, after]]);
  });

  it("bounds character comparisons when an individual line is unusually long", () => {
    const before = lines(LineType.DELETE, ["a".repeat(3000)]);
    const after = lines(LineType.INSERT, ["b".repeat(3000)]);
    expect(alignChangedLines(before, after)).toEqual([[before, after]]);
  });

  it.each([LineType.DELETE, LineType.INSERT] as const)("handles one-sided changes (%s)", (type) => {
    const changed = lines(type, ["x", "y"]);
    const before = type === LineType.DELETE ? changed : [];
    const after = type === LineType.INSERT ? changed : [];
    expect(alignChangedLines(before, after)).toEqual([[before, after]]);
  });
});

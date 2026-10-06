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
  const oldCondition = "    if not exists(value):";
  const newCondition = "    if value is None:";

  it("pairs a rewritten condition with the help of its adjacent changed return", () => {
    const before = lines(LineType.DELETE, [oldCondition, "        return value"]);
    const after = lines(LineType.INSERT, [newCondition, "        return None"]);
    expect(alignChangedLines(before, after)).toEqual([
      [[before[0]], [after[0]]],
      [[before[1]], [after[1]]],
    ]);
  });

  it("also extends a strong preceding code pair into a moderately similar suffix", () => {
    const before = lines(LineType.DELETE, ["    result = update(value)", oldCondition]);
    const after = lines(LineType.INSERT, ["    result = update(None)", newCondition]);
    expect(alignChangedLines(before, after)).toEqual([
      [[before[0]], [after[0]]],
      [[before[1]], [after[1]]],
    ]);
  });

  it.each([
    ["# related old", "# related new"],
    ['"related old"', '"related new"'],
    ['f"related old"', 'f"related new"'],
  ])("does not extend a comment or literal anchor into neighboring code (%s)", (old, next) => {
    const before = lines(LineType.DELETE, [oldCondition, old]);
    const after = lines(LineType.INSERT, ["    while other is None:", next]);
    expect(alignChangedLines(before, after)).toEqual([
      [[before[0]], []],
      [[], [after[0]]],
      [[before[1]], [after[1]]],
    ]);
  });

  it("pairs an isolated rewritten guard from its own identifier and indentation evidence", () => {
    const before = lines(LineType.DELETE, [oldCondition]);
    const after = lines(LineType.INSERT, [newCondition]);
    expect(alignChangedLines(before, after)).toEqual([[before, after]]);
  });

  it.each([
    [oldCondition, `    ${newCondition}`],
    ["    ax = 1111", "    throw OtherFault();"],
  ])("requires matching indentation and compatible code evidence in a rescued pair (%s)", (old, next) => {
    const before = lines(LineType.DELETE, [old, "        return value"]);
    const after = lines(LineType.INSERT, [next, "        return None"]);
    expect(alignChangedLines(before, after)).toEqual([
      [[before[0]], []],
      [[], [after[0]]],
      [[before[1]], [after[1]]],
    ]);
  });

  it.each(["before", "after", "tie"])("uses the stronger boundary without crossing anchors (%s)", (stronger) => {
    const before = lines(LineType.DELETE, [
      `start = '${stronger === "after" ? "old" : "same"}'`,
      oldCondition,
      oldCondition,
      `finish = '${stronger === "before" ? "old" : "same"}'`,
    ]);
    const after = lines(LineType.INSERT, [
      `start = '${stronger === "after" ? "new" : "same"}'`,
      newCondition,
      `finish = '${stronger === "before" ? "new" : "same"}'`,
    ]);
    const snapshot = JSON.stringify([before, after]);
    const result = alignChangedLines(before, after);
    expect(result.filter(([old, next]) => old.length && next.length)).toEqual([
      [[before[0]], [after[0]]],
      [[before[stronger === "after" ? 2 : 1]], [after[1]]],
      [[before[3]], [after[2]]],
    ]);
    expect(result.flatMap(([old]) => old)).toEqual(before);
    expect(result.flatMap(([, next]) => next)).toEqual(after);
    expect(JSON.stringify([before, after])).toBe(snapshot);
  });

  it.each(["py", "python", "pyi"])("pairs unchanged Python code when annotations are removed (%s)", (language) => {
    const statements = [
      "if len(config) > 0:",
      '    params["config"] = decode(config[0].read_text())',
      '    value = "# literal"',
      "    value = 'it\\'s # literal'",
    ];
    const before = lines(
      LineType.DELETE,
      statements.map((line) => `${line}  # checker: ignore[invalid-argument-type]`),
    );
    const after = lines(LineType.INSERT, statements);
    const result = alignChangedLines(before, after, language);
    expect(result).toEqual(before.map((line, index) => [[line], [after[index]]]));
  });

  it.each([
    ['value = "# this is a very long string literal"', 'value = "# x"', "py"],
    ['value = """some # long literal content"""', 'value = """x"""', "py"],
    ['value = f"{mapping["# this is a very long dictionary string key"]}"', 'value = f"{mapping["# x"]}"', "py"],
    ["# this is a very long comment", "# x", "py"],
    ["if (ready) {} # a long non-Python suffix", "if (ready) {}", "js"],
  ])("does not discard string content, whole comments, or non-Python suffixes", (old, next, language) => {
    const before = lines(LineType.DELETE, [old]);
    const after = lines(LineType.INSERT, [next]);
    const result = alignChangedLines(before, after, language);
    expect(result.flatMap(([left]) => left)).toEqual(before);
    expect(result.flatMap(([, right]) => right)).toEqual(after);
    // Assignments and guards remain useful comparisons even when their string
    // operands are rewritten; whole comments have no statement-role evidence.
    expect(result).toEqual(
      old.startsWith("#")
        ? [
            [before, []],
            [[], after],
          ]
        : [[before, after]],
    );
  });

  it.each([
    "import widgets",
    "import widgets as ui",
    "import widgets, tools",
    "from .widgets import Widget",
    "from .. import Widget",
    "from widgets import (",
    "from widgets import *",
  ])("pairs an unchanged import with a long added or removed comment: %s", (statement) => {
    const withComment = `${statement}  # checker: ignore[unresolved-import, missing-module]`;
    for (const [old, next] of [
      [withComment, statement],
      [statement, withComment],
    ]) {
      const before = lines(LineType.DELETE, [old]);
      const after = lines(LineType.INSERT, [next]);
      expect(alignChangedLines(before, after)).toEqual([[before, after]]);
    }
  });

  it("keeps import identity when several trailing comments are removed together", () => {
    const before = lines(LineType.DELETE, [
      "import obsolete  # checker: ignore[unresolved-import]",
      "import widgets  # checker: ignore[unresolved-import]",
      "from helpers import run  # checker: ignore[unresolved-import]",
    ]);
    const after = lines(LineType.INSERT, ["import widgets", "from helpers import run"]);
    expect(alignChangedLines(before, after)).toEqual([
      [[before[0]], []],
      [[before[1]], [after[0]]],
      [[before[2]], [after[1]]],
    ]);
  });

  it.each([false, true])("aligns an unwrapped import with its header in either direction (reverse=%s)", (reverse) => {
    const multiline = [
      "# TODO remove compatibility annotations after the migration",
      "from .registry import (  # checker: ignore[unresolved-import]",
      "    FACTORY,",
      "    ModelType,",
      "    Model,",
      "    TranslationConfig,",
      "    LegacyConfig,",
      ")",
    ];
    const single = ["from .registry import FACTORY, ModelType, Model"];
    const before = lines(LineType.DELETE, reverse ? single : multiline);
    const after = lines(LineType.INSERT, reverse ? multiline : single);
    const result = alignChangedLines(before, after);
    const pairs = result.filter(([old, next]) => old.length && next.length);
    expect(pairs).toEqual(reverse ? [[[before[0]], [after[1]]]] : [[[before[1]], [after[0]]]]);
    expect(result.flatMap(([old]) => old)).toEqual(before);
    expect(result.flatMap(([, next]) => next)).toEqual(after);
  });

  it("prefers the matching from-module over similar names in another import or its continuation", () => {
    const before = lines(LineType.DELETE, [
      "from .unrelated import FACTORY, ModelType, Model",
      "from .registry import (",
      "    FACTORY, ModelType, Model,",
      ")",
    ]);
    const after = lines(LineType.INSERT, ["from .registry import FACTORY, ModelType, Model"]);
    expect(alignChangedLines(before, after).filter(([old, next]) => old.length && next.length)).toEqual([
      [[before[1]], [after[0]]],
    ]);
  });

  it("prefers the exact from-module even when another long module differs by only one letter", () => {
    const before = lines(LineType.DELETE, [
      "from .feature_registry_cache_primary import Model, ModelType, Factory",
      "from .feature_registry_cache_primars import (",
      "    Model, ModelType, Factory,",
      ")",
    ]);
    const after = lines(LineType.INSERT, ["from .feature_registry_cache_primars import Model, ModelType, Factory"]);
    expect(alignChangedLines(before, after, "py").filter(([old, next]) => old.length && next.length)).toEqual([
      [[before[1]], [after[0]]],
    ]);
  });

  it.each([
    ['text = "import widgets # a long string literal"', 'text = "import widgets'],
    ['import "widgets#this-is-a-long-string-specifier"', 'import "widgets"'],
    ["# import widgets and a very long explanation", "# import widgets"],
  ])("does not treat hashes inside strings or whole comments as import suffixes", (old, next) => {
    const before = lines(LineType.DELETE, [old]);
    const after = lines(LineType.INSERT, [next]);
    const result = alignChangedLines(before, after);
    expect(result.flatMap(([left]) => left)).toEqual(before);
    expect(result.flatMap(([, right]) => right)).toEqual(after);
    expect(result).toEqual(
      old.startsWith("#")
        ? [
            [before, []],
            [[], after],
          ]
        : [[before, after]],
    );
  });

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

describe("assignment target anchors", () => {
  function aligned(old: string[], next: string[], language = "py") {
    const before = lines(LineType.DELETE, old);
    const after = lines(LineType.INSERT, next);
    const snapshot = JSON.stringify([before, after]);
    const groups = alignChangedLines(before, after, language);
    expect(groups.flatMap(([left]) => left)).toEqual(before);
    expect(groups.flatMap(([, right]) => right)).toEqual(after);
    expect(JSON.stringify([before, after])).toBe(snapshot);
    return {
      groups,
      before,
      after,
      pairs: groups.filter(([left, right]) => left.length && right.length),
    };
  }

  it.each([
    ["Params", "Основное", "main"],
    ["Inputs and Outputs", "Входы и выходы", "inputs_and_outputs"],
  ])("pairs translated keyword values with their target (%s)", (old, next, code) => {
    const { groups, before, after } = aligned(
      [`            name="${old}",`],
      [`            name="${next}",`, `            code="${code}",`],
    );
    expect(groups).toEqual([
      [[before[0]], [after[0]]],
      [[], [after[1]]],
    ]);
  });

  it.each([false, true])(
    "keeps a translated parameter next to an added or removed parameter (reverse=%s)",
    (reverse) => {
      const old = ['    caption="English display text",'];
      const next = ['    identifier="English display text",', '    caption="Переведённая подпись",'];
      const { pairs, before, after } = aligned(reverse ? next : old, reverse ? old : next);
      expect(pairs).toEqual(reverse ? [[[before[1]], [after[0]]]] : [[[before[0]], [after[1]]]]);
    },
  );

  it.each([
    "title",
    "options.label",
    "settings . presentation . caption",
    "настройки.подпись",
    "const caption",
    "let caption",
    "var caption",
    "val caption",
    "final caption",
  ])("recognizes a generic unchanged assignment target: %s", (target) => {
    const { pairs, before, after } = aligned(
      [`${target} = "English description";`],
      ['unrelated = "English description";', `${target} = "Совершенно другая подпись";`],
    );
    expect(pairs).toEqual([[[before[0]], [after[1]]]]);
  });

  it("normalizes whitespace around member access while retaining exact indentation", () => {
    const { pairs, before, after } = aligned(
      ['\toptions . caption = "English description"'],
      ['\toptions.caption = "Совершенно другая подпись"', '\toptions.code = "English description"'],
    );
    expect(pairs).toEqual([[[before[0]], [after[0]]]]);
    expect(
      aligned(
        ['    caption = "English description"'],
        ['\tcaption = "Совершенно другая подпись на другом языке"', "\tidentifier = 42"],
      ).pairs,
    ).toEqual([]);
  });

  it("does not let neighboring gap extension steal an assignment with its own matching target", () => {
    const { pairs, before, after } = aligned(
      ["start = stable()", '    caption="English display text",', "finish = stable()"],
      [
        "start = stable()",
        '    identifier="English display text",',
        '    caption="Переведённая подпись",',
        "finish = stable()",
      ],
    );
    expect(pairs).toEqual([
      [[before[0]], [after[0]]],
      [[before[1]], [after[2]]],
      [[before[2]], [after[3]]],
    ]);
  });

  it("distinguishes assignment operators when a same-operator counterpart exists", () => {
    const { pairs, before, after } = aligned(
      ["counter += previous"],
      ["counter = previous", "counter += completely_different_operand"],
    );
    expect(pairs).toEqual([[[before[0]], [after[1]]]]);
  });

  it.each(["==", "!=", "<=", ">=", "=>", ":="])("does not treat %s as an assignment anchor", (operator) => {
    const { pairs } = aligned(
      [`caption ${operator} "${"a".repeat(50)}"`],
      [`caption ${operator} "${"ж".repeat(60)}"`, "extra = 42"],
    );
    expect(pairs).toEqual([]);
  });

  it.each([
    "# caption = ",
    "// caption = ",
    "/* caption = ",
    '"caption = ',
    "f'caption = ",
    "std::string caption = ",
    "caption: SomeType = ",
  ])("does not promote comment, literal, or ambiguous typed text to a target (%s)", (prefix) => {
    const { pairs } = aligned([`${prefix}${"a".repeat(60)}`], [`${prefix}${"ж".repeat(70)}`, "extra = 42"]);
    expect(pairs).toEqual([]);
  });

  it("does not interpret a JavaScript //= comment as a floor assignment", () => {
    expect(
      aligned([`caption //= "${"a".repeat(60)}"`], [`caption //= "${"ж".repeat(70)}"`, "extra = 42"], "js").pairs,
    ).toEqual([]);
  });

  it("does not manufacture structural pairs for repeated translated targets", () => {
    const { pairs } = aligned(
      [`name = "${"a".repeat(50)}"`, `name = "${"b".repeat(50)}"`],
      [
        `name = "${"ж".repeat(60)}"`,
        `code = "${"a".repeat(50)}"`,
        `name = "${"я".repeat(60)}"`,
        `slug = "${"b".repeat(50)}"`,
      ],
    );
    expect(pairs).toEqual([]);
  });

  it("still uses exact value evidence for repeated targets and keeps inserted fields separate", () => {
    const { pairs, before, after } = aligned(
      ['name = "first"', 'name = "second"'],
      ['name = "first"', 'code = "first"', 'name = "second"', 'code = "second"'],
    );
    expect(pairs).toEqual([
      [[before[0]], [after[0]]],
      [[before[1]], [after[2]]],
    ]);
  });

  it("keeps source order when same-target anchors cross after parameter reordering", () => {
    const { pairs } = aligned(
      ['caption = "English description"', 'identifier = "old machine key"'],
      ['identifier = "Совершенно новое значение"', 'caption = "Полностью переведённое описание"'],
    );
    expect(pairs).toHaveLength(1);
    for (const [[old], [next]] of pairs) {
      expect(old.content.slice(1).split("=")[0]).toBe(next.content.slice(1).split("=")[0]);
    }
  });

  it("does not promote two different targets merely because both lines are assignments", () => {
    expect(
      aligned([`previous = "${"a".repeat(50)}"`], [`replacement = "${"ж".repeat(60)}"`, "extra = 42"]).pairs,
    ).toEqual([]);
  });
});

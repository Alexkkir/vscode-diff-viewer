import { LineType, type DiffBlock } from "diff2html/lib/types";
import { parseDiff } from "../diff";
import { realignDiffHunks } from "../hunk-alignment";

const patch = (body: string[]): string => ["--- sample.py", "+++ sample.py", ...body, ""].join("\n");
const projection = (block: DiffBlock, side: "old" | "new") =>
  block.lines
    .filter((line) => line[`${side}Number`] !== undefined)
    .map((line) => [line[`${side}Number`], line.content.slice(1)]);
const replacement = (old: string[], next: string[], oldStart = 1, newStart = 1): string =>
  patch([
    `@@ -${oldStart},${old.length} +${newStart},${next.length} @@`,
    ...old.map((line) => `-${line}`),
    ...next.map((line) => `+${line}`),
  ]);

describe("realignDiffHunks", () => {
  it.each([false, true])(
    "does not enlarge a valid edit by anchoring on a unique moved line (reverse=%s)",
    (reverse) => {
      const checkpoint = reverse ? "+checkpoint()" : "-checkpoint()";
      const moved = reverse ? "-checkpoint()" : "+checkpoint()";
      const before = parseDiff(
        patch(["@@ -1,6 +1,6 @@", checkpoint, ...Array.from({ length: 5 }, () => " tick()"), moved]),
      );
      const [file] = realignDiffHunks(before);
      expect(file).toBe(before[0]);
      expect(file).toMatchObject({ addedLines: 1, deletedLines: 1 });
      expect(file.blocks[0].lines.filter((line) => line.type === LineType.CONTEXT).map((line) => line.content)).toEqual(
        Array.from({ length: 5 }, () => " tick()"),
      );
    },
  );

  it.each([false, true])(
    "keeps supplied meaningful context when a tie only exchanges it for moved lines (reverse=%s)",
    (reverse) => {
      const removed = reverse ? "+" : "-";
      const added = reverse ? "-" : "+";
      const body = ["tick()", "", "tick()", "", ""];
      const before = parseDiff(
        patch([
          "@@ -1,7 +1,7 @@",
          `${removed}checkpoint_one()`,
          `${removed}checkpoint_two()`,
          ...body.map((line) => ` ${line}`),
          `${added}checkpoint_one()`,
          `${added}checkpoint_two()`,
        ]),
      );
      const [file] = realignDiffHunks(before);
      expect(file).toBe(before[0]);
      expect(file).toMatchObject({ addedLines: 2, deletedLines: 2 });
      expect(file.blocks[0].lines.filter((line) => line.type === LineType.CONTEXT).map((line) => line.content)).toEqual(
        body.map((line) => ` ${line}`),
      );
    },
  );

  it.each([false, true])(
    "keeps a moved checkpoint from replacing a long blank-only context (reverse=%s)",
    (reverse) => {
      const removed = reverse ? "+checkpoint()" : "-checkpoint()";
      const added = reverse ? "-checkpoint()" : "+checkpoint()";
      const before = parseDiff(
        patch(["@@ -1,101 +1,101 @@", removed, ...Array.from({ length: 100 }, () => " "), added]),
      );
      const [file] = realignDiffHunks(before);
      expect(file).toBe(before[0]);
      expect(file).toMatchObject({ addedLines: 1, deletedLines: 1 });
      expect(file.blocks[0].lines.filter((line) => line.type === LineType.CONTEXT)).toHaveLength(100);
    },
  );

  it("keeps the surviving constructor and deletes both removed test classes", () => {
    const before = parseDiff(
      patch([
        "@@ -1,12 +1,5 @@",
        " @task",
        " class Worker:",
        "-    def __init__(self, value):",
        "-        self.value = value",
        "-",
        "-class TestOne:",
        '+    """Stores a value."""',
        "     def __init__(self, value):",
        "         self.value = value",
        "-",
        "-class TestTwo:",
        "-    def __init__(self, value):",
        "-        self.value = value",
      ]),
    );
    const [file] = realignDiffHunks(before);
    expect(projection(file.blocks[0], "old")).toEqual(projection(before[0].blocks[0], "old"));
    expect(projection(file.blocks[0], "new")).toEqual(projection(before[0].blocks[0], "new"));
    const lines = file.blocks[0].lines;
    expect(lines.find((line) => line.oldNumber === 3)).toMatchObject({ type: LineType.CONTEXT, newNumber: 4 });
    expect(lines.find((line) => line.oldNumber === 4)).toMatchObject({ type: LineType.CONTEXT, newNumber: 5 });
    expect(lines.find((line) => line.newNumber === 3)).toMatchObject({
      type: LineType.INSERT,
      content: '+    """Stores a value."""',
    });
    expect(lines.filter((line) => (line.oldNumber ?? 0) >= 5).every((line) => line.type === LineType.DELETE)).toBe(
      true,
    );
    expect(file).toMatchObject({ addedLines: 1, deletedLines: 8 });
    expect(realignDiffHunks([file])[0]).toBe(file);
  });

  it("prefers the earliest old copy when duplicate sequences have equal LCS length", () => {
    const before = parseDiff(
      replacement(["anchor", "repeat", "value", "repeat", "value"], ["anchor", "note", "repeat", "value"]),
    );
    const [file] = realignDiffHunks(before);
    expect(
      file.blocks[0].lines
        .filter((line) => line.type === LineType.CONTEXT)
        .map((line) => [line.oldNumber, line.newNumber]),
    ).toEqual([
      [1, 1],
      [2, 3],
      [3, 4],
    ]);
  });

  it("does not borrow constructor lines from deleted classes with different resource values", () => {
    const constructor = (resource: string) => [
      "    def __init__(self, role, resource):",
      "        self.role = role",
      `        self.resource = ${resource}`,
    ];
    const old = [
      "@task",
      "class Worker:",
      ...constructor("resource"),
      "",
      "class TestOne:",
      ...constructor("'cpu'"),
      "",
      "class TestTwo:",
      ...constructor("'gpu'"),
    ];
    const next = ["@task", "class Worker:", '    """Stores a role and a resource."""', ...constructor("resource")];
    const [file] = realignDiffHunks(parseDiff(replacement(old, next)));
    expect(
      file.blocks[0].lines
        .filter((line) => line.type === LineType.CONTEXT)
        .map((line) => [line.oldNumber, line.newNumber]),
    ).toEqual([
      [1, 1],
      [2, 2],
      [3, 4],
      [4, 5],
      [5, 6],
    ]);
    expect(
      file.blocks[0].lines.filter((line) => (line.oldNumber ?? 0) >= 6).every((line) => line.type === LineType.DELETE),
    ).toBe(true);
  });

  it("respects unique class anchors among repetitive methods", () => {
    const old = [
      "class First:",
      "    def run(self):",
      "        pass",
      "class Second:",
      "    def run(self):",
      "        pass",
    ];
    const next = ["class Second:", "    def run(self):", "        pass"];
    const [file] = realignDiffHunks(parseDiff(replacement(old, next)));
    expect(file.blocks[0].lines.filter((line) => line.type === LineType.CONTEXT).map((line) => line.oldNumber)).toEqual(
      [4, 5, 6],
    );
  });

  it("does not pull a surviving constructor toward a deleted class before a top-level anchor", () => {
    const body = ["    def __init__(self):", "        self.value = 1"];
    const old = [
      "class Worker:",
      ...body,
      "",
      "class TestOne:",
      ...body,
      "",
      "class TestTwo:",
      ...body,
      "class Next:",
      "    pass",
    ];
    const next = ["class Worker:", '    """Surviving worker."""', ...body, "class Next:", "    pass"];
    const [file] = realignDiffHunks(parseDiff(replacement(old, next)));
    expect(file.blocks[0].lines.find((line) => line.oldNumber === 2)).toMatchObject({
      type: LineType.CONTEXT,
      newNumber: 3,
    });
    expect(file.blocks[0].lines.find((line) => line.oldNumber === 3)).toMatchObject({
      type: LineType.CONTEXT,
      newNumber: 4,
    });
    expect(
      file.blocks[0].lines
        .filter((line) => (line.oldNumber ?? 0) >= 4 && (line.oldNumber ?? 0) <= 11)
        .every((line) => line.newNumber === undefined),
    ).toBe(true);
  });

  it("keeps a tab-indented constructor with its unique model anchor", () => {
    const common = ["\tdef __init__(self):", "\t\tsuper().__init__("];
    const old = [
      "class Removed:",
      ...common,
      '\t\t\tmodel="heavy",',
      "\t\t)",
      "",
      "class Original:",
      ...common,
      '\t\t\tmodel="light",',
      "\t\t)",
    ];
    const next = ["class Renamed:", ...common, '\t\t\tmodel="light",', "\t\t)"];
    const [file] = realignDiffHunks(parseDiff(replacement(old, next)));
    expect(file.blocks[0].lines.find((line) => line.oldNumber === 8)).toMatchObject({
      type: LineType.CONTEXT,
      newNumber: 2,
    });
    expect(file.blocks[0].lines.find((line) => line.oldNumber === 9)).toMatchObject({
      type: LineType.CONTEXT,
      newNumber: 3,
    });
    expect(
      file.blocks[0].lines
        .filter((line) => (line.oldNumber ?? 0) >= 1 && (line.oldNumber ?? 0) <= 6)
        .every((line) => line.newNumber === undefined),
    ).toBe(true);
  });

  it("never matches identical lines across an omitted hunk gap", () => {
    const before = parseDiff(patch(["@@ -10,1 +10,0 @@", "-moved", "@@ -40,0 +39,1 @@", "+moved"]));
    expect(realignDiffHunks(before)[0]).toBe(before[0]);
    expect(before[0].blocks.map((block) => [block.oldStartLine, block.newStartLine])).toEqual([
      [10, 10],
      [40, 39],
    ]);
  });

  it.each([
    [["-last", "\\ No newline at end of file", "+last"], { old: 9 }],
    [["-last", "+last", "\\ No newline at end of file"], { new: 12 }],
  ])("keeps a newline-only change as deletion/insertion", (lines, eof) => {
    const before = parseDiff(patch(["@@ -9 +12 @@", ...lines]));
    const [file] = realignDiffHunks(before);
    expect(file.noNewline).toEqual(eof);
    expect(file.blocks[0].lines.map((line) => line.type)).toEqual([LineType.DELETE, LineType.INSERT]);
    expect(projection(file.blocks[0], "old")).toEqual([[9, "last"]]);
    expect(projection(file.blocks[0], "new")).toEqual([[12, "last"]]);
  });

  it("allows exact matching when both last lines have the same missing-newline status", () => {
    const before = parseDiff(
      patch(["@@ -9 +12 @@", "-last", "\\ No newline at end of file", "+last", "\\ No newline at end of file"]),
    );
    const [file] = realignDiffHunks(before);
    expect(file.noNewline).toEqual({ old: 9, new: 12 });
    expect(file.blocks[0].lines).toEqual([{ type: LineType.CONTEXT, content: " last", oldNumber: 9, newNumber: 12 }]);
  });

  it.each(["", " ", "\t"])("preserves an unchanged whitespace separator between changed lines (%j)", (blank) => {
    const before = parseDiff(replacement(["a", blank, "b"], ["c", blank, "d"]));
    const [file] = realignDiffHunks(before);
    expect(file).toMatchObject({ addedLines: 2, deletedLines: 2 });
    expect(file.blocks[0].lines.find((line) => line.oldNumber === 2)).toMatchObject({
      type: LineType.CONTEXT,
      newNumber: 2,
      content: ` ${blank}`,
    });
  });

  it.each([
    [["first", "last"], ["first", "", "last"], 1, 0],
    [["first", "", "last"], ["first", "last"], 0, 1],
    [["first", " ", "last"], ["first", "\t", "last"], 1, 1],
  ] as const)("preserves actual whitespace-only edits", (old, next, addedLines, deletedLines) => {
    const before = parseDiff(replacement([...old], [...next]));
    const [file] = realignDiffHunks(before);
    expect(file).toMatchObject({ addedLines, deletedLines });
    expect(projection(file.blocks[0], "old")).toEqual(projection(before[0].blocks[0], "old"));
    expect(projection(file.blocks[0], "new")).toEqual(projection(before[0].blocks[0], "new"));
  });

  it.each(["", " ", "\t"])("keeps a missing EOF newline on a whitespace-only last line (%j)", (blank) => {
    const before = parseDiff(patch(["@@ -1 +1 @@", `-${blank}`, "\\ No newline at end of file", `+${blank}`]));
    const [file] = realignDiffHunks(before);
    expect(file).toMatchObject({ noNewline: { old: 1 }, addedLines: 1, deletedLines: 1 });
    expect(file.blocks[0].lines.map((line) => line.type)).toEqual([LineType.DELETE, LineType.INSERT]);
  });

  it("does not use a blank-only insertion to select a later duplicate body via the subsequence shortcut", () => {
    const body = ["    def __init__(self):", "        self.value = 1"];
    const old = ["class Worker:", ...body, "", "class Test:", ...body];
    const next = ["class Worker:", "", ...body];
    const [file] = realignDiffHunks(parseDiff(replacement(old, next)));
    expect(file.blocks[0].lines.find((line) => line.oldNumber === 2)).toMatchObject({
      type: LineType.CONTEXT,
      newNumber: 3,
    });
    expect(file.blocks[0].lines.find((line) => line.oldNumber === 3)).toMatchObject({
      type: LineType.CONTEXT,
      newNumber: 4,
    });
    expect(
      file.blocks[0].lines.filter((line) => (line.oldNumber ?? 0) >= 4).every((line) => line.newNumber === undefined),
    ).toBe(true);
  });

  it.each([
    { name: "removed documentation", prefix: ['    """Surviving worker."""'] },
    { name: "removed blank separator", prefix: [""] },
    { name: "removed documentation and blank separator", prefix: ['    """Surviving worker."""', ""] },
  ])("keeps the surviving constructor before newly added copies after $name", ({ prefix }) => {
    const body = ["    def __init__(self):", "        self.value = 1"];
    const old = ["class Worker:", ...prefix, ...body];
    const next = ["class Worker:", ...body, "", "class TestOne:", ...body, "", "class TestTwo:", ...body];
    const before = parseDiff(replacement(old, next, 21, 51));
    const original = JSON.stringify(before);
    const [file] = realignDiffHunks(before);
    for (const side of ["old", "new"] as const)
      expect(projection(file.blocks[0], side)).toEqual(projection(before[0].blocks[0], side));
    const lines = file.blocks[0].lines;
    for (let index = 0; index < body.length; index++)
      expect(lines.find((line) => line.oldNumber === 22 + prefix.length + index)).toMatchObject({
        type: LineType.CONTEXT,
        newNumber: 52 + index,
      });
    expect(lines.filter((line) => (line.newNumber ?? 0) >= 54).every((line) => line.oldNumber === undefined)).toBe(
      true,
    );
    expect(lines.filter((line) => line.type === LineType.DELETE).map((line) => line.content.slice(1))).toEqual(prefix);
    expect(realignDiffHunks([file])[0]).toBe(file);
    expect(JSON.stringify(before)).toBe(original);
  });

  it("does not let supplied whitespace context pin the survivor to a newly added class", () => {
    const before = parseDiff(
      patch([
        "@@ -21,4 +51,7 @@",
        " class Worker:",
        "+    def __init__(self):",
        "+        self.value = 1",
        " ",
        "+class TestOne:",
        "     def __init__(self):",
        "         self.value = 1",
      ]),
    );
    const [file] = realignDiffHunks(before);
    const lines = file.blocks[0].lines;
    expect(lines.find((line) => line.oldNumber === 23)).toMatchObject({ type: LineType.CONTEXT, newNumber: 52 });
    expect(lines.find((line) => line.oldNumber === 24)).toMatchObject({ type: LineType.CONTEXT, newNumber: 53 });
    expect(lines.find((line) => line.oldNumber === 22)).toMatchObject({ type: LineType.DELETE, newNumber: undefined });
    expect(lines.filter((line) => (line.newNumber ?? 0) >= 54).every((line) => line.type === LineType.INSERT)).toBe(
      true,
    );
    for (const side of ["old", "new"] as const)
      expect(projection(file.blocks[0], side)).toEqual(projection(before[0].blocks[0], side));
    expect(realignDiffHunks([file])[0]).toBe(file);
  });

  it("handles 6000 mostly unique lines without quadratic allocation", () => {
    const old = Array.from({ length: 6000 }, (_, index) => `value_${index} = ${index}`);
    const next = [...old.slice(0, 3000), '"""Added documentation"""', ...old.slice(3000)];
    const before = parseDiff(replacement(old, next, 10, 20));
    const [file] = realignDiffHunks(before);
    expect(file).toMatchObject({ addedLines: 1, deletedLines: 0 });
    expect(projection(file.blocks[0], "old")).toEqual(projection(before[0].blocks[0], "old"));
    expect(projection(file.blocks[0], "new")).toEqual(projection(before[0].blocks[0], "new"));
    expect(file.blocks[0].lines[file.blocks[0].lines.length - 1]).toMatchObject({ oldNumber: 6009, newNumber: 6020 });
  });

  it("aligns 8000 repeated lines linearly using the earliest embedding", () => {
    const old = ["heading", ...Array.from({ length: 8000 }, () => "    pass")];
    const next = ["heading", ...Array.from({ length: 4000 }, () => "    pass")];
    const [file] = realignDiffHunks(parseDiff(replacement(old, next)));
    expect(file).toMatchObject({ addedLines: 0, deletedLines: 4000 });
    expect(file.blocks[0].lines[4000]).toMatchObject({ type: LineType.CONTEXT, oldNumber: 4001, newNumber: 4001 });
    expect(file.blocks[0].lines[4001]).toMatchObject({ type: LineType.DELETE, oldNumber: 4002 });
  });

  it("falls back to the original hunk for large ambiguous changes", () => {
    const old = Array.from({ length: 6000 }, (_, index) => (index % 2 ? "a" : "b"));
    const next = ["new", ...old.slice(0, -1), "new"];
    const before = parseDiff(replacement(old, next));
    expect(realignDiffHunks(before)[0]).toBe(before[0]);
  });

  it("does not mutate inputs or reprocess combined/binary/oversized diffs", () => {
    const [file] = parseDiff(replacement(["old"], ["new"]));
    const snapshot = JSON.stringify(file);
    realignDiffHunks([file]);
    expect(JSON.stringify(file)).toBe(snapshot);
    for (const key of ["isCombined", "isBinary", "isTooBig"] as const) {
      const special = { ...file, [key]: true };
      expect(realignDiffHunks([special])[0]).toBe(special);
    }
  });

  it("preserves source projections and exact coordinates for many duplicate-line edits", () => {
    let seed = 123;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed;
    };
    for (let sample = 0; sample < 80; sample++) {
      const old = Array.from({ length: (random() % 30) + 1 }, () => `line${random() % 7}`);
      const next = Array.from({ length: (random() % 30) + 1 }, () => `line${random() % 7}`);
      const before = parseDiff(replacement(old, next, 7, 13));
      const [file] = realignDiffHunks(before);
      for (const side of ["old", "new"] as const)
        expect(projection(file.blocks[0], side)).toEqual(projection(before[0].blocks[0], side));
      expect(file.addedLines).toBe(file.blocks[0].lines.filter((line) => line.type === LineType.INSERT).length);
      expect(file.deletedLines).toBe(file.blocks[0].lines.filter((line) => line.type === LineType.DELETE).length);
      expect(file.addedLines + file.deletedLines).toBeLessThanOrEqual(before[0].addedLines + before[0].deletedLines);
    }
  });
});

/** Public synthetic examples. Never put user patches or private source in this corpus. */
export interface SourceRow {
  number: number;
  text: string;
}

export interface ExpectedDiffFile {
  oldName: string;
  newName: string;
  old: SourceRow[];
  next: SourceRow[];
  noNewline?: { old?: number; new?: number };
  /** Known related rows that should share a visual row in the split view. */
  pairs?: Array<[number, number]>;
  /** Old rows that must face an empty cell, such as a removed class. */
  removed?: number[];
}

export interface DiffContractCase {
  name: string;
  patch: string;
  files: ExpectedDiffFile[];
}

const eofMarker = "\\ No newline at end of file";
const rows = (source: string[], start = 1): SourceRow[] =>
  source.map((text, index) => ({ number: start + index, text }));

export function replacementCase(
  name: string,
  old: string[],
  next: string[],
  options: {
    path?: string;
    oldStart?: number;
    newStart?: number;
    oldEof?: boolean;
    newEof?: boolean;
    pairs?: Array<[number, number]>;
    removed?: number[];
  } = {},
): DiffContractCase {
  const path = options.path ?? `${name}.py`;
  const oldStart = old.length ? (options.oldStart ?? 1) : 0;
  const newStart = next.length ? (options.newStart ?? 1) : 0;
  const noNewline = {
    ...(options.oldEof ? { old: oldStart + old.length - 1 } : {}),
    ...(options.newEof ? { new: newStart + next.length - 1 } : {}),
  };
  return {
    name,
    patch: [
      `--- ${old.length ? path : "/dev/null"}`,
      `+++ ${next.length ? path : "/dev/null"}`,
      `@@ -${oldStart},${old.length} +${newStart},${next.length} @@`,
      ...old.map((line) => `-${line}`),
      ...(options.oldEof ? [eofMarker] : []),
      ...next.map((line) => `+${line}`),
      ...(options.newEof ? [eofMarker] : []),
      "",
    ].join("\n"),
    files: [
      {
        oldName: old.length ? path : "/dev/null",
        newName: next.length ? path : "/dev/null",
        old: rows(old, oldStart),
        next: rows(next, newStart),
        ...(Object.keys(noNewline).length ? { noNewline } : {}),
        pairs: options.pairs,
        removed: options.removed,
      },
    ],
  };
}

const constructor = (value: string) => ["    def __init__(self):", `        super().__init__(value="${value}")`];

export const diffContractCorpus: DiffContractCase[] = [
  replacementCase("renamed-guard-operand", ["if old_name:"], ["if replacement:"], { pairs: [[1, 1]] }),
  replacementCase("renamed-return-operand", ["return old_name"], ["return replacement"], { pairs: [[1, 1]] }),
  replacementCase("rewritten-assignment", ["config.flag = True"], ["options.enabled = False"], { pairs: [[1, 1]] }),
  replacementCase(
    "renamed-operands-block",
    ["if old_name:", "    return previous_result"],
    ["if replacement:", "    return fallback"],
    {
      pairs: [
        [1, 1],
        [2, 2],
      ],
    },
  ),
  replacementCase(
    "rewritten-string-assignment",
    ['value = "a very long literal # which remains source"'],
    ['value = "x"'],
    { pairs: [[1, 1]] },
  ),
  replacementCase(
    "rewritten-triple-string-assignment",
    ['value = """some # long literal content"""'],
    ['value = """x"""'],
    { pairs: [[1, 1]] },
  ),
  replacementCase(
    "rewritten-fstring-assignment",
    ['value = f"{mapping["# this is a very long dictionary string key"]}"'],
    ['value = f"{mapping["# x"]}"'],
    { pairs: [[1, 1]] },
  ),
  replacementCase(
    "isolated-rewritten-guard",
    ["if not exists(value):", "    return None"],
    ["if value is None:", "    return None"],
    {
      pairs: [
        [1, 1],
        [2, 2],
      ],
    },
  ),
  replacementCase(
    "entire-rewritten-related-block",
    ["if not exists(value):", "    return build(value)"],
    ["if value is None:", "    raise Missing(value)"],
    {
      pairs: [
        [1, 1],
        [2, 2],
      ],
    },
  ),
  replacementCase(
    "wrapped-import",
    ["from widgets import Alpha, Beta", "import tools"],
    ["from widgets import (", "    Alpha,", "    Beta,", ")", "import tools"],
    {
      pairs: [
        [1, 1],
        [2, 5],
      ],
    },
  ),
  replacementCase(
    "unwrapped-import",
    ["from widgets import (", "    Alpha,", "    Beta,", ")"],
    ["from widgets import Alpha, Beta"],
    { pairs: [[1, 1]] },
  ),
  replacementCase(
    "repeated-constructors",
    ["class Removed(Model):", ...constructor("removed"), "", "class Retained(Model):", ...constructor("retained")],
    ["class Retained(Model):", ...constructor("retained")],
    {
      pairs: [
        [5, 1],
        [6, 2],
        [7, 3],
      ],
      removed: [1, 2, 3, 4],
    },
  ),
  replacementCase("moved-code", ["first()", "second()", "third()"], ["second()", "third()", "first()"], {
    pairs: [
      [2, 1],
      [3, 2],
    ],
  }),
  replacementCase("deletion-only", ["gone()", "", "done()"], []),
  replacementCase("addition-only", [], ["new()", "", "done()"]),
  replacementCase("empty-final-line", ["before", ""], ["after", ""]),
  replacementCase("newline-added", ["last"], ["last"], { oldEof: true }),
  replacementCase("newline-removed", ["last"], ["last"], { newEof: true }),
  replacementCase("both-without-newline", ["before"], ["after"], { oldEof: true, newEof: true }),
  replacementCase("new-file-without-newline", [], ["new"], { newEof: true }),
  replacementCase("deleted-file-without-newline", ["old"], [], { oldEof: true }),
  replacementCase(
    "literal-metadata",
    ["-- file.py", "++ file.py", "@@ -1 +1 @@", eofMarker, "\uE000"],
    ["-- file.py", "++ file.py", "@@ -1 +1 @@", `value = '${eofMarker}'`, "\uE000"],
  ),
  replacementCase(
    "unicode-tabs-and-html",
    ['\tПривет <old> & "quoted"', "    \t ", "🙂 before"],
    ['\tПривет <new> & "quoted"', "\t    ", "🙂 after"],
  ),
  replacementCase("unrelated-text-replacement", ["# aaaa", "# bbbb"], ["# xxxx", "# yyyy"]),
  {
    name: "multiple-hunks-with-number-offsets",
    patch: [
      "--- sample.py",
      "+++ sample.py",
      "@@ -12,2 +21,3 @@",
      " before()",
      "-old()",
      "+first()",
      "+second()",
      "@@ -90 +100 @@",
      "-tail()",
      "+end()",
      eofMarker,
      "",
    ].join("\n"),
    files: [
      {
        oldName: "sample.py",
        newName: "sample.py",
        old: [...rows(["before()", "old()"], 12), ...rows(["tail()"], 90)],
        next: [...rows(["before()", "first()", "second()"], 21), ...rows(["end()"], 100)],
        noNewline: { new: 100 },
      },
    ],
  },
  {
    name: "quoted-utf8-path-and-rename",
    patch: [
      'diff --git "a/old\\t\\321\\202.py" "b/new\\t\\321\\202.py"',
      "similarity index 80%",
      'rename from "old\\t\\321\\202.py"',
      'rename to "new\\t\\321\\202.py"',
      '--- "a/old\\t\\321\\202.py"',
      '+++ "b/new\\t\\321\\202.py"',
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "",
    ].join("\n"),
    files: [{ oldName: "old\tт.py", newName: "new\tт.py", old: rows(["old"]), next: rows(["new"]) }],
  },
  {
    name: "binary-rename-and-mode-only-files",
    patch: [
      "diff --git a/image.png b/image.png",
      "Binary files a/image.png and b/image.png differ",
      "diff --git a/old.py b/new.py",
      "similarity index 100%",
      "rename from old.py",
      "rename to new.py",
      "diff --git a/run.sh b/run.sh",
      "old mode 100644",
      "new mode 100755",
      "",
    ].join("\n"),
    files: [
      { oldName: "image.png", newName: "image.png", old: [], next: [] },
      { oldName: "old.py", newName: "new.py", old: [], next: [] },
      { oldName: "run.sh", newName: "run.sh", old: [], next: [] },
    ],
  },
];

/** Deterministic edit recipes test repeated lines and punctuation without random test failures. */
export function generatedDiffContractCorpus(count = 40): DiffContractCase[] {
  const vocabulary = [
    "",
    " ",
    "\t",
    "tick()",
    "tick()",
    "    return value",
    "}",
    "# comment",
    "<tag> & text",
    "данные = '🙂'",
    eofMarker,
  ];
  let state = 0x41c6ce57;
  const random = (limit: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % limit;
  };
  return Array.from({ length: count }, (_, index) => {
    const old = Array.from({ length: 2 + random(15) }, () => vocabulary[random(vocabulary.length)]);
    const next = old.slice();
    next.splice(random(next.length), random(3), vocabulary[random(vocabulary.length)], `changed_${index}()`);
    if (index % 3 === 0) next.push(next.shift()!);
    return replacementCase(`generated-${index}`, old, next, {
      oldStart: 11 + index,
      newStart: 21 + index,
      oldEof: index % 4 === 0,
      newEof: index % 5 === 0,
    });
  });
}

/** Combined patches cannot be modelled faithfully by a two-source DiffLine. */
export const combinedDiffContractCorpus = [
  {
    name: "second-parent-only-deletion",
    patch: [
      "diff --cc combined.py",
      "--- a/combined.py",
      "+++ b/combined.py",
      "@@@ -10,2 -20,3 +40,2 @@@",
      " -second parent only",
      "  common",
      "--both removed",
      "++replacement",
      "",
    ].join("\n"),
  },
  {
    name: "three-parent-merge",
    patch: [
      "diff --cc combined.py",
      "--- a/combined.py",
      "+++ b/combined.py",
      "@@@@ -10 -20 -30 +40 @@@@",
      "---before",
      "+++after",
      "",
    ].join("\n"),
  },
];

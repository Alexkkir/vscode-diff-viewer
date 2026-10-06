import { parse } from "diff2html";
import { LineType } from "diff2html/lib/types";
import { parseDiff } from "../diff";

const marker = "\\ No newline at end of file";
const headers = ["--- prompt.py\t(0123456789abcdef0123456789abcdef01234567)", "+++ prompt.py\t(working tree)"];
const patch = (...lines: string[]): string => [...headers, ...lines, ""].join("\n");

describe("parseDiff", () => {
  it("decodes Git C-quoted UTF-8 filenames for display and file resolution", () => {
    const [file] = parseDiff(
      [
        'diff --git "a/\\321\\202.py" "b/\\321\\202.py"',
        '--- "a/\\321\\202.py"',
        '+++ "b/\\321\\202.py"',
        "@@ -1 +1 @@",
        "-before",
        "+after",
      ].join("\n"),
    );
    expect(file).toMatchObject({ oldName: "т.py", newName: "т.py", language: "py" });
  });

  it("decodes quoted rename-only paths without retaining the closing quote", () => {
    const [file] = parseDiff(
      [
        'diff --git "a/old\\tname.py" "b/new\\tname.py"',
        "similarity index 100%",
        'rename from "old\\tname.py"',
        'rename to "new\\tname.py"',
      ].join("\n"),
    );
    expect(file).toMatchObject({ oldName: "old\tname.py", newName: "new\tname.py", isRename: true });
  });

  it.each([
    [String.raw`name\twith\nlines.py`, "name\twith\nlines.py"],
    [String.raw`name\"quote\\slash.py`, 'name"quote\\slash.py'],
  ])("decodes quoted path escapes without altering escaped source text: %s", (encoded, decoded) => {
    const [file] = parseDiff(
      [
        `diff --git "a/${encoded}" "b/${encoded}"`,
        `--- "a/${encoded}"`,
        `+++ "b/${encoded}"`,
        "@@ -1 +1 @@",
        `-${encoded}`,
        `+${encoded}`,
      ].join("\n"),
    );
    expect(file).toMatchObject({ oldName: decoded, newName: decoded, language: "py" });
    expect(file.blocks[0].lines.map((line) => line.content)).toEqual([`-${encoded}`, `+${encoded}`]);
  });

  it("restores quoted paths in binary and mode-only Git metadata", () => {
    const files = parseDiff(
      [
        'diff --git "a/\\321\\202.png" "b/\\321\\202.png"',
        'Binary files "a/\\321\\202.png" and "b/\\321\\202.png" differ',
        'diff --git "a/\\321\\202.py" "b/\\321\\202.py"',
        "old mode 100644",
        "new mode 100755",
      ].join("\n"),
    );
    expect(files).toHaveLength(2);
    expect(files[0]).toMatchObject({ oldName: "т.png", newName: "т.png", isBinary: true });
    expect(files[1]).toMatchObject({ oldName: "т.py", newName: "т.py", oldMode: "100644", newMode: "100755" });
  });

  it("preserves the removed EOF newline marker without inventing a code line or rename", () => {
    const [file] = parseDiff(
      patch(
        '@@ -143,4 +143,4 @@ SYSTEM_PROMPT = """',
        " </output_format>",
        " ",
        ' "Запрос пользователя: "',
        '-"""',
        marker,
        '+"""',
      ),
    );
    expect(file).toMatchObject({
      oldName: "prompt.py",
      newName: "prompt.py",
      language: "py",
      noNewline: { old: 146 },
      addedLines: 1,
      deletedLines: 1,
    });
    expect(file.isRename).toBeFalsy();
    expect(file.blocks[0].lines).toHaveLength(5);
    expect(file.blocks[0].lines.slice(-2)).toEqual([
      { type: LineType.DELETE, content: '-"""', oldNumber: 146, newNumber: undefined },
      { type: LineType.INSERT, content: '+"""', oldNumber: undefined, newNumber: 146 },
    ]);
  });

  it.each([
    [["-last", "+last", marker], { new: 1 }],
    [["-before", marker, "+after", marker], { old: 1, new: 1 }],
    [[" last", marker], { old: 1, new: 1 }],
  ])("records the side belonging to each EOF marker", (lines, expected) => {
    expect(parseDiff(patch("@@ -1 +1 @@", ...lines))[0].noNewline).toEqual(expected);
  });

  it("handles CRLF, omitted counts, and an EOF marker without a trailing newline", () => {
    const text = ["--- a/file.txt", "+++ b/file.txt", "@@ -9 +12 @@", "-old", "+new", marker].join("\r\n");
    expect(parseDiff(text)[0].noNewline).toEqual({ new: 12 });
  });

  it.each([
    [["--- /dev/null", "+++ added.py", "@@ -0,0 +1 @@", "+new", marker], { new: 1 }],
    [["--- removed.py", "+++ /dev/null", "@@ -1 +0,0 @@", "-old", marker], { old: 1 }],
  ])("supports added and deleted files", (lines, expected) => {
    expect(parseDiff(lines.join("\n"))[0].noNewline).toEqual(expected);
  });

  it("keeps metadata on its own file across multiple Git/Arc files and hunks", () => {
    const text = [
      "diff --git a/one.py b/one.py",
      "--- a/one.py",
      "+++ b/one.py",
      "@@ -1 +1 @@",
      "-one",
      "+two",
      "@@ -9 +11 @@",
      "-old",
      marker,
      "+new",
      "diff --git a/two.py b/two.py",
      "--- a/two.py",
      "+++ b/two.py",
      "@@ -1 +1 @@",
      "-a",
      "+b",
      marker,
      ...headers,
      "@@ -2 +2 @@",
      "-before",
      "+after",
      marker,
    ].join("\n");
    const files = parseDiff(text);
    expect(files.map((file) => [file.newName, file.noNewline])).toEqual([
      ["one.py", { old: 9 }],
      ["two.py", { new: 1 }],
      ["prompt.py", { new: 2 }],
    ]);
  });

  it("supports multiple header-only Arc sections with identical hunk headers", () => {
    const text = patch("@@ -1 +1 @@", "-a", marker, "+b") + patch("@@ -1 +1 @@", "-a", "+b", marker);
    expect(parseDiff(text).map((file) => file.noNewline)).toEqual([{ old: 1 }, { new: 1 }]);
  });

  it("does not treat the marker in a source string as metadata or delete its text", () => {
    const text = patch("@@ -1,2 +1,2 @@", ` value = '${marker}'`, `-${marker}`, `+changed ${marker}`);
    const [file] = parseDiff(text);
    expect(file.noNewline).toBeUndefined();
    expect(file.blocks[0].lines.map((line) => line.content)).toEqual([
      ` value = '${marker}'`,
      `-${marker}`,
      `+changed ${marker}`,
    ]);
  });

  it("ignores standalone markers outside hunks and not immediately following a source line", () => {
    const text = [marker, ...headers, marker, "@@ -1 +1 @@", "-before", "+after", "", marker].join("\n");
    expect(parseDiff(text)[0].noNewline).toBeUndefined();
  });

  it("preserves genuine renamed files while removing Arc revision labels", () => {
    const text = [
      "--- old name.py\t(abcdef123)",
      "+++ new name.py\t(working tree)",
      "@@ -1 +1 @@",
      "-before",
      "+after",
    ].join("\n");
    expect(parseDiff(text)[0]).toMatchObject({ oldName: "old name.py", newName: "new name.py", language: "py" });
  });

  it("leaves filenames with other parentheses and quoted revision-like filenames unchanged", () => {
    const text = ['--- "a/file (abcdef123)"', '+++ "b/file (abcdef123)"', "@@ -1 +1 @@", "-a", "+b"].join("\n");
    expect(parseDiff(text)).toEqual(parse(text));
    const draft = text.replaceAll('(abcdef123)"', '(draft)"');
    expect(parseDiff(draft)).toEqual(parse(draft));
  });

  it("does not strip Arc-looking labels from removed and added source lines", () => {
    const text = patch("@@ -1 +1 @@", "--- value.py\t(abcdef123)", "+++ value.py\t(working tree)");
    expect(parseDiff(text)[0].blocks[0].lines.map((line) => line.content)).toEqual([
      "--- value.py\t(abcdef123)",
      "+++ value.py\t(working tree)",
    ]);
  });

  it("does not split header-looking code followed by the next hunk into a new file", () => {
    const text = patch(
      "@@ -1 +1 @@",
      "--- value.py\t(abcdef123)",
      "+++ value.py\t(working tree)",
      "@@ -10 +10 @@",
      "-old",
      "+new",
      marker,
    );
    const files = parseDiff(text);
    expect(files).toHaveLength(1);
    expect(files[0].blocks).toHaveLength(2);
    expect(files[0].blocks[0].lines.map((line) => line.content)).toEqual([
      "--- value.py\t(abcdef123)",
      "+++ value.py\t(working tree)",
    ]);
    expect(files[0].noNewline).toEqual({ new: 10 });
  });

  it("preserves configuration and large-diff callback file indices", () => {
    const text = patch("@@ -1 +1 @@", "-before", "+after") + patch("@@ -1 +1 @@", "-before", "+after");
    const result = parseDiff(text, { diffMaxChanges: 0, diffTooBigMessage: (index) => `Skipped ${index}` });
    expect(result.map((file) => file.blocks[0].header)).toEqual(["Skipped 0", "Skipped 1"]);
    expect(result.every((file) => file.noNewline === undefined)).toBe(true);
  });

  it("keeps ordinary Git patches, binary changes, and mode-only files unchanged", () => {
    const text = [
      "diff --git a/one.txt b/one.txt",
      "old mode 100644",
      "new mode 100755",
      "diff --git a/icon.png b/icon.png",
      "index abcdef1..abcdef2 100644",
      "Binary files a/icon.png and b/icon.png differ",
      "diff --git a/two.txt b/two.txt",
      "--- a/two.txt",
      "+++ b/two.txt",
      "@@ -1,2 +1,2 @@",
      " before",
      "-old",
      "+new",
    ].join("\n");
    expect(parseDiff(text)).toEqual(parse(text));
  });

  it.each(["diff --combined", "diff --cc"])("keeps header-like source inside a %s hunk", (prefix) => {
    const text = [
      `${prefix} real.py`,
      "index 1234567,1234568..1234569",
      "--- a/real.py",
      "+++ b/real.py",
      "@@@ -1 -1 +1 @@@",
      "--- literal.py\t(abcdef123)",
      "+++ literal.py\t(working tree)",
      "",
    ].join("\n");
    expect(parseDiff(text)).toEqual(parse(text.replace("diff --cc ", "diff --combined ")));
    expect(parseDiff(text)).toHaveLength(1);
    expect(parseDiff(text)[0].blocks[0].lines.map((line) => line.content)).toEqual([
      "--- literal.py\t(abcdef123)",
      "+++ literal.py\t(working tree)",
    ]);
  });

  it("keeps --cc file boundaries and checksums separate from an earlier ordinary diff", () => {
    const text = [
      "diff --git a/first.py b/first.py",
      "index abcdef0..abcdef1 100644",
      "--- a/first.py",
      "+++ b/first.py",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "diff --cc next.py",
      "index 1234567,1234568..1234569",
      "--- a/next.py",
      "+++ b/next.py",
      "@@@ -1 -1 +1 @@@",
      "--before",
      "++after",
      "",
    ].join("\n");
    expect(parseDiff(text)).toEqual(parse(text.replace("diff --cc ", "diff --combined ")));
    expect(parseDiff(text)[0].checksumBefore).toBe("abcdef0");
  });

  it("does not fabricate single-parent EOF metadata for a combined diff", () => {
    const text = [
      "diff --combined real.py",
      "--- a/real.py",
      "+++ b/real.py",
      "@@@ -1 -1 +1 @@@",
      "--before",
      marker,
      `++value = '${marker}'`,
      marker,
      "",
    ].join("\n");
    const [file] = parseDiff(text);
    expect(file.noNewline).toBeUndefined();
    expect(file.blocks[0].lines.map((line) => line.content)).toEqual(["--before", `++value = '${marker}'`]);
  });
});

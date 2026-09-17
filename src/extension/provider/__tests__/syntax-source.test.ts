import { parse } from "diff2html";
import { reconstructSyntaxSources } from "../syntax-source";

function diff(hunks: string) {
  return parse(`--- a/demo.py\n+++ b/demo.py\n${hunks}`)[0];
}

describe("reconstructSyntaxSources", () => {
  it("retains multiline-string context before and between separated hunks", () => {
    const file = diff(
      '@@ -3,2 +3,2 @@\n-old {value}\n+new {value}\n """\n' + "@@ -7,2 +7,3 @@\n keep = 1\n+extra = 2\n print(keep)\n",
    );
    const source = 'query = f"""\nSELECT\nnew {value}\n"""\n\n# hidden context\nkeep = 1\nextra = 2\nprint(keep)\n';

    expect(reconstructSyntaxSources(file, source)).toEqual({
      old: ['query = f"""', "SELECT", "old {value}", '"""', "", "# hidden context", "keep = 1", "print(keep)"],
      new: source.trimEnd().split("\n"),
    });
  });

  it("handles insertions and deletions with zero-count hunk sides", () => {
    const file = diff("@@ -0,0 +1,2 @@\n+first\n+second\n@@ -2,2 +3,0 @@\n-removed\n-also removed\n");
    expect(reconstructSyntaxSources(file, "first\nsecond\nkeep\nlast\n")).toEqual({
      old: ["keep", "removed", "also removed", "last"],
      new: ["first", "second", "keep", "last"],
    });
  });

  it.each([
    ["@@ -0,0 +1,2 @@\n+first\n+\n", "first\n\n", [], ["first", ""]],
    ["@@ -1,2 +0,0 @@\n-first\n-\n", "", ["first", ""], []],
    ["@@ -1 +1 @@\n-old\n+new\n", "new", ["old"], ["new"]],
    ["@@ -1 +1 @@\n-old\n+new\n", "new\r\n", ["old"], ["new"]],
  ])("handles whole-file changes and line endings (%s)", (hunks, source, oldLines, newLines) => {
    expect(reconstructSyntaxSources(diff(hunks as string), source as string)).toEqual({
      old: oldLines,
      new: newLines,
    });
  });

  it("rejects a stale source including mismatching context lines", () => {
    const file = diff("@@ -1,2 +1,2 @@\n context\n-old\n+new\n");
    expect(reconstructSyntaxSources(file, "context\nstale\n")).toBeUndefined();
    expect(reconstructSyntaxSources(file, "wrong context\nnew\n")).toBeUndefined();
    expect(reconstructSyntaxSources(file, "context\n")).toBeUndefined();
  });

  it("rejects invalid old-side coordinates instead of reconstructing a shifted file", () => {
    const file = diff("@@ -9 +2 @@\n-old\n+new\n");
    expect(reconstructSyntaxSources(file, "before\nnew\nafter\n")).toBeUndefined();
  });

  it("rejects overlapping and noncontiguous hunk coordinates", () => {
    const overlapping = diff("@@ -1 +1 @@\n-old\n+new\n@@ -1 +1 @@\n-old\n+new\n");
    expect(reconstructSyntaxSources(overlapping, "new\n")).toBeUndefined();
    const invalidNumber = diff("@@ -1,2 +1,2 @@\n same\n-old\n+new\n");
    invalidNumber.blocks[0].lines[1].oldNumber = 8;
    expect(reconstructSyntaxSources(invalidNumber, "same\nnew\n")).toBeUndefined();
    invalidNumber.blocks[0].lines[1].oldNumber = 2;
    invalidNumber.blocks[0].lines[2].newNumber = 8;
    expect(reconstructSyntaxSources(invalidNumber, "same\nnew\n")).toBeUndefined();
  });

  it("rejects combined, binary, and oversized input", () => {
    const file = diff("@@ -1 +1 @@\n-old\n+new\n");
    expect(reconstructSyntaxSources({ ...file, isCombined: true }, "new\n")).toBeUndefined();
    expect(reconstructSyntaxSources({ ...file, isBinary: true }, "new\n")).toBeUndefined();
    expect(reconstructSyntaxSources(file, "x".repeat(2 * 1024 * 1024 + 1))).toBeUndefined();
    expect(reconstructSyntaxSources(file, "new\n" + "\n".repeat(50_000))).toBeUndefined();
  });
});

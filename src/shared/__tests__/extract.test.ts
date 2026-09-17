import { extractNewFileNameFromDiffName, extractNumberFromString, normalizeDiffFilePath } from "../extract";

describe("convert :: extractNumberFromString", () => {
  it.each([
    ["0", 0],
    ["10", 10],
    ["", undefined],
    ["not-a-number", undefined],
  ])("should convert string to number", (value: string, expected: number | undefined) => {
    expect(extractNumberFromString(value)).toBe(expected);
  });
});

describe("convert :: extractNewFileNameFromDiffName", () => {
  it.each([
    ["file.ts", "file.ts"],
    ["dir/file.ts", "dir/file.ts"],
    ["{oldName.ts → newName.ts}", "newName.ts"],
    ["{oldDir → newDir}/file.ts", "newDir/file.ts"],
    ["dir/{oldName.ts → newName.ts}", "dir/newName.ts"],
    ["{old file.ts → new file.ts}", "new file.ts"],
    ["dir/{old folder → new folder}/file name.ts", "dir/new folder/file name.ts"],
  ])("should extract file name from diff name", (value: string, expected: string) => {
    expect(extractNewFileNameFromDiffName(value)).toBe(expected);
  });
});

describe("normalizeDiffFilePath", () => {
  it.each([
    ["ml/project/demo.py (working tree)", "ml/project/demo.py"],
    ["ml/project/demo.py\t(abcdef1234567890)", "ml/project/demo.py"],
    ["ml/{old.py (abcdef123) → new.py (working tree)}", "ml/new.py"],
    ["ml/{old dir → new dir}/file name.py (working tree)", "ml/new dir/file name.py"],
    ["file.py (draft)", "file.py (draft)"],
    ["file name.py", "file name.py"],
    ["/dev/null (abcdef123)", undefined],
    ["/dev/null", undefined],
    ["", undefined],
    [undefined, undefined],
  ])("normalizes %s without discarding filename spaces", (input, expected) => {
    expect(normalizeDiffFilePath(input)).toBe(expected);
  });
});

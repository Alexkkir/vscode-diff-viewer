// Regenerate with: node scripts/generate-git-source-fidelity-fixtures.mjs
// Every patch comes from Git; the before/after files are the independent oracle.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const cases = [
  ["plain", "example.txt", "first\nold\nlast\n", "first\nnew\nlast\n"],
  ["crlf", "example.txt", "first\r\nold\r\nlast\r\n", "first\r\nnew\r\nlast\r\n"],
  ["mixed-eol", "example.txt", "first\r\nold\nlast\r\n", "first\r\nnew\nlast\r\n"],
  ["bare-cr-middle", "example.txt", "first\nold\rcarriage\nlast\n", "first\nnew\rcarriage\nlast\n"],
  ["bare-cr-metadata", "example.txt", "first\nold\r+++ forged\nlast\n", "first\nnew\r+++ forged\nlast\n"],
  ["whitespace", "example.txt", "a\n \n\t\n\nend\n", "a\n  \n\t \n\nend\n"],
  ["eof-empty", "example.txt", "a\n", "a\n\n"],
  ["eof-empty-remove", "example.txt", "a\n\n", "a\n"],
  ["eof-none", "example.txt", "a", "b"],
  ["eof-cr", "example.txt", "a\r", "b\r"],
  ["unicode", "я 🚀.txt", "a\n", "b\n"],
  ["newline-path", "line\nname.txt", "a\n", "b\n"],
  ["tab-path", "tab\tname.txt", "a\n", "b\n"],
  ["tab-suffix-path", "name.txt\t", "a\n", "b\n"],
  ["quote-path", 'quote"name.txt', "a\n", "b\n"],
  ["backslash-path", "back\\slash.txt", "a\n", "b\n"],
  ["spaces-path", "path with spaces.txt", "a\n", "b\n"],
  ["arc-literal-path", "literal (working tree)", "a\n", "b\n"],
  ["arc-literal-extension", "literal.py (working tree)", 'print("old")\n', 'print("new")\n'],
  ["hex-literal-path", "literal (abcdef0123)", "a\n", "b\n"],
  ["a-path", "a/path.txt", "a\n", "b\n"],
  ["b-path", "b/path.txt", "a\n", "b\n"],
  ["space-suffix", "example.txt ", "a\n", "b\n"],
  ["binary", "image.bin", "a\0b\n", "a\0c\n"],
  [
    "source-quote-and-sentinel",
    "example.txt",
    "x\n\\ No newline at end of file\n\uE000path123\n--- other\n",
    "x\n\\ No newline at end of file\n\uE000path124\n+++ other\n",
  ],
  [
    "mixed-hunks",
    "example.txt",
    Array.from({ length: 100 }, (_, i) => `original ${i}`).join("\n") + "\n",
    Array.from({ length: 100 }, (_, i) => (i === 5 ? "new first" : i === 65 ? "new second" : `original ${i}`)).join(
      "\n",
    ) + "\n",
  ],
];

const fixtures = cases.map(([id, name, oldSource, newSource]) => ({
  id,
  oldName: `old/${name}`,
  newName: `new/${name}`,
  oldSource,
  newSource,
}));
for (const name of ["literal (working tree)", "literal (abcdef0123)", "literal {old → new}.txt"]) {
  fixtures.push({
    id: `rename-only-${name}`,
    oldName: "old/original.txt",
    newName: `new/${name}`,
    oldSource: "same unchanged source\n",
    newSource: "same unchanged source\n",
  });
}

const temporary = mkdtempSync(join(tmpdir(), "diff-source-fidelity-"));
try {
  for (const [index, fixture] of fixtures.entries()) {
    const cwd = join(temporary, String(index));
    for (const side of ["old", "new"]) {
      const file = join(cwd, fixture[`${side}Name`]);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, fixture[`${side}Source`]);
    }
    const output = spawnSync(
      "git",
      [
        "-c",
        "core.quotePath=true",
        "diff",
        "--no-index",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--src-prefix=a/",
        "--dst-prefix=b/",
        "--find-renames",
        "--",
        "old",
        "new",
      ],
      { cwd, encoding: "utf8" },
    );
    if (output.status !== 1) throw new Error(`${fixture.id}: ${output.stderr}`);
    fixture.patch = output.stdout;
  }
  const target = fileURLToPath(new URL("../src/shared/testing/git-source-fidelity.json", import.meta.url));
  writeFileSync(target, JSON.stringify(fixtures, null, 2) + "\n");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

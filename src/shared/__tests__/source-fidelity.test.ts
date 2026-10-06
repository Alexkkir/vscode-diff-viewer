/** @jest-environment jsdom */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TextDecoder } from "node:util";
import { parseDiff } from "../diff";
import { realignDiffHunks } from "../hunk-alignment";
import { renderAlignedDiffHtml } from "../../webview/message/handler/aligned-diff-renderer";
import { buildDiffFileMap, buildDiffFileViewModel } from "../../webview/message/handler/models";

jest.mock("../../webview/message/hash", () => ({ getSha1Hash: jest.fn() }));

interface Fixture {
  id: string;
  oldName: string;
  newName: string;
  oldSource: string;
  newSource: string;
  patch: string;
}

const fixtures: Fixture[] = JSON.parse(readFileSync(join(__dirname, "../testing/git-source-fidelity.json"), "utf8"));
const sourceLines = (source: string): string[] => {
  const lines = source.split("\n");
  if (source.endsWith("\n")) lines.pop();
  return lines;
};

describe("real Git source fidelity", () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, "TextDecoder", { value: TextDecoder, configurable: true });
  });

  it.each(fixtures)("preserves exact filenames and source projections: $id", (fixture) => {
    const files = parseDiff(fixture.patch);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ oldName: fixture.oldName, newName: fixture.newName });
    for (const file of [files[0], realignDiffHunks(files)[0]]) {
      if (file.isBinary) continue;
      for (const side of ["old", "new"] as const) {
        const expected = sourceLines(fixture[`${side}Source`]);
        const projection = file.blocks
          .flatMap((block) => block.lines)
          .filter((line) => line[`${side}Number`] !== undefined);
        for (const line of projection) expect(line.content.slice(1)).toBe(expected[line[`${side}Number`]! - 1]);
        if (expected.length < 5 && file.blocks.length) expect(projection).toHaveLength(expected.length);
      }
    }
  });

  it.each(["side-by-side", "line-by-line"] as const)("preserves source bytes in rendered DOM: %s", (outputFormat) => {
    for (const fixture of fixtures) {
      const root = document.createElement("div");
      root.innerHTML = renderAlignedDiffHtml(realignDiffHunks(parseDiff(fixture.patch)), {
        outputFormat,
        matching: "lines",
      });
      const panes = Array.from(root.querySelectorAll(".d2h-file-side-diff"));
      for (const element of root.querySelectorAll(".d2h-code-line-ctn")) {
        const row = element.closest("tr")!;
        for (const [side, index] of [
          ["old", 0],
          ["new", 1],
        ] as const) {
          if (panes.length && element.closest(".d2h-file-side-diff") !== panes[index]) continue;
          const number = Number(
            row.querySelector(panes.length ? ".d2h-code-side-linenumber" : `.line-num${index + 1}`)?.textContent,
          );
          if (number)
            expect({ fixture: fixture.id, text: element.textContent }).toEqual({
              fixture: fixture.id,
              text: sourceLines(fixture[`${side}Source`])[number - 1],
            });
        }
      }
    }
  });

  it.each(fixtures.filter((fixture) => !fixture.oldSource.includes("\0")))(
    "accepts CRLF patch delimiters without changing source: $id",
    (fixture) => {
      expect(parseDiff(fixture.patch.replaceAll("\n", "\r\n"))).toEqual(parseDiff(fixture.patch));
    },
  );

  it.each(fixtures)("uses literal parsed paths for links, copy and viewed-state keys: $id", (fixture) => {
    const files = parseDiff(fixture.patch);
    const accessible = new Set([fixture.oldName, fixture.newName]);
    expect(buildDiffFileViewModel(files[0], accessible)).toEqual({
      oldPath: fixture.oldName,
      newPath: fixture.newName,
      primaryPath: fixture.newName,
      isOldPathAccessible: true,
      isNewPathAccessible: true,
    });
    expect(Object.keys(buildDiffFileMap(files, accessible))).toEqual([fixture.newName]);
  });
});

/** @jest-environment jsdom */
import { parseDiff } from "../../../../shared/diff";
import { AlignedDiff2HtmlUI } from "../aligned-diff-renderer";
import { getRenderedFileWrappers, linkRenderedFileSummaries } from "../rendered-file-wrappers";

describe("rendered file model mapping", () => {
  it.each(
    (["side-by-side", "line-by-line"] as const).flatMap((outputFormat) =>
      [false, true].map((renderNothingWhenEmpty) => ({ outputFormat, renderNothingWhenEmpty })),
    ),
  )("keeps original file indexes with empty files and ID collisions (%j)", (config) => {
    const files = parseDiff(
      [
        "diff --git a/Aa.py b/Aa.py",
        "old mode 100644",
        "new mode 100755",
        "diff --git a/BB.py b/BB.py",
        "--- a/BB.py",
        "+++ b/BB.py",
        "@@ -1 +1 @@",
        "-before",
        "+after",
      ].join("\n"),
    );
    const root = document.createElement("div");
    new AlignedDiff2HtmlUI(root, files, { ...config, highlight: false, drawFileList: true }).draw();
    linkRenderedFileSummaries(root, files);
    const pairs = getRenderedFileWrappers(root, files);
    expect(pairs.map(({ fileIndex }) => fileIndex)).toEqual(config.renderNothingWhenEmpty ? [1] : [0, 1]);
    expect(pairs.map(({ file }) => file)).toEqual(config.renderNothingWhenEmpty ? [files[1]] : files);
    const changed = pairs.find(({ fileIndex }) => fileIndex === 1)!;
    expect(changed.wrapper.querySelector(".d2h-code-line-ctn")?.textContent).toBe("before");
    const links = root.querySelectorAll<HTMLAnchorElement>(".d2h-file-list-line a");
    expect(links[1].getAttribute("href")).toBe(`#${changed.wrapper.id}`);
    expect(links[0].getAttribute("href")).toBe(config.renderNothingWhenEmpty ? null : "#diff-viewer-file-0");
    expect(new Set(pairs.map(({ wrapper }) => wrapper.id)).size).toBe(pairs.length);
  });
});

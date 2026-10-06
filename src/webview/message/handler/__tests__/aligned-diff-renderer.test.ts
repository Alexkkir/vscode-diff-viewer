/** @jest-environment jsdom */
import { html, parse } from "diff2html";
import { AlignedDiff2HtmlUI, renderAlignedDiffHtml } from "../aligned-diff-renderer";

const patch = [
  "--- a/example.py",
  "+++ b/example.py",
  "@@ -1,8 +1,8 @@",
  " before",
  "-# maximum image size matches",
  "-# https://example.invalid/source/service/manager/editing/generator.py?rev=123456789",
  '-@FACTORY.register("image_light")',
  "-class LightModel(Model):",
  '-    """Emulates the image-light service from',
  '-    quality/image/service/light."""',
  '+@FACTORY.register("image_light_6mp")',
  "+class Config_Light_6mp(Model):",
  '+    """Legacy version for the image-light service from',
  "+    quality/image/service/light.",
  "+    https://example.invalid/source/service/manager/editing/generator.py?rev=123456789",
  '+    """',
  " after",
  "",
].join("\n");

describe("aligned diff renderer", () => {
  it("keeps local pane scrolling synchronized without bouncing a clamped opposite pane", () => {
    const root = document.createElement("div");
    new AlignedDiff2HtmlUI(root, parse(patch), { outputFormat: "side-by-side", highlight: false }).draw();
    const [left, right] = root.querySelectorAll<HTMLElement>(".d2h-file-side-diff");
    [left, right].forEach((pane, index) => {
      let position = 0;
      Object.defineProperty(pane, "scrollLeft", {
        get: () => position,
        set: (value: number) => {
          position = Math.max(0, Math.min(value, index ? 100 : 500));
        },
      });
    });
    left.scrollLeft = 500;
    left.dispatchEvent(new Event("scroll"));
    right.dispatchEvent(new Event("scroll"));
    expect([left.scrollLeft, right.scrollLeft]).toEqual([500, 100]);
    right.scrollTop = 75;
    right.dispatchEvent(new Event("scroll"));
    left.dispatchEvent(new Event("scroll"));
    expect([left.scrollTop, right.scrollTop]).toEqual([75, 75]);
    expect([left.scrollLeft, right.scrollLeft]).toEqual([500, 100]);
    right.scrollLeft = 40;
    right.dispatchEvent(new Event("scroll"));
    left.dispatchEvent(new Event("scroll"));
    expect([left.scrollLeft, right.scrollLeft]).toEqual([40, 40]);
  });

  it.each([
    ["side-by-side", "lines"],
    ["side-by-side", "words"],
    ["line-by-line", "lines"],
    ["line-by-line", "words"],
  ] as const)("keeps a rewritten guard with its adjacent return (%s/%s)", (outputFormat, matching) => {
    const files = parse(
      [
        "--- a/example.py",
        "+++ b/example.py",
        "@@ -58,2 +58,2 @@",
        "-    if not exists(value):",
        "-        return value",
        "+    if value is None:",
        "+        return None",
        "",
      ].join("\n"),
    );
    const original = JSON.stringify(files);
    const root = document.createElement("div");
    root.innerHTML = renderAlignedDiffHtml(files, { outputFormat, matching });
    const tables = root.querySelectorAll(".d2h-diff-tbody");
    if (outputFormat === "side-by-side") {
      for (const table of tables) {
        const rows = Array.from(table.querySelectorAll("tr"));
        expect(rows).toHaveLength(3);
        expect(rows.slice(1).map((row) => row.querySelector(".d2h-code-side-linenumber")?.textContent?.trim())).toEqual(
          ["58", "59"],
        );
      }
      expect(tables[0].querySelector(".d2h-code-line-ctn")?.textContent).toBe("    if not exists(value):");
      expect(tables[1].querySelector(".d2h-code-line-ctn")?.textContent).toBe("    if value is None:");
    } else {
      const rows = Array.from(root.querySelectorAll("tr")).filter((row) => row.querySelector(".d2h-code-line-ctn"));
      expect(rows.every((row) => row.querySelector("td.d2h-change"))).toBe(true);
      expect(
        rows.map((row) => [row.querySelector(".line-num1")?.textContent, row.querySelector(".line-num2")?.textContent]),
      ).toEqual([
        ["58", ""],
        ["", "58"],
        ["59", ""],
        ["", "59"],
      ]);
    }
    expect(JSON.stringify(files)).toBe(original);
  });

  it.each(["side-by-side", "line-by-line"] as const)(
    "uses Python comment pairing without altering source text (%s)",
    (outputFormat) => {
      const patch = [
        "--- a/config.py",
        "+++ b/config.py",
        "@@ -1,2 +1,2 @@",
        "-if len(config) > 0:  # checker: ignore[invalid-argument-type]",
        '-    params["config"] = decode(config[0].read_text())  # checker: ignore[invalid-index]',
        "+if len(config) > 0:",
        '+    params["config"] = decode(config[0].read_text())',
        "",
      ].join("\n");
      const files = parse(patch);
      const root = document.createElement("div");
      root.innerHTML = renderAlignedDiffHtml(files, { outputFormat, matching: "lines" });
      const source = Array.from(root.querySelectorAll(".d2h-code-line-ctn"));
      expect(source.map((line) => line.textContent).sort()).toEqual(
        files[0].blocks[0].lines.map((line) => line.content.slice(1)).sort(),
      );
      expect(root.querySelectorAll("del")).toHaveLength(2);
      expect(
        Array.from(root.querySelectorAll("del")).every((span) => span.textContent?.trim().startsWith("# checker:")),
      ).toBe(true);
      expect(root.querySelectorAll("ins")).toHaveLength(0);
      if (outputFormat === "side-by-side") {
        const panes = root.querySelectorAll(".d2h-diff-tbody");
        expect(panes[0].querySelectorAll("tr")).toHaveLength(3);
        expect(panes[1].querySelectorAll("tr")).toHaveLength(3);
      }
    },
  );

  it.each(["lines", "words"] as const)(
    "pairs comment-only import edits and highlights only the comment (%s)",
    (matching) => {
      const files = parse(
        [
          "--- a/example.py",
          "+++ b/example.py",
          "@@ -1,2 +1,2 @@",
          "-import widgets  # checker: ignore[unresolved-import]",
          "+import widgets",
          " import tools",
          "",
        ].join("\n"),
      );
      const root = document.createElement("div");
      root.innerHTML = renderAlignedDiffHtml(files, { outputFormat: "side-by-side", matching });
      const tables = root.querySelectorAll(".d2h-diff-tbody");
      const left = Array.from(tables[0].querySelectorAll("tr"));
      const right = Array.from(tables[1].querySelectorAll("tr"));
      const oldIndex = left.findIndex((row) =>
        row.querySelector(".d2h-code-line-ctn")?.textContent?.startsWith("import widgets"),
      );
      const newIndex = right.findIndex(
        (row) => row.querySelector(".d2h-code-line-ctn")?.textContent === "import widgets",
      );
      expect(oldIndex).toBe(newIndex);
      expect(left[oldIndex].querySelector("del")?.textContent?.trim()).toBe("# checker: ignore[unresolved-import]");
      expect(right[newIndex].querySelector("ins")).toBeNull();
    },
  );

  it.each(["lines", "words"] as const)("aligns related rows and preserves inline %s differences", (matching) => {
    const root = document.createElement("div");
    const files = parse(patch);
    const original = JSON.stringify(files);
    const viewer = new AlignedDiff2HtmlUI(root, files, { outputFormat: "side-by-side", matching, highlight: false });
    viewer.draw();
    const tables = root.querySelectorAll(".d2h-diff-tbody");
    const left = Array.from(tables[0].querySelectorAll("tr"));
    const right = Array.from(tables[1].querySelectorAll("tr"));
    const oldRow = left.findIndex((row) => row.textContent?.includes("@FACTORY"));
    const newRow = right.findIndex((row) => row.textContent?.includes("@FACTORY"));
    expect(oldRow).toBe(newRow);
    expect(left[oldRow].querySelector(".d2h-code-side-linenumber")?.textContent?.trim()).toBe("4");
    expect(right[newRow].querySelector(".d2h-code-side-linenumber")?.textContent?.trim()).toBe("2");
    expect(right[newRow].querySelector("ins")?.textContent).toContain("6mp");
    expect(left.length).toBe(right.length);
    expect(JSON.stringify(files)).toBe(original);
  });

  it("uses the same inline pairing in unified layout", () => {
    const root = document.createElement("div");
    root.innerHTML = renderAlignedDiffHtml(parse(patch), { outputFormat: "line-by-line", matching: "lines" });
    const row = Array.from(root.querySelectorAll("tr")).find((item) => item.textContent?.includes("image_light_6mp"));
    expect(row?.querySelector("ins")?.textContent).toBe("image_light_6mp");
    expect(root.querySelectorAll(".d2h-code-line-ctn")).toHaveLength(14);
  });

  it.each([
    { matching: "none" as const },
    { matching: "lines" as const, matchingMaxComparisons: 0 },
    { matching: "words" as const, maxLineSizeInBlockForComparison: 0 },
  ])("respects opt-out and configured work limits (%j)", (config) => {
    const files = parse(patch);
    expect(renderAlignedDiffHtml(files, config)).toBe(html(files, config));
  });
});

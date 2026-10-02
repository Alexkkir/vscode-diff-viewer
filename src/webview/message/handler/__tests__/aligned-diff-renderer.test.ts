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

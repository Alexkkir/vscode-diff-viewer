/** @jest-environment jsdom */
import { parseDiff } from "../diff";
import { realignDiffHunks } from "../hunk-alignment";
import { renderAlignedDiffHtml } from "../../webview/message/handler/aligned-diff-renderer";

const constructor = (name: string, size: string) => [
  "    def __init__(self):",
  "        super().__init__(",
  `            model="${name}",`,
  `            system="${name}",`,
  `            mode="${name}",`,
  `            size=${size},`,
  "        )",
];
const old = [
  "# setup",
  '@FACTORY.register("image_heavy")',
  "class HeavyModel(Model):",
  '    """Heavy service from',
  '    quality/image/service/light."""',
  ...constructor("heavy", "6"),
  "",
  "# maximum image size matches",
  "# https://example.invalid/source/generator.py?rev=123456789",
  '@FACTORY.register("image_light")',
  "class LightModel(Model):",
  '    """Emulates the image-light service from',
  '    quality/image/service/light."""',
  ...constructor("light", "6"),
  "",
  '@FACTORY.register("image_1mp")',
  "class SmallModel(Model):",
  ...constructor("small", "1"),
  "",
  "class TestOne(Model):",
  ...constructor("test_one", "1"),
  "",
  "class TestTwo(Model):",
  ...constructor("test_two", "1"),
];
const next = [
  "# setup",
  '@FACTORY.register("image_light_6mp")',
  "class Config_Light_6mp(Model):",
  '    """Legacy version for the image-light service from',
  "    quality/image/service/light.",
  "    https://example.invalid/source/generator.py?rev=123456789",
  '    """',
  ...constructor("light", "6.1"),
  "",
  '@FACTORY.register("image_1mp")',
  "class SmallModel(Model):",
  '    """Legacy small model."""',
  ...constructor("small", "1"),
];
const patch = [
  "--- sample.py",
  "+++ sample.py",
  `@@ -1,${old.length} +1,${next.length} @@`,
  ...old.map((line) => `-${line}`),
  ...next.map((line) => `+${line}`),
].join("\n");

describe("full constructor topology", () => {
  it("preserves complete sources and takes both retained constructors from their own classes", () => {
    const files = realignDiffHunks(parseDiff(patch));
    const lines = files[0].blocks[0].lines;
    expect(lines.filter((line) => line.oldNumber !== undefined).map((line) => line.content.slice(1))).toEqual(old);
    expect(lines.filter((line) => line.newNumber !== undefined).map((line) => line.content.slice(1))).toEqual(next);
    const targetOldConstructor = old.indexOf("    def __init__(self):", old.indexOf("class LightModel(Model):")) + 1;
    const targetNewConstructor =
      next.indexOf("    def __init__(self):", next.indexOf("class Config_Light_6mp(Model):")) + 1;
    for (let offset = 0; offset < 2; offset++) {
      expect(files[0].blocks[0].lines.find((line) => line.oldNumber === targetOldConstructor + offset)?.newNumber).toBe(
        targetNewConstructor + offset,
      );
    }
    const deletedClassEnd = old.indexOf("# maximum image size matches");
    expect(
      files[0].blocks[0].lines
        .filter((line) => (line.oldNumber ?? 0) >= 2 && (line.oldNumber ?? 0) <= deletedClassEnd)
        .every((line) => line.newNumber === undefined),
    ).toBe(true);
    const firstOldConstructor = old.indexOf("    def __init__(self):", old.indexOf("class SmallModel(Model):")) + 1;
    const smallNewConstructor = next.indexOf("    def __init__(self):", next.indexOf("class SmallModel(Model):")) + 1;
    expect(files[0].blocks[0].lines.find((line) => line.oldNumber === firstOldConstructor)?.newNumber).toBe(
      smallNewConstructor,
    );
    const firstTestLine = old.indexOf("class TestOne(Model):") + 1;
    expect(
      lines.filter((line) => (line.oldNumber ?? 0) >= firstTestLine).every((line) => line.newNumber === undefined),
    ).toBe(true);
  });

  it("pairs the renamed class after a deleted similar class in the renderer", () => {
    const files = realignDiffHunks(parseDiff(patch));
    const root = document.createElement("div");
    root.innerHTML = renderAlignedDiffHtml(files, { outputFormat: "side-by-side", matching: "lines" });
    const tables = root.querySelectorAll(".d2h-diff-tbody");
    const left = Array.from(tables[0].querySelectorAll("tr"));
    const right = Array.from(tables[1].querySelectorAll("tr"));
    const row = (rows: Element[], text: string) =>
      rows.findIndex((element) => element.querySelector(".d2h-code-line-ctn")?.textContent === text);
    const oldRegistration = row(left, '@FACTORY.register("image_light")');
    const newRegistration = row(right, '@FACTORY.register("image_light_6mp")');
    expect(oldRegistration).toBe(newRegistration);
    expect(row(left, "class LightModel(Model):")).toBe(row(right, "class Config_Light_6mp(Model):"));
  });
});

describe("multiline documentation before duplicated constructors", () => {
  const body = [
    "    def __init__(self):",
    "        super().__init__(",
    "            kind=ModelType.IMAGE,",
    "            config=Config(",
    '                model="example",',
    "                system_prompt=SYSTEM_PROMPT,",
    '                mode="image",',
    "                max_area=1024,",
    "                model_kwargs={",
    '                    "cache_limit": 256,',
    '                    "workers": 4,',
    '                    "backend": "FAST",',
    "                },",
    '                processor_kwargs={"enabled": False},',
    "            ),",
    "        )",
  ];
  const header = ['@FACTORY.register("small")', "class SmallModel(Model):"];
  const old = [
    ...header,
    ...body,
    "",
    '@FACTORY.register("small_test")',
    "class SmallTest(Model):",
    ...body.slice(0, 7),
    '                role="viewer",',
    ...body.slice(7),
    "",
    "",
    '@FACTORY.register("small_other_test")',
    "class SmallOtherTest(Model):",
    ...body.slice(0, 5),
    "                system_prompt=OTHER_PROMPT,",
    body[6],
    '                role="viewer",',
    ...body.slice(7),
    "",
    "",
    '@FACTORY.register("next")',
    "class NextModel(Model):",
    '    """Unchanged next model."""',
    "",
    "    def __init__(self) -> None:",
    "        pass",
  ];
  const next = [
    ...header,
    '    """Matches the small service from',
    "    example/services/small.",
    '    """',
    "",
    ...body,
    "",
    "",
    '@FACTORY.register("next")',
    "class NextModel(Model):",
    '    """Unchanged next model."""',
    "",
    "    def __init__(self) -> None:",
    "        pass",
  ];
  const patch = [
    "--- synthetic.py",
    "+++ synthetic.py",
    `@@ -594,${old.length} +569,${next.length} @@`,
    ...old.map((line) => `-${line}`),
    ...next.map((line) => `+${line}`),
  ].join("\n");

  it.each(["side-by-side", "line-by-line"] as const)("keeps the first full constructor in %s", (outputFormat) => {
    const files = realignDiffHunks(parseDiff(patch));
    const lines = files[0].blocks[0].lines;
    for (let offset = 0; offset < body.length; offset++) {
      expect(lines.find((line) => line.oldNumber === 596 + offset)?.newNumber).toBe(575 + offset);
    }
    expect(lines.find((line) => line.oldNumber === 615)?.newNumber).toBeUndefined();
    expect(lines.filter((line) => line.oldNumber !== undefined).map((line) => line.content.slice(1))).toEqual(old);
    expect(lines.filter((line) => line.newNumber !== undefined).map((line) => line.content.slice(1))).toEqual(next);
    expect(realignDiffHunks(files)).toEqual(files);
    const root = document.createElement("div");
    root.innerHTML = renderAlignedDiffHtml(files, { outputFormat, matching: "lines" });
    if (outputFormat === "side-by-side") {
      const [left, right] = Array.from(root.querySelectorAll(".d2h-diff-tbody"), (table) =>
        Array.from(table.querySelectorAll("tr")),
      );
      const oldIndex = left.findIndex(
        (row) => row.querySelector(".d2h-code-side-linenumber")?.textContent?.trim() === "596",
      );
      expect(oldIndex).toBeGreaterThanOrEqual(0);
      expect(right[oldIndex].querySelector(".d2h-code-side-linenumber")?.textContent?.trim()).toBe("575");
    } else {
      const row = Array.from(root.querySelectorAll("tr")).find(
        (row) => row.querySelector(".line-num1")?.textContent?.trim() === "596",
      );
      expect(row?.querySelector(".line-num2")?.textContent?.trim()).toBe("575");
    }
  });
});

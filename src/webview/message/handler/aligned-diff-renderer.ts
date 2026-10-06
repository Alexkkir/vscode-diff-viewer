import { defaultDiff2HtmlConfig, Diff2HtmlConfig } from "diff2html";
import { FileListRenderer } from "diff2html/lib/file-list-renderer";
import HoganJsUtils from "diff2html/lib/hoganjs-utils";
import LineByLineRenderer from "diff2html/lib/line-by-line-renderer";
import { MatcherFn } from "diff2html/lib/rematch";
import SideBySideRenderer from "diff2html/lib/side-by-side-renderer";
import { DiffFile, DiffLine } from "diff2html/lib/types";
import { Diff2HtmlUI, Diff2HtmlUIConfig } from "diff2html/lib/ui/js/diff2html-ui-slim.js";
import { alignChangedLines } from "./line-alignment";
import { setProgrammaticScroll, userScrollAxes } from "./scroll-synchronization";

type RendererConfig = typeof defaultDiff2HtmlConfig;

function matchLines(oldLines: DiffLine[], newLines: DiffLine[], config: RendererConfig, language?: string) {
  const comparisons = oldLines.length * newLines.length;
  const enabled = config.matching === "lines" || config.matching === "words";
  const allowed =
    enabled &&
    comparisons < config.matchingMaxComparisons &&
    [...oldLines, ...newLines].every((line) => line.content.length < config.maxLineSizeInBlockForComparison);
  return allowed ? alignChangedLines(oldLines, newLines, language) : [[oldLines, newLines]];
}

class AlignedSideBySideRenderer extends SideBySideRenderer {
  private combined = false;
  private language?: string;
  private withoutInlineHighlight?: SideBySideRenderer;

  constructor(
    private readonly hogan: HoganJsUtils,
    private readonly alignmentConfig: RendererConfig,
  ) {
    super(hogan, alignmentConfig);
  }

  override generateFileHtml(file: DiffFile) {
    this.combined = file.isCombined;
    this.language = file.language;
    return super.generateFileHtml(file);
  }

  override applyRematchMatching(oldLines: DiffLine[], newLines: DiffLine[], matcher: MatcherFn<DiffLine>) {
    return this.combined
      ? super.applyRematchMatching(oldLines, newLines, matcher)
      : matchLines(oldLines, newLines, this.alignmentConfig, this.language);
  }

  override processChangedLines(isCombined: boolean, oldLines: DiffLine[], newLines: DiffLine[]) {
    // Upstream removes the opposite side's <ins>/<del> spans with a regex that
    // does not match CR. Keep the already chosen pairs, but omit inline spans
    // for this group so removed text cannot leak into the new side (or vice versa).
    if ([...oldLines, ...newLines].some((line) => line.content.includes("\r"))) {
      this.withoutInlineHighlight ??= new SideBySideRenderer(this.hogan, {
        ...this.alignmentConfig,
        maxLineLengthHighlight: 0,
      });
      return this.withoutInlineHighlight.processChangedLines(isCombined, oldLines, newLines);
    }
    return super.processChangedLines(isCombined, oldLines, newLines);
  }
}

class AlignedLineByLineRenderer extends LineByLineRenderer {
  private combined = false;
  private language?: string;
  private withoutInlineHighlight?: LineByLineRenderer;

  constructor(
    private readonly hogan: HoganJsUtils,
    private readonly alignmentConfig: RendererConfig,
  ) {
    super(hogan, alignmentConfig);
  }

  override generateFileHtml(file: DiffFile) {
    this.combined = file.isCombined;
    this.language = file.language;
    return super.generateFileHtml(file);
  }

  override applyRematchMatching(oldLines: DiffLine[], newLines: DiffLine[], matcher: MatcherFn<DiffLine>) {
    return this.combined
      ? super.applyRematchMatching(oldLines, newLines, matcher)
      : matchLines(oldLines, newLines, this.alignmentConfig, this.language);
  }

  override processChangedLines(file: DiffFile, isCombined: boolean, oldLines: DiffLine[], newLines: DiffLine[]) {
    if ([...oldLines, ...newLines].some((line) => line.content.includes("\r"))) {
      this.withoutInlineHighlight ??= new LineByLineRenderer(this.hogan, {
        ...this.alignmentConfig,
        maxLineLengthHighlight: 0,
      });
      return this.withoutInlineHighlight.processChangedLines(file, isCombined, oldLines, newLines);
    }
    return super.processChangedLines(file, isCombined, oldLines, newLines);
  }
}

export function renderAlignedDiffHtml(files: DiffFile[], configuration: Diff2HtmlConfig = {}): string {
  const config = { ...defaultDiff2HtmlConfig, ...configuration };
  const hogan = new HoganJsUtils(config);
  const fileList = config.drawFileList
    ? new FileListRenderer(hogan, { colorScheme: config.colorScheme }).render(files)
    : "";
  const renderer =
    config.outputFormat === "side-by-side"
      ? new AlignedSideBySideRenderer(hogan, config)
      : new AlignedLineByLineRenderer(hogan, config);
  // The HTML parser normalizes literal CR characters to LF, including source
  // text inside code cells. A character reference retains the original byte.
  return (fileList + renderer.render(files)).replaceAll("\r", "&#13;");
}

/** Keep diff2html's UI behaviors and templates, replacing only line pairing. */
export class AlignedDiff2HtmlUI extends Diff2HtmlUI {
  override readonly diffHtml: string;

  constructor(target: HTMLElement, files: DiffFile[], config: Diff2HtmlUIConfig = {}) {
    // An omitted input makes the base class serialize target.innerHTML, which
    // can be expensive when refreshing an already-rendered large diff.
    super(target, [], config);
    this.diffHtml = renderAlignedDiffHtml(files, this.config);
  }

  override synchronisedScroll(): void {
    this.targetElement.querySelectorAll(".d2h-file-wrapper").forEach((wrapper) => {
      const [left, right] = wrapper.querySelectorAll<HTMLElement>(".d2h-file-side-diff");
      if (!left || !right) return;
      const onScroll = (event: Event) => {
        const source = event.target === left ? left : right;
        const target = source === left ? right : left;
        for (const axis of userScrollAxes(event, source)) setProgrammaticScroll(target, axis, source[axis]);
      };
      left.addEventListener("scroll", onScroll, { passive: true });
      right.addEventListener("scroll", onScroll, { passive: true });
    });
  }
}

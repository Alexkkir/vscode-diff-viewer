import { defaultDiff2HtmlConfig, Diff2HtmlConfig } from "diff2html";
import { FileListRenderer } from "diff2html/lib/file-list-renderer";
import HoganJsUtils from "diff2html/lib/hoganjs-utils";
import LineByLineRenderer from "diff2html/lib/line-by-line-renderer";
import { MatcherFn } from "diff2html/lib/rematch";
import SideBySideRenderer from "diff2html/lib/side-by-side-renderer";
import { DiffFile, DiffLine } from "diff2html/lib/types";
import { Diff2HtmlUI, Diff2HtmlUIConfig } from "diff2html/lib/ui/js/diff2html-ui-slim.js";
import { alignChangedLines } from "./line-alignment";

type RendererConfig = typeof defaultDiff2HtmlConfig;

function matchLines(oldLines: DiffLine[], newLines: DiffLine[], config: RendererConfig) {
  const comparisons = oldLines.length * newLines.length;
  const enabled = config.matching === "lines" || config.matching === "words";
  const allowed =
    enabled &&
    comparisons < config.matchingMaxComparisons &&
    [...oldLines, ...newLines].every((line) => line.content.length < config.maxLineSizeInBlockForComparison);
  return allowed ? alignChangedLines(oldLines, newLines) : [[oldLines, newLines]];
}

class AlignedSideBySideRenderer extends SideBySideRenderer {
  private combined = false;

  constructor(
    hogan: HoganJsUtils,
    private readonly alignmentConfig: RendererConfig,
  ) {
    super(hogan, alignmentConfig);
  }

  override generateFileHtml(file: DiffFile) {
    this.combined = file.isCombined;
    return super.generateFileHtml(file);
  }

  override applyRematchMatching(oldLines: DiffLine[], newLines: DiffLine[], matcher: MatcherFn<DiffLine>) {
    return this.combined
      ? super.applyRematchMatching(oldLines, newLines, matcher)
      : matchLines(oldLines, newLines, this.alignmentConfig);
  }
}

class AlignedLineByLineRenderer extends LineByLineRenderer {
  private combined = false;

  constructor(
    hogan: HoganJsUtils,
    private readonly alignmentConfig: RendererConfig,
  ) {
    super(hogan, alignmentConfig);
  }

  override generateFileHtml(file: DiffFile) {
    this.combined = file.isCombined;
    return super.generateFileHtml(file);
  }

  override applyRematchMatching(oldLines: DiffLine[], newLines: DiffLine[], matcher: MatcherFn<DiffLine>) {
    return this.combined
      ? super.applyRematchMatching(oldLines, newLines, matcher)
      : matchLines(oldLines, newLines, this.alignmentConfig);
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
  return fileList + renderer.render(files);
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
}

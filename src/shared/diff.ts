import { parse, type Diff2HtmlConfig } from "diff2html";
import type { DiffFile } from "diff2html/lib/types";

/** The marker applies to a source line, not an extra line of code in the patch. */
export interface DiffFileWithMetadata extends DiffFile {
  noNewline?: { old?: number; new?: number };
}

const NO_NEWLINE = "\\ No newline at end of file";
const ARC_REVISION = /[ \t]+\((?:working tree|[a-f0-9]{7,64})\)$/i;

/** A combined merge has multiple old sources that a two-source renderer cannot represent. */
export function hasCombinedDiff(text: string): boolean {
  return (
    /^diff --(?:cc|combined)[ \t]+\S/m.test(text) ||
    /^(@{3,}) (?:-\d+(?:,\d+)? )+\+\d+(?:,\d+)? \1(?:[ \t].*)?\r?$/m.test(text)
  );
}

function decodeGitPath(quoted: string): string {
  const escapes: Record<string, string> = {
    a: "\u0007",
    b: "\b",
    t: "\t",
    n: "\n",
    v: "\v",
    f: "\f",
    r: "\r",
    '"': '"',
    "\\": "\\",
  };
  return quoted.slice(1, -1).replace(/(?:\\[0-7]{1,3})+|\\[abtnvfr"\\]/g, (escape) => {
    if (/^\\[0-7]/.test(escape)) {
      const bytes = Array.from(escape.matchAll(/\\([0-7]{1,3})/g), (match) => Number.parseInt(match[1], 8));
      try {
        return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
      } catch {
        return escape;
      }
    }
    return escapes[escape[1]];
  });
}

interface DiffSection {
  lines: string[];
  noNewline: NonNullable<DiffFileWithMetadata["noNewline"]>;
}

interface Hunk {
  old: number;
  new: number;
  oldRemaining: number;
  newRemaining: number;
  previous?: NonNullable<DiffFileWithMetadata["noNewline"]>;
}

interface CombinedHunk {
  oldRemaining: number[];
  newRemaining: number;
}

/**
 * diff2html discards EOF markers and mistakes Arc revision labels for renames.
 * Read those details before parsing, using hunk counts to distinguish headers
 * from actual removed/added code that happens to start with --- / +++.
 */
export function parseDiff(text: string, config?: Diff2HtmlConfig): DiffFileWithMetadata[] {
  let literalToken = "\uE000";
  while (text.includes(literalToken)) literalToken += "\uE000";
  const literalMarker = NO_NEWLINE.replace("\\", literalToken);
  const quotedPaths = new Map<string, string>();
  // Hide quoted names from upstream's permissive quote/whitespace parsing.
  // Only metadata is rewritten; escaped text inside source remains literal.
  const maskPaths = (line: string, stripPrefix: boolean): string =>
    line.replace(/"(?:\\.|[^"\\])*"/g, (quoted) => {
      const decoded = decodeGitPath(quoted);
      const prefix = stripPrefix
        ? (["a/", "b/", "i/", "w/", "c/", "o/", config?.srcPrefix, config?.dstPrefix].find(
            (value): value is string => !!value && decoded.startsWith(value),
          ) ?? "")
        : "";
      const placeholder = `${literalToken}path${quotedPaths.size}`;
      quotedPaths.set(placeholder, decoded.slice(prefix.length));
      return prefix + placeholder;
    });
  const restorePath = (value: string): string =>
    value.replace(
      new RegExp(`${literalToken}path\\d+`, "g"),
      (placeholder) => quotedPaths.get(placeholder) ?? placeholder,
    );
  const restore = (value: string): string =>
    value
      .replaceAll(literalMarker, NO_NEWLINE)
      .replaceAll(`-${literalToken}- `, "--- ")
      .replaceAll(`--${literalToken} `, "--- ");
  const sections: DiffSection[] = [];
  let section: DiffSection = { lines: [], noNewline: {} };
  let hasFile = false;
  let isGit = false;
  let hasHeaders = false;
  let hunk: Hunk | undefined;
  let combinedHunk: CombinedHunk | undefined;
  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  const startFile = (git: boolean): void => {
    if (hasFile) {
      sections.push(section);
      section = { lines: [], noNewline: {} };
    }
    hasFile = true;
    isGit = git;
    hasHeaders = false;
    hunk = undefined;
    combinedHunk = undefined;
  };

  for (let index = 0; index < lines.length; index++) {
    // Git emits both spellings. Upstream recognizes only --combined; retain
    // proper file boundaries for --cc before handing it the normalized text.
    let line = lines[index].replace(/^diff --cc /, "diff --combined ");
    const insideHunk =
      (hunk && (hunk.oldRemaining > 0 || hunk.newRemaining > 0)) ||
      (combinedHunk && (combinedHunk.newRemaining > 0 || combinedHunk.oldRemaining.some((count) => count > 0)));
    if (line.startsWith("diff --git") || line.startsWith("diff --combined")) {
      startFile(true);
      line = maskPaths(line, true);
    } else if (!insideHunk && line.startsWith("Binary files") && !isGit) {
      startFile(false);
      line = maskPaths(line, true);
    } else if (!insideHunk && line.startsWith("--- ") && lines[index + 1]?.startsWith("+++ ")) {
      if (!isGit || hasHeaders) startFile(false);
      hasHeaders = true;
      // Strip only recognized revision metadata in actual file headers.
      line = maskPaths(line.replace(ARC_REVISION, ""), true);
      lines[index + 1] = maskPaths(lines[index + 1].replace(ARC_REVISION, ""), true);
    } else if (!insideHunk && /^(?:copy|rename) (?:from|to) /.test(line)) {
      line = maskPaths(line, false);
    } else if (!insideHunk && line.startsWith("Binary files")) {
      line = maskPaths(line, true);
    }

    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    const combinedHeader = /^(@{3,}) ((?:-\d+(?:,\d+)? )+)\+\d+(?:,(\d+))? \1/.exec(line);
    if (header) {
      combinedHunk = undefined;
      hunk = {
        old: Number(header[1]),
        new: Number(header[3]),
        oldRemaining: Number(header[2] ?? 1),
        newRemaining: Number(header[4] ?? 1),
      };
    } else if (combinedHeader) {
      hunk = undefined;
      combinedHunk = {
        oldRemaining: Array.from(combinedHeader[2].matchAll(/-\d+(?:,(\d+))?/g), (range) => Number(range[1] ?? 1)),
        newRemaining: Number(combinedHeader[3] ?? 1),
      };
    } else if (line === NO_NEWLINE && combinedHunk) {
      // Our metadata has one old side; combined patches have multiple parents.
      // Preserve upstream behavior instead of assigning an ambiguous old EOF.
      continue;
    } else if (line === NO_NEWLINE && hunk?.previous) {
      Object.assign(section.noNewline, hunk.previous);
      hunk.previous = undefined;
      continue;
    } else if (combinedHunk) {
      const prefix = line.slice(0, combinedHunk.oldRemaining.length);
      if (prefix.length === combinedHunk.oldRemaining.length && /^[ +\-]+$/.test(prefix)) {
        const removed = prefix.includes("-");
        combinedHunk.oldRemaining = combinedHunk.oldRemaining.map((remaining, parent) =>
          prefix[parent] === "-" || (!removed && prefix[parent] === " ") ? remaining - 1 : remaining,
        );
        if (!removed) combinedHunk.newRemaining--;
        // Keep both combined diff prefix columns intact when masking source
        // text that otherwise resembles a non-Git file-header pair.
        if (prefix.length === 2 && line.startsWith("--- ")) line = `--${literalToken}${line.slice(3)}`;
      }
    } else if (hunk) {
      hunk.previous = undefined;
      if (line.startsWith("-") && hunk.oldRemaining > 0) {
        hunk.previous = { old: hunk.old++ };
        hunk.oldRemaining--;
        // Upstream detects a new non-Git file from --- / +++ / @@ even
        // when the first two lines are still part of the previous hunk.
        if (line.startsWith("--- ")) line = `-${literalToken}${line.slice(2)}`;
      } else if (line.startsWith("+") && hunk.newRemaining > 0) {
        hunk.previous = { new: hunk.new++ };
        hunk.newRemaining--;
      } else if (line.startsWith(" ") && hunk.oldRemaining > 0 && hunk.newRemaining > 0) {
        hunk.previous = { old: hunk.old++, new: hunk.new++ };
        hunk.oldRemaining--;
        hunk.newRemaining--;
      }
    }
    // The upstream parser otherwise deletes this phrase even inside source code.
    section.lines.push(line.replaceAll(NO_NEWLINE, literalMarker));
  }
  sections.push(section);

  const result: DiffFileWithMetadata[] = [];
  for (const part of sections) {
    const offset = result.length;
    const tooBigMessage = config?.diffTooBigMessage;
    const options =
      typeof tooBigMessage === "function"
        ? { ...config, diffTooBigMessage: (fileIndex: number) => tooBigMessage(offset + fileIndex) }
        : config;
    const files: DiffFileWithMetadata[] = parse(part.lines.join("\n"), options);
    for (const file of files) {
      const hadQuotedPath =
        file.oldName?.includes(`${literalToken}path`) || file.newName.includes(`${literalToken}path`);
      if (file.oldName) file.oldName = restorePath(restore(file.oldName));
      file.newName = restorePath(restore(file.newName));
      if (hadQuotedPath) {
        for (const path of [file.oldName, file.newName]) {
          const parts = path?.split(".");
          if (parts && parts.length > 1) file.language = parts[parts.length - 1];
        }
      }
      for (const block of file.blocks) {
        block.header = restore(block.header);
        for (const line of block.lines) line.content = restore(line.content);
      }
      const noNewline: NonNullable<DiffFileWithMetadata["noNewline"]> = {};
      for (const side of ["old", "new"] as const) {
        const number = part.noNewline[side];
        if (
          number !== undefined &&
          file.blocks.some((block) => block.lines.some((line) => line[`${side}Number`] === number))
        ) {
          noNewline[side] = number;
        }
      }
      if (Object.keys(noNewline).length) file.noNewline = noNewline;
      result.push(file);
    }
  }
  return result;
}

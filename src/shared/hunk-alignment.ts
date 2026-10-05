import { LineType, type DiffBlock, type DiffLine } from "diff2html/lib/types";
import type { DiffFileWithMetadata } from "./diff";

interface SourceLine {
  text: string;
  key: string;
  number: number;
}
type Match = [number, number];
interface Budget {
  scans: number;
  cells: number;
}

// Keep both the common (nearly unchanged) case linear and adversarial patches
// bounded. If a hunk exceeds the budget, keep its supplied alignment verbatim.
const MAX_SCANS = 200_000;
const MAX_LCS_CELLS = 500_000;
const MAX_DEPTH = 32;

function project(block: DiffBlock, side: "old" | "new", eof?: number): SourceLine[] {
  const lines: SourceLine[] = [];
  for (const line of block.lines) {
    const number = side === "old" ? line.oldNumber : line.newNumber;
    if (number === undefined) continue;
    const text = line.content.slice(1);
    // Identical last-line text with different newline status is still a change.
    lines.push({ text, number, key: `${number === eof ? "0" : "1"}\0${text}` });
  }
  return lines;
}

function uniquePositions(lines: SourceLine[], start: number, end: number): Map<string, number> {
  const positions = new Map<string, number>();
  for (let i = start; i < end; i++) {
    // Blank separators must not move a retained body into a later deleted
    // declaration merely because a new docstring adds an extra separator.
    if (!lines[i].text.trim()) continue;
    const key = lines[i].key;
    positions.set(key, positions.has(key) ? -1 : i);
  }
  return positions;
}

/** Select unique exact anchors in increasing old and new order. */
function anchors(oldPositions: Map<string, number>, newPositions: Map<string, number>): Match[] {
  const pairs: Match[] = [];
  for (const [key, old] of oldPositions) {
    const next = newPositions.get(key);
    if (old >= 0 && next !== undefined && next >= 0) pairs.push([old, next]);
  }
  const tails: number[] = [];
  const previous = new Int32Array(pairs.length).fill(-1);
  for (let i = 0; i < pairs.length; i++) {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (pairs[tails[mid]][1] < pairs[i][1]) low = mid + 1;
      else high = mid;
    }
    if (low > 0) previous[i] = tails[low - 1];
    tails[low] = i;
  }
  const result: Match[] = [];
  for (let i = tails[tails.length - 1] ?? -1; i >= 0; i = previous[i]) result.push(pairs[i]);
  return result.reverse();
}

/** Earliest embedding also handles large runs of repeated lines in linear time. */
function subsequence(
  smaller: SourceLine[],
  start: number,
  end: number,
  larger: SourceLine[],
  otherStart: number,
  otherEnd: number,
  swap: boolean,
): Match[] | undefined {
  // A full embedding maximizes matches only when every line has positive
  // weight. Matching a blank separator first can otherwise select a later
  // duplicate body, bypassing the weighted LCS's earliest-copy preference.
  for (let i = start; i < end; i++) if (!smaller[i].text.trim()) return undefined;
  const result: Match[] = [];
  for (let i = start, j = otherStart; i < end; i++, j++) {
    while (j < otherEnd && smaller[i].key !== larger[j].key) j++;
    if (j === otherEnd) return undefined;
    result.push(swap ? [j, i] : [i, j]);
  }
  return result;
}

function matchRange(
  old: SourceLine[],
  next: SourceLine[],
  oldStart: number,
  oldEnd: number,
  newStart: number,
  newEnd: number,
  result: Match[],
  budget: Budget,
  depth = 0,
  bodyAnchor = false,
): boolean {
  if (depth > MAX_DEPTH) return false;
  budget.scans -= oldEnd - oldStart + newEnd - newStart;
  if (budget.scans < 0) return false;
  while (oldStart < oldEnd && newStart < newEnd && old[oldStart].key === next[newStart].key) {
    result.push([oldStart++, newStart++]);
  }
  if (oldStart === oldEnd || newStart === newEnd) return true;

  // Keep the exact constructor/body prefix belonging to a unique body anchor
  // with that anchor. Otherwise an earlier removed class with the same
  // def/super boilerplate can steal those lines and split the renamed header.
  // Only take a contiguous indented run: EOF, blank separators and top-level
  // anchors must not pull a surviving constructor toward a later test class.
  if (bodyAnchor) {
    const suffix: Match[] = [];
    while (
      oldStart < oldEnd &&
      newStart < newEnd &&
      old[oldEnd - 1].key === next[newEnd - 1].key &&
      /^\s+\S/.test(old[oldEnd - 1].text)
    ) {
      suffix.push([--oldEnd, --newEnd]);
    }
    if (suffix.length) {
      if (!matchRange(old, next, oldStart, oldEnd, newStart, newEnd, result, budget, depth + 1)) return false;
      for (let index = suffix.length - 1; index >= 0; index--) result.push(suffix[index]);
      return true;
    }
  }

  const oldPositions = uniquePositions(old, oldStart, oldEnd);
  const newPositions = uniquePositions(next, newStart, newEnd);
  const ordered = anchors(oldPositions, newPositions);
  if (ordered.length) {
    for (const [oldAnchor, newAnchor] of ordered) {
      if (
        !matchRange(
          old,
          next,
          oldStart,
          oldAnchor,
          newStart,
          newAnchor,
          result,
          budget,
          depth + 1,
          /^\s+\S/.test(old[oldAnchor].text),
        )
      )
        return false;
      result.push([oldAnchor, newAnchor]);
      oldStart = oldAnchor + 1;
      newStart = newAnchor + 1;
    }
    return matchRange(old, next, oldStart, oldEnd, newStart, newEnd, result, budget, depth + 1);
  }
  if (![...oldPositions.keys()].some((key) => newPositions.has(key))) return true;

  const oldLength = oldEnd - oldStart;
  const newLength = newEnd - newStart;
  const embedding =
    oldLength >= newLength
      ? subsequence(next, newStart, newEnd, old, oldStart, oldEnd, true)
      : subsequence(old, oldStart, oldEnd, next, newStart, newEnd, false);
  if (embedding) {
    for (const match of embedding) result.push(match);
    return true;
  }

  const width = newLength + 1;
  const cells = (oldLength + 1) * width;
  if (cells > budget.cells) return false;
  budget.cells -= cells;
  const lengths = new Uint32Array(cells);
  for (let i = oldLength - 1; i >= 0; i--) {
    for (let j = newLength - 1; j >= 0; j--) {
      lengths[i * width + j] =
        old[oldStart + i].key === next[newStart + j].key
          ? (old[oldStart + i].text.trim() ? 1 : 0) + lengths[(i + 1) * width + j + 1]
          : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1]);
    }
  }
  for (let i = 0, j = 0; i < oldLength && j < newLength; ) {
    if (old[oldStart + i].key === next[newStart + j].key) {
      result.push([oldStart + i++, newStart + j++]);
    } else if (lengths[i * width + j + 1] >= lengths[(i + 1) * width + j]) {
      // Ties insert on the new side first, retaining the earliest old copy.
      j++;
    } else i++;
  }
  return true;
}

/** Restore unchanged separators after meaningful line matches are fixed. */
function matchWhitespace(old: SourceLine[], next: SourceLine[], matches: Match[]): Match[] {
  const result: Match[] = [];
  let oldStart = 0;
  let newStart = 0;
  for (const [oldEnd, newEnd] of [...matches, [old.length, next.length]]) {
    const positions = new Map<string, { indexes: number[]; cursor: number }>();
    for (let index = oldStart; index < oldEnd; index++) {
      if (old[index].text.trim()) continue;
      let entry = positions.get(old[index].key);
      if (!entry) {
        entry = { indexes: [], cursor: 0 };
        positions.set(old[index].key, entry);
      }
      entry.indexes.push(index);
    }
    let previous = oldStart - 1;
    for (let index = newStart; index < newEnd; index++) {
      if (next[index].text.trim()) continue;
      const entry = positions.get(next[index].key);
      if (!entry) continue;
      while (entry.cursor < entry.indexes.length && entry.indexes[entry.cursor] <= previous) entry.cursor++;
      if (entry.cursor === entry.indexes.length) continue;
      previous = entry.indexes[entry.cursor++];
      result.push([previous, index]);
    }
    if (oldEnd < old.length) result.push([oldEnd, newEnd]);
    oldStart = oldEnd + 1;
    newStart = newEnd + 1;
  }
  return result;
}

function realignBlock(block: DiffBlock, eof: DiffFileWithMetadata["noNewline"], budget: Budget): DiffBlock {
  const old = project(block, "old", eof?.old);
  const next = project(block, "new", eof?.new);
  if (!old.length || !next.length) return block;
  const matches: Match[] = [];
  if (!matchRange(old, next, 0, old.length, 0, next.length, matches, budget)) return block;
  const lines: DiffLine[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  for (const [oldMatch, newMatch] of [...matchWhitespace(old, next, matches), [old.length, next.length]]) {
    while (oldIndex < oldMatch) {
      const line = old[oldIndex++];
      lines.push({ type: LineType.DELETE, content: `-${line.text}`, oldNumber: line.number, newNumber: undefined });
    }
    while (newIndex < newMatch) {
      const line = next[newIndex++];
      lines.push({ type: LineType.INSERT, content: `+${line.text}`, oldNumber: undefined, newNumber: line.number });
    }
    if (oldMatch < old.length) {
      lines.push({
        type: LineType.CONTEXT,
        content: ` ${old[oldIndex].text}`,
        oldNumber: old[oldIndex++].number,
        newNumber: next[newIndex++].number,
      });
    }
  }
  if (
    lines.length === block.lines.length &&
    lines.every((line, index) => {
      const previous = block.lines[index];
      return (
        line.content === previous.content &&
        line.oldNumber === previous.oldNumber &&
        line.newNumber === previous.newNumber
      );
    })
  )
    return block;
  return { ...block, lines };
}

/** Recompute exact line alignment independently inside each supplied hunk. */
export function realignDiffHunks(files: DiffFileWithMetadata[]): DiffFileWithMetadata[] {
  return files.map((file) => {
    if (file.isCombined || file.isBinary || file.isTooBig) return file;
    const budget = { scans: MAX_SCANS, cells: MAX_LCS_CELLS };
    const blocks = file.blocks.map((block) => realignBlock(block, file.noNewline, budget));
    if (blocks.every((block, index) => block === file.blocks[index])) return file;
    let addedLines = 0;
    let deletedLines = 0;
    for (const block of blocks) {
      for (const line of block.lines) {
        if (line.type === LineType.INSERT) addedLines++;
        else if (line.type === LineType.DELETE) deletedLines++;
      }
    }
    return { ...file, blocks, addedLines, deletedLines };
  });
}

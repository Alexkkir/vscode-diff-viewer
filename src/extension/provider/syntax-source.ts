import { DiffFile, DiffLine, LineType } from "diff2html/lib/types";

const MAX_SOURCE_LENGTH = 2 * 1024 * 1024;
const MAX_SOURCE_LINES = 50_000;

// A matching working-tree file supplies the lexical context omitted by a diff.
// Reconstruct the old side only after checking every hunk against the new side;
// a stale or unrelated source must never supply misleading tokenization state.
export function reconstructSyntaxSources(
  file: DiffFile,
  newSource: string,
): { old: string[]; new: string[] } | undefined {
  if (file.isCombined || file.isBinary || newSource.length > MAX_SOURCE_LENGTH) return;
  const newLines = newSource === "" ? [] : newSource.split(/\r?\n/);
  if (newSource.endsWith("\n")) newLines.pop();
  if (newLines.length > MAX_SOURCE_LINES) return;

  const oldLines: string[] = [];
  let cursor = 0;
  let patchLength = 0;
  for (const block of file.blocks) {
    const oldProjection: DiffLine[] = [];
    const newProjection: DiffLine[] = [];
    for (const line of block.lines) {
      patchLength += line.content.length;
      if (patchLength > MAX_SOURCE_LENGTH) return;
      if (line.type === LineType.CONTEXT) {
        if (!line.content.startsWith(" ")) return;
        oldProjection.push(line);
        newProjection.push(line);
      } else if (line.type === LineType.INSERT) {
        if (!line.content.startsWith("+") || line.oldNumber !== undefined) return;
        newProjection.push(line);
      } else if (line.type === LineType.DELETE) {
        if (!line.content.startsWith("-") || line.newNumber !== undefined) return;
        oldProjection.push(line);
      } else return;
      if (oldProjection.length > MAX_SOURCE_LINES || newProjection.length > MAX_SOURCE_LINES) return;
    }
    if (oldProjection.length + newProjection.length === 0) return;
    const newStart = block.newStartLine - (newProjection.length ? 1 : 0);
    const oldStart = block.oldStartLine - (oldProjection.length ? 1 : 0);
    if (
      !Number.isSafeInteger(newStart) ||
      !Number.isSafeInteger(oldStart) ||
      newStart < cursor ||
      newStart + newProjection.length > newLines.length ||
      oldStart !== oldLines.length + newStart - cursor ||
      oldStart + oldProjection.length > MAX_SOURCE_LINES
    )
      return;

    for (let i = 0; i < newProjection.length; i++) {
      const line = newProjection[i];
      if (line.newNumber !== newStart + i + 1 || line.content.slice(1) !== newLines[newStart + i]) return;
    }
    for (let i = 0; i < oldProjection.length; i++) {
      if (oldProjection[i].oldNumber !== oldStart + i + 1) return;
    }
    // Apply the inverse patch in one pass, retaining untouched source between
    // hunks. Avoid spreading a large hunk into splice's argument list.
    for (let i = cursor; i < newStart; i++) oldLines.push(newLines[i]);
    for (const line of oldProjection) oldLines.push(line.content.slice(1));
    cursor = newStart + newProjection.length;
  }
  if (oldLines.length + newLines.length - cursor > MAX_SOURCE_LINES) return;
  for (let i = cursor; i < newLines.length; i++) oldLines.push(newLines[i]);
  return { old: oldLines, new: newLines };
}

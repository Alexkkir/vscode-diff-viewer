import { DiffFile, LineType } from "diff2html/lib/types";

export const DEFAULT_CONTEXT_LINES = 50;
export const CONTEXT_EXPAND_STEP = 20;

/** A half-open range of existing, unchanged lines in one diff block. */
export interface ContextGap {
  /** Remains unchanged as either edge of the range is expanded. */
  id: string;
  blockIndex: number;
  start: number;
  end: number;
  /** There is a change before this gap: reveal its start to expand downwards. */
  canExpandBefore: boolean;
  /** There is a change after this gap: reveal its end to expand upwards. */
  canExpandAfter: boolean;
}

export type ContextExpansionDirection = "start" | "end";

function nonnegativeInteger(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

/** Keep the requested context on both sides of every group of changed lines. */
export function buildContextGaps(file: DiffFile, contextLines = DEFAULT_CONTEXT_LINES): ContextGap[] {
  const context = nonnegativeInteger(contextLines, DEFAULT_CONTEXT_LINES);
  const gaps: ContextGap[] = [];
  file.blocks.forEach((block, blockIndex) => {
    // A block without any changes (for example a rename) should stay readable.
    if (!block.lines.some((line) => line.type !== LineType.CONTEXT)) return;

    for (let index = 0; index < block.lines.length; ) {
      if (block.lines[index].type !== LineType.CONTEXT) {
        index++;
        continue;
      }
      const runStart = index;
      while (index < block.lines.length && block.lines[index].type === LineType.CONTEXT) index++;

      const canExpandBefore = runStart > 0;
      const canExpandAfter = index < block.lines.length;
      const start = runStart + (canExpandBefore ? context : 0);
      const end = index - (canExpandAfter ? context : 0);
      if (start < end) {
        gaps.push({
          id: `${blockIndex}:${start}:${end}`,
          blockIndex,
          start,
          end,
          canExpandBefore,
          canExpandAfter,
        });
      }
    }
  });
  return gaps;
}

/** Reveal at most one step from an allowed edge; null means the gap is gone. */
export function expandContextGap(
  gap: ContextGap,
  direction: ContextExpansionDirection,
  step = CONTEXT_EXPAND_STEP,
): ContextGap | null {
  if (gap.start >= gap.end) return null;
  const allowed = direction === "start" ? gap.canExpandBefore : gap.canExpandAfter;
  const count = allowed ? Math.min(nonnegativeInteger(step, CONTEXT_EXPAND_STEP), gap.end - gap.start) : 0;
  const next = {
    ...gap,
    start: gap.start + (direction === "start" ? count : 0),
    end: gap.end - (direction === "end" ? count : 0),
  };
  return next.start < next.end ? next : null;
}

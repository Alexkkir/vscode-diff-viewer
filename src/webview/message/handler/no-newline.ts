import type { DiffFileWithMetadata } from "../../../shared/diff";
import { getHtmlId } from "diff2html/lib/render-utils";

type Side = "old" | "new";

function addMarker(row: HTMLTableRowElement, sides: Side[]): void {
  const cell = row.cells[row.cells.length - 1];
  if (!cell) return;
  const marker = document.createElement("div");
  marker.className = "diff-no-newline";
  if (sides.length) {
    marker.dataset.noNewlineSide = sides.join(" ");
    marker.textContent = "\\ No newline at end of file";
  } else {
    // Two independent tables form the side-by-side view. A blank annotation
    // keeps subsequent source rows aligned even when only one side lacks LF.
    marker.classList.add("diff-no-newline-placeholder");
    marker.setAttribute("aria-hidden", "true");
  }
  cell.append(marker);
}

function isLine(value: string | null | undefined, target?: number): boolean {
  return !!target && !!value && /^\s*\d+\s*$/.test(value) && Number(value) === target;
}

// EOF metadata belongs to its real source row, outside the selectable source
// text. Folding, syntax updates and searching therefore keep their usual line
// numbers and text, while a newline-only change remains visible to the reader.
export function renderNoNewlineMarkers(container: HTMLElement, files: DiffFileWithMetadata[]): void {
  container.querySelectorAll(".diff-no-newline").forEach((marker) => marker.remove());
  const wrappers = new Map(
    Array.from(container.querySelectorAll<HTMLElement>(".d2h-file-wrapper"), (wrapper) => [wrapper.id, wrapper]),
  );
  files.forEach((file) => {
    // renderNothingWhenEmpty can omit earlier file wrappers, so DOM positions
    // need not match positions in the full file model.
    const wrapper = wrappers.get(getHtmlId(file));
    const eof = file.noNewline;
    if (!wrapper || !eof) return;
    const panes = Array.from(wrapper.querySelectorAll<HTMLElement>(".d2h-file-side-diff"));
    if (panes.length === 2) {
      const rows = panes.map((pane) => Array.from(pane.querySelectorAll<HTMLTableRowElement>("tbody > tr")));
      const targets = rows.map((sideRows, side) =>
        sideRows.findIndex((row) =>
          isLine(row.querySelector(".d2h-code-side-linenumber")?.textContent, side ? eof.new : eof.old),
        ),
      );
      for (const index of new Set(targets.filter((index) => index >= 0))) {
        rows.forEach((sideRows, side) => {
          const row = sideRows[index];
          if (row) addMarker(row, targets[side] === index ? [side ? "new" : "old"] : []);
        });
      }
    } else if (!panes.length) {
      for (const row of wrapper.querySelectorAll<HTMLTableRowElement>("tbody > tr")) {
        const sides: Side[] = [];
        if (isLine(row.querySelector(".line-num1")?.textContent, eof.old)) sides.push("old");
        if (isLine(row.querySelector(".line-num2")?.textContent, eof.new)) sides.push("new");
        if (sides.length) addMarker(row, sides);
      }
    }
  });
}

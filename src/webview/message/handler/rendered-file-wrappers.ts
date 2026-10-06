import type { DiffFile } from "diff2html/lib/types";

/** Pair rendered wrappers with source models without relying on colliding HTML IDs. */
export function getRenderedFileWrappers<T extends DiffFile>(
  container: HTMLElement,
  files: readonly T[],
): Array<{ file: T; fileIndex: number; wrapper: HTMLElement }> {
  const wrappers = Array.from(container.querySelectorAll<HTMLElement>(".d2h-file-wrapper"));
  // diff2html preserves file order. renderNothingWhenEmpty is the only option
  // that removes wrappers, and removes every file with no blocks together.
  const emptyFilesOmitted = wrappers.length < files.length;
  let wrapperIndex = 0;
  return files.flatMap((file, fileIndex) => {
    if (emptyFilesOmitted && !file.blocks.length) return [];
    const wrapper = wrappers[wrapperIndex++];
    return wrapper ? [{ file, fileIndex, wrapper }] : [];
  });
}

/** Summary links must use the same unambiguous identity as the rendered files. */
export function linkRenderedFileSummaries(container: HTMLElement, files: readonly DiffFile[]): void {
  const byIndex = new Map<number, HTMLElement>();
  for (const { fileIndex, wrapper } of getRenderedFileWrappers(container, files)) {
    wrapper.id = `diff-viewer-file-${fileIndex}`;
    byIndex.set(fileIndex, wrapper);
  }
  container.querySelectorAll<HTMLElement>(".d2h-file-list-line").forEach((row, index) => {
    const link = row.querySelector<HTMLAnchorElement>('a[href^="#"]');
    const wrapper = byIndex.get(index);
    if (wrapper) link?.setAttribute("href", `#${wrapper.id}`);
    else link?.removeAttribute("href");
  });
}

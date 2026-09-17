export function extractNumberFromString(str: string): number | undefined {
  const num = Number.parseInt(str.trim());
  return Number.isNaN(num) ? undefined : num;
}

export function extractNewFileNameFromDiffName(diffName: string): string {
  const renamedFileNameRegex = /\{([^{}]+?) → ([^{}]+?)\}/gu;
  return diffName.replaceAll(renamedFileNameRegex, "$2");
}

/** Arc revision labels and diff2html rename presentation are not filesystem names. */
export function normalizeDiffFilePath(path?: string): string | undefined {
  if (!path) return undefined;
  const normalized = extractNewFileNameFromDiffName(path).replace(/[ \t]+\((?:working tree|[a-f0-9]{7,64})\)$/i, "");
  return normalized && normalized !== "/dev/null" ? normalized : undefined;
}

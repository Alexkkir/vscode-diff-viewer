export function extractNumberFromString(str: string): number | undefined {
  const num = Number.parseInt(str.trim());
  return Number.isNaN(num) ? undefined : num;
}

export function extractNewFileNameFromDiffName(diffName: string): string {
  const renamedFileNameRegex = /\{([^{}]+?) → ([^{}]+?)\}/gu;
  return diffName.replaceAll(renamedFileNameRegex, "$2");
}

/** Parsed file names already have metadata removed; their remaining characters are literal. */
export function parsedDiffFilePath(path?: string): string | undefined {
  return path && path !== "/dev/null" ? path : undefined;
}

/** Only for legacy display labels, never for DiffFile.oldName/newName or filesystem paths. */
export function normalizeDiffFilePath(path?: string): string | undefined {
  if (!path) return undefined;
  const normalized = extractNewFileNameFromDiffName(path).replace(/[ \t]+\((?:working tree|[a-f0-9]{7,64})\)$/i, "");
  return normalized && normalized !== "/dev/null" ? normalized : undefined;
}

import { DiffLine } from "diff2html/lib/types";

export type AlignedLineGroup = [DiffLine[], DiffLine[]];

// Line count and line length limits also come from diff2html's settings. This
// independent ceiling bounds work if those user settings are unusually large.
const MAX_COMPARISONS = 100_000;
const MAX_CHARACTER_COMPARISONS = 5_000_000;
const MIN_SIMILARITY = 0.5;
const CONTINUITY_BONUS = 0.5;

/** Align a changed run as a whole, rather than anchoring on its closest pair. */
export function alignChangedLines(oldLines: DiffLine[], newLines: DiffLine[]): AlignedLineGroup[] {
  if (!oldLines.length || !newLines.length) return oldLines.length || newLines.length ? [[oldLines, newLines]] : [];
  const width = newLines.length + 1;
  const comparisons = oldLines.length * newLines.length;
  if (comparisons > MAX_COMPARISONS) return [[oldLines, newLines]];

  const oldText = oldLines.map((line) => line.content.slice(1).trim());
  const newText = newLines.map((line) => line.content.slice(1).trim());
  const oldDeclarations = oldText.map(declarationShape);
  const newDeclarations = newText.map(declarationShape);
  const scores = new Float64Array((oldLines.length + 1) * width);
  const directions = new Uint8Array(scores.length);
  const pairScores = new Float64Array(scores.length).fill(-Infinity);
  const weights = new Float64Array(scores.length);
  const consecutive = new Uint8Array(scores.length);
  let characterBudget = MAX_CHARACTER_COMPARISONS;

  // Weighted longest common subsequence: several related source lines outweigh
  // a single near-identical URL/comment that has moved across those lines.
  for (let oldIndex = 1; oldIndex <= oldLines.length; oldIndex++) {
    for (let newIndex = 1; newIndex <= newLines.length; newIndex++) {
      const left = oldText[oldIndex - 1];
      const right = newText[newIndex - 1];
      const compared = similarity(left, right, characterBudget);
      if (!compared) return [[oldLines, newLines]];
      characterBudget -= compared.work;
      const declaration = oldDeclarations[oldIndex - 1];
      const renamedDeclaration = declaration !== undefined && declaration === newDeclarations[newIndex - 1];
      const score = Math.max(compared.score, renamedDeclaration ? 0.8 : 0);
      const weight =
        score > MIN_SIMILARITY ? (score - MIN_SIMILARITY) * Math.min(1, Math.min(left.length, right.length) / 10) : 0;
      const index = oldIndex * width + newIndex;
      const deletion = scores[index - width];
      const insertion = scores[index - 1];
      const previous = index - width - 1;
      const separate = scores[previous] + weight;
      const adjacent = pairScores[previous] + weight + CONTINUITY_BONUS * Math.min(weight, weights[previous]);
      const pair = weight > 0 ? Math.max(separate, adjacent) : -Infinity;
      pairScores[index] = pair;
      weights[index] = weight;
      consecutive[index] = adjacent > separate ? 1 : 0;
      if (pair >= deletion && pair >= insertion) {
        scores[index] = pair;
        directions[index] = 1;
      } else if (deletion >= insertion) {
        scores[index] = deletion;
        directions[index] = 2;
      } else {
        scores[index] = insertion;
        directions[index] = 3;
      }
    }
  }

  const anchors: Array<[number, number]> = [];
  let oldIndex = oldLines.length;
  let newIndex = newLines.length;
  let followPair = false;
  while (oldIndex > 0 && newIndex > 0) {
    const index = oldIndex * width + newIndex;
    const direction = followPair ? 1 : directions[index];
    if (direction === 1) {
      followPair = !!consecutive[index];
      anchors.push([--oldIndex, --newIndex]);
    } else if (direction === 2) {
      oldIndex--;
    } else {
      newIndex--;
    }
  }
  anchors.reverse();

  const result: AlignedLineGroup[] = [];
  oldIndex = 0;
  newIndex = 0;
  for (const [oldAnchor, newAnchor] of anchors) {
    if (oldAnchor > oldIndex) result.push([oldLines.slice(oldIndex, oldAnchor), []]);
    if (newAnchor > newIndex) result.push([[], newLines.slice(newIndex, newAnchor)]);
    result.push([[oldLines[oldAnchor]], [newLines[newAnchor]]]);
    oldIndex = oldAnchor + 1;
    newIndex = newAnchor + 1;
  }
  if (oldIndex < oldLines.length) result.push([oldLines.slice(oldIndex), []]);
  if (newIndex < newLines.length) result.push([[], newLines.slice(newIndex)]);
  return result;
}

function declarationShape(text: string): string | undefined {
  // A long renamed declaration can have little character overlap despite the
  // same syntax/base class/signature. Only abstract its declared name, keeping
  // every other token exact; strings, comments and arbitrary expressions do
  // not acquire a false similarity from sharing punctuation.
  const declaration =
    /^((?:export\s+)?(?:async\s+)?(?:class|def|function|interface|struct|enum|type)\s+)[\p{L}_$][\p{L}\p{N}_$]*/u;
  return declaration.test(text) ? text.replace(declaration, "$1\0") : undefined;
}

function similarity(left: string, right: string, budget: number): { score: number; work: number } | undefined {
  if (left === right) return { score: 1, work: 0 };
  const length = Math.max(left.length, right.length);
  if (Math.min(left.length, right.length) / length <= MIN_SIMILARITY) return { score: 0, work: 0 };

  // Unchanged indentation, identifiers and long URL prefixes should not cause
  // quadratic character comparisons for every possible pair of lines.
  let start = 0;
  while (start < Math.min(left.length, right.length) && left[start] === right[start]) start++;
  let leftEnd = left.length;
  let rightEnd = right.length;
  while (leftEnd > start && rightEnd > start && left[leftEnd - 1] === right[rightEnd - 1]) {
    leftEnd--;
    rightEnd--;
  }
  const a = left.slice(start, leftEnd);
  const b = right.slice(start, rightEnd);
  const work = a.length * b.length;
  if (work > budget) return undefined;
  const row = new Uint32Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) row[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const previous = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = previous;
    }
  }
  return { score: 1 - row[b.length] / length, work };
}

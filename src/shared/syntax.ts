export interface SyntaxToken {
  start: number;
  end: number;
  color: string;
  fontStyle: number;
}
export interface FileSyntax {
  old: Record<number, SyntaxToken[]>;
  new: Record<number, SyntaxToken[]>;
}

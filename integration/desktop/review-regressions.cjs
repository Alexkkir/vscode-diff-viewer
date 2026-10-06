// Run through @vscode/test-electron in an isolated profile after build:prod.
exports.run = async () => {
  for (const name of [
    "external-rewrite",
    "syntax-colors",
    "context-folding",
    "textmate-fstrings",
    "semantic-colors",
    "refresh-performance",
    "arc-mode",
    "search-and-maximize",
  ]) {
    console.log(`REVIEW START ${name}`);
    await require(`./${name}.cjs`).run();
    console.log(`REVIEW PASS ${name}`);
  }
};

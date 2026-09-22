# Diff Viewer extension for VS Code

[![vs-code-marketplace](https://img.shields.io/badge/VS%20Code-Marketplace-007ACC?logo=visualstudiocode&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=caponetto.vscode-diff-viewer)
[![changelog](https://img.shields.io/badge/Version-History-2EA043)](./CHANGELOG.md)
![vs-code-support](https://img.shields.io/badge/Visual%20Studio%20Code-1.75.0+-blue.svg)
![github-ci](https://github.com/caponetto/vscode-diff-viewer/workflows/CI/badge.svg)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Diff Viewer renders `.diff` and `.patch` files inside VS Code with [diff2html](https://github.com/rtfpessoa/diff2html). It gives patch files a readable custom editor, layout switching, and a lightweight review workflow based on collapsing files as you view them.

## Features ✨

- Render `.diff` and `.patch` files in a custom editor instead of raw unified diff text.
- Switch between line-by-line and side-by-side layouts from the editor title bar.
- Collapse reviewed files and track progress across the current diff document.
- Optionally show a persistent footer scrollbar for wide diffs.
- Reopen a diff with all files collapsed from the Explorer context menu.
- Open referenced files directly from file headers and line numbers when those paths are available in the current workspace or by absolute path.

## Demo 🎬

### Without the extension 📄

<p align="center">
  <img src="documentation/original.png" alt="Original diff file shown as raw text in VS Code" width="700">
</p>

### With the extension ✅

<p align="center">
  <img src="documentation/demo.png" alt="Diff Viewer extension rendering a patch file in VS Code" width="700">
</p>

## Usage 🚀

1. Open a `.diff` or `.patch` file in VS Code.
2. VS Code will open it with the `Diff Viewer` custom editor.
3. Use the editor title bar buttons to switch between line-by-line and side-by-side views.
4. Use the checkbox beside each file header to collapse it after review, or use the title bar actions to expand or collapse all files.

If you prefer a persistent horizontal scrollbar for wide side-by-side diffs, enable `diffviewer.globalScrollbar`. Viewed state is stored per diff document. If a file's diff changes later, the extension expands it again and marks it as changed since the last view. File header actions are only shown for paths the extension can currently resolve.

### Hide the terminal on opening a diff

**DiffViewer: Hide Terminal On Open** (`diffviewer.hideTerminalOnOpen`) is enabled by default to fully hide the bottom panel when Diff Viewer receives focus, including reopening the current diff with `code diff.diff` from a maximized terminal. Terminal sessions keep running. You can open and maximize the terminal again normally; background diff updates do not hide it. You can turn this setting off to keep the panel visible.

### Arc mounts

`DiffViewer: Arc Mode` (`diffviewer.arcMode`) is enabled by default. For a diff stored anywhere inside `arcadia` or a numbered directory such as `5arcadia`, root-relative filenames are resolved inside that containing mount. For example, `/home/me/5arcadia/ml/project/review/diff.diff` links `ml/project/demo.py` to `/home/me/5arcadia/ml/project/demo.py`. Remote URI schemes and hosts are preserved.

The filename in each available file header is a link (mouse click or Enter); revision labels such as `(working tree)` are removed when locating its source. A missing file is not substituted from another Arcadia. If the diff is outside an Arcadia directory, normal workspace path resolution applies. Turning Arc mode off restores normal workspace path resolution everywhere.

### Large diffs and refresh

External file changes refresh the existing view without a Loading overlay. Where remote filesystem notifications are unavailable, visible diff editors check file metadata every 250 ms; a full content check every two seconds covers providers with unchanged/coarse timestamps. Unsaved editor changes take priority over disk content.

Native lexical colors appear with the diff. Language-server colors arrive separately without rebuilding the view or changing expanded context. Folded context retains its full text and tokenization state; its DOM receives syntax colors when revealed, including through Find.

### Find in a diff

Press `Ctrl+F` (`Cmd+F` on macOS) or use the search button in the editor title bar. Search highlights literal matches in visible code and file names, including text split across syntax-highlight spans. Use `Enter` / `Shift+Enter` for the next / previous match, `Aa` to match case, and `Escape` to close. Expand collapsed files to include their code in the search.

## Commands ⌘

- `Show diff line by line`
- `Show diff side by side`
- `Expand all files`
- `Collapse all files`
- `Find in diff`
- `Show raw file`
- `Open diff collapsed (all viewed)` from the Explorer context menu on `.diff` and `.patch` files

## Settings ⚙️

| Setting                                      | Default        | Description                                                  |
| -------------------------------------------- | -------------- | ------------------------------------------------------------ |
| `diffviewer.arcMode`                         | `true`         | Resolve Arc links relative to the diff’s containing Arcadia. |
| `diffviewer.colorScheme`                     | `auto`         | Renderer theme used in the webview.                          |
| `diffviewer.outputFormat`                    | `line-by-line` | Layout used to render the diff.                              |
| `diffviewer.globalScrollbar`                 | `false`        | Show a persistent footer scrollbar for wide diffs.           |
| `diffviewer.drawFileList`                    | `true`         | Show the file summary list above the diff.                   |
| `diffviewer.matching`                        | `none`         | Inline matching mode: `none`, `words`, or `lines`.           |
| `diffviewer.matchWordsThreshold`             | `0.25`         | Similarity threshold used for `words` matching.              |
| `diffviewer.matchingMaxComparisons`          | `2500`         | Upper bound for line matching work inside a changed block.   |
| `diffviewer.maxLineSizeInBlockForComparison` | `200`          | Maximum line size considered for block comparisons.          |
| `diffviewer.maxLineLengthHighlight`          | `10000`        | Maximum line size eligible for inline highlight.             |
| `diffviewer.renderNothingWhenEmpty`          | `false`        | Skip rendering files with no visible changes.                |

## Limitations 📌

- The custom editor only activates for files with `.diff` or `.patch` extensions.
- The extension renders patch files; it does not generate diffs itself.
- Opening files from the rendered diff depends on the paths present in the patch and whether those paths are accessible from the current environment.

## Contribute 🤝

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the local setup, supported Node.js version, verification commands, and development workflow.

## License 📄

Released under the MIT License. See [LICENSE](LICENSE).

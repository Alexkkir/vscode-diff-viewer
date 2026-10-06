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
4. Use **Expand all** in the footer beside **Syntax highlighting** to expand every file; uncheck it to collapse them. The checkbox shows a mixed state when only some files are open. Expanding is remembered for this diff when its content refreshes, including large diffs opened collapsed. You can also use the title bar actions or the checkbox beside each file header.

If you prefer a persistent horizontal scrollbar for wide side-by-side diffs, enable `diffviewer.globalScrollbar`. Viewed state is stored per diff document. If a file's diff changes later, the extension expands it again and marks it as changed since the last view. File header actions are only shown for paths the extension can currently resolve.

### Hide the terminal on opening a diff

**DiffViewer: Hide Terminal On Open** (`diffviewer.hideTerminalOnOpen`) is enabled by default to fully hide the bottom panel when Diff Viewer receives focus, including reopening the current diff with `code diff.diff` from a maximized terminal. Terminal sessions keep running. You can open and maximize the terminal again normally; background diff updates do not hide it. You can turn this setting off to keep the panel visible.

### Arc mounts

`DiffViewer: Arc Mode` (`diffviewer.arcMode`) is enabled by default. For a diff stored anywhere inside `arcadia` or a numbered directory such as `5arcadia`, root-relative filenames are resolved inside that containing mount. For example, `/home/me/5arcadia/ml/project/review/diff.diff` links `ml/project/demo.py` to `/home/me/5arcadia/ml/project/demo.py`. Remote URI schemes and hosts are preserved.

File names can be selected and copied without leaving the diff. Use **Ctrl/Cmd+click**, **Enter**, or **Open file** to open an available source file. **Copy path** copies the displayed path; the header's context menu also offers **Copy file name** and **Copy file path**. Revision labels such as `(working tree)` are removed when locating its source. A missing file is not substituted from another Arcadia. If the diff is outside an Arcadia directory, normal workspace path resolution applies. Turning Arc mode off restores normal workspace path resolution everywhere.

### Patch alignment and end-of-file changes

Related changed lines are matched in order as a whole when `diffviewer.matching` is `lines` or `words`, so a moved comment or URL does not displace an otherwise matching decorator and class. Within each available hunk, exact context is realigned to prefer the first coherent copy of repeated code. Blank separators are preserved but do not drive the choice between repeated code blocks. This avoids showing a surviving constructor as deleted just because the patch matched it to a later removed class. Work is bounded; missing context is never fetched or invented, and the original patch file remains unchanged.

An established code match can keep nearby rewritten lines together when they retain compatible indentation and shared identifiers. For example, a rewritten condition stays beside its corresponding early return instead of gaining a separate empty row on each side. This does not use comments or literals as anchors or force unrelated blocks to match.

Equal-sized replacement gaps can also compare statements with the same role and indentation, including fully renamed assignments, calls and conditions. Existing ordered anchors remain fixed. Combined merge patches have more than two versions and open as their original text with an explanation instead of being reduced to an inaccurate two-column view.

Python lines with unchanged code stay paired when a trailing comment is added or removed. A multiline `from ... import (...)` rewritten as one line aligns with its original import header. Quoted hashes remain part of strings; ambiguous f-strings and multiline strings retain full-text matching. Fixed line-number columns use an opaque background so changed code cannot show through them during horizontal scrolling.

A missing final newline is shown as `\ No newline at end of file` beside the affected old/new source line. Arc revision labels are excluded from displayed filenames, preventing ordinary edits from appearing as renames.

### Large diffs and refresh

When the diff file changes, the old preview is hidden behind **Updating diff…** until its replacement is ready. Stale results cannot revive the old view. Switching focus without a file change does not hide or reload it. Where remote filesystem notifications are unavailable, visible diff editors check file metadata every 250 ms; a full content check every two seconds covers providers with unchanged/coarse timestamps. Unsaved editor changes take priority over disk content.

Refresh and theme/layout changes preserve per-file horizontal offsets and the visible source-line anchor. Manually opened files in a large diff remain open on refresh. Native syntax enrichment preserves the selected source text so a delayed language-server response does not interrupt copying.

Large diffs create lightweight file headers first, with bodies materialized only when opened. Their native syntax and source lookup are requested for opened files instead of delaying the initial preview. Expand all works in batches with browser frames between them; global scrollbar measurements are also scheduled cooperatively. Offscreen bodies avoid unnecessary layout/paint work. A very large individual file can still take time to open.

Native and language-server colors update existing rows without rebuilding the view or changing expanded context. Folded context within an opened file retains its full text and tokenization state; its DOM receives syntax colors when revealed, including through Find.

Literal parsed filenames are used unchanged for navigation and syntax sources, including names containing spaces or text resembling revision labels. Carriage-return bytes are retained in source cells. Changed groups containing CR omit intraline change spans because the upstream highlighter does not safely separate their old/new text; syntax colors and whole-line diff colors remain available.

### Find in a diff

Press `Ctrl+F` (`Cmd+F` on macOS) or use the search button in the editor title bar. Search highlights literal matches in visible code and file names, including text split across syntax-highlight spans. Use `Enter` / `Shift+Enter` for the next / previous match, `Aa` to match case, and `Escape` to close. Expand collapsed files to include their code in the search.

The read-only diff context menu offers copying without Cut/Paste. Cut/Paste remain available in the editable Find field. Copying selected text uses the selection captured before the native context menu takes focus.

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

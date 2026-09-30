This release makes CodeSuite work better with Quarto notebooks and brings automatic R plot capture.

## What's New

- Quarto-style `{r}`, `{python}`, and `{r, echo=FALSE}` fences now highlight and run like `r` and `python` in Live Preview, Reading view, Run All, and Jupyter export. Attributes inside the braces are left for Quarto ([#70](https://github.com/felixleopold/obsidian-code-suite/issues/70)).
- A leading `#| eval: false` cell option makes a block static, and `#| eval: true` makes it runnable. A `static` attribute on the fence line still takes precedence.
- R plots appear below the block automatically, with no code changes needed. This covers base graphics, grid, and ggplot2, and `dev.new(width=, height=)` sizes are respected. R no longer leaves an `Rplots.pdf` file behind.
- Every runtime receives a `CODESUITE_OUTPUT_DIR` environment variable. Writing `fig_N.png` there shows the figure in the output panel.
- New **Rscript path** setting under **Languages → Interpreters**, for systems where R is not on PATH (R's Windows installer does not add itself).
- A **Buy me a coffee** link in the settings and plugin listing for anyone who wants to support development.

## Bug Fixes

- Fix accented, CJK, and emoji text in MATLAB sessions on Windows by running the MATLAB worker in Python UTF-8 mode ([#74](https://github.com/felixleopold/obsidian-code-suite/pull/74)). Thanks to @RarityBrown.
- Standalone code-file views now show figures that were written without an output marker.

## Upgrade Notes

- No settings changes or manual migration are required. Existing ```` ```r ```` and ```` ```python ```` blocks behave as before.
- Other Quarto cell options (`echo`, `output`, `fig-width`, …) are treated as ordinary comments for now.

See [PR #76](https://github.com/felixleopold/obsidian-code-suite/pull/76), [PR #74](https://github.com/felixleopold/obsidian-code-suite/pull/74), and [PR #73](https://github.com/felixleopold/obsidian-code-suite/pull/73).

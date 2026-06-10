The notebook release — interactive Plotly widgets, Jupyter import/export, styled HTML/PDF export with outputs, and live HTML preview for `html` blocks.

## What's New

- **Interactive Plotly plots** ([#12](https://github.com/felixleopold/obsidian-code-suite/issues/12)) — `fig.show()` now renders a fully interactive widget (zoom, pan, hover, legend toggles) instead of a static image. Click any plot or image to open it full screen; hover an image for copy/download buttons. New settings: **Interactive plots** (on by default) and **Embed Plotly.js offline**.
- **Matplotlib style setting** — apply a built-in style name (e.g. `dark_background`, `seaborn-v0_8-darkgrid`) or a `.mplstyle` file to every Matplotlib plot.
- **Jupyter notebook import/export** ([#5](https://github.com/felixleopold/obsidian-code-suite/issues/5)) — **Import Jupyter notebook (.ipynb)…** converts a notebook into a new note (code cells become fenced blocks, markdown cells become prose; imports unrun). **Export note to Jupyter notebook (.ipynb)** converts the active note back, with blocks in the note's dominant executable language becoming code cells.
- **HTML & PDF export with outputs** ([#5](https://github.com/felixleopold/obsidian-code-suite/issues/5)) — export the rendered note, including executed code outputs, plots, and your Shiki theme, to a self-contained HTML file or a PDF (Electron print engine). A per-export dialog offers content width, an optional title heading, keep-code-blocks-together, and a single-long-page mode; choices are remembered.
- **HTML live preview** — `html` code blocks (and `![[file.html]]` embeds) can render as live HTML in a sandboxed iframe with a Preview/Code header toggle. Full documents with `<style>`/`<script>` work; bare fragments inherit your Obsidian theme. Enable globally with the **Render HTML blocks** setting, or per block with a `preview`/`source` fence flag (`![[page.html|preview]]` for embeds).
- **Outputs survive scrolling** — executed block outputs are snapshotted in memory, so Obsidian's reading-view virtualization no longer wipes an output when its block scrolls far off screen, and exports capture every run output.

## Bug Fixes

- Run All no longer gives up on long-running blocks at 2 minutes — its safety timeout now follows the configured execution timeout.
- Output panels restored from a snapshot have working Clear and Copy buttons.
- Internal cleanup: stale html-preview frame references are garbage-collected, and obsolete lint suppressions were removed.

## Upgrade Notes

- No breaking changes. All new behaviour is opt-in or on-by-default with the previous look preserved: Plotly interactivity can be turned off (static PNGs need the `kaleido` package, as before), and HTML preview is off unless enabled in settings or per block.
- The default **Matplotlib style** is `dark_background`; clear the setting if you prefer Matplotlib's stock look.

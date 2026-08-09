This release adds native MATLAB Engine execution with persistent per-note workspaces, inline figures, cancellation, and managed Engine lifecycles.

## What's New

- **MATLAB Engine execution** — run `matlab` fences through the official MATLAB Engine for Python, with an isolated persistent base workspace for each note ([#51](https://github.com/felixleopold/obsidian-code-suite/pull/51)).
- **Figures and cancellation** — MATLAB figures render inline through Code Suite's existing output pipeline, and long-running code supports native interruption from the Stop button.
- **Managed Engine lifecycle** — startup and restart status is visible, inactive Engines close after a configurable timeout, and workspace resets are disclosed instead of happening silently.
- **Efficient warm runs** — repeated MATLAB fences reuse the Engine and figure helper, substantially reducing per-run overhead after startup.

## Bug Fixes

- **Embedded variable references use the correct note** — inline `$var` references are now scoped to their source note, so references inside embeds resolve against the embedded note rather than the host note.

## Upgrade Notes

- Existing installations are unchanged unless MATLAB fences are used.
- To enable MATLAB execution, install a MATLAB Engine package compatible with your MATLAB release and select that Python interpreter under Settings → Code Suite → Languages.

This patch restores HTML and PDF note export on Obsidian 1.13.

## Bug Fixes

- **PDF and HTML export works without MathJax**: Code Suite now flushes MathJax styles only when the rendered note actually contains math. Notes without math no longer stop silently after the export options dialog.
- **Visible export failures**: errors while building the standalone document now appear in an Obsidian notice and the developer console, instead of leaving the command apparently unresponsive.

No manual steps are required.

See [PR #66](https://github.com/felixleopold/obsidian-code-suite/pull/66).

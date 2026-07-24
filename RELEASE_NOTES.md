This release lets you choose which fenced-code languages CodeSuite leaves untouched, so Obsidian or another plugin can render them.

## What's New

- **Configurable code block passthrough languages** — add one fenced-code language per line under Settings → CodeSuite → Languages to let Obsidian or another plugin render those blocks in Live Preview and reading view ([#50](https://github.com/felixleopold/obsidian-code-suite/pull/50)).
- **Better plugin compatibility by default** — `base`, `d2`, and `vid` now pass through for compatibility with Obsidian Bases, D2, and the Thumbnails plugin; built-in `mermaid`, `dataview`, `dataviewjs`, and `query` passthrough remains unchanged.

## Upgrade Notes

- No action needed. Remove a default entry from the new setting if you want CodeSuite to handle that language instead.

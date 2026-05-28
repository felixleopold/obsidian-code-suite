This release fixes one remaining skip-badge alignment bug when notes include a `vars` block.

## What's New

- Skip badges now stay attached to the correct executable block even when a note also contains a `vars` block.

## Bug Fixes

- Exclude `vars` blocks from the live skip-badge indexing pass so badges line up with the same executable block order used by Run All.
- Mark only inline executable code blocks as source-aligned skip targets, preventing helper blocks from shifting badge placement.

## Upgrade Notes

- No breaking changes. Reload Obsidian or toggle the plugin after updating.

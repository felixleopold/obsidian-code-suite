This release replaces the clunky preview-rerender skip badge fix with a simpler render-time solution that behaves like normal code block language updates.

## What's New

- Skip badges now rely on Obsidian's normal markdown post-processing during reading-mode render, matching how language changes appear without forcing a preview rerender (#15).

## Bug Fixes

- Removed the forced `previewMode.rerender(true)` call on layout changes, which could make reading mode jump or feel unstable.
- Keep the lightweight save/edit DOM sync for already-rendered views without rebuilding the markdown preview.
- Keep the corrected fence-attribute parser so initial reading-mode renders pick up `skip`, `collapsed`, and `expanded` attributes reliably (#15).

## Upgrade Notes

- No breaking changes. Reload Obsidian or toggle the plugin after updating to remove the old layout-change rerender listener.

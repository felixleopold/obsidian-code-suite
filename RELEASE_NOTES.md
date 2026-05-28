This release fixes macOS command lookup and finishes the skip-state refresh work so code block headers stay accurate across edits, saves, and reading-mode switches.

## What's New

- Skip badges now refresh after edit-to-reading-mode transitions, so preview headers reflect the current `skip` state immediately (#15).
- Run All now reads the live in-memory note content, so unsaved `skip` changes are honored without reopening the note (#15).

## Bug Fixes

- Prepend common Homebrew paths on macOS so `brew`, `node`, `python`, and similar tools work from Obsidian-launched shells.
- Re-sync skip badges on saves, debounced editor changes, and preview layout rebuilds to eliminate stale header state (#15).
- Fix fenced-block skip indexing so already-running blocks no longer shift later skip states during Run All (#15).
- Parse fence attributes from the current rendered section so preview-mode `skip` badges are reliable on initial render (#15).
- Color stderr orange by default and only switch to red when the process exits with a non-zero status.

## Upgrade Notes

- No breaking changes. Reload Obsidian or toggle the plugin after updating to activate the new preview-sync listeners.

This release fixes inline code styling in pop-out windows.

## What's New

- No new features in this patch release.

## Bug Fixes

- Inline code blocks in pop-out (dedicated) windows now get their background color; before, they kept syntax highlighting but lost the background. Theme colors and the wide-block and soft-wrap settings now apply to every open workspace window, not just the main one (#103, thanks @jsvk).
- Pop-out window documents are now released when the window closes.

## Upgrade Notes

- No manual migration is required. Existing settings are preserved.
- The minimum supported Obsidian version remains 1.6.6.

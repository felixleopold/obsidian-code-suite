Soft-wrap support for reading view, hideable clear-session button, and extra blank line fix.

## What's New

- **Soft-wrap long lines** (Settings → Appearance): code blocks in reading view now wrap long lines instead of showing a horizontal scrollbar, matching the editor's behaviour. On by default.
- **Hideable clear-session button** (Settings → Code execution): the "Clear execution session" button in the tab bar can now be turned off to declutter the header. The command palette entry is always available. The button is never shown on mobile.

## Bug Fixes

- Removed the extra blank line that appeared at the bottom of every code block in reading view. Every block was rendering one line taller than its actual content.

## Upgrade Notes

- Soft-wrap is on by default. If you prefer horizontal scrolling, disable it under Settings → Appearance → Soft-wrap long lines.
- The clear-session button now only appears on desktop (it was always a no-op on mobile). No action needed.

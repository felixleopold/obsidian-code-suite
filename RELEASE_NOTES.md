A cleaner, tab-organized settings panel — every setting regrouped into five navigable sections.

## What's New

- **Tabbed settings** — the CodeSuite settings tab is now split into five sections — **Appearance**, **Execution**, **Languages**, **Files**, and **Advanced** — with a tab bar at the top instead of one long scroll ([#31](https://github.com/felixleopold/obsidian-code-suite/issues/31)).
- **Keyboard-navigable** — switch tabs with the arrow keys (and Home/End), with the full ARIA tabs pattern for screen readers.
- **Built to Obsidian's settings style guide** — sentence-case headings, no redundant section labels, and a tab bar themed entirely with Obsidian's CSS variables so it matches every theme and wraps on mobile.
- **"Collapse code blocks by default" moved to Appearance**, where it belongs — it controls inline code blocks, not embedded files.

## Upgrade Notes

- No action needed. Every setting keeps its current value and meaning — only the layout changed.
- If a setting is hard to find, check its new tab: themes and code-block display → **Appearance**; run options, working directory, environment variables, and plots → **Execution**; interpreter paths and shell/PHP options → **Languages**; embedded and vault code files → **Files**; experimental features and baked-output sharing → **Advanced**.

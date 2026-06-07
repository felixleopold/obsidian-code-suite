Full code-block chrome in Live Preview — header, Run/Copy, live output, line numbers, collapse, and file embeds now render in the editor, not just Reading view.

## What's New

- **Full Live Preview chrome** — fenced code blocks in Live Preview now render the same header, Run/Copy buttons, Shiki-highlighted body, line numbers, and collapse toggle as Reading view. No more plain, unstyled blocks in the editor.
- **Live Preview file embeds** — `![[file.py]]` embeds on their own line render the full `ocode-wrapper` chrome (with filename link and Run button) in Live Preview, matching Reading view.
- **Edit-on-click reveal** — clicking the code body moves the cursor into the block and reveals its raw source for editing. Moving the cursor out re-renders the chrome instantly.
- **Streaming output survives cursor movement** — a per-block DOM cache returns the *same* wrapper node across cursor in/out cycles, so running output and active processes are never interrupted by moving the cursor.
- **Gutter continuity during reveal** — when line numbers are enabled, a CSS counter gutter mirrors the chrome numbering on the raw HyperMD lines visible while a block is being edited, eliminating the gutter-flash on cursor entry.

## Bug Fixes

- Suppressed Obsidian's native `code-block-flair` widget (the language label + copy button injected at the top-right of every fence in the editor) — it was flashing in the corner the instant the cursor entered a block and our chrome widget was dropped.
- `Run All` and skip-state sync now scope to `.markdown-reading-view` so Live Preview block widgets (which have their own Run buttons and build-time skip state) are never double-counted.
- Line numbers toggle in Settings now applies `ocode-lp-lnum` to `document.body` immediately, without requiring a plugin reload.

## Upgrade Notes

- No settings migration required. The Live Preview chrome uses the same settings as Reading view (line numbers, collapse, execution, theme). Existing notes open and render without any user action.

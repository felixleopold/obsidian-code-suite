This patch fixes two live-formatting regressions introduced in CodeSuite 1.20.0.

## Bug Fixes

- **Unified inline code boxes**: Source mode and Live Preview now apply the enhanced background, border, and spacing only to the code content. Opening and closing backticks remain outside the box instead of appearing as separate boxes.
- **Immediate static updates**: changing fence options such as `static` now refreshes Reading View code chrome when switching from Source mode or in an open reading pane. The Run button disappears or reappears without closing and reopening the note.

## Upgrade Notes

- No manual steps are required.
- Static blocks retain syntax highlighting, line numbers, Copy, and collapse controls. They remove Run controls and Run All participation.

See [PR #65](https://github.com/felixleopold/obsidian-code-suite/pull/65).

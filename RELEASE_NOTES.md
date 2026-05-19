This patch release tightens up the new code-file view without changing its workflow. Embedded/code-file headers stay clickable for collapse, alignment is restored, and the editor CSS now passes the previous release's lint warnings without relying on `!important` overrides.

## What's New

- No new user-facing features in this release.

## Bug Fixes

- Restored left alignment for collapsible code-file and embedded-file blocks by removing the extra outer gutter wrapper while keeping header-click collapse behavior.
- Removed the code-file editor's `!important` CSS overrides by scoping selectors more precisely, which resolves the reported CSS lint warnings without changing editor appearance.
- Cleaned up an unused empty CSS ruleset in the output pill styles.

## Upgrade Notes

- No breaking changes. Existing settings and note content continue to work as-is.

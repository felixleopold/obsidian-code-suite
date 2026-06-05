A code-quality release that clears all outstanding Obsidian plugin reviewer warnings with no change to behavior.

## What's New

- Cleared every source and CSS warning reported by the Obsidian plugin reviewer: timer and animation-frame calls now use `window` (instead of the `activeWindow.*` and bare-global forms), Node's `require` is reached through `window` instead of `globalThis`, and intentionally-ignored errors use optional `catch` bindings rather than unused `_e`/`_err` variables.
- Reworked the soft-wrap hang-indent so it no longer relies on the `:has()` selector (broad style invalidation) or `text-indent` (only partially supported in older Obsidian). Wrapped code lines still align exactly with the code column via a renderer marker class and an absolutely-positioned line number.

## Bug Fixes

- None — this release is behavior-preserving cleanup.

## Upgrade Notes

- No action required. No settings, data, or rendering behavior changes.

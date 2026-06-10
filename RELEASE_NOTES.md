Maintenance release — lint compliance fixes for the Obsidian plugin review.

## Bug Fixes

- **Lint compliance** — replaced three `obsidianmd/ui/sentence-case` rule disables with an `ignoreRegex` allowlist entry for the "Jupyter" and "A4" proper nouns, since disabling that rule is not permitted by the Obsidian reviewer.
- **Dropped a CSS `!important`** — the native Live Preview code-block flair is now suppressed by raising selector specificity instead of `!important`.

## Upgrade Notes

- No behavior changes. Internal lint cleanup only.

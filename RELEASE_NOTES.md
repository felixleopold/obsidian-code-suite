Lint-compliance maintenance release — no functional or user-facing changes.

## Maintenance

- **Removed a CSS `!important`** — the rule that hides the unsupported `code_vars:` / `template_context:` property rows now wins by selector specificity (scoped under `.metadata-container`) instead of `!important`.
- **Cleaned up the README** — removed leftover demo-GIF planning comments (`<!-- PLAN: … -->`) and the commented-out image placeholders that pointed at GIFs that were never produced.

## Upgrade Notes

- No action needed. Behavior is identical to 1.14.1.

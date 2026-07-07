Maintenance release: clears the remaining Obsidian plugin-reviewer warnings. No functional changes.

## Bug Fixes

- **Cleared the remaining `@typescript-eslint/no-unnecessary-type-assertion` warnings** from the plugin review ([#43](https://github.com/felixleopold/obsidian-code-suite/issues/43)). Four `window.setTimeout(...) as unknown as number` casts and a Shiki `loadTheme` cast were genuinely redundant and removed; the file-picker `File & { path }` cast became a type annotation; and the two `frontmatter as Record<string, unknown>` casts now route through a small `toRecord()` helper whose `unknown → Record` narrowing is valid in every type environment. Rounds out the type-safety cleanup started in 1.16.2.

## Upgrade Notes

- No action needed — internal type-safety changes only, no effect on behavior.

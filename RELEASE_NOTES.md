Makes the CodeSuite variables panel reliable and turns it on by default, so your `code_vars:` and `template_context:` values are visible in reading view out of the box.

## What's New

- **CodeSuite variables panel is on by default** — the read-only rendering of `code_vars:` / `template_context:` now shows automatically just below the Properties widget in reading view, with no setting to enable. Turn off **CodeSuite variables panel** in settings to just suppress Obsidian's "unsupported property type" warning and render nothing ([#34](https://github.com/felixleopold/obsidian-code-suite/issues/34)).

## Bug Fixes

- **The variables panel no longer flickers or vanishes on scroll** — it is now anchored inside the note header (next to Properties), the chrome Obsidian keeps pinned, instead of in the scrolled content Obsidian virtualizes and rebuilds. It stays put across scrolling and re-renders, and refreshes whenever the frontmatter changes.

## Upgrade Notes

- If you previously turned the panel off, that choice is preserved. Vaults that never touched the setting now show the panel by default.
- The "unsupported property type" warning for these nested fields stays hidden either way; the setting only controls whether the value list is also shown.

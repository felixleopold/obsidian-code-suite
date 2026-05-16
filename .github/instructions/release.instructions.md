---
description: "Use when: preparing a release, bumping the version, tagging, publishing, writing release notes, creating a GitHub release, fixing dependency conflicts, or updating the community plugin submission for the CodeSuite Obsidian plugin."
---

# CodeSuite Release Guidelines

## Pre-Release Checklist

Before every release:

1. **Sync versions** — `version` in `package.json` and `manifest.json` must match exactly.
2. **Dependencies** — If deps changed, run `npm install` to update the lock file and `npm audit fix` to clear vulnerabilities.
3. **Build** — `npm run build` must succeed with no errors.
4. **Commit** — Commit all changed files before tagging.
5. **Tag and push** — Check `.github/workflows/release.yml` for the current trigger format and follow it.

Always review `.github/workflows/release.yml` to understand what the CI workflow does before releasing.

## GitHub Release Notes

After the tag is pushed and CI completes, create a GitHub release with proper release notes.

**Create the release via CLI:**
```bash
gh release create <version> --title "<version>" --notes-file RELEASE_NOTES.md
```
Or use `--generate-notes` as a starting point and edit before publishing:
```bash
gh release edit <version> --notes "..."
```

**Release notes must include:**

1. **Summary** — one or two sentences describing the theme of the release (e.g. "Adds Python execution support and improves theme loading performance").
2. **What's New** — bullet list of new features, with short descriptions.
3. **Bug Fixes** — bullet list of bugs fixed, referencing issue numbers where applicable (`#42`).
4. **Breaking Changes** — clearly marked section (omit if none). Describe what changed and how users should update.
5. **Upgrade Notes** — any manual steps required (e.g. re-enable plugin, clear cache, update settings).

**Formatting conventions:**
- Use `## What's New`, `## Bug Fixes`, `## Breaking Changes`, `## Upgrade Notes` as section headers.
- Reference PRs/issues with `#number` — GitHub auto-links them.
- Keep each bullet to one line. Add detail in a sub-bullet if needed.
- Do not include internal refactors or dependency bumps unless they affect users.

**Example:**
```markdown
This release adds live stdin input for code execution and fixes theme flickering on reload.

## What's New
- Code blocks now accept stdin input during execution (#12)
- Added support for the Catppuccin Mocha bundled theme

## Bug Fixes
- Fixed theme flickering when switching notes quickly (#18)
- Corrected line numbers misalignment for wrapped lines

## Upgrade Notes
- No breaking changes. Existing settings are preserved.
```

## Dependencies

Key rules that don't change:

- `shiki` is the only runtime dependency — keep it in `dependencies`, not `devDependencies`.
- `@codemirror/*`, `@lezer/*`, `obsidian`, `electron`, and Node.js built-ins are all externalized by esbuild — keep them in `devDependencies` only.
- `@codemirror/state` must match the version Obsidian bundles — check current Obsidian peer deps before upgrading.

When upgrading `eslint-plugin-obsidianmd` or any ESLint-related package, verify peer deps first:
```
npm view eslint-plugin-obsidianmd peerDependencies
```

## Community Plugin Submission

Obsidian no longer uses GitHub PRs to `obsidianmd/obsidian-releases` for community plugin submissions. Use the current Obsidian community submission portal instead.

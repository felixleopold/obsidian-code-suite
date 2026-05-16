---
description: "Use when: preparing a release, bumping the version, tagging, publishing, fixing dependency conflicts, or updating the community plugin submission for the CodeSuite Obsidian plugin."
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

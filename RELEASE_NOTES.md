Maintenance release: type-safety cleanup for the Obsidian plugin reviewer. No functional changes.

## Bug Fixes

- **Cleared ~200 `@typescript-eslint/no-unsafe-*` warnings** from the plugin review ([#43](https://github.com/felixleopold/obsidian-code-suite/issues/43)). Node built-ins are reached through Electron's `window.require` bridge; the old `as typeof import("fs")` casts resolved to `any` in any environment without `@types/node` (including the reviewer), which cascaded into unsafe-access warnings across `main.ts`, `executor.ts`, and `settings.ts`. A new `src/node-builtins.ts` provides hand-written, self-contained type definitions for exactly the `fs`/`path`/`os`/`child_process`/`process` surface we use, so the code stays fully typed regardless of `@types/node`.

## Upgrade Notes

- No action needed — this is an internal type-safety change with no effect on behavior.

# Contributing to CodeSuite

Thanks for your interest in contributing! This document covers how to set up a development environment, submit changes, and follow the project's conventions.

## Getting started

**Prerequisites:** Node.js 18+, npm, and a desktop installation of [Obsidian](https://obsidian.md).

```bash
git clone https://github.com/felixleopold/obsidian-code-suite.git
cd obsidian-code-suite
npm install
```

### Development build

```bash
npm run build
```

Output is written to `dist/main.js`. The `install-plugin.sh` script copies the built files directly into your local Obsidian vault — edit the path at the top of the script to match your vault location, then run:

```bash
bash install-plugin.sh
```

After installation, reload Obsidian or toggle the plugin off/on under **Settings → Community plugins**.

## Project structure

| File | Role |
|---|---|
| `src/main.ts` | Plugin entry point — rendering, editor extensions, execution orchestration |
| `src/highlighter.ts` | `Highlighter` class — wraps Shiki, handles theme/language loading |
| `src/executor.ts` | `startExecution()` — spawns child processes, streams I/O, manages cancel/stdin |
| `src/settings.ts` | `CodePluginSettings` interface and `DEFAULT_SETTINGS` |
| `src/settings-tab.ts` | Settings UI (`CodeSettingTab`) |
| `styles.css` | All plugin styles (CSS class prefix: `ocode-`) |
| `esbuild.config.js` | Build config — only `shiki` is bundled; everything else is external |

## Obsidian API conventions

This project enforces [Obsidian plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines) via `eslint-plugin-obsidianmd`. Violations are lint errors. Always use the Obsidian-safe equivalents:

- `activeDocument.*` instead of `document.*`
- `createEl()` / `createDiv()` / `createSpan()` instead of `document.createElement()`
- `activeWindow.setTimeout()` / `activeWindow.clearTimeout()` instead of bare globals
- Never use `innerHTML`, `outerHTML`, or `insertAdjacentHTML` with user-controlled content

## Node.js built-ins in `executor.ts`

`child_process`, `fs`, `os`, and `path` are externalized by esbuild. Load them dynamically at the call site:

```ts
const { spawn } = globalThis.require("child_process") as typeof import("child_process");
```

Never use static top-level imports for these modules.

## Submitting changes

1. **Fork** the repository and create a branch from `main`.
2. Make your changes following the conventions above.
3. Run `npm run build` and confirm it succeeds with no errors.
4. Open a **pull request** with a clear description of what changed and why.

For larger changes or new features, please open an issue first to discuss the approach.

## Reporting bugs

Open a [GitHub issue](https://github.com/felixleopold/obsidian-code-suite/issues) and include:

- Obsidian version
- Plugin version
- Steps to reproduce
- What you expected vs. what happened

## Code style

- TypeScript strict mode — no implicit `any`
- `const` / `let` only, never `var`
- `async`/`await` over raw Promises
- CSS classes must use the `ocode-` prefix

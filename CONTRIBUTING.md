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

---

## How it works (internals)

Understanding the pipeline helps when working on any of the three subsystems.

### Syntax highlighting (reading view)

A Markdown post-processor registered in `main.ts` fires after Obsidian renders a note. It finds every `<pre><code>` block, replaces it with Shiki-highlighted HTML, and wraps it in a styled container with a header bar and action buttons.

### Syntax highlighting (editor)

A CodeMirror 6 `ViewPlugin` in `main.ts` scans the document for code fences and tokenises them with Shiki via the `Highlighter` class in `highlighter.ts`. It applies `Decoration.mark` ranges per token, giving full syntax color in Live Preview and Source mode without leaving the editor.

### Code execution

`executor.ts` exports `startExecution()`, which spawns a child process via Node's `child_process.spawn`. No code is ever sent to a remote server — everything runs locally. stdout and stderr pipe to the output panel in real time. For Python, accumulated session code is prepended to each run. For Bash, an `export` dump of the previous session's environment is sourced before each new block.

### Shared context

The per-note session object lives in a `Map` keyed by the note's file path. It holds the accumulated source (Python) or the last `export` snapshot (Bash). The map is cleared when the note is closed or **Clear Session** is clicked. Nothing is written to disk.

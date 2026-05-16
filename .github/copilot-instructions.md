# CodeSuite — Project Guidelines

## What This Is

**CodeSuite** (`id: code-suite`) is an Obsidian plugin providing VS Code-quality code blocks: Shiki syntax highlighting, code execution with live I/O, embedded file rendering, and custom theme import. Built with esbuild (CommonJS, ES2020) from TypeScript source in `src/`.

## Architecture

| File | Role |
|---|---|
| `src/main.ts` | Plugin entry point. Rendering, editor extensions, markdown post-processors, execution orchestration. |
| `src/highlighter.ts` | `Highlighter` class — wraps Shiki. Theme/language loading, `highlight()`, `tokenize()`. |
| `src/executor.ts` | `startExecution()` — spawns child processes, streams I/O, manages cancel/stdin. |
| `src/settings.ts` | `CodePluginSettings` interface, `DEFAULT_SETTINGS`, `BUNDLED_THEMES`. No side effects. |
| `src/settings-tab.ts` | `CodeSettingTab extends PluginSettingTab` — all settings UI. |
| `styles.css` | All plugin styles. CSS class prefix is `ocode-`. |
| `esbuild.config.js` | Build config. Only `shiki` is bundled; everything else is external. |

## Obsidian API Rules

Enforced by `eslint-plugin-obsidianmd` — violations are lint errors. Always use the Obsidian-safe equivalents:

- `activeDocument.*` instead of `document.*`
- `createEl()` / `createDiv()` / `createSpan()` instead of `document.createElement()`
- `activeWindow.setTimeout()` / `activeWindow.clearTimeout()` instead of the bare globals
- `catch (_e) {}` — never leave catch bindings empty

## Node.js Built-ins in `executor.ts`

`child_process`, `fs`, `os`, `path` are externalized by esbuild. Load them dynamically at the call site — never use static top-level imports:

```ts
const { spawn } = globalThis.require("child_process") as typeof import("child_process");
```

## New Features

Document new features in `README.md`. Follow existing code patterns and Obsidian best practices.

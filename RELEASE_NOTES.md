This release adds per-block formatting and inline code highlighting, and fixes TypeScript execution with custom Node installations.

## What's New

- **Static blocks**: add `static` to a code fence to keep syntax colors and normal styling while removing Run controls and Run All participation. Enable **Static blocks by default** globally and use `static=false` for individual runnable blocks. Static HTML blocks also suppress live previews.
- **Per-block formatting**: use `title="My Script.py"`, `showLineNumbers` / `hideLineNumbers`, and `collapse` to customize individual blocks. Boolean options support explicit values, including `ln=true` / `ln:false` and `fold=true` / `fold:false` aliases. Existing `collapsed` and `expanded` flags still work.
- **Line highlighting**: mark lines with `{1, 5-10}`, `ins={3}`, or `del={7-10}`. Diff blocks automatically color added and deleted lines. Line backgrounds and numbering appear in rendered blocks and editable source.
- **Inline code**: ordinary inline code has configurable stronger styling. Add a language prefix such as `{python} sum(values)` inside backticks for Shiki syntax colors. Reading View hides recognized prefixes; the editor retains them and highlights single-line spans.

See [the formatting examples](https://github.com/felixleopold/obsidian-code-suite/blob/1.20.0/examples/formatting.md) and [PR #62](https://github.com/felixleopold/obsidian-code-suite/pull/62).

## Bug Fixes

- **Custom Node installations**: TypeScript execution locates `npx` and its Node interpreter beside the configured Node path, and process launch failures appear in output ([#61](https://github.com/felixleopold/obsidian-code-suite/pull/61)).

## Upgrade Notes

- No manual migration is required. Blocks remain runnable by default.
- Enhanced inline styling and inline syntax highlighting are enabled by default and can be disabled separately in settings.

Inspired by mProjectsCode's Shiki Highlighter, Expressive Code by Hippo, and Codeblock Customizer.

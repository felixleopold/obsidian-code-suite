Fixes the code-block Copy button so it no longer adds a trailing newline to the clipboard.

## Bug Fixes

- **Copy no longer appends a trailing newline** — clicking **Copy** on a code block now puts the code on the clipboard exactly as displayed, without the extra newline the fence carries. Pasting a single-line command into a terminal no longer auto-executes it, so you can preview or edit it first ([#37](https://github.com/felixleopold/obsidian-code-suite/issues/37)).

## Upgrade Notes

- No action needed. This affects only what the Copy pill writes to the clipboard; Run and execution behavior are unchanged.

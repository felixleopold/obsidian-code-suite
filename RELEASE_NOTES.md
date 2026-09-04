This release adds complete JavaScript notebook context and fixes caret visibility and Live Preview line numbering.

## What's New

- **JavaScript shared context**: JavaScript blocks can consume `vars`, `code_vars:` frontmatter, and values published by other languages ([#54](https://github.com/felixleopold/obsidian-code-suite/issues/54)).
- **JavaScript notebook state**: top-level variables, functions, classes, closures, and JSON-safe values carry across JavaScript blocks, with serializable values published back to other languages.

## Bug Fixes

- **Visible editing caret**: code blocks use the active CodeSuite foreground color for the caret, keeping it visible with Obsidian's Default Light theme ([#58](https://github.com/felixleopold/obsidian-code-suite/issues/58)).
- **Stable Live Preview line numbers**: folded and virtualized code keeps its true source line numbers, including very long blocks ([#59](https://github.com/felixleopold/obsidian-code-suite/issues/59)).

## Upgrade Notes

- No manual steps are required. Existing settings and sessions continue to work.

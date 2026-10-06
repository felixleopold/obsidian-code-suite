This release runs C# code blocks, makes Tab behave like a code editor inside fenced blocks, and makes CodeSuite settings searchable.

## What's New

- C# blocks (`csharp`, `cs`, `c#`) now run as .NET 10 file-based apps through `dotnet run`, with live output and stdin support ([#77](https://github.com/felixleopold/obsidian-code-suite/issues/77)). A new **Dotnet path** setting under **Languages → Interpreters** covers systems where `dotnet` is not on PATH.
- Tab and Shift+Tab indent inside fenced code blocks instead of moving the whole Markdown line ([#71](https://github.com/felixleopold/obsidian-code-suite/issues/71)). Indentation is detected from the block and other blocks in the same language, or can be set to tabs or 2, 4, or 8 spaces. Tab works as before outside code blocks, and Escape followed by Tab still moves focus out of the editor.
- CodeSuite settings now appear in Obsidian's settings search on Obsidian 1.13 and later.

## Bug Fixes

- Inline code in nested list items indented with a tab or four spaces now gets inline code styling ([#75](https://github.com/felixleopold/obsidian-code-suite/pull/75)). Thanks to @jsvk.
- Remove a CSS feature that Obsidian's plugin checks flagged as only partially supported.

## Upgrade Notes

- No manual migration is required. Tab handling in code blocks is on by default; turn off **Tab key in code blocks** to restore Obsidian's usual Tab behaviour.
- C# execution requires the .NET 10 SDK or later. The first run after starting your computer takes a few seconds while the compiler starts.

See [PR #80](https://github.com/felixleopold/obsidian-code-suite/pull/80), [PR #72](https://github.com/felixleopold/obsidian-code-suite/pull/72), [PR #75](https://github.com/felixleopold/obsidian-code-suite/pull/75), and [PR #64](https://github.com/felixleopold/obsidian-code-suite/pull/64).

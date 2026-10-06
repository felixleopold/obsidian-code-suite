This release adds C# execution, code-block indentation, and searchable settings, with fixes for Markdown boundaries, stopping processes, shared variables, and saved outputs.

## What's New

- C# blocks (`csharp`, `cs`, `c#`) run as .NET 10 file-based apps through `dotnet run --file`, with live output and stdin support (#77). A **Dotnet path** setting under **Languages → Interpreters** covers systems where `dotnet` is not on PATH.
- Tab and Shift+Tab indent inside fenced code blocks using detected indentation, or a configured choice of tabs or 2, 4, or 8 spaces (#71). Tab keeps its usual behaviour outside code blocks.
- CodeSuite controls appear in Obsidian's settings search on Obsidian 1.13 and later, including the new Tab and indentation settings.
- Inline code in nested list paragraphs indented with a tab or four spaces receives inline styling (#75). Thanks to @jsvk.

## Bug Fixes

- C# executes the snippet even when the working directory contains a different .NET project.
- Stop, execution timeout, and the output-size limit terminate launcher child processes, preventing a stopped C# application from continuing to produce output.
- Backticks inside indented Markdown code blocks remain literal, including blocks inside lists and after setext headings or thematic breaks.
- Tab handling recognises fenced code in lists, blockquotes, and callouts, preserves their Markdown prefixes, and leaves indented pseudo-fences alone.
- Escape followed by Tab moves focus out of the editor instead of inserting indentation.
- Shared-context replay restores historical cross-language values before replaying dependent blocks, so a later Python block can safely use a value changed by JavaScript.
- Live output replaces the corresponding baked panel while displayed. Clearing live output also clears its cached result and reveals the saved baked output again.
- Removed a CSS feature that Obsidian's plugin checks flagged as only partially supported.

## Upgrade Notes

- No manual migration is required. Existing settings and baked outputs are preserved.
- Tab handling is on by default; turn off **Tab key in code blocks** to restore Obsidian's usual behaviour. Custom hotkeys assigned to Tab or Shift+Tab can take precedence.
- C# execution requires the .NET 10 SDK or later. The first run can take a few seconds while the compiler starts.
- This release includes the features prepared for 1.22.0, which was not published as a GitHub release.

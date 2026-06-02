This release adds the requested PHP, PowerShell, and shell startup execution improvements, and fixes one remaining skip-badge alignment bug when notes include a `vars` block.

## What's New

- PHP snippets that omit `<?php` now run by default; CodeSuite adds the tag only to the temporary execution file.
- PowerShell code blocks and `.ps1` files can run through `pwsh` when PowerShell 7+ is installed.
- Bash and Zsh blocks can run in login mode, and Bash/Zsh/Shell blocks can source one or more configured startup files before execution.
- Skip badges now stay attached to the correct executable block even when a note also contains a `vars` block.

## Bug Fixes

- Exclude `vars` blocks from the live skip-badge indexing pass so badges line up with the same executable block order used by Run All.
- Mark only inline executable code blocks as source-aligned skip targets, preventing helper blocks from shifting badge placement.
- Add a Zsh-native shared-variable snapshotter so Zsh blocks can update inline `$varname` references without using Bash-only `compgen`.

## Upgrade Notes

- No breaking changes. Reload Obsidian or toggle the plugin after updating.
- The PHP opening-tag behavior is enabled by default and can be disabled in Settings → CodeSuite → Environment.

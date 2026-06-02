This release makes shell execution explicit and predictable: you can now pin the exact bash, zsh, and sh binaries, the `sh` fence no longer secretly runs bash, and the line counter is fixed.

## What's New

- New **Bash path**, **Zsh path**, and **Shell (sh) path** settings under Settings → CodeSuite → Environment. Each lets you pin the exact interpreter for that language; leave empty to keep the current PATH-resolved behavior.
- To restore the old `obsidian-execute-code` behavior where `shell` blocks ran under modern bash, set **Shell (sh) path** to `/opt/homebrew/bin/bash` (Apple Silicon) or `/usr/local/bin/bash` (Intel).

## Bug Fixes

- Line-count hint is no longer off by one — a one-line block now reads "1 line" instead of "2 lines", with correct singular/plural wording.

## Breaking Changes

- `sh` code blocks now run **POSIX sh** (`/bin/sh`), matching `shell` blocks. Previously `sh` was aliased to bash. `bash`, `zsh`, and `shell` blocks are unchanged.
- If you have `sh` blocks that rely on bash features (arrays, `[[ ]]`, etc.), either rename the fence to `bash`, or set **Shell (sh) path** to a bash binary.
- A one-time notice explaining this appears after you update; it will not show again.

## Upgrade Notes

- Reload Obsidian or toggle the plugin after updating.
- Pointing **Zsh path** at a non-zsh binary (e.g. bash) will fail — variable tracking emits zsh-specific syntax. Keep each path on its matching shell family.

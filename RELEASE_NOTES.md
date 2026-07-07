Bash, zsh, and sh code blocks now run under WSL on Windows.

## Bug Fixes

- **WSL shells on Windows can now find the script** — the temp file was handed to WSL as a Windows path (`C:\…\code.sh`), which WSL can't resolve (backslashes are mangled and the file lives at `/mnt/c/…` in WSL's filesystem), so blocks failed with `No such file or directory` ([#42](https://github.com/felixleopold/obsidian-code-suite/issues/42)). The path is now translated to its `/mnt/c/…` form before it's passed to WSL bash/zsh/sh.

## What's New

- **WSL path translation** setting (Windows only, under Languages) — *Auto-detect* (default) applies the translation when the shell interpreter looks like WSL; force it *On* for a custom WSL setup, or *Off* if your `bash`/`zsh`/`sh` is Git Bash, Cygwin, or MSYS.

## Upgrade Notes

- No action needed. On WSL the fix applies automatically; the setting is only there if you need to override the detection.

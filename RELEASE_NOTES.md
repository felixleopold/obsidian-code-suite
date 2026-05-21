This release fixes the `skip` tag not being picked up immediately and improves the import-as-alias workflow.

## Bug Fixes
- **Skip tag now works immediately** — `# codesuite:skip` and the fence `skip` attribute are now read from the current file source when Run All is triggered, so you no longer need to close and reopen the note for changes to take effect (#15)
- **Import alias sidebar refresh** — the file explorer now updates as soon as Obsidian indexes the new symlink (uses the vault `create` event instead of a fixed 250 ms timeout), making the file appear instantly after import

## What's New
- **Import alias opens in a new tab** — after a successful *Import code file as alias…*, the file is opened in a new tab rather than replacing the current one

## Upgrade Notes
- No breaking changes. Existing settings are preserved.

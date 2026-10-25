This release fixes code blocks running twice with shared context, and adds commands to run the block at the cursor and move a block into its own file, plus optional saved outputs.

## What's New

- **Run code block at cursor**: a command that runs the fenced block under the cursor, including in Source mode and while editing in Live Preview. Assign it a hotkey in Settings → Hotkeys; there is no default binding. Running it again while the block runs stops it (#96, closes #97, thanks @vellori).
- **Move code block to file…**: a command that writes the block under the cursor to a new code file and replaces it with an `![[file]]` embed. It asks for a file name, never overwrites, and warns before dropping fence options the embed can't keep. One undo restores the block (#100, closes #28).
- **Keep outputs after closing notes** (off by default): saves each block's last output outside the note and shows it again with a "ran … ago" badge when the note reopens. Includes a retention setting (30 days by default) and a command to clear all saved outputs (#93, part of #70).

## Bug Fixes

- With shared execution context on, clicking Run no longer runs the block twice. A re-run used to replay the block's own previous run before running it again, so side effects like appending to a file happened twice (#101, fixes #98).
- In Python and JavaScript, if a silently replayed earlier block fails because it depends on the block you are re-running, the run continues instead of stopping.

## Upgrade Notes

- No manual migration is required. Existing settings are preserved.
- Shared execution context still replays a note's *other* earlier blocks on each run, so their side effects (file writes, network calls) repeat. The setting now says so; turn it off for code with side effects. Persistent sessions are tracked in #102.
- The minimum supported Obsidian version remains 1.6.6.

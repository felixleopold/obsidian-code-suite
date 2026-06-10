Execution and output-panel fixes, plus a cancellable Run All.

## What's New

- **Cancel Run All** — clicking the Run All header button again while a pass is running now stops the current block and ends the pass. The button turns into a stop control while active.

## Bug Fixes

- **Re-running a block after Run All no longer throws** — the shared-context replay used to drop the block's own earlier run, so re-running an early block replayed later blocks first and hit a `NameError` for variables that block defines. The full accumulated session is now replayed in order.
- **No more trailing blank line in output** — the internal variable-snapshot marker printed a spacer newline that surfaced as an empty line after a run.
- **Output-less runs read as "ran fine"** — a successful block with no output now collapses to a slim `Output (none)` header instead of showing an empty output box.

## Upgrade Notes

- No settings or behavior changes beyond the fixes above.

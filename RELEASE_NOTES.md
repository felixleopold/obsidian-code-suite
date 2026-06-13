Clearer code-output handling: no more duplicate copy buttons, and warnings are no longer mislabeled as errors (#29).

## Bug Fixes

- **No more duplicate copy buttons on error output ([#29](https://github.com/felixleopold/obsidian-code-suite/issues/29))** — when a run's only output was on stderr, the *copy output* and *copy error* buttons copied the exact same text. Copy buttons are now split by stream: a neutral **Copy output** appears only when there's stdout, and an orange **Copy stderr** handles stderr — so you never get two buttons copying the same thing.
- **Warnings are no longer shown as errors ([#29](https://github.com/felixleopold/obsidian-code-suite/issues/29))** — stderr used to be repainted red whenever a run's exit code was non-zero, which mislabeled intentional warnings and progress messages as errors (and, on a mixed run, lumped them in with the real error). stderr now stays orange regardless of exit code — it's diagnostics, and a warning can't be reliably told apart from an error within the same stream. Failure is signaled by a red **`Output (exit: N)`** badge in the header instead.

## Upgrade Notes

- No settings changes. The output panel may now show two copy buttons (**Copy output** and **Copy stderr**) where a failed run previously showed two identical ones — each now copies a distinct stream.

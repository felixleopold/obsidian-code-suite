Quality and reliability release — multi-language Jupyter round-trips, cancellation polish, skip-badge fixes, and fence-attribute isolation.

## What's New

- **Multi-language Jupyter notebook export** — every executable code block now becomes a code cell (not just blocks in the note's dominant language). Blocks in a non-dominant language (e.g. a JavaScript block in a Python notebook) carry a `metadata.vscode.languageId` tag so VS Code renders each cell in the correct language and round-trips back to the right fence on re-import. Notebook import similarly respects per-cell language metadata on cells that carry it.

## Bug Fixes

- **Stopped runs are labelled cleanly** — clicking Stop shows *Output (stopped)* when there is partial output, or removes the panel entirely if nothing was produced. Stopped runs are not persisted to the shared session. Run All now also halts when a block is manually stopped.
- **Queued cancel is immediate** — cancelling a *Queued* block reverts the pill right away instead of waiting for the prior run to finish.
- **Skip tags show up correctly** — skip-badge sync now matches blocks by code hash instead of source position, so blocks that are virtualized off screen no longer shift the skip state onto the wrong blocks.
- **Fence attributes no longer bleed across blocks** — a one-line guard now slices `sectionInfo.text` to the current section, fixing a bug where blocks in Reading view could inherit the `skip`, `preview`, or other flags of the first fence in the note.
- **Output panels cleared properly** — clearing a note's session now also removes live output panels already on screen and reverts any in-progress Run pills, not just the in-memory snapshot cache.
- **Matplotlib style default corrected** — the default is now blank (Matplotlib's stock look) as documented. The 1.8.0 build shipped with `dark_background` as the default by mistake.

## Upgrade Notes

- No breaking changes except the Matplotlib style correction: if you installed 1.8.0 and your plots look different after upgrading, the `dark_background` style that was incorrectly defaulted has been cleared. To restore it, set **Settings → Python → Matplotlib style** to `dark_background`.

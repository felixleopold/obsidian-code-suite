Adds opt-in "baked outputs" for sharing notes with code output in contexts where the recipient can't run code.

## What's New

- **Bake outputs into note** — new opt-in feature (Settings → CodeSuite → Sharing) that serializes code block output into the note markdown. Run your code, then use the **Bake code outputs into note (for sharing)** command to insert a `codesuite-output` block after each source block. The baked output renders as a styled panel in reading view and live preview; other Markdown renderers (including the NoteColab web viewer) fall back to a labelled code block.
- **Clear baked outputs from note** — companion command that removes all baked blocks and their associated image files. Fully reversible.
- **No note bloat** — figures (e.g. matplotlib plots) are written as image files to a configurable vault folder (`CodeSuite/baked-outputs` by default) and referenced by name, not inlined. An *Inline images instead of files* toggle is available if you prefer a fully self-contained note.
- **Stale detection** — the baked panel shows a `stale` badge when the code above it has changed since the output was baked, prompting a re-run and re-bake.
- **Orphan sweep** — re-baking after edits writes fresh image files and automatically deletes the old ones.

## Bug Fixes

- Fixed two missing `cancelled: false` fields in early-return `ExecutionResult` objects in the mobile and missing-runtime paths.

## Upgrade Notes

- Baked outputs is off by default and changes nothing for existing users. Enable it under **Settings → CodeSuite → Sharing (baked outputs)** only if you share notes and want recipients to see your code output.

This patch release makes Code Suite follow Obsidian's code font size and adds an optional custom pixel size.

## What's New

- **Native code sizing by default** — rendered blocks, Live Preview and Source Mode lines, execution output, and standalone code-file editors now use Obsidian's semantic `--code-size` and react immediately to Appearance and theme changes ([#52](https://github.com/felixleopold/obsidian-code-suite/issues/52)).
- **Optional custom pixel size** — disable “Follow Obsidian code size” under Settings → Code Suite → Appearance to reveal an 8–24px slider. Changes apply immediately, including in pop-out windows.

## Upgrade Notes

- No action needed. Existing installations follow Obsidian's code size by default.

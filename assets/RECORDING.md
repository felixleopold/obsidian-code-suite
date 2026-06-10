# Demo GIF / Video Recording Notes

Shot list for the README + store listing. Record each scene, then drop the file into `assets/` with the exact filename below — the README already has matching `<!-- ![...](assets/...) -->` stubs to uncomment.

## Global setup (do once before recording)

- **Vault:** a clean scratch vault, sidebar collapsed, no other plugins' UI visible.
- **Window size:** record at **1200–1400px wide**. Crop tight to the note pane — no OS chrome, no clock, no dock.
- **Theme:** dark vault + a high-contrast Shiki theme (Tokyo Night or Catppuccin Mocha). Consistent across all clips so the set looks like one product.
- **Font size:** bump editor font ~1 step so text is legible when scaled down in the README.
- **Cursor:** slow, deliberate movements. Pause ~0.5s before each click so viewers track what happens.
- **Code:** real, short, meaningful snippets (see each scene). No `foo`/`lorem`.
- **Theme-cycle demo command** (for the hero clip): a hidden command cycles a curated theme list on a hotkey, so you never open settings on camera. Enable per vault: add `"demoThemeCycle": true` to `.obsidian/plugins/code-suite/data.json` (Obsidian closed), reopen, then bind **"Cycle theme (demo)"** under Settings → Hotkeys. Gated behind the flag — it never registers for normal users. Remove the flag after recording.

## Export targets

| Use | Format | Notes |
|---|---|---|
| README inline | `.gif` **≤ 2.5 MB** | loops automatically; keep ≤15s; 12–15 fps is plenty |
| README inline (preferred for long clips) | `.mp4` (H.264) | embed via `<video src="assets/x.mp4" controls>` — GitHub plays it inline, much smaller than gif |
| Obsidian store screenshot | static `.png` from the hero frame | the store listing wants stills; grab the best frame |

> Prefer `.mp4` for anything over ~8s — a 15s gif blows past 2.5 MB fast. Keep gifs for the short P0/P1 loops.

## Tooling

- **Record:** macOS — [Kap](https://getkap.co) (gif + mp4, area select) or QuickTime screen record → convert.
- **Trim/convert:** `ffmpeg`.
  - mp4 → optimized gif (palette, crisp, small):
    ```bash
    ffmpeg -i in.mp4 -vf "fps=14,scale=1300:-1:flags=lanczos,palettegen=stats_mode=diff" palette.png
    ffmpeg -i in.mp4 -i palette.png -lavfi "fps=14,scale=1300:-1:flags=lanczos,paletteuse=dither=bayer:bayer_scale=3" out.gif
    ```
  - shrink mp4 for inline embed:
    ```bash
    ffmpeg -i in.mov -vcodec libx264 -crf 26 -movflags +faststart -an out.mp4
    ```
- **Check size:** `ls -lh out.gif` — if > 2.5 MB, drop fps to 10, narrow scale to 1100, or shorten the clip.

---

## Scenes

> **One feature per clip.** The hero is the only montage — every other clip owns exactly one feature so nothing is shown twice: execution owns bash/deps + streaming, notebook owns shared vars + `$var`, export owns outputs-in-PDF (uses a **table**, not a plot, so it differs from the hero), highlighting owns theme switching, embed owns embedded files.

### 0. `hero.gif` — P0 — the one that sells it (~7s)
The summary montage — the only clip allowed to show several features. No dead time, ~1.5s/beat:
1. **Theme swap** — press the demo theme-cycle hotkey (see below) so the block recolors live. Sells highlighting + themes instantly without opening settings on camera.
2. **Run** — cursor hits Run, output/plot renders (matplotlib `plt.show()` pops in below).
3. **`$var` substitution** — the summary sentence under the block fills in `$peak` live (value computed inside the Python block, written into the prose — not a printed output).
4. **Export** — hard cut to the **Export to PDF** result, theme-matched, plot embedded.
Goal: themes → run → graph → live `$var` → export in ~7 seconds. Grab the best frame for the store `.png`.

### 1. `demo-execution.gif` — P0 (~12s)
Owns: **bash execution + inline dependency install + live streaming.** No plot here (that's the hero/export).
- Run a **bash** block: `pip install cowsay` → pip output streams in live.
- Run a **Python** block that uses the just-installed package → same env, no restart.
- Optional tail beat: a `input()` block to show the interactive stdin bar.
```bash
pip install cowsay
```
```python
import cowsay
cowsay.cow("deps installed inline")
```

### 2. `demo-notebook.gif` — P0 (~15s)
- Show a `vars` block at top: `threshold = 0.85`.
- A line of prose containing `` `$threshold` `` and `` `$result` ``.
- Run two Python blocks that use `threshold` and set `result`.
- Camera shows the inline `$threshold` / `$result` in the prose **updating live** after the run.
- Click **Run All** → blocks highlight in sequence, scroll follows.
This is the "wow, it's not just code blocks" moment — make the inline-`$var` update unmistakable.

### 3. `demo-export.gif` — P0 — the differentiator (~10s)
Owns: **outputs in the exported file.** Use a **text table** (pandas `to_string`), not a plot — keeps it visually distinct from the hero's plot and proves *all* output types carry over.
- Reading view → Run All so the table + numbers are on screen.
- Command palette → **Export note to PDF (with outputs)** → show the options dialog briefly → confirm.
- Cut to the resulting PDF: highlighted code, the printed table, theme-matched styling.
Emphasize **outputs included** — that's what competitors can't do.

### 4. `demo-highlighting.gif` — P1 (~8s)
- Open the theme picker in settings, switch between **Catppuccin → Gruvbox → Nord → Tokyo Night**.
- Keep a code block visible in reading view; show it recoloring live with each pick.
- End on the nicest theme.

### 5. `demo-embed.gif` — P2 (~8s)
- Type `![[script.py]]` in a note.
- Switch to reading view → collapsible block appears with filename + line count.
- Click to expand → full highlighted, runnable block.
- Optional: hit Run to show it executes like an inline block.

---

## After recording — checklist

- [ ] Filenames match exactly (`hero.gif`, `demo-execution.gif`, …).
- [ ] Each file in `assets/`.
- [ ] Uncomment the matching `<!-- ![...] -->` line in `README.md`.
- [ ] For `.mp4` clips, replace the `![...]` stub with `<video src="assets/x.mp4" controls width="100%"></video>`.
- [ ] Every gif ≤ 2.5 MB (`ls -lh assets/*.gif`).
- [ ] Grab the best `hero` frame as a `.png` for the community store screenshot.
- [ ] Visual consistency pass: same theme, same crop, same font size across all clips.

HTML and PDF exports now reproduce Obsidian callouts and LaTeX math, and embedded html-block previews no longer clip in PDFs.

## What's New

- **Callouts in exports** — `.callout` blocks render in standalone HTML and PDF with their theme colours, icons, and any custom callout types, lifted from the live note so they track your active theme.
- **LaTeX math in exports** — inline and block equations (MathJax) are fully typeset and self-contained in the exported file, including the shared SVG glyph cache so every reference resolves offline.

## Bug Fixes

- Embedded **html-block previews no longer collapse to a 60px sliver** in PDF export — the hidden print window keeps `requestAnimationFrame` firing (background throttling disabled) and waits for every preview iframe to report its final height before printing.
- **Display equations no longer overflow or get clipped** — they render as a scaled, centred block instead of living in a scroll container that a PDF page can't scroll.

## Upgrade Notes

- No action needed. Re-export any note that uses callouts or math to pick up the richer output.

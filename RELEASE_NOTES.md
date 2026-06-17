Adds one-click PDF and print export for rendered HTML blocks, plus a compatibility fix that aligns the declared minimum app version with the APIs the plugin uses.

## What's New

- **PDF export for HTML blocks** — turn on **PDF export for HTML blocks** (Settings → CodeSuite) and rendered `html` blocks get a **PDF** pill with two actions: **Save as PDF…** writes just that block to an A4 page beside the note (`<note name>.pdf`), and **Print…** opens the system print dialog for the block alone. Great for invoices, reports, and certificates.
- **Per-block opt in/out** — control a single block with a `pdf` (or `export`) / `nopdf` fence flag without flipping the global setting; `pdf` alone also renders the block as a preview.
- **Honours your own CSS** — both paths respect the block's styles, including `@media print` rules, and lay the document out on A4 with comfortable margins. A long document flows onto additional pages.

## Bug Fixes

- Raised `minAppVersion` from `1.5.0` to `1.6.6` to match `FileManager.trashFile` (added in Obsidian 1.6.6), which the baked-outputs feature shipped in 1.10.0 uses to clear and sweep image files. This resolves the "uses Obsidian APIs newer than the declared minAppVersion" review finding.

## Upgrade Notes

- PDF export for HTML blocks is off by default and changes nothing for existing notes. Enable it under **Settings → CodeSuite**, or opt a single block in with a `pdf` fence flag.
- PDF export and printing are **desktop only** — both paths need Electron.
- The plugin now requires **Obsidian 1.6.6 or newer**. This was already true in 1.10.0 (the baked-outputs feature called a 1.6.6 API); the manifest now declares it correctly.

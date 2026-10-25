This release makes HTML and PDF exports preserve code-block formatting from Reading view.

## What's New

- No new features in this patch release.

## Bug Fixes

- Preserve explicit line highlights (`{n}`), insertion highlights (`ins={…}`), and deletion highlights (`del={…}`) in HTML and PDF exports, including blocks inside callouts (#94, fixes #88).
- Preserve code-block fence options such as titles, line numbers, and `skip` during export (#94).
- Guard the settings sidebar icon API on Obsidian versions older than 1.11.0.

## Upgrade Notes

- No manual migration is required. Existing settings are preserved.
- Export existing notes again to include the restored formatting; previously exported files are unchanged.
- The minimum supported Obsidian version remains 1.6.6.

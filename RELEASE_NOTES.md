This patch corrects the API compatibility and CSS issues reported by Obsidian's plugin review for 1.22.1.

## What's New

- No new features in this patch.

## Bug Fixes

- Custom-theme removal buttons use styling compatible with the declared minimum Obsidian version, 1.6.6.
- Hidden baked outputs override Live Preview's display rule through selector specificity, preserving live-output replacement without `!important`.

## Upgrade Notes

- No manual migration is required. Existing settings and baked outputs are preserved.
- The minimum supported Obsidian version remains 1.6.6; settings search requires Obsidian 1.13 or later.

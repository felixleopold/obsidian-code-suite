Reading-view and export polish: collapsible code blocks everywhere, CodeSuite frontmatter that actually renders in preview, and html-block previews that survive HTML/PDF export — plus a notebook-correct fix for variables on block re-run.

## What's New

- **Every code block is collapsible** — fold or unfold any fenced block from its header in both reading view and Live Preview, not just html previews and embeds ([#32](https://github.com/felixleopold/obsidian-code-suite/issues/32)). The old "Collapsible inline code blocks" toggle is replaced by **Collapse code blocks by default**, which only chooses the initial state; per-block `collapsed` / `expanded` fence flags still win.
- **Frontmatter variables render in preview** — a nested `code_vars:` / `template_context:` mapping used to trigger Obsidian's orange "unsupported property type" warning and collapse. CodeSuite now hides that broken row and renders the values in a small read-only panel just below the Properties widget ([#34](https://github.com/felixleopold/obsidian-code-suite/issues/34)).
- **List form for `code_vars`** — write `code_vars` as a YAML list of `key = value` strings (`- threshold = 0.85`), parsed with the same grammar and `:type` hints as a `vars` block. A plain list renders natively in Obsidian, so use that form if you prefer native Properties rendering.
- **HTML previews in exports** — a preview-mode `html` block now renders its document in HTML and PDF exports instead of exporting as a bare header ([#33](https://github.com/felixleopold/obsidian-code-suite/issues/33)).

## Bug Fixes

- **Variables persist across re-runs** — re-running a block fed its own previous output back into itself, so a block that read and transformed a cross-language variable (e.g. bash reading a Python int and multiplying it) compounded on every run. A block now sees the upstream value it originally consumed, matching notebook re-run semantics ([#36](https://github.com/felixleopold/obsidian-code-suite/issues/36)).
- **No dead buttons in exports** — the output toolbar's buttons (copy, save image, …) appeared in static HTML/PDF exports but did nothing; they're now hidden, like the run pill and input bar ([#35](https://github.com/felixleopold/obsidian-code-suite/issues/35)).

## Upgrade Notes

- The **Collapsible inline code blocks** setting is gone. Every block is collapsible now; **Collapse code blocks by default** controls only whether blocks start folded. Existing settings load fine — the removed key is simply ignored.
- The frontmatter panel renders the mapping form in place; if you'd rather Obsidian render `code_vars` natively, switch to the list form. Both forms seed variables identically.

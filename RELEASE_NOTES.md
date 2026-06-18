Turns `html` blocks — and embedded `.html` files — into data-driven documents: interpolate frontmatter, pull in a shared layout/CSS partial, and loop over a list — built for reusable invoices, reports, and certificates that export straight to PDF.

## What's New

- **HTML block templating** — add a `template` flag to an `html` fence (e.g. ```` ```html template ````) and the block renders through a small templating engine instead of showing static markup. The layout/CSS lives once in a partial; the data lives in the note's frontmatter.
- **Templating an embedded file** — embed a standalone `.html` file with `![[invoice.html|template pdf]]` and it's templated against the *embedding* note. No fenced block, no imports folder, no `{{> … }}` — the cleanest setup for a one-file document. The `template`/`notemplate`/`pdf` alias flags mirror the fence flags, and the global settings apply too.
  - **Interpolation** — `{{ invoice_number }}`, dotted paths like `{{ biz.biz_iban }}`, HTML-escaped by default (`{{{ … }}}` or `| raw` for trusted markup, `| default:"—"` for a fallback).
  - **Filters** — `eur` (`€ 1.500,00`), `date` (`18.06.2026`), `number`, `upper`/`lower`, chainable and locale-aware. Formatting stays in the template so frontmatter stays raw and Dataview-queryable.
  - **Includes** — `{{> invoice }}` inlines a shared partial from your imports folder (recursive, cycle-guarded), so the CSS and layout aren't copied into every note.
  - **Loops & conditionals** — `{{#each items}}…{{/each}}` (with `this`, `@index`, `@first`, `@last`) and `{{#if}}` / `{{#unless}}` / `{{else}}`.
  - **Shared context notes** — declare `template_context: { biz: "[[Business Config]]" }` in frontmatter and read another note's data under that namespace (`{{ biz.biz_iban }}`). Change it once; every invoice updates.
- **Resolves once for every consumer** — the live preview, the **Save as PDF** / **Print** pill, and full-note HTML/PDF export all receive the already-resolved document. The PDF/print path is unchanged.
- **New setting — HTML block templating** — when on, any `html` block containing `{{` is treated as a template without the per-block flag. A starter (`examples/invoice/`) and a full syntax reference (`docs/html-templating.md`) ship with the release.

## Bug Fixes

- None.

## Upgrade Notes

- Templating is **off by default** and changes nothing for existing notes. Opt a single block in with a `template` fence flag (or an embed in with `![[file.html|template]]`), or enable **Settings → CodeSuite → HTML block templating** for any `{{`-containing block or embed.
- The global setting is off by default on purpose: html blocks that legitimately contain `{{` (Vue/Angular/Handlebars demos) render literally unless you flag them. Use `notemplate` to keep a specific block literal when the global setting is on.
- Partials resolve against your existing **Imports folder** (default `CodeSuiteImports/`). No new path setting.
- Interpolation, includes, and loops work on desktop and mobile; PDF export and printing remain desktop-only.

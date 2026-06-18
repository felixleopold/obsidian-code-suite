# Invoice template — copy-paste starter

A worked example of [HTML templating](../../docs/html-templating.md): one shared
layout, per-note data, exported to PDF. This version **embeds** the layout file
directly — the cleanest setup, with no fenced block and no imports folder.

| File | Goes where | Role |
|---|---|---|
| `invoice.html` | **anywhere in your vault** (Obsidian resolves `![[invoice.html]]` by name) | The layout + CSS, written once. Embedded by each invoice. |
| `Business Config.md` | anywhere in your vault | Details shared by every invoice (legal name, IBAN, tax note). Edited once. |
| `Invoice 2026-002.md` | anywhere in your vault | One invoice: data in frontmatter, a one-line embed. Copy per invoice. |

## How it works

1. The invoice note embeds the layout with two flags:

   ```markdown
   ![[invoice.html|template pdf]]
   ```

   `template` renders the embedded file through the templating engine (against
   *this* note); `pdf` adds the export pill. Both also have global settings
   (Settings → CodeSuite → HTML) if you'd rather not write flags per embed.

2. The file's `{{ … }}` resolve against the invoice note: `{{ invoice_number }}`
   and `{{ client_name }}` from its frontmatter, `{{#each items}}` over the line
   items, `{{ biz.biz_iban }}` from `Business Config.md` (declared via
   `template_context:`), with `| eur` / `| date` formatting applied at render time.

3. Open the note, click the **PDF** pill → **Save as PDF…** to write
   `Invoice 2026-002.pdf` beside the note.

## Make your next invoice

Duplicate `Invoice 2026-002.md`, change the frontmatter (`invoice_number`,
`client_name`, `items`, `amount_net`, dates). Leave the embed as-is. Done.

> `amount_net` is stored, not computed — templates display data, they don't do
> arithmetic. Put the total in frontmatter (where Dataview can also sum it across
> invoices for a dashboard).

> **Prefer a fenced block?** You can instead keep the layout in your imports
> folder and pull it into a `` ```html template pdf `` block with `{{> invoice }}`.
> See [the templating docs](../../docs/html-templating.md) — same engine, same
> data, just a different render seam.

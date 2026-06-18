# HTML Templating

> **Part of the CodeSuite docs** — [README](../README.md) · [Variables & Execution](variables-and-execution.md) · **HTML Templating** · [Configuration Reference](configuration.md)

CodeSuite can render an `html` code block — **or an embedded `.html` file** — as a **data-driven document** instead of a static blob: it interpolates the note's frontmatter, CodeSuite variables, and shared "context notes" into the markup, pulls in a reusable partial, and loops over a list. The layout and CSS live once (in a partial, or in a standalone `.html` file you embed); the data lives in the note's frontmatter.

The driving use case is **reusable documents** — invoices, reports, certificates — where you keep one template and fill it per note, then [export the block to PDF](../README.md#share) and send it.

It builds directly on two features you may already use: the [HTML live preview](../README.md#share) (the sandboxed iframe a rendered `html` block lives in) and [variables](variables-and-execution.md) (`$varname` already substitutes note data into rendered prose). Templating is the same idea — *"put my note's data into the page"* — with a richer `{{ … }}` syntax for nested fields, lists, and shared layout.

---

## Contents

1. [Turning a block into a template](#turning-a-block-into-a-template)
2. [Templating an embedded file](#templating-an-embedded-file)
3. [Interpolation](#interpolation)
4. [Filters](#filters)
5. [Includes (shared partials)](#includes-shared-partials)
6. [Loops](#loops)
7. [Conditionals](#conditionals)
8. [Where the data comes from](#where-the-data-comes-from)
9. [Worked example: an invoice](#worked-example-an-invoice)
10. [How it renders & updates](#how-it-renders--updates)
11. [Security](#security)
12. [Out of scope](#out-of-scope)
13. [Quick reference](#quick-reference)

---

## Turning a block into a template

A block opts in with a `template` flag on the fence — alongside `preview`, `pdf`, and the other html-block flags:

````markdown
```html template
{{> invoice }}
```
````

- `template` composes with the others. ` ```html template pdf ` renders the document **and** shows the PDF pill.
- A `template` block always **renders** (it's preview-eligible, exactly as `pdf` is) — you don't also need `preview`.
- `notemplate` forces a block to render literally even if the global setting (below) is on.

**Global setting.** Turn on **Settings → CodeSuite → HTML block templating** to treat *any* `html` block that contains `{{` as a template, without the per-block flag. It's **off by default** on purpose: html blocks are often framework demos (Vue, Angular, Handlebars) that legitimately contain literal `{{`, and we must never rewrite those. The `template` flag is the safe, explicit trigger; the global setting is a convenience once you know your vault has no such demos.

---

## Templating an embedded file

You don't have to keep the template inside a fenced block. Drop the layout in a standalone **`.html` file** anywhere in your vault and **embed** it — CodeSuite templates the embedded file against the note doing the embedding:

```markdown
![[invoice.html|template pdf]]
```

This is usually the cleanest setup for a reusable document: the note holds *only* data (frontmatter) and one embed line; the file holds the layout and CSS. There's no fenced block, no imports folder, and no `{{> … }}` indirection — the embedded file **is** the template.

- The embed's alias flags mirror the fence flags: `template` opts in, `notemplate` opts out, `pdf` adds the export pill, `preview`/`source` pick the starting view. Combine them freely: `![[invoice.html|template pdf]]`.
- The file's `{{ … }}` resolve against the **embedding note** — its frontmatter, vars, and `template_context:` notes — so the same `invoice.html` renders differently for each invoice note. Editing the note's data re-renders the embed.
- The global **HTML block templating** setting also applies: with it on, embedding any `.html` file that contains `{{` templates it without the `template` flag. Likewise the global **PDF export** setting gives every embedded html document the PDF pill.
- The file can still `{{> include }}` other partials, loop, and use filters — it's the same engine, just reached through an embed instead of a fence.

> **Embed vs. `{{> include }}`.** They solve different problems. *Embedding* renders a whole file as the document for *this* note. An *include* (`{{> partial }}`, below) stitches a shared fragment into a larger template. For a one-file document like an invoice, embed it; when you're composing several shared pieces, include them.

---

## Interpolation

`{{ path }}` inserts a value, looked up by a dotted path into the [context](#where-the-data-comes-from), **HTML-escaped** by default:

```
Rechnung {{ invoice_number }} · {{ client_name }}
An: {{ biz.biz_legal_name }}
```

- **Nested fields** — `{{ biz.biz_iban }}` reaches into a nested object (e.g. a context note's frontmatter).
- **Missing path → empty string.** Friendly for optional fields; supply a fallback with `| default:"…"`.
- **Unescaped output** — `{{{ path }}}` (triple braces) or `{{ path | raw }}` emits the value without HTML-escaping, for values that are intentionally markup. Use only on data you trust.
- `{{! a comment }}` is dropped from the output.

> **Why escape by default?** Invoice/report data is user text. Escaping stops a stray `<` from breaking your layout and prevents markup injection. Opt out explicitly, per value, only when you mean to.

---

## Filters

Append `| filter` to format a value. Filters are chainable (`{{ x | lower | upper }}`) and take an optional argument (`filter:arg`, quoted if it contains spaces or `|`):

| Filter | Example | Output (default locale de-AT) |
|---|---|---|
| `eur` | `{{ amount_net \| eur }}` | `€ 1.500,00` |
| `number` | `{{ qty \| number }}` | `1.234,5` |
| `date` | `{{ issue_date \| date }}` | `18.06.2026` |
| `upper` / `lower` | `{{ code \| upper }}` | case-folded |
| `default:"…"` | `{{ service_period \| default:"—" }}` | the fallback when the value is missing/empty |
| `raw` | `{{ note_html \| raw }}` | skips HTML-escaping |

- `eur`, `number`, and `date` accept a **locale** argument to override the default: `{{ total | eur:"en-US" }}` → `$1,500.00`, `{{ issue_date | date:"en-GB" }}`.
- Date-only `YYYY-MM-DD` values are formatted in local time, so the displayed day never shifts across time zones.
- A non-numeric value passed to `eur`/`number`, or an unparseable date, falls back to the value's plain string form (no crash).

**Why filters?** They keep formatting in the *template* while frontmatter stays raw and queryable. Your Dataview dashboard wants `amount_net: 1500` (a number it can sum); the invoice wants `€ 1.500,00`. One source of truth, formatted at render time.

---

## Includes (shared partials)

`{{> path }}` inlines another file's contents before interpolation — so the CSS, layout, and logo live in exactly one place and every invoice shares them:

```
{{> invoice }}              → <imports folder>/invoice.html
{{> partials/footer.html }} → <imports folder>/partials/footer.html
```

- Resolved relative to your **Imports folder** (Settings → CodeSuite, default `CodeSuiteImports/`) — the same folder used by *Import code file as alias*.
- `.html` is assumed when you omit the extension.
- **Recursive** — a partial may include another — with a depth cap (10) and a cycle guard. A missing or too-deep include is left in place verbatim; a cycle is dropped. Nothing throws.
- A partial's own `{{ … }}` are interpolated against the **host note's** data, so the same `invoice.html` renders differently for each invoice note.
- Confined to the vault: a path containing `..` is rejected.

---

## Loops

`{{#each array}} … {{/each}}` repeats its body over a frontmatter array. Inside the loop:

- `this` is the current element (`{{ this.description }}`), and an object element's fields are also reachable directly (`{{ description }}`).
- `@index` (0-based), `@first`, and `@last` describe the position.

```html
<table>
  {{#each items}}
  <tr>
    <td>{{ @index }}</td>
    <td>{{ this.description }}</td>
    <td class="r">{{ this.amount | eur }}</td>
  </tr>
  {{/each}}
</table>
```

with frontmatter:

```yaml
items:
  - { description: "Wartung & Server (3 Monate)", amount: 120 }
  - { description: "Domain", amount: 18 }
```

A line's `amount` is **stored** in frontmatter (entered once), not computed at render time — see [Out of scope](#out-of-scope).

---

## Conditionals

`{{#if path}} … {{/if}}` keeps its body only when the value is truthy; `{{#unless path}}` is the negation; `{{else}}` provides the alternative:

```html
{{#if service_period}}<div class="period">Leistungszeitraum: {{ service_period }}</div>{{/if}}
{{#if items}}…table…{{else}}<p>Keine Positionen.</p>{{/if}}
```

**Truthy** = non-empty string · non-zero number · non-empty array · present object · `true`. Everything else (missing, `""`, `0`, `[]`, `false`) is falsy — handy for dropping empty rows.

---

## Where the data comes from

The engine resolves a path against a layered context, **highest precedence first**:

1. **Loop scope** — `this`, `@index`, `@first`, `@last`, and the current element's fields, inside `{{#each}}`.
2. **CodeSuite vars** — `vars` blocks and `code_vars:` frontmatter (the existing [per-note var store](variables-and-execution.md#declaring-variables)). Matches the rule that block vars override frontmatter.
3. **Frontmatter** — every YAML key of the host note.
4. **Named context notes** — declared in the host note's frontmatter and exposed under a namespace, so shared data stays in its own single-source note instead of being copied into every template:

   ```yaml
   template_context:
     biz: "[[Business Config]]"
   ```

   Then `{{ biz.biz_iban }}` reads the `biz_iban` key from `Business Config.md`'s frontmatter. Change it once there and every invoice updates. The value may be a `"[[wikilink]]"` (quote it so YAML doesn't parse the brackets) or a plain note name.

---

## Worked example: an invoice

**`invoice.html`** — written once, shared by every invoice, dropped anywhere in your vault:

```html
<!doctype html><html><head><meta charset="utf-8"><style>
  /* …the invoice CSS, once… */
  .inv { font-family: -apple-system, 'Segoe UI', sans-serif; color: #1b1b1b; }
  table { width: 100%; border-collapse: collapse; }
  td.r { text-align: right; }
  .total { font-weight: 700; }
</style></head><body>
  <div class="inv">
    <header>{{ biz.biz_legal_name }} · {{ biz.biz_street }}, {{ biz.biz_zip_city }}</header>
    <h1>Rechnung {{ invoice_number }}</h1>
    <div>An: {{ client_name }}<br>{{ client_address }}</div>
    <table>
      {{#each items}}
      <tr><td>{{ this.description }}</td><td class="r">{{ this.amount | eur }}</td></tr>
      {{/each}}
    </table>
    <div class="total">Gesamt: {{ amount_net | eur }}</div>
    <div class="legal">{{ biz.biz_tax_note }} · IBAN {{ biz.biz_iban }}</div>
  </div>
</body></html>
```

**An invoice note** — just data and one embed line:

```markdown
---
invoice_number: "2026-002"
client_name: "Muster GmbH"
client_address: "Beispielgasse 12, 1010 Wien"
issue_date: 2026-06-18
items:
  - { description: "Wartung & Server (3 Monate)", amount: 120 }
amount_net: 120
template_context:
  biz: "[[Business Config]]"
---

![[invoice.html|template pdf]]
```

The embed renders the full invoice in preview; the **PDF** pill exports it to A4 beside the note. Change the IBAN in `Business Config.md` → every invoice updates. Nothing is baked in, nothing is repeated.

> **Prefer a fenced block?** Put `invoice.html` in your imports folder instead and pull it in with `` ```html template pdf `` containing `{{> invoice }}`. Same engine, same data — see [Includes](#includes-shared-partials).

A ready-to-copy version lives in [`examples/invoice/`](../examples/invoice/).

---

## How it renders & updates

- A template block — or [embedded file](#templating-an-embedded-file) — resolves to final HTML inside the same [sandboxed iframe](../README.md#share) a normal rendered `html` block uses. The **PDF/Print** pill and full-note HTML/PDF export all receive the already-resolved HTML and need no special handling.
- **Re-rendering.** Editing the note's frontmatter re-resolves the template (reading view re-renders automatically; Live Preview rebuilds the block when the metadata cache settles). For an embedded file, editing the **embedding note's** data re-renders it; editing the embedded **file** itself refreshes notes that embed it on their next render. Editing a **partial** or a **context note** likewise refreshes on the next render (reopen the note or toggle preview to force it now).
- **Resolution is re-run per export**, so a *Save as PDF* always reflects the current data, never a stale preview.
- Plain (non-template) `html` blocks are completely untouched — no extra reads, no async, no behavior change.

---

## Security

- **Escaped by default.** Interpolated values are HTML-escaped; raw output is explicit (`{{{ }}}` / `| raw`).
- **The iframe sandbox is unchanged** (`sandbox="allow-scripts"`, no same-origin): even resolved content cannot reach your vault, the app, or Obsidian's API.
- **Includes are confined to the vault** (no `..` escaping), depth-capped, and cycle-guarded.
- **Opt-in.** Existing html blocks — including framework demos with literal `{{` — are never rewritten unless flagged `template` or you enable the global setting.

---

## Out of scope

By design, templates *display* data; they don't compute it:

- **No arithmetic or expressions** (`{{ qty * price }}`). Compute once at data-entry time (or in a real `javascript`/`python` block) and store the result in frontmatter. This keeps the engine declarative and safe.
- **No JS inside the template.** Want computation? Run a [code block](variables-and-execution.md) to produce values, then template them.
- Not full Handlebars (no custom helpers, partial parameters, or block params beyond `this`/`@index`).

---

## Quick reference

| Syntax | Meaning |
|---|---|
| `{{ path }}` | Interpolate, HTML-escaped |
| `{{{ path }}}` / `{{ path \| raw }}` | Interpolate, unescaped |
| `{{ path \| filter:arg }}` | Apply a filter (chainable) |
| `{{ path \| default:"—" }}` | Fallback for a missing/empty value |
| `{{> partial }}` | Include a file from the imports folder |
| `{{#each items}}…{{/each}}` | Loop; `this`, `@index`, `@first`, `@last` inside |
| `{{#if x}}…{{else}}…{{/if}}` | Conditional |
| `{{#unless x}}…{{/unless}}` | Negated conditional |
| `{{! comment }}` | Dropped from output |

**Filters:** `eur` · `number` · `date` · `upper` · `lower` · `default:"…"` · `raw` (the formatters take an optional locale argument).

**Activation:** `template` fence flag, or `![[file.html|template]]` embed flag (always); or **HTML block templating** setting + a `{{`-containing block/file. `notemplate` opts out.

**Context precedence:** loop scope → vars → frontmatter → `template_context:` notes (namespaced).

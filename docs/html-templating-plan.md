# HTML Block Templating — Implementation Plan

Status: **proposal / awaiting sign-off** · Target: a minor feature release (e.g. 1.10.0)

This document plans a templating layer for `html` code blocks: interpolate the
note's frontmatter and CodeSuite variables into the block, pull in a shared
partial, and loop over a list — so an `html` block can be **data-driven** instead
of a static blob. The driving use case is reusable documents (invoices, reports,
certificates) where the layout/CSS lives once and the data lives in frontmatter.

It is deliberately scoped as a **logical extension of machinery CodeSuite already
has**, not a new subsystem.

---

## 1. Why this fits CodeSuite

CodeSuite already turns notes into live documents and already has a variable
model. The pieces this feature reuses:

| Existing capability | Where | Reused for |
|---|---|---|
| Typed variable model (`VarValue`, `fromJsValue`, `toJs`, `toDisplay`) | `src/vars.ts` | Formatting interpolated values consistently |
| `code_vars:` frontmatter → per-note var store | `applyFrontmatterVars()` `main.ts:3090` | Reading the note's data |
| Inline `$varname` substitution in the note body | `updateInlineVarRefs()` (reading view) | The *precedent*: "substitute note data into rendered content" |
| `html` live preview in a sandboxed iframe | `addHtmlPreview()` `main.ts:3334` → `buildHtmlFrame()` `main.ts:3510` | The single render seam |
| Per-block fence flags (`preview` / `pdf` / `source`) | `htmlPreviewState()` `main.ts:3123`, `htmlPdfState()` `main.ts:3142` | The opt-in mechanism |
| Per-block PDF / print export | `exportHtmlBlockToPdf()` `main.ts:3450`, `printHtmlBlock()` `main.ts:3463` | Works unchanged on the resolved HTML |
| Imports folder | `codeImportsFolder` setting (default `CodeSuiteImports`) | Where shared partials live |

The mental model the user already has — *"`$var` puts my note's data into the
page"* — simply extends to `html` blocks, with the richer `{{ … }}` syntax needed
for nested fields, lists, and a shared template.

**The key architectural fact that makes this clean:** every consumer of an html
block's source — live preview, Save-as-PDF, Print — funnels through one function,
`addHtmlPreview()`. Resolve the template **once** there and feed the result to all
three. The export/print path and the PDF button need **no changes**; they just
receive already-resolved HTML.

---

## 2. Feature specification (syntax)

### 2.1 Activation — opt-in, never surprising

A block opts into templating with a `template` fence flag, mirroring the existing
`preview` / `pdf` flags (already parsed into the attribute set at `main.ts:1061`
and `main.ts:2609` — **no parser change needed**):

````
```html template
{{> invoice }}
```
````

- `template` composes with the others: ` ```html template pdf ` renders the
  document *and* shows the PDF pill.
- A `template` block is implicitly preview-eligible (so it renders), exactly as
  `pdf` already implies preview in `htmlPreviewState()`.
- Optional global setting `htmlTemplating` (see §4.3): when on, any html block
  that *contains* `{{` is treated as a template even without the flag. Default
  **off**, because html blocks are often framework demos (Vue/Angular/Handlebars)
  that legitimately contain literal `{{` — we must not rewrite those. The flag is
  the safe, explicit trigger.

### 2.2 Interpolation

`{{ path }}` — dotted path into the context, **HTML-escaped** by default:

```
Rechnung {{ invoice_number }} · {{ client_name }}
```

- `{{{ path }}}` (triple) or `{{ path | raw }}` emits unescaped (for values that
  are intentionally HTML).
- Missing path → empty string (friendly for optional fields). `| default:"—"`
  supplies a fallback.

### 2.3 Filters

`{{ path | filter }}`, chainable, registry-based so it's easy to extend:

| Filter | Example | Output |
|---|---|---|
| `eur` | `{{ amount_net \| eur }}` | `€ 1.500,00` (de-AT) |
| `date` | `{{ issue_date \| date }}` | `18.06.2026` |
| `number` | `{{ qty \| number }}` | locale number |
| `upper` / `lower` | | case |
| `default:"…"` | `{{ service_period \| default:"" }}` | fallback |
| `raw` | | skip HTML-escaping |

Filters keep formatting (currency, dates) in the *template* while frontmatter
stays raw and queryable by Dataview — the dashboard wants `amount_net: 1500`, the
invoice wants `€ 1.500,00`. No double source of truth.

### 2.4 Includes (shared template / partials)

`{{> path }}` inlines another file's contents before interpolation, so the CSS +
layout + logo live in exactly one place:

```
{{> invoice }}              → CodeSuiteImports/invoice.html
{{> partials/footer.html }} → CodeSuiteImports/partials/footer.html
```

- Resolved relative to `codeImportsFolder` (reuse the existing setting); `.html`
  is assumed if no extension.
- **Recursive** (a partial may include another), with a **depth cap** (e.g. 10)
  and a visited-set to break cycles.
- Path is confined to the vault (reject `..` escaping the vault root).

### 2.5 Loops

`{{#each items}} … {{/each}}` over a frontmatter array. Inside, `this` is the
current element; `@index`, `@first`, `@last` are available:

```html
{{#each items}}
  <tr>
    <td>{{ @index }}</td>
    <td>{{ this.description }}</td>
    <td class="r">{{ this.amount | eur }}</td>
  </tr>
{{/each}}
```

Arithmetic is **out of scope** (see §11): a line's `amount` is stored in
frontmatter (computed once at data-entry time), not derived at render time.

### 2.6 Conditionals (small, optional — Phase 3)

`{{#if service_period}}…{{/if}}` / `{{#unless …}}` to drop empty rows. Truthiness:
non-empty string, non-zero number, non-empty array, `true`.

### 2.7 Context sources & precedence

The context the engine resolves against, **highest precedence first**:

1. **Loop scope** — `this`, `@index`, … inside `{{#each}}`.
2. **CodeSuite vars** — `vars` blocks + `code_vars:` (the existing per-note var
   store). Matches the existing rule that block vars override frontmatter.
3. **Frontmatter** — every YAML key of the host note.
4. **Named context notes** — `{{ biz.biz_iban }}`, loaded from notes declared in
   the host note's frontmatter (keeps business data in its own single-source
   note rather than duplicated into a partial):

   ```yaml
   template_context:
     biz: "[[Business Config]]"
   ```

   Each entry's note frontmatter is exposed under that namespace via
   `metadataCache`. (Decision C — see §10.)

---

## 3. Worked example (the real target)

**`CodeSuiteImports/invoice.html`** — written once:

```html
<!doctype html><html><head><meta charset="utf-8"><style>
  /* …the invoice CSS, once… */
</style></head><body>
  <div class="inv">
    <header>{{ biz.biz_legal_name }} · {{ biz.biz_street }}, {{ biz.biz_zip_city }}</header>
    <h1>Rechnung {{ invoice_number }}</h1>
    <div>An: {{ client_name }}<br>{{ client_address }}</div>
    <table>
      {{#each items}}
      <tr><td>{{ this.description }}</td><td>{{ this.amount | eur }}</td></tr>
      {{/each}}
    </table>
    <div class="total">Gesamt: {{ amount_net | eur }}</div>
    <div class="legal">{{ biz.biz_tax_note }} · IBAN {{ biz.biz_iban }}</div>
  </div>
</body></html>
```

**An invoice note** — just data + one line:

````markdown
---
invoice_number: "2026-002"
client_name: "Muster GmbH"
client_address: "Beispielgasse 12, 1010 Wien"
items:
  - { description: "Wartung & Server (3 Monate)", amount: 120 }
amount_net: 120
template_context:
  biz: "[[Business Config]]"
---

```html template pdf
{{> invoice }}
```
````

Renders the full invoice in preview; the PDF pill exports it. Change the IBAN in
`Business Config.md` → every invoice updates. Nothing baked in, nothing repeated.

---

## 4. Code changes

### 4.1 New file: `src/template.ts` (the engine — pure, dependency-free)

Mirrors `vars.ts` in style: small, exhaustively doc-commented, no Obsidian
imports (pure string→string given a context), so it's unit-testable in isolation.

```ts
/** A value lookup against the layered template context. */
export interface TemplateContext {
  /** Resolve a dotted path (e.g. "this.description", "biz.biz_iban"). */
  lookup(path: string): unknown;
  /** Push/pop loop scope for {{#each}}. */
  withScope(scope: Record<string, unknown>): TemplateContext;
}

/** Synchronous render pass: interpolation, filters, {{#each}}, {{#if}}.
 *  Assumes includes are already expanded. Never throws — an unparseable
 *  construct is left verbatim and a console warning is emitted. */
export function renderTemplate(source: string, ctx: TemplateContext): string;

/** Async pre-pass: expand {{> partial}} includes via a provided reader.
 *  Depth-capped and cycle-guarded. Returns source unchanged if it has none. */
export async function expandIncludes(
  source: string,
  readPartial: (path: string) => Promise<string | null>,
  depth?: number,
): Promise<string>;

/** Built-in filter registry: eur, date, number, upper, lower, default, raw. */
export const FILTERS: Record<string, (v: unknown, arg?: string) => string>;

/** True if the source contains any `{{ … }}` construct (cheap activation gate). */
export function hasTemplateSyntax(source: string): boolean;
```

Value formatting reuses `vars.ts`: a looked-up frontmatter value is normalised
through `fromJsValue` → `toDisplay` for the default case, and filters operate on
the raw JS value (so `eur` sees a `number`).

### 4.2 `src/main.ts` — wire it in at the one seam

1. **Context builder** (new private method):

   ```ts
   /** Assemble the layered template context for an html block from its note's
    *  frontmatter, CodeSuite var stores, and any `template_context:` notes. */
   private async buildTemplateContext(sourcePath?: string): Promise<TemplateContext>
   ```

   - Frontmatter via `this.app.metadataCache.getFileCache(file)?.frontmatter`
     (works for **both** reading view and Live Preview, which share
     `addHtmlPreview` but where only `sourcePath` is reliably present).
   - Vars via the existing `noteVarStore` / `noteVarsBlockStore` for that path.
   - `template_context:` notes resolved with
     `this.app.metadataCache.getFirstLinkpathDest(name, sourcePath)` (the same
     helper already used at `main.ts:1121`/`3441`).

2. **Resolve once in `addHtmlPreview()`** (`main.ts:3334`). It already receives
   `code` and `sourcePath`. Gate on the `template` flag (or `htmlTemplating`
   setting + `hasTemplateSyntax`). When active:

   ```ts
   const resolved: Promise<string> = (async () => {
     const ctx = await this.buildTemplateContext(sourcePath);
     const expanded = await expandIncludes(code, (p) => this.readPartial(p));
     return renderTemplate(expanded, ctx);
   })();
   ```

   Then feed `resolved` to the three consumers instead of `code`:
   - `buildHtmlFrame(pane, code)` → `buildHtmlFrame(pane, await resolved)`
   - `exportHtmlBlockToPdf(code, …)` → `exportHtmlBlockToPdf(await resolved, …)`
   - `printHtmlBlock(code)` → `printHtmlBlock(await resolved)`

   `buildHtmlFrame` becomes `async` (it only sets `iframe.srcdoc`; awaiting first
   is trivial and the frame is already built lazily via `ResizeObserver`). The
   export/print methods are already `async` and already take the HTML string —
   **they need no internal change.** `buildHtmlBlockDocument()` / `buildHtmlSrcdoc()`
   stay exactly as they are; they receive resolved HTML.

3. **`readPartial(path)`** (new private helper): resolve against
   `codeImportsFolder`, confine to vault, `await this.app.vault.cachedRead(file)`.
   Works on desktop **and** mobile (no `fs` — uses the vault API).

4. **Activation helper** `htmlTemplateState(rawLang, attrs)` next to
   `htmlPreviewState`/`htmlPdfState`, returning whether the block is a template.
   `htmlPreviewState` gains one line so a `template` block is preview-eligible
   (like `pdf` already is).

> **Zero-cost for normal html blocks:** if the block is not a template, none of
> the above runs — the existing synchronous path is untouched. No extra reads, no
> async, no behavior change for everyone not using the feature.

### 4.3 `src/settings.ts` + `src/settings-tab.ts`

Add one documented setting (follow the existing doc-comment density):

```ts
/**
 * When true, `html` blocks that contain `{{ … }}` are rendered as templates
 * (frontmatter/vars interpolated, partials included) even without the explicit
 * `template` fence flag. Off by default so html blocks that legitimately contain
 * `{{` (framework demos) are never rewritten — the per-block `template` flag is
 * the safe opt-in. Partials resolve against `codeImportsFolder`.
 */
htmlTemplating: boolean;   // default: false
```

Reuse `codeImportsFolder` for partials — no new path setting. Settings-tab UI: a
toggle in the existing HTML section near `renderHtmlBlocks` / `htmlBlockPdfExport`.

### 4.4 `styles.css`

None required — the template renders inside the existing `.ocode-html-render`
iframe. (Optional: a tiny `ocode-template-badge` on the source view, like the
table badge at `main.ts:3077`, to signal "this block is a template.")

---

## 5. Async, correctness, and the existing render lifecycle

- Resolution is async only because of includes / context-note reads. The frame is
  already built lazily (the `ResizeObserver` dance in `addHtmlPreview`), so an
  extra `await` before `iframe.srcdoc = …` changes nothing structurally.
- **Re-render on data change:** when frontmatter or the partial changes, Obsidian
  re-runs the post-processor → `addHtmlPreview` runs again → re-resolved. (A
  partial edit re-renders the *partial's* note; invoice notes referencing it
  refresh on their next render. Acceptable; note it in docs.)
- **Full-note export** (`exportRenderedNote` `main.ts:2215`) serializes the
  preview DOM; the iframe's `srcdoc` attribute already holds resolved HTML, so it
  is captured for free — no change needed.
- The engine **never throws**: a malformed `{{#each}}` is left verbatim with a
  `console.warn`, matching CodeSuite's "degrade gracefully" posture.

---

## 6. Security & safety

- **Escape by default.** Interpolated values are HTML-escaped; raw output is
  explicit (`{{{ }}}` / `| raw`). Invoice/report data is user text — this prevents
  a stray `<` from breaking layout and prevents markup injection.
- **The iframe sandbox is unchanged** (`sandbox="allow-scripts"`, no
  `allow-same-origin`): even resolved content cannot reach the vault or Obsidian.
- **Include path confinement:** reject paths escaping the vault; depth cap +
  cycle guard on recursion.
- **Opt-in:** existing html blocks (including framework demos with literal `{{`)
  are untouched unless flagged or the global setting is enabled.

---

## 7. Backwards compatibility

- Purely additive and opt-in. `renderHtmlBlocks`, `htmlBlockPdfExport`, execution,
  exec env, embeds — all unchanged.
- Mobile: interpolation/loops/includes all work (vault API, no `fs`). PDF/print
  stay desktop-only exactly as today.
- No change to `data.json` shape beyond the new `htmlTemplating: false` default
  (back-compat default = current behavior).

---

## 8. Phasing (each phase independently shippable)

| Phase | Scope | Risk |
|---|---|---|
| **1** | Engine core: `{{ field }}`, filters, escaping, `{{#each}}`; activation flag; wire into `addHtmlPreview`; frontmatter + vars context. **Sync only — no includes yet.** | Low |
| **2** | `{{> include }}` (async pre-pass) + `readPartial`; make `buildHtmlFrame` async. | Low–med |
| **3** | `template_context:` named context notes; `{{#if}}`; global `htmlTemplating` setting. | Low |

Phase 1 alone already removes the "data baked into HTML" problem for single-file
templates; Phase 2 removes the "CSS repeated per note" problem.

---

## 9. Testing & documentation (the "well documented" bar)

**Tests / fixtures** (CodeSuite convention — `CodeSuite Feature Tests/` notes, plus
`examples/`):
- A `Templating.md` fixture: interpolation, missing field, each-loop, every
  filter, include, escaping vs `raw`, a framework-demo block *without* the flag
  (must render verbatim).
- `examples/invoice/` — the worked example (note + `invoice.html` partial) as a
  copy-paste starter.

**Docs:**
- New `docs/html-templating.md` — full syntax reference (this plan's §2 expanded),
  written in the style of `docs/variables-and-execution.md`.
- `README.md` — feature paragraph + bump the "Shipped in X.Y.Z" line (per repo
  CLAUDE.md §New Features).
- `RELEASE_NOTES.md` — `## What's New` entry following the required format.
- **Doc comments** on every new exported function and the new `main.ts` methods,
  matching the density of `vars.ts` / the existing html-block methods.

**Obsidian API conventions** (repo CLAUDE.md §Obsidian API Rules) apply to all new
code: `activeDocument`/`createDiv` over `document.*`, `window.setTimeout`,
`catch { /* reason */ }`, no static Node imports. The engine in `template.ts` is
pure and imports nothing, so only the `main.ts` glue touches the Obsidian API.

---

## 10. Open decisions (recommendation in **bold**)

- **A — Engine home:** new `src/template.ts` (pure, testable) **← recommended**,
  vs folding into `vars.ts`. Separate file keeps `vars.ts` focused.
- **B — Syntax:** Handlebars-style `{{ }}` / `{{> }}` / `{{#each}}` **← recommended**
  (familiar, distinct from HTML/CSS), vs extending the existing `$var` style
  (collides with JS/templates; a sigil-on-identifier has no open/close form, so
  blocks force you to reinvent `{{#each}}…{{/each}}` anyway). **Decided:** keep
  both — `$var` for scalars into code/prose, `{{ }}` for structured rendering.
  Separate lanes; `$var` is **not** deprecated. See §12 for how far `{{ }}` reaches.
- **C — Business/shared data home:** `template_context:` named context notes so
  data stays in `Business Config.md` **← recommended**, vs baking constants into a
  partial `.html` (simpler but duplicates the config note).
- **D — Filters:** built-in registry incl. `eur`/`date` **← recommended** (keeps
  frontmatter raw/queryable), vs pre-formatting values in frontmatter (breaks
  Dataview math).
- **E — Activation:** explicit `template` fence flag **← recommended**; global
  `htmlTemplating` setting as an opt-in convenience. (Never auto-rewrite every
  `{{`-containing block by default — framework demos.)

---

## 11. Out of scope (deliberately)

- **Arithmetic / expressions** in templates (`{{ qty * price }}`). Data is computed
  once at entry (or by the note's own `vars`/exec block) and stored; templates
  *display*, they don't compute. Keeps the engine declarative and safe.
- Full Handlebars (helpers, partial params, block params beyond `this`/`@index`).
- Running JS *inside* the template. (Want computation? Use a real CodeSuite
  `javascript`/`python` block to produce values, then template them.)

---

## 12. Future directions — how far `{{ }}` should reach

`$var` and `{{ }}` serve different jobs and stay in **separate lanes**: `$var`
injects scalars into code/prose, `{{ }}` renders documents from structured data.
No migration, no deprecation.

**Natural to extend later** — the engine is content-type-agnostic (pure
string→string), so generalizing costs little once Phases 1–2 land:

- The `template` flag on **other fenced block types** — `svg` (data-driven charts),
  `markdown`, `latex`, `csv`. Same engine, different block language.
- The **filter** registry grows per need (`percent`, `pad`, `truncate`, …).
- ✅ **Embedded `.html` files** — `![[invoice.html|template pdf]]` templates the
  embedded file against the embedding note. **Shipped** (1.12.0): the embed path
  (`populateEmbedContainer`) threads `htmlTemplate`/`htmlPdf` into the existing
  `addHtmlPreview` seam, with `template`/`notemplate`/`pdf` alias flags mirroring
  the fence flags and the global settings applying. The cleanest invoice setup —
  data in frontmatter, one embed line, no fenced block. The standalone
  **code-file view** (opening `invoice.html` directly) deliberately still shows
  raw source — that's where you edit the template.

**Deliberately NOT planned:**

- `{{ }}` in **markdown body prose** — collides with Obsidian's core Templates
  syntax (`{{title}}`, `{{date}}`) and overlaps Dataview/Templater, which already
  own structured content in notes.
- **Retiring `$var`** — it keeps a live inline binding (`updateInlineVarRefs`) that
  has no equivalent in an iframe-rendered block; forcing a migration buys nothing.

---

## 13. Effort estimate

- Phase 1: `template.ts` (~200 lines incl. docs) + ~60 lines of `main.ts` glue +
  settings + tests/docs.
- Phases 2–3: ~120 more lines total.

Small, self-contained, and squarely in the grain of the existing variable/preview
machinery. **No changes to execution, the export/print pipeline, or the iframe
sandbox.**
```

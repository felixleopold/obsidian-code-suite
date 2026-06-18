/**
 * A small, Handlebars-flavoured templating engine for `html` code blocks.
 *
 * It turns a static `html` block into a *data-driven* document: the note's
 * frontmatter, CodeSuite vars, and shared "context notes" are interpolated into
 * the markup, a shared partial can be pulled in, and a frontmatter array can be
 * looped over. The driving use case is reusable documents — invoices, reports,
 * certificates — where the layout/CSS lives once (in a partial) and the data
 * lives in frontmatter.
 *
 * Design constraints (mirroring `vars.ts`):
 *   - **Pure.** No Obsidian imports — the engine is `string → string` given a
 *     context, so it is unit-testable in isolation. The only dependency is
 *     `vars.ts` (also pure), reused so a looked-up value is formatted exactly
 *     the way an inline `$var` would be.
 *   - **Never throws.** A malformed construct is left verbatim and a
 *     `console.warn` is emitted, matching CodeSuite's "degrade gracefully"
 *     posture — a broken template must never blank out the document.
 *   - **Declarative.** No arithmetic or arbitrary JS inside the template (that
 *     is what real `javascript`/`python` blocks are for). Templates *display*
 *     data; they do not compute it.
 *
 * Syntax summary:
 *   {{ path }}            interpolate, HTML-escaped (dotted paths: a.b.c)
 *   {{{ path }}}          interpolate, unescaped (also `{{ path | raw }}`)
 *   {{ path | filter }}   apply a filter (chainable): eur, date, number, …
 *   {{> partial }}        include another file (expanded by {@link expandIncludes})
 *   {{#each items}}…{{/each}}     loop; inside: `this`, `@index`, `@first`, `@last`
 *   {{#if x}}…{{else}}…{{/if}}    conditional; `{{#unless x}}` is the negation
 *   {{! comment }}        dropped from the output
 */

import { fromJsValue, toDisplay } from "./vars";

/** A value lookup against the layered template context. */
export interface TemplateContext {
  /** Resolve a dotted path (e.g. "this.description", "biz.biz_iban"). Returns
   *  `undefined` for a missing path (callers render that as an empty string). */
  lookup(path: string): unknown;
  /** Return a child context with `scope` pushed on top (highest precedence).
   *  Used by `{{#each}}` to expose `this`/`@index`/the element's own fields. */
  withScope(scope: Record<string, unknown>): TemplateContext;
}

/** Maximum `{{> partial }}` nesting depth before the engine stops recursing. */
const MAX_INCLUDE_DEPTH = 10;

// ─── Public context factory ──────────────────────────────────────────────────

/**
 * Build a {@link TemplateContext} over a flat `base` record (the merged
 * frontmatter / vars / namespaced context-notes assembled by the caller).
 * Loop scopes are layered on top via {@link TemplateContext.withScope}; the
 * topmost scope that owns the path's head segment wins, so `{{#each}}` locals
 * shadow note data exactly like Handlebars.
 */
export function createContext(base: Record<string, unknown>): TemplateContext {
  return new LayeredContext(base, []);
}

class LayeredContext implements TemplateContext {
  constructor(
    private readonly base: Record<string, unknown>,
    private readonly scopes: Record<string, unknown>[],
  ) {}

  lookup(path: string): unknown {
    const segs = splitPath(path);
    if (!segs.length) return undefined;
    const head = segs[0];
    // Highest-precedence scope first, then the base record.
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (Object.prototype.hasOwnProperty.call(this.scopes[i], head)) {
        return descend(this.scopes[i][head], segs, 1);
      }
    }
    if (Object.prototype.hasOwnProperty.call(this.base, head)) {
      return descend(this.base[head], segs, 1);
    }
    return undefined;
  }

  withScope(scope: Record<string, unknown>): TemplateContext {
    return new LayeredContext(this.base, [...this.scopes, scope]);
  }
}

/** Split a dotted path into non-empty segments (`a.b` → ["a","b"]). */
function splitPath(path: string): string[] {
  return path.trim().split(".").map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Walk the remaining `segs` (from index `i`) into a nested value. */
function descend(value: unknown, segs: string[], i: number): unknown {
  let cur: unknown = value;
  for (; i < segs.length; i++) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[segs[i]];
  }
  return cur;
}

// ─── Includes (async pre-pass) ───────────────────────────────────────────────

/**
 * Expand `{{> partial }}` includes by inlining each partial's contents before
 * interpolation, so a shared CSS/layout file lives in exactly one place. The
 * `readPartial` reader resolves a path to file contents (or `null` when
 * missing); the engine stays Obsidian-agnostic.
 *
 * Recursive (a partial may include another), depth-capped at
 * {@link MAX_INCLUDE_DEPTH}, and cycle-guarded by the ancestor chain. A missing
 * partial or an over-deep / cyclic include degrades gracefully — the reference
 * is left verbatim (missing/too-deep) or dropped (cycle) with a `console.warn`,
 * never throwing. Returns the source unchanged when it has no includes.
 */
export async function expandIncludes(
  source: string,
  readPartial: (path: string) => Promise<string | null>,
  depth = 0,
): Promise<string> {
  return expandInner(source, readPartial, depth, new Set<string>());
}

async function expandInner(
  source: string,
  readPartial: (path: string) => Promise<string | null>,
  depth: number,
  seen: Set<string>,
): Promise<string> {
  const re = /\{\{>\s*([^}]+?)\s*\}\}/g;
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    out += source.slice(last, m.index);
    last = m.index + m[0].length;
    const path = m[1].trim();

    if (depth >= MAX_INCLUDE_DEPTH) {
      console.warn(`CodeSuite template: include depth limit (${MAX_INCLUDE_DEPTH}) reached at "${path}"`);
      out += m[0];
      continue;
    }
    if (seen.has(path)) {
      console.warn(`CodeSuite template: include cycle detected at "${path}" — skipped`);
      continue;
    }
    const content = await readPartial(path);
    if (content === null) {
      console.warn(`CodeSuite template: partial not found: "${path}"`);
      out += m[0];
      continue;
    }
    const nextSeen = new Set(seen);
    nextSeen.add(path);
    out += await expandInner(content, readPartial, depth + 1, nextSeen);
  }
  out += source.slice(last);
  return out;
}

// ─── Synchronous render pass ─────────────────────────────────────────────────

/**
 * Render a template against `ctx`: interpolation, filters, escaping,
 * `{{#each}}`, and `{{#if}}`/`{{#unless}}`. Assumes `{{> includes }}` have
 * already been expanded by {@link expandIncludes}.
 *
 * Never throws. If the template is structurally broken (an unbalanced block),
 * the original source is returned verbatim with a `console.warn`, so a typo in
 * one block can't blank out a whole document.
 */
export function renderTemplate(source: string, ctx: TemplateContext): string {
  let nodes: Node[];
  try {
    nodes = parseProgram(tokenize(source));
  } catch (err) {
    console.warn("CodeSuite template: parse error — rendering source verbatim.", err);
    return source;
  }
  return renderNodes(nodes, ctx);
}

/** True if `source` contains any `{{ … }}` construct (cheap activation gate). */
export function hasTemplateSyntax(source: string): boolean {
  return /\{\{[\s\S]*?\}\}/.test(source);
}

// ─── Tokenizer ───────────────────────────────────────────────────────────────

type Token =
  | { kind: "text"; value: string }
  | { kind: "interp"; expr: string; raw: boolean }
  | { kind: "open"; helper: "each" | "if" | "unless"; expr: string; src: string }
  | { kind: "close"; helper: "each" | "if" | "unless" }
  | { kind: "else" }
  | { kind: "comment" }
  | { kind: "verbatim"; value: string };

/**
 * Split the source into text and mustache tokens. The triple-stache
 * alternative is tried first so `{{{ x }}}` is one raw token, not a double plus
 * a stray brace. Both forms are non-greedy, stopping at the first close.
 */
function tokenize(source: string): Token[] {
  const re = /\{\{\{([\s\S]*?)\}\}\}|\{\{([\s\S]*?)\}\}/g;
  const tokens: Token[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    if (m.index > last) tokens.push({ kind: "text", value: source.slice(last, m.index) });
    last = m.index + m[0].length;
    const triple = m[1] !== undefined;
    const inner = (triple ? m[1] : m[2]).trim();
    tokens.push(classify(inner, triple, m[0]));
  }
  if (last < source.length) tokens.push({ kind: "text", value: source.slice(last) });
  return tokens;
}

/** Classify a mustache's inner text into a token. */
function classify(inner: string, triple: boolean, src: string): Token {
  if (inner.startsWith("!")) return { kind: "comment" };
  // A leftover include (the partial was missing/too-deep) is emitted verbatim.
  if (inner.startsWith(">")) return { kind: "verbatim", value: src };
  if (inner === "else") return { kind: "else" };
  if (inner.startsWith("/")) {
    const helper = inner.slice(1).trim();
    if (helper === "each" || helper === "if" || helper === "unless") return { kind: "close", helper };
    return { kind: "verbatim", value: src };
  }
  if (inner.startsWith("#")) {
    const sp = inner.indexOf(" ");
    const helper = (sp === -1 ? inner.slice(1) : inner.slice(1, sp)).trim();
    const expr = sp === -1 ? "" : inner.slice(sp + 1).trim();
    if (helper === "each" || helper === "if" || helper === "unless") {
      return { kind: "open", helper, expr, src };
    }
    return { kind: "verbatim", value: src };
  }
  return { kind: "interp", expr: inner, raw: triple };
}

// ─── Parser (tokens → AST) ───────────────────────────────────────────────────

type Node =
  | { type: "text"; value: string }
  | { type: "interp"; expr: string; raw: boolean }
  | { type: "each"; expr: string; body: Node[] }
  | { type: "if"; negate: boolean; expr: string; body: Node[]; elseBody: Node[] };

/** Parse the full token stream, requiring every block to be balanced. */
function parseProgram(tokens: Token[]): Node[] {
  const [nodes, pos] = parseUntil(tokens, 0, null);
  if (pos !== tokens.length) throw new Error("unexpected closing tag");
  return nodes;
}

/**
 * Parse nodes until a close matching `stop` (or, for if/unless, an `else`) is
 * reached. Returns the nodes plus the index of the stopping token (which the
 * caller consumes). Throws on an unbalanced or unexpected close.
 */
function parseUntil(
  tokens: Token[],
  start: number,
  stop: "each" | "if" | "unless" | null,
): [Node[], number] {
  const out: Node[] = [];
  let pos = start;
  while (pos < tokens.length) {
    const t = tokens[pos];
    if (t.kind === "close") {
      if (stop && t.helper === stop) return [out, pos];
      throw new Error(`unexpected {{/${t.helper}}}`);
    }
    if (t.kind === "else") {
      if (stop === "if" || stop === "unless") return [out, pos];
      // A stray else outside an if is treated as literal text.
      out.push({ type: "text", value: "{{else}}" });
      pos++;
      continue;
    }
    if (t.kind === "open") {
      if (t.helper === "each") {
        const [body, p2] = parseUntil(tokens, pos + 1, "each");
        out.push({ type: "each", expr: t.expr, body });
        pos = p2 + 1;
      } else {
        const [body, p2] = parseUntil(tokens, pos + 1, t.helper);
        let elseBody: Node[] = [];
        let endPos = p2;
        if (tokens[p2] && tokens[p2].kind === "else") {
          const [eb, p3] = parseUntil(tokens, p2 + 1, t.helper);
          elseBody = eb;
          endPos = p3;
        }
        out.push({ type: "if", negate: t.helper === "unless", expr: t.expr, body, elseBody });
        pos = endPos + 1;
      }
      continue;
    }
    if (t.kind === "text") out.push({ type: "text", value: t.value });
    else if (t.kind === "verbatim") out.push({ type: "text", value: t.value });
    else if (t.kind === "interp") out.push({ type: "interp", expr: t.expr, raw: t.raw });
    // comments are dropped
    pos++;
  }
  if (stop) throw new Error(`missing {{/${stop}}}`);
  return [out, pos];
}

// ─── Renderer ────────────────────────────────────────────────────────────────

function renderNodes(nodes: Node[], ctx: TemplateContext): string {
  let out = "";
  for (const n of nodes) {
    switch (n.type) {
      case "text":
        out += n.value;
        break;
      case "interp":
        out += renderInterp(n.expr, n.raw, ctx);
        break;
      case "each": {
        const arr = ctx.lookup(n.expr.trim());
        if (Array.isArray(arr)) {
          arr.forEach((el, i) => {
            // Spread an object element's own fields so both `{{ field }}` and
            // `{{ this.field }}` resolve; always expose `this` and the @-locals.
            const scope: Record<string, unknown> =
              el && typeof el === "object" && !Array.isArray(el)
                ? { ...(el as Record<string, unknown>) }
                : {};
            scope["this"] = el;
            scope["@index"] = i;
            scope["@first"] = i === 0;
            scope["@last"] = i === arr.length - 1;
            out += renderNodes(n.body, ctx.withScope(scope));
          });
        }
        break;
      }
      case "if": {
        const truthy = isTruthy(ctx.lookup(n.expr.trim()));
        const take = n.negate ? !truthy : truthy;
        out += renderNodes(take ? n.body : n.elseBody, ctx);
        break;
      }
    }
  }
  return out;
}

/** Resolve an interpolation expression (`path | filter:arg | …`) to a string. */
function renderInterp(expr: string, rawByDefault: boolean, ctx: TemplateContext): string {
  const { path, filters } = parseExpr(expr);
  let value = ctx.lookup(path);
  let raw = rawByDefault;
  for (const f of filters) {
    if (f.name === "raw") {
      raw = true;
      continue;
    }
    if (f.name === "default") {
      if (value === null || value === undefined || value === "") value = f.arg ?? "";
      continue;
    }
    const fn = FILTERS[f.name];
    if (fn) value = fn(value, f.arg);
    else console.warn(`CodeSuite template: unknown filter "${f.name}"`);
  }
  const str = stringify(value);
  return raw ? str : escapeHtml(str);
}

interface ParsedFilter {
  name: string;
  arg?: string;
}

/** Split `path | filter | filter:"arg"` into the path and its filter chain,
 *  respecting quotes so a `|` inside an argument is not a separator. */
function parseExpr(expr: string): { path: string; filters: ParsedFilter[] } {
  const parts = splitOnPipe(expr);
  const path = (parts[0] ?? "").trim();
  const filters = parts.slice(1).map((p) => parseFilter(p.trim())).filter((f) => f.name.length > 0);
  return { path, filters };
}

/** Parse one `name` or `name:arg` filter token; the arg may be quoted. */
function parseFilter(s: string): ParsedFilter {
  const ci = s.indexOf(":");
  if (ci === -1) return { name: s.trim() };
  return { name: s.slice(0, ci).trim(), arg: unquoteArg(s.slice(ci + 1).trim()) };
}

/** Split on top-level `|` only — a `|` inside single/double quotes is kept. */
function splitOnPipe(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  for (const ch of s) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === "|") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/** Strip one matched layer of surrounding quotes from a filter argument. */
function unquoteArg(a: string): string {
  if (
    a.length >= 2 &&
    ((a[0] === '"' && a[a.length - 1] === '"') || (a[0] === "'" && a[a.length - 1] === "'"))
  ) {
    return a.slice(1, -1);
  }
  return a;
}

// ─── Value formatting ────────────────────────────────────────────────────────

/**
 * Stringify a looked-up value for output. Strings pass through; everything else
 * is normalised through `vars.ts` (`fromJsValue` → `toDisplay`) so a number,
 * boolean, or structured value formats exactly as an inline `$var` would.
 * Missing values render as the empty string (friendly for optional fields).
 */
function stringify(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  return toDisplay(fromJsValue(v));
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** HTML-escape interpolated text so a stray `<` can't break layout or inject markup. */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/** Truthiness for `{{#if}}`/`{{#unless}}`: non-empty string / non-zero number /
 *  non-empty array / present object / `true`. */
function isTruthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false) return false;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return true;
  return Boolean(v);
}

/** Coerce a value to a finite number, or `null` when it isn't numeric. */
function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Coerce a value to a Date, or `null`. Date-only `YYYY-MM-DD` strings are
 *  parsed in local time so the displayed day never shifts across time zones. */
function toDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "string") {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === "number") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Built-in formatting filters. Keeping currency/date/number formatting in the
 * *template* lets frontmatter stay raw and Dataview-queryable (`amount: 1500`)
 * while the document shows `€ 1.500,00` — no double source of truth.
 *
 * `raw` and `default` are not listed here: they control the interpolation
 * pipeline itself (escaping / fallback) and are handled in `renderInterp`.
 * The registry is intentionally open for extension (percent, pad, truncate, …).
 */
export const FILTERS: Record<string, (v: unknown, arg?: string) => string> = {
  /** Currency, default locale de-AT (`{{ amount | eur }}` → `€ 1.500,00`). An
   *  arg overrides the locale (`{{ amount | eur:"en-US" }}`). */
  eur: (v, arg) => formatCurrency(v, "EUR", arg || "de-AT"),
  /** Locale number with grouping. Arg overrides the locale (default de-AT). */
  number: (v, arg) => {
    const n = toNumber(v);
    if (n === null) return stringify(v);
    try {
      return new Intl.NumberFormat(arg || "de-AT").format(n);
    } catch {
      return stringify(v);
    }
  },
  /** `dd.MM.yyyy` by default; arg overrides the locale (`date:"en-US"`). */
  date: (v, arg) => {
    const d = toDate(v);
    if (!d) return stringify(v);
    try {
      return new Intl.DateTimeFormat(arg || "de-AT", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(d);
    } catch {
      return stringify(v);
    }
  },
  upper: (v) => stringify(v).toUpperCase(),
  lower: (v) => stringify(v).toLowerCase(),
};

function formatCurrency(v: unknown, currency: string, locale: string): string {
  const n = toNumber(v);
  if (n === null) return stringify(v);
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(n);
  } catch {
    return stringify(v);
  }
}

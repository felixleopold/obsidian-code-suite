/**
 * Typed variable model for `vars` blocks, `code_vars:` frontmatter, and data
 * tables. A raw value (as written by the user) is parsed into a `VarValue`
 * carrying an explicit type, then rendered into the correct literal for each
 * target language at injection time.
 *
 * This is what fixes issue #16: previously every value was injected as a
 * string, so `5` became the string `"5"`, `True` became `"True"`, and a quoted
 * `"https://x"` was double-quoted into `'"https://x"'`. Now the literal type is
 * inferred (or forced via a `:type` hint) and emitted natively.
 */

/** Recognised explicit type hints, e.g. `PORT:str = 8080`. */
export type VarTypeHint = "str" | "int" | "float" | "bool" | "json";

/** A parsed, typed variable value. Numbers keep their literal text so the
 *  int/float distinction and exact formatting survive the round-trip. */
export type VarValue =
  | { kind: "string"; value: string }
  | { kind: "int"; raw: string }
  | { kind: "float"; raw: string }
  | { kind: "bool"; value: boolean }
  | { kind: "null" }
  | { kind: "json"; value: unknown };

/** One parsed assignment from a `vars` block. */
export interface VarEntry {
  /** Variable name (a valid identifier). */
  name: string;
  /** Typed value, used for injection. */
  value: VarValue;
  /** The value text exactly as written, used for re-rendering the block. */
  raw: string;
}

const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const INT_RE = /^-?\d+$/;
const FLOAT_RE = /^-?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?$/;
const HINTS = new Set<VarTypeHint>(["str", "int", "float", "bool", "json"]);

export function isValidIdent(name: string): boolean {
  return IDENT_RE.test(name);
}

/** Strip one matched layer of surrounding quotes. Double-quoted strings get
 *  JSON escape handling; single-quoted strings are taken literally. */
function unquote(text: string): string {
  if (text.length >= 2 && text[0] === '"' && text[text.length - 1] === '"') {
    try {
      return JSON.parse(text) as string;
    } catch (_e) {
      return text.slice(1, -1);
    }
  }
  if (text.length >= 2 && text[0] === "'" && text[text.length - 1] === "'") {
    return text.slice(1, -1);
  }
  return text;
}

/** Coerce a raw value to a forced type from a `:type` hint. Falls back to a
 *  bare string when the value can't be coerced (never throws). */
function coerceWithHint(raw: string, hint: VarTypeHint): VarValue {
  switch (hint) {
    case "str":
      return { kind: "string", value: unquote(raw) };
    case "int":
      return INT_RE.test(raw.trim()) ? { kind: "int", raw: raw.trim() } : { kind: "string", value: unquote(raw) };
    case "float":
      return FLOAT_RE.test(raw.trim()) ? { kind: "float", raw: raw.trim() } : { kind: "string", value: unquote(raw) };
    case "bool":
      return { kind: "bool", value: /^(true|yes|1)$/i.test(raw.trim()) };
    case "json":
      try {
        return { kind: "json", value: JSON.parse(raw) };
      } catch (_e) {
        return { kind: "string", value: unquote(raw) };
      }
  }
}

/** Infer the type of a single-line value from how it is written. */
export function inferVarValue(raw: string, hint?: VarTypeHint): VarValue {
  if (hint) return coerceWithHint(raw, hint);
  const t = raw.trim();
  if (t === "") return { kind: "string", value: "" };

  // Quoted string — strip one layer of quotes.
  const quoted = (t[0] === '"' && t[t.length - 1] === '"') || (t[0] === "'" && t[t.length - 1] === "'");
  if (quoted && t.length >= 2) return { kind: "string", value: unquote(t) };

  // Booleans (Python-, JS-, and YAML-style spellings).
  if (/^(true|false)$/i.test(t)) return { kind: "bool", value: /^true$/i.test(t) };
  // Null / None / nil.
  if (/^(null|none|nil)$/i.test(t)) return { kind: "null" };

  // Numbers.
  if (INT_RE.test(t)) return { kind: "int", raw: t };
  if (FLOAT_RE.test(t)) return { kind: "float", raw: t };

  // Inline JSON arrays / objects.
  if ((t[0] === "[" && t[t.length - 1] === "]") || (t[0] === "{" && t[t.length - 1] === "}")) {
    try {
      return { kind: "json", value: JSON.parse(t) };
    } catch (_e) {
      /* not valid JSON — fall through to bare string */
    }
  }

  // Bare, unquoted text is treated as a string (preserves the original
  // ergonomics of `dataset = sales_q4.csv`).
  return { kind: "string", value: t };
}

/** Wrap an already-typed JS value (e.g. parsed from YAML frontmatter) into a
 *  VarValue without re-inferring from text — YAML has already typed it. */
export function fromJsValue(value: unknown): VarValue {
  if (value === null || value === undefined) return { kind: "null" };
  if (typeof value === "boolean") return { kind: "bool", value };
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { kind: "int", raw: String(value) }
      : { kind: "float", raw: String(value) };
  }
  if (typeof value === "string") return { kind: "string", value };
  return { kind: "json", value };
}

/** Convert a typed value to a plain JS value (for embedding inside table
 *  structures and for JSON serialisation). */
export function toJs(v: VarValue): unknown {
  switch (v.kind) {
    case "string": return v.value;
    case "int": return Number(v.raw);
    case "float": return Number(v.raw);
    case "bool": return v.value;
    case "null": return null;
    case "json": return v.value;
  }
}

/** Render any JS value as a Python literal. */
function jsToPython(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(jsToPython).join(", ") + "]";
  if (typeof value === "object") {
    const parts = Object.entries(value as Record<string, unknown>).map(
      ([k, v]) => `${JSON.stringify(k)}: ${jsToPython(v)}`
    );
    return "{" + parts.join(", ") + "}";
  }
  return JSON.stringify(value);
}

/** Render a typed value as a Python literal (`5`, `True`, `"x"`, `[...]`). */
export function toPython(v: VarValue): string {
  switch (v.kind) {
    case "string": return JSON.stringify(v.value);
    case "int": return v.raw;
    case "float": return v.raw;
    case "bool": return v.value ? "True" : "False";
    case "null": return "None";
    case "json": return jsToPython(v.value);
  }
}

/** Render a typed value as the *unquoted* scalar a shell variable should hold.
 *  Shells are stringly typed; structured values become a JSON string. */
export function toShellScalar(v: VarValue): string {
  switch (v.kind) {
    case "string": return v.value;
    case "int": return v.raw;
    case "float": return v.raw;
    case "bool": return v.value ? "true" : "false";
    case "null": return "";
    case "json": return JSON.stringify(v.value);
  }
}

/** Human-readable display form, used for inline `$var` substitution and the
 *  rendered vars block. Strings show without surrounding quotes. */
export function toDisplay(v: VarValue): string {
  switch (v.kind) {
    case "string": return v.value;
    case "int": return v.raw;
    case "float": return v.raw;
    case "bool": return v.value ? "true" : "false";
    case "null": return "";
    case "json": return JSON.stringify(v.value);
  }
}

/** A single Python seed-assignment line for a typed value. */
export function pythonSeedLine(name: string, v: VarValue): string {
  return `${name} = ${toPython(v)}`;
}

/** A single shell seed-assignment line for a typed value. */
export function shellSeedLine(name: string, v: VarValue): string {
  const scalar = toShellScalar(v).replace(/'/g, "'\\''");
  return `${name}='${scalar}'`;
}

/** Split a `key` token into its name and optional `:type` hint
 *  (e.g. `PORT:str` → { name: "PORT", hint: "str" }). */
function parseKey(keyPart: string): { name: string; hint?: VarTypeHint } {
  const ci = keyPart.indexOf(":");
  if (ci === -1) return { name: keyPart.trim() };
  const name = keyPart.slice(0, ci).trim();
  const hintStr = keyPart.slice(ci + 1).trim().toLowerCase();
  if (HINTS.has(hintStr as VarTypeHint)) return { name, hint: hintStr as VarTypeHint };
  // Unrecognised text after the colon — treat the whole thing as the name so
  // it fails identifier validation and the line is skipped.
  return { name: keyPart.trim() };
}

/**
 * Parse a `vars` block body into typed entries.
 *
 * Syntax: one `key = value` (or `key: value`) per line. Blank lines and lines
 * starting with `#` are ignored. A `:type` hint may follow the key when the
 * `=` separator is used (`PORT:str = 8080`). Values may be triple-quoted
 * (`"""` or `'''`) to span multiple lines; one leading and one trailing
 * newline are trimmed for ergonomics.
 */
export function parseVarsSource(source: string): VarEntry[] {
  const entries: VarEntry[] = [];
  const lines = source.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    const colon = line.indexOf(":");
    const sep = eq !== -1 ? eq : colon;
    if (sep === -1) continue;

    const { name, hint } = parseKey(line.slice(0, sep));
    if (!isValidIdent(name)) continue;
    const valPart = line.slice(sep + 1).trim();

    // Multiline (or single-line) triple-quoted string.
    const tq = valPart.slice(0, 3);
    if (tq === '"""' || tq === "'''") {
      const rest = valPart.slice(3);
      const sameLineClose = rest.indexOf(tq);
      if (sameLineClose !== -1) {
        const content = rest.slice(0, sameLineClose);
        entries.push({ name, value: { kind: "string", value: content }, raw: valPart });
        continue;
      }
      const buf = [rest];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const closeIdx = lines[j].indexOf(tq);
        if (closeIdx !== -1) {
          buf.push(lines[j].slice(0, closeIdx));
          break;
        }
        buf.push(lines[j]);
      }
      i = j; // consume through the closing line
      const content = buf.join("\n").replace(/^\n/, "").replace(/\n$/, "");
      // Store the full triple-quoted block so the vars display shows all lines.
      entries.push({ name, value: { kind: "string", value: content }, raw: `"""\n${content}\n"""` });
      continue;
    }

    entries.push({ name, value: inferVarValue(valPart, hint), raw: valPart });
  }

  return entries;
}

// ─── Data tables (experimental) ──────────────────────────────────────────────

/** How a markdown table is exposed to code. */
export type TableShape = "records" | "dict" | "columns" | "matrix" | "vars";

const SHAPES = new Set<TableShape>(["records", "dict", "columns", "matrix", "vars"]);

export interface TableDirective {
  name?: string;       // omitted for the `vars` shape
  shape: TableShape;
}

/** Parse a `%% codesuite: <name> [as <shape>] %%` directive line.
 *  Returns null when the line isn't a CodeSuite table directive. */
export function parseTableDirective(line: string): TableDirective | null {
  const m = line.match(/%%\s*codesuite\b\s*:?\s*(.*?)\s*%%/i);
  if (!m) return null;
  const inner = m[1].trim();
  if (!inner) return null;
  const tokens = inner.split(/\s+/);

  if (tokens[0].toLowerCase() === "vars" && tokens.length === 1) {
    return { shape: "vars" };
  }

  const name = tokens[0];
  if (!isValidIdent(name)) return null;
  let shape: TableShape = "records";
  if (tokens.length >= 3 && tokens[1].toLowerCase() === "as") {
    const s = tokens[2].toLowerCase();
    if (!SHAPES.has(s as TableShape)) return null;
    shape = s as TableShape;
  } else if (tokens.length === 2) {
    // Allow the shorthand `%% codesuite: prices dict %%`.
    const s = tokens[1].toLowerCase();
    if (SHAPES.has(s as TableShape)) shape = s as TableShape;
    else return null;
  }
  return { name, shape };
}

/** Header-convention detection: a 2+ column table whose first header is
 *  var/variable/name/key and second is `value` is treated as a `vars` table. */
export function headerLooksLikeVars(headers: string[]): boolean {
  if (headers.length < 2) return false;
  const a = headers[0].toLowerCase().trim();
  const b = headers[1].toLowerCase().trim();
  return ["var", "vars", "variable", "name", "key"].includes(a) && b === "value";
}

/** Build the variable(s) a table contributes, given its parsed cells and shape.
 *  The `vars` shape yields one entry per row; all other shapes yield a single
 *  structured (json) entry under `name`. */
export function buildTableVars(
  headers: string[],
  rows: string[][],
  directive: TableDirective
): VarEntry[] {
  const infer = (cell: string) => inferVarValue((cell ?? "").trim());

  if (directive.shape === "vars") {
    const hasTypeCol = headers.length >= 3 && headers[2].toLowerCase().trim() === "type";
    const out: VarEntry[] = [];
    for (const r of rows) {
      const name = (r[0] ?? "").trim();
      if (!isValidIdent(name)) continue;
      const hint = hasTypeCol ? ((r[2] ?? "").trim().toLowerCase() as VarTypeHint) : undefined;
      const value = inferVarValue((r[1] ?? "").trim(), HINTS.has(hint as VarTypeHint) ? hint : undefined);
      out.push({ name, value, raw: (r[1] ?? "").trim() });
    }
    return out;
  }

  const name = directive.name;
  if (!name || !isValidIdent(name)) return [];

  let structured: unknown;
  switch (directive.shape) {
    case "records":
      structured = rows.map((r) =>
        Object.fromEntries(headers.map((h, i) => [h, toJs(infer(r[i]))]))
      );
      break;
    case "columns":
      structured = Object.fromEntries(
        headers.map((h, i) => [h, rows.map((r) => toJs(infer(r[i])))])
      );
      break;
    case "matrix":
      // Markdown always puts the first row in <thead>, so `headers` are the
      // first row of the matrix. Include them so [[1,2,3],[4,5,6],[7,8,9]]
      // works correctly instead of [[4,5,6],[7,8,9]].
      structured = [
        headers.map((h) => toJs(infer(h))),
        ...rows.map((r) => r.map((c) => toJs(infer(c)))),
      ];
      break;
    case "dict":
      structured = Object.fromEntries(
        rows.map((r) => [String(toJs(infer(r[0]))), toJs(infer(r[1]))])
      );
      break;
  }

  const value: VarValue = { kind: "json", value: structured };
  return [{ name, value, raw: JSON.stringify(structured) }];
}

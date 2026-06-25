/**
 * Import / export / conversion utilities (GitHub issue #5).
 *
 * Pure data transforms only — no Obsidian, Electron, or filesystem access.
 * The plugin (main.ts) handles file pickers, vault writes, DOM capture, and
 * PDF rendering, then calls into the functions here.
 *
 *   - ipynb  ⇄ markdown   (no cell outputs — notebooks round-trip "unrun")
 *   - rendered note DOM → self-contained themed HTML string
 */

// ─── Jupyter notebook types (nbformat 4) ──────────────────────────

export interface NotebookCell {
  cell_type: "code" | "markdown" | "raw";
  /** Jupyter stores source as an array of lines (each keeps its trailing \n). */
  source: string[] | string;
  metadata: Record<string, unknown>;
  outputs?: unknown[];
  execution_count?: number | null;
}

export interface Notebook {
  cells: NotebookCell[];
  metadata: Record<string, unknown>;
  nbformat: number;
  nbformat_minor: number;
}

/**
 * Kernel/language metadata for the canonical languages CodeSuite executes.
 * Used when *exporting* a note to give the notebook a sensible kernelspec.
 * Anything not listed falls back to a minimal generic spec.
 */
const KERNELSPECS: Record<string, { display: string; name: string; language: string }> = {
  python:     { display: "Python 3",   name: "python3",    language: "python" },
  javascript: { display: "JavaScript", name: "javascript", language: "javascript" },
  typescript: { display: "TypeScript", name: "typescript", language: "typescript" },
  ruby:       { display: "Ruby",       name: "ruby",       language: "ruby" },
  r:          { display: "R",          name: "ir",         language: "R" },
  bash:       { display: "Bash",       name: "bash",       language: "bash" },
};

/** Map a notebook language name (kernelspec/language_info) to a fence label. */
function notebookLangToFence(name: string): string {
  const n = name.toLowerCase().trim();
  const map: Record<string, string> = {
    python: "python",
    python3: "python",
    ipython: "python",
    javascript: "javascript",
    js: "javascript",
    node: "javascript",
    typescript: "typescript",
    ts: "typescript",
    ruby: "ruby",
    ir: "r",
    r: "r",
    bash: "bash",
    sh: "shell",
    shell: "shell",
    zsh: "zsh",
  };
  return map[n] || n || "python";
}

/** Collapse a cell's source (array of lines or a single string) into one string. */
function cellSource(cell: NotebookCell): string {
  const s = cell.source;
  return Array.isArray(s) ? s.join("") : String(s ?? "");
}

/**
 * Split text into the line array Jupyter expects: every line keeps its
 * trailing "\n" except the last. An empty string yields an empty array.
 */
function toSourceArray(text: string): string[] {
  const body = text.replace(/\n$/, "");
  if (body === "") return [];
  const lines = body.split("\n");
  return lines.map((l, i) => (i < lines.length - 1 ? l + "\n" : l));
}

/** Drop blank lines from both ends of a line list (used when flushing md cells). */
function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") start++;
  while (end > start && lines[end - 1].trim() === "") end--;
  return lines.slice(start, end);
}

// ─── ipynb → markdown ─────────────────────────────────────────────

/**
 * Detect the notebook's primary language from its metadata. Falls back to
 * "python" when nothing usable is present.
 */
function detectNotebookLang(nb: Notebook): string {
  const meta = nb.metadata ?? {};
  const kernelspec = meta["kernelspec"] as { language?: string; name?: string } | undefined;
  const langInfo = meta["language_info"] as { name?: string } | undefined;
  const raw = kernelspec?.language || langInfo?.name || kernelspec?.name || "python";
  return notebookLangToFence(raw);
}

/**
 * Read a code cell's own language, if it carries one. Multi-language exports tag
 * each code cell with `metadata.vscode.languageId` (the VS Code convention) so a
 * notebook mixing e.g. Python + JavaScript round-trips with each fence intact.
 * Returns "" when the cell has no per-cell language (use the notebook default).
 */
function cellLang(cell: NotebookCell): string {
  const vscode = (cell.metadata as { vscode?: { languageId?: string } } | undefined)?.vscode;
  const id = vscode?.languageId;
  return id ? notebookLangToFence(id) : "";
}

/**
 * Convert a parsed notebook into CodeSuite-flavoured markdown. Code cells
 * become fenced blocks in the cell's own language (falling back to the
 * notebook's kernel language); markdown cells pass through verbatim; raw cells
 * are emitted as plain text. Cell *outputs are dropped* — the note imports
 * "unrun" so the user re-runs blocks in CodeSuite.
 */
export function ipynbToMarkdown(nb: Notebook): { markdown: string; lang: string } {
  const lang = detectNotebookLang(nb);
  const parts: string[] = [];

  for (const cell of nb.cells ?? []) {
    const src = cellSource(cell).replace(/\n$/, "");
    if (cell.cell_type === "code") {
      // Skip wholly-empty code cells so we don't litter the note with blank fences.
      if (src.trim() === "") continue;
      parts.push("```" + (cellLang(cell) || lang) + "\n" + src + "\n```");
    } else {
      // markdown + raw cells: pass through as note prose.
      if (src.trim() === "") continue;
      parts.push(src);
    }
  }

  return { markdown: parts.join("\n\n") + "\n", lang };
}

// ─── markdown → ipynb ─────────────────────────────────────────────

interface FenceBlock {
  /** Indentation before the opening fence. */
  indent: string;
  /** Fence character repeated (``` or ~~~). */
  fence: string;
  /** Full info string after the fence (lang + attrs). */
  info: string;
  /** Resolved/canonical language for the fence's first word. */
  canonical: string;
  /** Raw first word of the info string, lower-cased. */
  rawLang: string;
  /** Body lines between the fences. */
  body: string[];
  /** Whether a matching closing fence was found. */
  closed: boolean;
}

const FENCE_RE = /^(\s*)([`~]{3,})(.*)$/;

/**
 * Walk markdown line-by-line, yielding either a plain line or a fenced block.
 * Shared by language detection and the cell builder so both see the same view.
 */
function scanMarkdown(
  markdown: string,
  resolveLang: (raw: string) => string,
  onLine: (line: string) => void,
  onFence: (block: FenceBlock) => void
): void {
  const lines = markdown.split("\n");
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(FENCE_RE);
    if (!m) {
      onLine(lines[i]);
      i++;
      continue;
    }
    const indent = m[1];
    const fenceChar = m[2][0];
    const fenceLen = m[2].length;
    const info = m[3].trim();
    const rawLang = (info.split(/\s+/)[0] ?? "").toLowerCase();
    const body: string[] = [];
    i++;
    let closed = false;
    while (i < lines.length) {
      const cm = lines[i].match(/^(\s*)([`~]{3,})\s*$/);
      if (cm && cm[2][0] === fenceChar && cm[2].length >= fenceLen) {
        i++;
        closed = true;
        break;
      }
      body.push(lines[i]);
      i++;
    }
    onFence({
      indent,
      fence: fenceChar.repeat(fenceLen),
      info,
      canonical: rawLang ? resolveLang(rawLang) : "",
      rawLang,
      body,
      closed,
    });
  }
}

/**
 * Pick the notebook's target language: the most frequent executable fence
 * language in the note. Defaults to "python" when the note has no runnable
 * code blocks (the notebook is then all markdown cells).
 */
function pickTargetLang(
  markdown: string,
  resolveLang: (raw: string) => string,
  isExec: (lang: string) => boolean
): string {
  const counts = new Map<string, number>();
  scanMarkdown(
    markdown,
    resolveLang,
    () => {},
    (b) => {
      if (b.rawLang === "vars") return;
      if (b.rawLang && isExec(b.canonical)) {
        counts.set(b.canonical, (counts.get(b.canonical) ?? 0) + 1);
      }
    }
  );
  let best = "";
  let bestN = 0;
  for (const [lang, n] of counts) {
    if (n > bestN) {
      best = lang;
      bestN = n;
    }
  }
  return best || "python";
}

/**
 * Convert a CodeSuite/Obsidian markdown note into a Jupyter notebook.
 *
 * The notebook's kernelspec is the note's dominant executable language, but
 * *every* executable code block becomes a code cell — blocks in a non-dominant
 * language carry their own `metadata.vscode.languageId` so editors render and
 * round-trip them in the right language. `vars` blocks and non-executable
 * fences stay inside markdown cells verbatim. No outputs are emitted.
 */
export function markdownToIpynb(
  markdown: string,
  resolveLang: (raw: string) => string,
  isExec: (lang: string) => boolean
): Notebook {
  const target = pickTargetLang(markdown, resolveLang, isExec);
  const cells: NotebookCell[] = [];
  let mdBuf: string[] = [];

  const flushMd = () => {
    const trimmed = trimBlankEdges(mdBuf);
    mdBuf = [];
    if (trimmed.length === 0) return;
    cells.push({
      cell_type: "markdown",
      metadata: {},
      source: toSourceArray(trimmed.join("\n")),
    });
  };

  scanMarkdown(
    markdown,
    resolveLang,
    (line) => mdBuf.push(line),
    (b) => {
      const isCode =
        b.rawLang !== "" &&
        b.rawLang !== "vars" &&
        isExec(b.canonical);

      if (isCode) {
        flushMd();
        // Tag non-dominant languages so editors render them correctly and the
        // notebook round-trips back to the right fence on import. The kernel
        // language stays clean (no redundant tag).
        const metadata = b.canonical === target
          ? {}
          : { vscode: { languageId: b.canonical } };
        cells.push({
          cell_type: "code",
          metadata,
          execution_count: null,
          outputs: [],
          source: toSourceArray(b.body.join("\n")),
        });
        return;
      }

      // Keep the fenced block verbatim inside the surrounding markdown cell.
      mdBuf.push(b.indent + b.fence + b.info);
      for (const line of b.body) mdBuf.push(line);
      if (b.closed) mdBuf.push(b.indent + b.fence);
    }
  );
  flushMd();

  const spec = KERNELSPECS[target] ?? { display: target, name: target, language: target };
  return {
    cells,
    metadata: {
      kernelspec: { display_name: spec.display, language: spec.language, name: spec.name },
      language_info: { name: spec.language },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
}

// ─── rendered note → HTML ─────────────────────────────────────────

/**
 * Minimal, self-contained typography for the exported document. Pulls colours
 * from CSS custom properties (filled in from the live Obsidian theme by the
 * caller) so the page tracks the user's theme without shipping all of
 * Obsidian's stylesheet.
 */
const BASE_HTML_CSS = `
*, *::before, *::after { box-sizing: border-box; }
body {
  margin: 0;
  padding: 2.5rem;
  background: var(--background-primary, #ffffff);
  color: var(--text-normal, #1a1a1a);
  font-family: var(--export-font, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif);
  font-size: 16px;
  line-height: 1.6;
}
/* Match Obsidian's reading view: full content width (the live note has
   readable-line-length handling of its own; we don't re-impose a cap). */
.ocode-export { max-width: none; margin: 0 auto; }
.ocode-export img { max-width: 100%; height: auto; }
.ocode-export h1, .ocode-export h2, .ocode-export h3,
.ocode-export h4, .ocode-export h5, .ocode-export h6 {
  line-height: 1.25; margin: 1.6em 0 0.6em;
}
.ocode-export h1 { font-size: 2em; border-bottom: 1px solid var(--background-modifier-border, #ddd); padding-bottom: 0.3em; }
.ocode-export h2 { font-size: 1.5em; border-bottom: 1px solid var(--background-modifier-border, #ddd); padding-bottom: 0.3em; }
.ocode-export p { margin: 0.8em 0; }
.ocode-export a { color: var(--text-accent, #5b8def); text-decoration: none; }
.ocode-export blockquote {
  margin: 1em 0; padding: 0.2em 1em;
  border-left: 4px solid var(--background-modifier-border, #ddd);
  color: var(--text-muted, #666);
}
.ocode-export :not(pre) > code {
  background: var(--code-background, rgba(135,131,120,0.15));
  padding: 0.15em 0.35em; border-radius: 4px;
  font-family: var(--font-monospace, ui-monospace, "SF Mono", Menlo, Consolas, monospace);
  font-size: 0.9em;
}
.ocode-export table { border-collapse: collapse; margin: 1em 0; }
.ocode-export th, .ocode-export td {
  border: 1px solid var(--background-modifier-border, #ddd); padding: 0.4em 0.8em;
}
.ocode-export ul, .ocode-export ol { padding-left: 1.6em; }
.ocode-export hr { border: none; border-top: 1px solid var(--background-modifier-border, #ddd); margin: 2em 0; }
/* Static export: drop interactive affordances. */
.ocode-export .ocode-pill, .ocode-export .ocode-btn-group,
.ocode-export .ocode-input-bar, .ocode-export .edit-block-button,
.ocode-export .ocode-output-toolbar { display: none !important; }
@media print {
  /* printToPDF runs with margins:0 so the themed background bleeds to the paper
     edge. (Electron's printToPDF, unlike Chrome's CLI, does NOT paint the root
     background into @page/programmatic margins — any margin renders as white
     bands — so margins:0 + a dark body/html background is the only reliable way
     to get full-bleed dark.) This body padding is the content inset; top/bottom
     only insets the first/last page, so for uniform per-page padding use the
     single-page export (one tall page = no interior page breaks). */
  html, body { background: var(--background-primary, #ffffff); }
  body { padding: 12mm 14mm; }
  .ocode-export { max-width: none; }
  /* Kill the leading top margin on the first element (usually the title H1) so
     the header hugs the top inset — no extra wasted band above the title. */
  .ocode-export > :first-child { margin-top: 0 !important; }
  /* Don't override .ocode-wrapper's overflow/border-radius here — keep the exact
     rounded-card look of the reading view. Line wrapping is handled by the
     ocode-wrap-code body class we carry over, not by print rules. Whether code
     blocks may split across pages is controlled per-export by the keepBlocksWhole
     rule appended below, not here. */
  /* Show outputs in full — drop the on-screen scroll caps so nothing is hidden. */
  .ocode-export .ocode-output .ocode-output-content { max-height: none !important; overflow: visible !important; }
  .ocode-export .ocode-output-images { max-height: none !important; overflow: visible !important; }
  .ocode-export .ocode-output-img { max-height: none !important; max-width: 100% !important; }
  .ocode-export img { max-width: 100% !important; height: auto; }
  /* Keep a plot from being split across a page break. */
  .ocode-output-images, .ocode-output-img { break-inside: avoid; }
  /* Smart splitting: avoid stranding a line or two of a paragraph at a page
     edge, keep each short block whole, and never leave a heading orphaned at
     the bottom of a page (it sticks to the content that follows it). The engine
     still fills each page greedily — these only steer the break points so we
     use most of the page without ugly orphan jumps. */
  .ocode-export p, .ocode-export li { orphans: 3; widows: 3; break-inside: avoid; }
  .ocode-export blockquote, .ocode-export table { break-inside: avoid; }
  .ocode-export h1, .ocode-export h2, .ocode-export h3,
  .ocode-export h4, .ocode-export h5, .ocode-export h6 { break-after: avoid; }
}
`;

/** Width strategy for the exported content column. */
export type ExportWidthMode = "default" | "current" | "full";

/** User-selected export options, gathered from the per-export modal. */
export interface ExportOptions {
  /** Content column width: Obsidian's default readable width, the live view's
   *  current width, or unconstrained full width. */
  widthMode: ExportWidthMode;
  /** PDF only: try to keep each code block on one page (split only when a block
   *  is taller than a page). Off = split anywhere, the original behaviour. */
  keepCodeBlocksWhole: boolean;
  /** PDF only: emit a single tall page with no page breaks. */
  singlePage: boolean;
  /** PDF/HTML: prepend the note filename as an H1 heading at the top. */
  includeTitle: boolean;
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  widthMode: "current",
  keepCodeBlocksWhole: true,
  singlePage: false,
  includeTitle: false,
};

/**
 * Assemble a complete, standalone HTML document from a cleaned note body.
 *
 * @param title       Document title (note basename).
 * @param bodyHtml    innerHTML of the cleaned reading-view clone.
 * @param pluginCss   Contents of the plugin's styles.css (ocode-* rules).
 * @param themeVars   A ":root { … }" block of CSS custom properties captured
 *                    from the live Obsidian/CodeSuite theme.
 * @param bodyClass   The live note's relevant body classes (theme-dark/light
 *                    plus the plugin's `ocode-wrap-code` / `ocode-wide-blocks`)
 *                    so its theme- and setting-scoped rules in styles.css apply
 *                    to the export exactly as they do in the reading view.
 */
export function buildExportHtml(opts: {
  title: string;
  bodyHtml: string;
  pluginCss: string;
  themeVars: string;
  bodyClass: string;
  /** Content column width (px) measured from the live reading view, so the
   *  export matches Obsidian's configured width. Omit for full width. */
  contentWidth?: number;
  /** PDF: try to keep each code block whole (break-inside: avoid). A block
   *  taller than a page still splits, so nothing is clipped. */
  keepBlocksWhole?: boolean;
  /** PDF single-page: layout the on-screen render exactly as it prints (no
   *  output scroll caps, fixed inset) so the page-height measurement matches. */
  singlePage?: boolean;
  /** PDF multi-page (separate pages): wrap the body in a repeating-thead/tfoot
   *  table so every printed page gets a themed top/bottom inset. Electron's
   *  printToPDF runs with margins:0 (for full-bleed dark) which only insets the
   *  first page top / last page bottom; the repeating header/footer rows are the
   *  only way to reserve per-page vertical space that inherits the background. */
  paginated?: boolean;
  /** Prepend the note filename as an H1 heading before the body content. */
  includeTitle?: boolean;
}): string {
  const widthRule = opts.contentWidth && opts.contentWidth > 0
    ? `.ocode-export { max-width: ${opts.contentWidth}px; }`
    : "";
  // Keep-whole: prefer not to break inside a code block / its output panel. The
  // browser still splits any block taller than the page, so tall blocks are
  // never clipped — they just split as a last resort.
  const keepWholeRule = opts.keepBlocksWhole ? `@media print {
  .ocode-export .ocode-wrapper { break-inside: avoid; page-break-inside: avoid; }
}` : "";
  // Single-page: the page height is measured from the on-screen render, but the
  // on-screen layout normally differs from print (output scroll caps, padding).
  // Mirror the print layout into screen via the ocode-singlepage class (carried
  // on <body>) so the measured height equals the printed height.
  const singlePageRule = opts.singlePage ? `
body.ocode-singlepage { padding: 10mm 14mm 14mm !important; }
.ocode-singlepage .ocode-export .ocode-output .ocode-output-content { max-height: none !important; overflow: visible !important; }
.ocode-singlepage .ocode-export .ocode-output-images { max-height: none !important; overflow: visible !important; }
.ocode-singlepage .ocode-export .ocode-output-img { max-height: none !important; max-width: 100% !important; }` : "";
  // styles.css hides `.ocode-output` under `@media print` (so printing a note
  // from inside Obsidian omits outputs). For our export the outputs are the
  // whole point — re-show them in print (PDF). Emitted AFTER pluginCss so it wins.
  const printShowOutputs = `@media print {
  .ocode-export .ocode-output { display: block !important; }
  .ocode-export .ocode-output-header { display: flex !important; }
  .ocode-export .ocode-output-images { display: flex !important; }
}`;
  // Repeating-thead/tfoot table: the spacer rows repeat on every printed page,
  // reserving 12mm of themed (background-inheriting) space top and bottom. Body
  // padding only covers the horizontal inset now — the vertical inset moves to
  // the spacers so it lands on *every* page, not just the first/last.
  const paginatedRule = opts.paginated ? `@media print {
  body { padding: 0 14mm !important; }
  table.ocode-page-table { width: 100%; border-collapse: collapse; border: none; margin: 0; }
  table.ocode-page-table > thead > tr > td { height: 12mm; border: none; padding: 0; }
  table.ocode-page-table > tfoot > tr > td { height: 12mm; border: none; padding: 0; }
  table.ocode-page-table > tbody > tr > td { border: none; padding: 0; vertical-align: top; }
}` : "";
  // Title: inject before body content when requested. Uses an existing h1 style
  // so it inherits all heading rules including the bottom border from BASE_HTML_CSS.
  const titleHtml = opts.includeTitle
    ? `<h1 class="ocode-export-title">${escapeHtml(opts.title)}</h1>\n`
    : "";
  // When paginated, the body is wrapped so the spacer rows can repeat per page.
  const inner = `<div class="markdown-preview-view markdown-rendered ocode-export">
${titleHtml}${opts.bodyHtml}
</div>`;
  const body = opts.paginated
    ? `<table class="ocode-page-table">
<thead><tr><td></td></tr></thead>
<tbody><tr><td>
${inner}
</td></tr></tbody>
<tfoot><tr><td></td></tr></tfoot>
</table>`
    : inner;
  return `<!DOCTYPE html>
<html lang="en" class="${escapeAttr(opts.bodyClass)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title)}</title>
<style>
${opts.themeVars}
${BASE_HTML_CSS}
${opts.pluginCss}
${widthRule}
${printShowOutputs}
${keepWholeRule}
${singlePageRule}
${paginatedRule}
</style>
</head>
<body class="${escapeAttr(opts.bodyClass)}">
${body}
</body>
</html>`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

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
 * Convert a parsed notebook into CodeSuite-flavoured markdown. Code cells
 * become fenced blocks in the notebook's language; markdown cells pass through
 * verbatim; raw cells are emitted as plain text. Cell *outputs are dropped* —
 * the note imports "unrun" so the user re-runs blocks in CodeSuite.
 */
export function ipynbToMarkdown(nb: Notebook): { markdown: string; lang: string } {
  const lang = detectNotebookLang(nb);
  const parts: string[] = [];

  for (const cell of nb.cells ?? []) {
    const src = cellSource(cell).replace(/\n$/, "");
    if (cell.cell_type === "code") {
      // Skip wholly-empty code cells so we don't litter the note with blank fences.
      if (src.trim() === "") continue;
      parts.push("```" + lang + "\n" + src + "\n```");
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
 * The notebook is single-kernel (Jupyter's model), so only code blocks in the
 * note's dominant executable language become code cells. Blocks in other
 * languages, `vars` blocks, and non-executable fences stay inside markdown
 * cells verbatim, preserving their fences. No outputs are emitted.
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
      const isTargetCode =
        b.rawLang !== "" &&
        b.rawLang !== "vars" &&
        isExec(b.canonical) &&
        b.canonical === target;

      if (isTargetCode) {
        flushMd();
        cells.push({
          cell_type: "code",
          metadata: {},
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
.ocode-export .ocode-input-bar, .ocode-export .edit-block-button { display: none !important; }
@media print {
  /* Page margins are set to 0 in printToPDF so the themed background reaches the
     paper edge; this padding is the real content inset. */
  body { padding: 16mm 14mm; }
  .ocode-export { max-width: none; }
  /* Don't override .ocode-wrapper's overflow/border-radius here — keep the exact
     rounded-card look of the reading view. Line wrapping is handled by the
     ocode-wrap-code body class we carry over, not by print rules. We also do
     NOT set break-inside:avoid on code blocks: a tall block that can't fit on
     the current page would otherwise leave a large blank gap. */
  /* Show outputs in full — drop the on-screen scroll caps so nothing is hidden. */
  .ocode-export .ocode-output .ocode-output-content { max-height: none !important; overflow: visible !important; }
  .ocode-export .ocode-output-images { max-height: none !important; overflow: visible !important; }
  .ocode-export .ocode-output-img { max-height: none !important; max-width: 100% !important; }
  .ocode-export img { max-width: 100% !important; height: auto; }
  /* Keep a plot from being split across a page break. */
  .ocode-output-images, .ocode-output-img { break-inside: avoid; }
}
`;

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
}): string {
  const widthRule = opts.contentWidth && opts.contentWidth > 0
    ? `.ocode-export { max-width: ${opts.contentWidth}px; }`
    : "";
  // styles.css hides `.ocode-output` under `@media print` (so printing a note
  // from inside Obsidian omits outputs). For our export the outputs are the
  // whole point — re-show them in print (PDF). Emitted AFTER pluginCss so it wins.
  const printShowOutputs = `@media print {
  .ocode-export .ocode-output { display: block !important; }
  .ocode-export .ocode-output-header { display: flex !important; }
  .ocode-export .ocode-output-images { display: flex !important; }
}`;
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
</style>
</head>
<body class="${escapeAttr(opts.bodyClass)}">
<div class="markdown-preview-view markdown-rendered ocode-export">
${opts.bodyHtml}
</div>
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

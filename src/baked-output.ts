/**
 * Baked outputs — persisting code-execution output into the note markdown.
 *
 * CodeSuite normally keeps execution output in memory only (it never touches the
 * `.md` file). That is the right default: it keeps notes clean and lets output
 * stay ephemeral. But it means the output is invisible to anything that only
 * reads the markdown — most notably **shared notes** (e.g. via NoteColab), where
 * a recipient renders the raw markdown in a web viewer with no CodeSuite running.
 *
 * "Baking" serializes the current output of each run code block into a fenced
 *     ```codesuite-output
 *     {"v":1,"hash":"…","exit":0,"label":"Output","stdout":"…","stderr":"","figures":[…]}
 *     ```
 * block placed right after its source block. The block is:
 *   - rendered as a styled output panel by CodeSuite (reading view + live preview);
 *   - rendered by a small markdown-it plugin in the NoteColab web viewer;
 *   - and, failing both, degrades to a clearly-labelled JSON code block.
 *
 * Two problems are handled deliberately (see the design notes on each helper):
 *   - **Note bloat** — figures are written to external image files in the vault and
 *     referenced by *filename* (not inlined as base64), so the markdown stays small.
 *     Only interactive Plotly widgets, which have no static image form, are inlined.
 *   - **Stale media** — figure filenames embed a hash of their source code, so a
 *     re-bake after an edit writes fresh files and the old ones become orphans that
 *     the bake/clear routines sweep. The block also stores the source hash so the
 *     renderer can flag output that no longer matches the code above it.
 *
 * This module is intentionally free of Obsidian imports: it is pure
 * string/serialization logic so it can be reasoned about (and unit-tested) on its
 * own. All vault I/O (writing image files, reading/writing the note) lives in
 * main.ts.
 */

/** Fence language that marks a baked-output block. */
export const BAKED_OUTPUT_LANG = "codesuite-output";

/** Serialization format version, bumped if the JSON shape ever changes. */
export const BAKED_OUTPUT_VERSION = 1;

/**
 * Tiny stable hash (djb2 → base36). Matches a code block's source to its baked
 * output and to the reading-view wrapper's `data-ocode-hash`, so the renderer can
 * tell when output is stale relative to the code above it. Callers hash the
 * *trimmed* source, exactly as the wrapper does.
 */
export function codeHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** A single baked figure: a static image, or an inlined interactive widget. */
export type BakedFigure =
  /**
   * Static image (e.g. matplotlib). Exactly one of `file`/`data` is set:
   *   - `file`: a vault filename (the default, no-bloat path — the image lives
   *     in the baked-outputs folder and travels as a normal attachment).
   *   - `data`: inline base64 PNG (the self-contained escape hatch).
   */
  | { kind: "image"; file?: string; data?: string }
  /** Interactive widget (e.g. Plotly). Inlined because it has no image form. */
  | { kind: "widget"; html: string };

/** The serializable snapshot of one code block's output. */
export interface BakedOutput {
  /** Format version. */
  v: number;
  /** Hash of the source block this output belongs to (see {@link codeHash}). */
  hash: string;
  /** Process exit code (null when killed/unknown). */
  exit: number | null;
  /** Header label, e.g. "Output", "Output (exit: 1)", "Output (timed out)". */
  label: string;
  /** Captured stdout (visible text, figure sentinels already resolved out). */
  stdout: string;
  /** Captured stderr. */
  stderr: string;
  /** Figures in creation order. */
  figures: BakedFigure[];
}

/** Build a {@link BakedOutput} with defaults filled in and shape normalized. */
export function makeBakedOutput(o: Partial<BakedOutput> & { hash: string }): BakedOutput {
  return {
    v: BAKED_OUTPUT_VERSION,
    hash: o.hash,
    exit: o.exit ?? null,
    label: o.label ?? "Output",
    stdout: o.stdout ?? "",
    stderr: o.stderr ?? "",
    figures: o.figures ?? [],
  };
}

/**
 * Parse a baked-output fence body (the single JSON line) back into a
 * {@link BakedOutput}. Returns null for anything that isn't a well-formed,
 * known-version baked block, so a malformed block just renders as plain text.
 */
export function parseBakedOutput(body: string): BakedOutput | null {
  try {
    const raw = JSON.parse(body.trim()) as Partial<BakedOutput>;
    if (!raw || typeof raw !== "object") return null;
    if (raw.v !== BAKED_OUTPUT_VERSION) return null;
    if (typeof raw.hash !== "string") return null;
    const figures = Array.isArray(raw.figures)
      ? raw.figures.filter((f): f is BakedFigure =>
          !!f &&
          ((f.kind === "image" && (typeof f.file === "string" || typeof f.data === "string")) ||
           (f.kind === "widget" && typeof f.html === "string")))
      : [];
    return {
      v: BAKED_OUTPUT_VERSION,
      hash: raw.hash,
      exit: typeof raw.exit === "number" ? raw.exit : null,
      label: typeof raw.label === "string" ? raw.label : "Output",
      stdout: typeof raw.stdout === "string" ? raw.stdout : "",
      stderr: typeof raw.stderr === "string" ? raw.stderr : "",
      figures,
    };
  } catch {
    return null;
  }
}

/**
 * Sanitize a note basename into a filename stem safe across platforms.
 * Combined with a per-note path hash, this keeps baked image files from
 * colliding when two notes with the same basename share an output folder.
 */
export function sanitizeStem(basename: string): string {
  const stem = basename.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return stem || "note";
}

/**
 * Deterministic filename for a baked image figure. Encodes the note stem, a
 * short note-path hash (cross-note uniqueness), the source-code hash (so editing
 * the code produces a *new* file and the old one becomes a sweepable orphan), and
 * the figure index.
 */
export function bakedImageName(noteBasename: string, notePath: string, srcHash: string, figureIndex: number): string {
  return `${sanitizeStem(noteBasename)}-${codeHash(notePath)}.${srcHash}.${figureIndex}.png`;
}

/** Prefix shared by every baked image file for a given note — used by the orphan sweep. */
export function bakedImagePrefix(noteBasename: string, notePath: string): string {
  return `${sanitizeStem(noteBasename)}-${codeHash(notePath)}.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Markdown text manipulation
//
// All helpers below operate on the raw note text. They share a minimal fenced-
// block scanner that recognizes backtick fences (matching CodeSuite's editor and
// reading-view behavior). They never parse the surrounding markdown, so they are
// safe to run on any note and are fully reversible via clearBakedOutputs().
// ─────────────────────────────────────────────────────────────────────────────

interface RawFence {
  lang: string;
  /** Leading whitespace before the opening fence. */
  indent: string;
  /** Inner lines (between the fences), verbatim. */
  body: string[];
  /** 0-based line index of the opening fence. */
  openLine: number;
  /** 0-based line index of the closing fence. */
  closeLine: number;
}

/** Scan closed backtick-fenced blocks from already-split lines. Unclosed fences end the scan. */
function scanFences(lines: string[]): RawFence[] {
  const fences: RawFence[] = [];
  let i = 0;
  while (i < lines.length) {
    const open = /^(\s*)(`{3,})(.*)$/.exec(lines[i]);
    if (!open) { i++; continue; }
    const [, indent, ticks, info] = open;
    const lang = info.trim().split(/\s+/)[0] ?? "";
    const closeRe = new RegExp(`^\\s*\`{${ticks.length},}\\s*$`);
    const body: string[] = [];
    let j = i + 1;
    let closed = false;
    for (; j < lines.length; j++) {
      if (closeRe.test(lines[j])) { closed = true; break; }
      body.push(lines[j]);
    }
    if (!closed) break; // unterminated fence — leave the rest untouched
    fences.push({ lang, indent, body, openLine: i, closeLine: j });
    i = j + 1;
  }
  return fences;
}

/** Assemble the three lines of a baked-output fence at the given indent. */
function bakedFenceLines(output: BakedOutput, indent: string): string[] {
  return [
    `${indent}\`\`\`${BAKED_OUTPUT_LANG}`,
    `${indent}${JSON.stringify(output)}`,
    `${indent}\`\`\``,
  ];
}

/** True when every line in [from, to] is blank (vacuously true when from > to). */
function onlyBlankBetween(lines: string[], from: number, to: number): boolean {
  for (let k = from; k <= to; k++) {
    if (lines[k].trim() !== "") return false;
  }
  return true;
}

/**
 * Insert/refresh a baked-output block after every source block whose trimmed-code
 * hash is present in `byHash`. An existing baked block directly following a source
 * block (separated only by blank lines) is replaced in place; otherwise a fresh
 * one is inserted right after the source block. Other content is left byte-for-byte.
 */
export function applyBakedOutputs(source: string, byHash: Map<string, BakedOutput>): string {
  const lines = source.split("\n");
  const fences = scanFences(lines);
  const out: string[] = [];
  let cursor = 0; // next source line not yet copied
  let skipExistingBaked = false; // set when the previous block already replaced the next baked fence

  for (let k = 0; k < fences.length; k++) {
    const f = fences[k];

    if (skipExistingBaked && f.lang === BAKED_OUTPUT_LANG) {
      // This existing baked block was just regenerated by the block above —
      // drop it (and the blank lines leading up to it, already skipped via cursor).
      cursor = f.closeLine + 1;
      skipExistingBaked = false;
      continue;
    }

    // Copy everything up to and including this fence verbatim.
    for (let l = cursor; l <= f.closeLine; l++) out.push(lines[l]);
    cursor = f.closeLine + 1;

    if (f.lang === BAKED_OUTPUT_LANG) continue; // never bake onto a baked block

    const hash = codeHash(f.body.join("\n").trim());
    const output = byHash.get(hash);
    if (!output) continue;

    out.push("");
    out.push(...bakedFenceLines(output, f.indent));

    // If an existing baked block immediately follows, mark it for removal so we
    // replace rather than stack a second one.
    const next = fences[k + 1];
    if (next && next.lang === BAKED_OUTPUT_LANG &&
        onlyBlankBetween(lines, f.closeLine + 1, next.openLine - 1)) {
      skipExistingBaked = true;
    }
  }

  for (let l = cursor; l < lines.length; l++) out.push(lines[l]);
  return out.join("\n");
}

/**
 * Remove every baked-output block (and the single blank separator line we insert
 * before each). Returns the cleaned text plus the image filenames that were
 * referenced, so the caller can delete the now-unused image files.
 */
export function clearBakedOutputs(source: string): { content: string; removedFiles: string[] } {
  const lines = source.split("\n");
  const fences = scanFences(lines);
  const out: string[] = [];
  const removedFiles: string[] = [];
  let cursor = 0;

  for (const f of fences) {
    if (f.lang !== BAKED_OUTPUT_LANG) continue;

    // Drop one blank separator line immediately preceding the block, if present
    // (that's the spacer applyBakedOutputs inserts).
    let dropFrom = f.openLine;
    if (dropFrom > cursor && lines[dropFrom - 1].trim() === "") dropFrom--;

    for (let l = cursor; l < dropFrom; l++) out.push(lines[l]);
    cursor = f.closeLine + 1;

    const parsed = parseBakedOutput(f.body.join("\n"));
    if (parsed) {
      for (const fig of parsed.figures) {
        if (fig.kind === "image" && fig.file) removedFiles.push(fig.file);
      }
    }
  }

  for (let l = cursor; l < lines.length; l++) out.push(lines[l]);
  return { content: out.join("\n"), removedFiles };
}

/** Collect every image filename referenced by baked blocks in the given text. */
export function collectBakedImageFiles(source: string): Set<string> {
  const files = new Set<string>();
  for (const f of scanFences(source.split("\n"))) {
    if (f.lang !== BAKED_OUTPUT_LANG) continue;
    const parsed = parseBakedOutput(f.body.join("\n"));
    if (!parsed) continue;
    for (const fig of parsed.figures) {
      if (fig.kind === "image" && fig.file) files.add(fig.file);
    }
  }
  return files;
}

/**
 * Hash of the source code block immediately preceding the baked block on
 * `bakedOpenLine`, computed from the full note text. Returns null when there is
 * no code block before it (so the renderer simply skips the staleness check).
 * Used to flag baked output that no longer matches the code above it.
 */
export function precedingCodeHash(source: string, bakedOpenLine: number): string | null {
  const lines = source.split("\n");
  let prev: RawFence | null = null;
  for (const f of scanFences(lines)) {
    if (f.openLine >= bakedOpenLine) break;
    if (f.lang === BAKED_OUTPUT_LANG) continue;
    prev = f;
  }
  return prev ? codeHash(prev.body.join("\n").trim()) : null;
}

import {
  App,
  Component,
  Menu,
  Plugin,
  MarkdownPostProcessorContext,
  MarkdownRenderer,
  MarkdownView,
  Modal,
  Setting,
  TFile,
  TFolder,
  Notice,
  Platform,
  setIcon,
  normalizePath,
  editorInfoField,
  editorLivePreviewField,
} from "obsidian";
import { ViewPlugin, Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder, StateField, StateEffect, Prec } from "@codemirror/state";
import type { Extension, Text, EditorState } from "@codemirror/state";
import { Highlighter, EXT_TO_LANG } from "./highlighter";
import { CodeSettingTab } from "./settings-tab";
import { startExecution, isExecutable, type RunningProcess, type OutputFigure } from "./executor";
import {
  type CodePluginSettings,
  DEFAULT_SETTINGS,
  BUNDLED_THEMES,
} from "./settings";
import { CodeFileView, CODE_FILE_VIEW_TYPE } from "./code-file-view";
import { buildFigureEl } from "./output-view";
import {
  type BakedOutput,
  type BakedFigure,
  BAKED_OUTPUT_LANG,
  codeHash,
  makeBakedOutput,
  parseBakedOutput,
  applyBakedOutputs,
  clearBakedOutputs,
  collectBakedImageFiles,
  precedingCodeHash,
  bakedImageName,
  bakedImagePrefix,
} from "./baked-output";
import {
  type Notebook,
  type ExportOptions,
  type ExportWidthMode,
  DEFAULT_EXPORT_OPTIONS,
  ipynbToMarkdown,
  markdownToIpynb,
  buildExportHtml,
} from "./convert";
import {
  type VarValue,
  type VarEntry,
  parseVarsSource,
  isValidIdent,
  inferVarValue,
  fromJsValue,
  toJs,
  toDisplay,
  toShellScalar,
  pythonSeedLine,
  shellSeedLine,
  parseTableDirective,
  headerLooksLikeVars,
  buildTableVars,
} from "./vars";
import {
  type TemplateContext,
  createContext,
  renderTemplate,
  expandIncludes,
  hasTemplateSyntax,
} from "./template";

/**
 * Release that changed the `sh` fence alias from bash to POSIX sh. Users whose
 * last-seen version predates this get a one-time heads-up on upgrade.
 */
const SHELL_ALIAS_BREAKING_VERSION = "1.5.0";

/** Compare two `MAJOR.MINOR.PATCH` strings. Returns <0, 0, or >0. */
function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

// SVG icons as constants
const ICON = {
  copy: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  check: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`,
  play: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
  stop: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>`,
  close: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  send: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`,
  reload: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`,
  eye: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
  code: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
  printer: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>`,
};

const CODE_FILE_EXTENSIONS = new Set(Object.keys(EXT_TO_LANG));

/** Minimal Electron surface used by import/export (reached via window.require). */
interface ElectronDialog {
  showOpenDialog?: (o: { properties?: string[]; filters?: { name: string; extensions: string[] }[] }) =>
    Promise<{ canceled: boolean; filePaths: string[] }>;
  showSaveDialog?: (o: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) =>
    Promise<{ canceled: boolean; filePath?: string }>;
}
interface ElectronBrowserWindow {
  loadFile: (p: string) => Promise<void>;
  webContents: {
    printToPDF: (o: Record<string, unknown>) => Promise<Uint8Array>;
    print: (o: Record<string, unknown>, cb?: (success: boolean, reason: string) => void) => void;
    executeJavaScript: (code: string) => Promise<unknown>;
  };
  destroy: () => void;
}
type ElectronBrowserWindowCtor = new (opts: Record<string, unknown>) => ElectronBrowserWindow;

/**
 * Detect the "skip from Run All" marker on the first non-empty line of a code
 * block. Accepts most common comment styles so the marker works for every
 * supported language:
 *   #  codesuite:skip      (python, bash, ruby, perl, r, makefile, …)
 *   // codesuite:skip      (js, ts, go, swift, java, c, c++, rust, php, kotlin, scala, …)
 *   -- codesuite:skip      (lua, sql, haskell)
 *   %  codesuite:skip      (r/latex/matlab)
 *   /* codesuite:skip *\/   (any C-style)
 */
const SKIP_MARKER_RE = /^\s*(?:#|\/\/|--|%|\/\*)\s*codesuite\s*:\s*skip(?:[\s*/]|$)/i;
function blockHasSkipMarker(code: string): boolean {
  for (const raw of code.split("\n")) {
    if (!raw.trim()) continue;
    return SKIP_MARKER_RE.test(raw);
  }
  return false;
}

/**
 * Languages that Obsidian (or its plugins) render natively — we leave their
 * blocks untouched in both reading view and Live Preview.
 */
const PASSTHROUGH_LANGS = new Set(["mermaid", "dataview", "dataviewjs", "query"]);

/**
 * Strip an opening fence's indentation from one of its content lines. Mirrors
 * CommonMark, which removes up to the fence's indent from each line: an exact
 * prefix match is removed whole; otherwise leading whitespace is consumed up
 * to the indent's length (tolerating tab/space mixes).
 */
function stripFenceIndent(line: string, indent: string): string {
  if (!indent) return line;
  if (line.startsWith(indent)) return line.slice(indent.length);
  let i = 0;
  while (i < indent.length && i < line.length && (line[i] === " " || line[i] === "\t")) i++;
  return line.slice(i);
}

/** Decode a base64 string to an ArrayBuffer (for writing baked image files). */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * A code block's output captured at run time, kept as data so it can be both
 * re-rendered and serialized into the note by the "Bake outputs" command. Figures
 * are held as raw {@link OutputFigure}s; baking turns images into files (or inline
 * base64) and inlines widgets. See baked-output.ts.
 */
interface CapturedOutput {
  /** Hash of the trimmed source (matches the wrapper's data-ocode-hash). */
  hash: string;
  exit: number | null;
  label: string;
  stdout: string;
  stderr: string;
  figures: OutputFigure[];
}

/** One runnable unit in a Run All pass, parsed from the note source. */
interface RunAllEntry {
  /** Executable fenced block, or an embedded code file on its own line. */
  kind: "fence" | "embed";
  /** 0-based source line of the opening fence / embed — scroll target when the
   *  block's section is virtualized out of the reading view. */
  line: number;
  /** Excluded from Run All (fence `skip` attribute or codesuite:skip marker). */
  skip: boolean;
  /** Hash of the dedented code; matches the wrapper's data-ocode-hash. Fences only. */
  hash?: string;
  /** Embedded file's basename — matches the wrapper's header label. Embeds only. */
  name?: string;
}

/** A fenced code block located in an editor document, with absolute positions. */
interface FencedBlock {
  /** Raw language token from the opening fence info string (may be ""). */
  lang: string;
  /** Full opening fence info string (everything after the backticks, trimmed). */
  info: string;
  /** Leading whitespace before the opening fence (list-nested blocks). */
  indent: string;
  /** Doc position of the start of the opening fence line. */
  openFrom: number;
  /** Doc position of the end of the closing fence line. */
  closeTo: number;
  /** Inner (non-fence) lines with their absolute start positions. */
  innerLines: { text: string; from: number }[];
  /** Inner lines joined with newlines. */
  code: string;
}

/**
 * One entry in the live cross-language variable namespace. Tracks not just the
 * current value but *which block* last wrote it and the value it had before, so
 * re-running a block can reconstruct the state it saw the first time (notebook
 * semantics) rather than feeding its own previous result back into itself.
 */
interface LiveVar {
  /** Current value. */
  value: VarValue;
  /** Language of the block that wrote this value. */
  lang: string;
  /** True when this value was produced by transforming an incoming seed (i.e.
   *  the variable was seeded and then changed). Such values can't be recreated
   *  by a same-language replay alone, so they must be re-seeded on re-run. */
  derived: boolean;
  /** Identity (`lang\0code`) of the block that wrote this value. */
  block: string;
  /** The value as written by the most recent *different* block — the state this
   *  variable should be reset to when its current owner block is re-run. */
  prev?: LiveVar;
}

/**
 * Walk an editor document and return every *closed* ```-fenced code block with
 * absolute positions covering the fence lines. Shared by the Shiki token-color
 * extension and the Live Preview block-widget extension so both agree on block
 * boundaries. Only backtick fences are recognized (matches the editor's
 * historical behavior); unclosed blocks are skipped so they stay editable.
 */
function scanFencedBlocks(doc: Text): FencedBlock[] {
  const blocks: FencedBlock[] = [];
  let inBlock = false;
  let lang = "";
  let info = "";
  let indent = "";
  let openFrom = 0;
  let innerLines: { text: string; from: number }[] = [];
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const trimmed = line.text.trimStart();
    if (!inBlock && trimmed.startsWith("```")) {
      inBlock = true;
      info = trimmed.slice(3).trim();
      lang = info.split(/\s/)[0];
      indent = line.text.slice(0, line.text.length - trimmed.length);
      openFrom = line.from;
      innerLines = [];
    } else if (inBlock && /^`{3,}\s*$/.test(trimmed)) {
      blocks.push({
        lang,
        info,
        indent,
        openFrom,
        closeTo: line.to,
        innerLines: [...innerLines],
        code: innerLines.map((l) => l.text).join("\n"),
      });
      inBlock = false;
      lang = "";
      info = "";
      indent = "";
      innerLines = [];
    } else if (inBlock) {
      innerLines.push({ text: line.text, from: line.from });
    }
  }
  return blocks;
}

/**
 * Dispatched to force the Live Preview block-widget StateField to rebuild even
 * when the document and selection are unchanged (e.g. after a theme/highlighter
 * refresh). Carried as a transaction effect.
 */
const lpRebuildEffect = StateEffect.define<null>();

/**
 * CM6 block widget that renders a CodeSuite `ocode-wrapper` in Live Preview.
 * The wrapper DOM is owned by the plugin's per-block cache (via `resolve`), so
 * the *same* node — with its live output and running process — is reused across
 * cursor moves and reveal/re-render cycles. `eq()` compares the cache key, which
 * already folds in language, source, block attributes, and the settings sig, so
 * CM never recreates a widget whose content is unchanged.
 */
class CodeBlockWidget extends WidgetType {
  constructor(
    private readonly key: string,
    private readonly resolve: () => HTMLElement | null,
  ) {
    super();
  }

  eq(other: CodeBlockWidget): boolean {
    return other.key === this.key;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = this.resolve() ?? createDiv({ cls: "ocode-wrapper ocode-lp-empty" });
    this.wireReveal(view, wrapper);
    return wrapper;
  }

  /**
   * The widget owns all of its own events. We dispatch reveal explicitly on a
   * code-body click (below), and the chrome's buttons have their own handlers,
   * so CM6 must never treat a click as an editor gesture — otherwise a tall
   * block (one with output) maps clicks to a position *outside* its range and
   * the block never reveals for editing.
   */
  ignoreEvent(): boolean {
    return true;
  }

  /**
   * Clicking the code body reveals the raw source for editing. We can't rely on
   * CM6's click-to-coordinate mapping (a block widget is atomic — clicks land at
   * its edges, and output makes that unreliable), so we move the selection into
   * the block ourselves. The next render sees the cursor overlap and drops the
   * widget, exposing the editable lines.
   */
  private wireReveal(view: EditorView, wrapper: HTMLElement): void {
    if (wrapper.dataset.ocodeRevealWired === "1") return;
    wrapper.dataset.ocodeRevealWired = "1";
    const codeArea = wrapper.querySelector<HTMLElement>("pre.shiki");
    if (!codeArea) return;
    codeArea.addEventListener("mousedown", (e) => {
      // Let users still select text inside the code body (drag / modifier).
      if (e.button !== 0 || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
      const pos = view.posAtDOM(wrapper);
      e.preventDefault();
      view.dispatch({ selection: { anchor: pos } });
      view.focus();
    });
  }

  /** Let CM6 measure the real DOM height rather than guessing. */
  get estimatedHeight(): number {
    return -1;
  }
}

/** Parse an SVG string into a DOM element without using innerHTML */
function parseSvg(svgString: string): Node {
  const doc = new DOMParser().parseFromString(svgString, "text/html");
  return activeDocument.adoptNode(doc.body.firstChild!);
}

/** Replace element content with parsed SVG */
function setSvgContent(el: Element, svgString: string): void {
  el.textContent = "";
  el.appendChild(parseSvg(svgString));
}

export default class CodePlugin extends Plugin {
  settings: CodePluginSettings = DEFAULT_SETTINGS;
  highlighter: Highlighter = new Highlighter();
  /** Track running processes per wrapper element for cancel */
  private runningProcs: Map<HTMLElement, RunningProcess> = new Map();
  /**
   * Tail of the per-note run queue: resolves when the most recently started
   * (or queued) run in that note finishes. Shared-context runs chain onto it
   * so rapid manual clicks execute in click order instead of racing (#25).
   */
  private noteRunQueue: Map<string, Promise<void>> = new Map();
  /**
   * Live Preview block-widget DOM cache. Maps note path → blockKey
   * (`lang\0code`) → the rendered `ocode-wrapper`. CM6 recreates widgets on
   * every cursor move; returning the *same* DOM node keeps a block's streaming
   * output and running process alive across cursor movement and reveal/re-render.
   * In-memory only; pruned on rebuild and cleared on unload / rename / session clear.
   */
  private lpWrapperCache: Map<string, Map<string, HTMLElement>> = new Map();
  /**
   * Shared execution context. Maps note path → language → ordered list of
   * previously-executed code blocks. In-memory only; cleared on unload.
   */
  private noteContexts: Map<string, Map<string, string[]>> = new Map();
  /** Latest variable snapshot per note (Python only). Maps note path → {varName: displayValue}. */
  private noteVarStore: Map<string, Record<string, string>> = new Map();
  /** Variables declared in ```vars blocks, `code_vars:` frontmatter, and data
   *  tables — the *initial* (seed) values injected into code execution. */
  private noteVarsBlockStore: Map<string, Record<string, VarValue>> = new Map();
  /**
   * Live cross-language variable namespace. After a block runs, any shared var
   * it *changed* (or newly defined) is recorded here, tagged with the producing
   * language. On the next run, values produced by *other* languages are
   * injected as seeds — so a value set in Python is visible in Bash, etc.
   * Reset to the declared seeds by Clear Session. Maps note path →
   * { varName → LiveVar }.
   */
  private noteLiveVars: Map<string, Map<string, LiveVar>> = new Map();
  /**
   * Static HTML snapshots of executed block outputs. Maps note path → block
   * source → the finished `.ocode-output` panel's outerHTML. Lets outputs
   * survive Obsidian's reading-view section eviction (re-attached on render)
   * and lets HTML/PDF export capture every run output, not just visible ones.
   * In-memory only; cleared on unload or Clear Session.
   */
  private noteOutputs: Map<string, Map<string, string>> = new Map();
  /**
   * Structured snapshots of executed block outputs, captured alongside
   * {@link noteOutputs} but kept as data (text + raw figures) rather than DOM, so
   * the "Bake outputs into note" command can serialize them into the markdown.
   * Maps note path → block source → captured output. In-memory only.
   */
  private noteOutputData: Map<string, Map<string, CapturedOutput>> = new Map();
  /** Tracks which MarkdownView instances have already had view-header actions added. */
  private viewActionsAdded = new WeakSet<MarkdownView>();
  /** All action buttons added to view headers — removed in onunload so plugin reloads don't duplicate them. */
  private viewActionEls: HTMLElement[] = [];
  /**
   * In-flight Run All passes, keyed by view. Lets the header button toggle:
   * a second click while a pass is running cancels it (stops the live block and
   * breaks the loop). `current` is the wrapper of the block running right now.
   */
  private activeRunAll = new WeakMap<MarkdownView, { cancelled: boolean; current: HTMLElement | null }>();

  /** Monotonically increasing counter — refreshHighlighter checks this to bail if superseded */
  private _refreshSeq = 0;

  /** Demo/recording only — curated themes the demo-cycle command steps through. */
  private static readonly DEMO_THEME_CYCLE = [
    // popular darks
    "gruvbox-dark-medium",
    "catppuccin-mocha",
    "dracula",
    // light themes
    // "catppuccin-latte",
    // "rose-pine-dawn",
  ];
  private _demoThemeIdx = 0;
  /** Debounce timer for auto-theme switching (css-change can fire many times per mode switch) */
  private _autoThemeTimer: number | null = null;
  /** Debounce timer for queued skip-badge sync passes. */
  private _skipSyncTimer: number | null = null;
  /** True when no persisted data existed at load — i.e. a genuinely fresh install. */
  private _isFreshInstall = false;
  /** Monotonic id for html-preview iframes — used to match their resize messages. */
  private _frameSeq = 0;
  /** Live html-preview iframes by token, sized by the shared resize listener.
   *  Weakly referenced so pruned blocks' frames can be garbage-collected. */
  private _htmlFrames = new Map<string, WeakRef<HTMLIFrameElement>>();
  /** True once the single shared `message` listener for frame resizes is installed. */
  private _htmlFrameListenerInstalled = false;
  /** Set to an array while a note is being rendered for HTML/PDF export. Live
   *  html-preview iframes are built lazily (on layout), which never happens in
   *  the detached export render — so addHtmlPreview records its panes here and
   *  buildNoteHtml builds the frames eagerly afterwards (#33). Null otherwise. */
  private _exportHtmlPanes:
    | { pane: HTMLElement; wrapper: HTMLElement; code: string; htmlTemplate: boolean }[]
    | null = null;

  async onload() {
    await this.loadSettings();

    // Apply auto-theme selection before init so the correct theme is active from the start
    if (this.settings.autoTheme) {
      const isDark = activeDocument.body.classList.contains("theme-dark");
      const autoTheme = isDark ? this.settings.darkAutoTheme : this.settings.lightAutoTheme;
      if (this.settings.theme !== autoTheme) {
        this.settings.theme = autoTheme;
        await this.saveSettings();
      }
    }

    await this.highlighter.init();

    // Load any custom themes from settings
    for (const ct of this.settings.customThemes) {
      this.highlighter.loadCustomTheme(ct);
    }

    this.addSettingTab(new CodeSettingTab(this.app, this));

    // ─── Code file view (#4 / #11) ──────────────
    // Register a custom view + bind code file extensions to it so .py, .js,
    // etc. show up in the Obsidian file explorer and open in CodeSuite's
    // lightweight editor instead of the default plain-text fallback.
    this.registerView(CODE_FILE_VIEW_TYPE, (leaf) => new CodeFileView(leaf, this));
    if (this.settings.enableCodeFileView) {
      this.registerCodeFileExtensions();
    }

    // Command: import an external code file into the vault as a symlink alias
    if (Platform.isDesktop) {
      this.addCommand({
        id: "import-code-file-as-alias",
        name: "Import code file as alias\u2026",
        callback: () => { void this.importCodeFileAsAlias(); },
      });

      // \u2500\u2500\u2500 Import / export / conversion (#5) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
      this.addCommand({
        id: "import-jupyter-notebook",
        name: "Import Jupyter notebook (.ipynb)\u2026",
        callback: () => { void this.importNotebook(); },
      });
      this.addCommand({
        id: "export-note-to-jupyter",
        name: "Export note to Jupyter notebook (.ipynb)",
        checkCallback: (checking) => {
          const file = this.app.workspace.getActiveFile();
          const ok = !!file && file.extension === "md";
          if (ok && !checking) void this.exportNotebook();
          return ok;
        },
      });
      this.addCommand({
        id: "export-note-to-html",
        name: "Export note to HTML (with outputs)",
        checkCallback: (checking) => {
          const ok = this.getRenderedPreview() !== null;
          if (ok && !checking) void this.exportRenderedNote("html");
          return ok;
        },
      });
      this.addCommand({
        id: "export-note-to-pdf",
        name: "Export note to PDF (with outputs)",
        checkCallback: (checking) => {
          const ok = this.getRenderedPreview() !== null;
          if (ok && !checking) void this.exportRenderedNote("pdf");
          return ok;
        },
      });
    }

    // Demo/recording only (see CodePluginSettings.demoThemeCycle). Gated behind
    // a hidden, UI-less setting so it never registers for normal users; bind a
    // hotkey to flick through a curated theme list on camera.
    if (this.settings.demoThemeCycle) {
      this.addCommand({
        id: "demo-cycle-theme",
        name: "Cycle theme (demo)",
        callback: () => { void this.demoCycleTheme(); },
      });
    }

    if (this.settings.wideCodeBlocks) {
      activeDocument.body.addClass("ocode-wide-blocks");
    }

    if (this.settings.wrapCodeInReadingView) {
      activeDocument.body.addClass("ocode-wrap-code");
    }

    // Mirror line-number chrome onto the raw lines Obsidian shows while a Live
    // Preview block is being edited, so clicking in doesn't flash a gutter-less
    // "native" block before our chrome returns.
    if (this.settings.showLineNumbers) {
      activeDocument.body.addClass("ocode-lp-lnum");
    }

    // Apply theme CSS variables
    this.applyThemeColors();

    // Auto-theme: re-apply whenever Obsidian's dark/light mode changes
    this.registerEvent(
      this.app.workspace.on("css-change", () => {
        void this.applyAutoTheme();
      })
    );

    // Sync skip badges whenever the file is saved to disk (covers reading-view
    // tabs open alongside an editing tab, and reloads after external changes).
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!(file instanceof TFile)) return;
        this.queueSkipBadgeSync(file.path);
      })
    );

    // Sync skip badges while typing in live preview (debounced 400 ms so we
    // don't run on every keystroke).
    this.registerEvent(
      this.app.workspace.on("editor-change", (_editor, info) => {
        if (!(info instanceof MarkdownView)) return;
        this.queueSkipBadgeSync(info.file?.path, 400);
      })
    );

    // Editor (CM6): Shiki token colors + full block-chrome widgets (Live Preview)
    this.registerEditorExtension([
      this.buildShikiEditorExtension(),
      this.buildBlockWidgetExtension(),
    ]);

    // A renamed note's cached Live Preview wrappers are keyed by its old path —
    // drop them so they don't leak (and re-render fresh under the new path).
    this.registerEvent(
      this.app.vault.on("rename", (_file, oldPath) => {
        this.dropLpWrapperCache(oldPath);
      })
    );

    // Force the block-widget field to rebuild on edit/preview mode toggles and
    // leaf switches. The field-level live-preview check catches most flips, but
    // these events also cover the first render after a note opens before its
    // file path is available, so chrome never lags a mode switch.
    this.registerEvent(
      this.app.workspace.on("layout-change", () => this.forceLpRebuild())
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.forceLpRebuild())
    );

    // An html `template` block renders from its note's frontmatter, so when the
    // metadata cache settles after an edit, rebuild open editors' block widgets
    // (the frontmatter fingerprint in the cache key then re-resolves the
    // template against the new data). Reading views re-render on their own. This
    // is cheap for non-template notes — build() just re-keys and returns cached
    // wrappers; only a changed template block misses the cache and re-resolves.
    this.registerEvent(
      this.app.metadataCache.on("changed", () => this.forceLpRebuild())
    );

    // Reading view: syntax highlighting + execution
    this.registerMarkdownPostProcessor(
      (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
        this.processCodeBlocks(el, ctx);
      },
      1000
    );

    // Reading view: inline $varname substitution.
    // Always run — tagging is cheap, and we need spans tagged regardless of
    // when the user enables shared context (Obsidian doesn't re-post-process on
    // setting toggle, so a gated post-processor would miss already-rendered notes).
    this.registerMarkdownPostProcessor(
      (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
        this.processInlineVarRefs(el, ctx);
      },
      1001
    );

    // Reading view: experimental data-tables. A `%% codesuite: … %%` directive
    // (or a `var | value` header) turns a markdown table into a code variable.
    this.registerMarkdownPostProcessor(
      (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
        if (this.settings.experimentalTables) {
          this.processDataTables(el, ctx);
        }
      },
      1002
    );

    // Reading view: surface CodeSuite's nested frontmatter (`code_vars:`,
    // `template_context:`) as a readable panel, since Obsidian's Properties
    // widget can't display nested objects and warns instead (#34).
    this.registerMarkdownPostProcessor(
      (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
        this.renderFrontmatterVarsPanel(el, ctx);
      },
      1003
    );

    // Command: clear the execution session for the current note
    this.addCommand({
      id: "clear-execution-session",
      name: "Clear execution session for this note",
      callback: () => {
        const file = this.app.workspace.getActiveFile();
        if (file) {
          this.clearNoteSession(file.path);
          new Notice("Execution session cleared.");
        }
      },
    });

    // Commands: bake / clear baked outputs (opt-in — see CodePluginSettings.bakedOutputs).
    // Gated by the setting so they only appear in the palette for users who have
    // turned the feature on; both require an active markdown note.
    this.addCommand({
      id: "bake-outputs-into-note",
      name: "Bake code outputs into note (for sharing)",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!this.settings.bakedOutputs || !file || file.extension !== "md") return false;
        if (!checking) void this.bakeOutputsIntoNote(file);
        return true;
      },
    });
    this.addCommand({
      id: "clear-baked-outputs",
      name: "Clear baked outputs from note",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!this.settings.bakedOutputs || !file || file.extension !== "md") return false;
        if (!checking) void this.clearBakedOutputsFromNote(file);
        return true;
      },
    });

    // View-header actions: Run All + Clear Session
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        const view = leaf?.view;
        if (view instanceof MarkdownView) this.ensureViewActions(view);
      })
    );
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof MarkdownView) this.ensureViewActions(leaf.view);
    });

    // Reading view: embedded code file rendering
    this.registerMarkdownPostProcessor(
      (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
        if (this.settings.renderEmbeddedFiles) {
          this.processEmbeddedFiles(el, ctx);
        }
      },
      999
    );

    // One-time upgrade notices. Deferred until the workspace is ready so the
    // modal opens over a settled UI rather than during startup.
    this.app.workspace.onLayoutReady(() => {
      void this.maybeShowUpgradeNotice();
    });
  }

  /**
   * Show a one-time modal to users upgrading *across* a breaking change, then
   * record the current version so it never repeats. Fresh installs (empty
   * lastNoticeVersion) are skipped — there is nothing to migrate.
   *
   * The SHELL_ALIAS_BREAKING_VERSION gate can be removed a couple of releases
   * after 1.5.0; the version stamp below keeps it from firing more than once.
   */
  private async maybeShowUpgradeNotice(): Promise<void> {
    const current = this.manifest.version;
    const seen = this.settings.lastNoticeVersion;
    // An existing user with no recorded version upgraded from a release that
    // predates the field — treat that as "0.0.0" so the gate still catches them.
    // A genuinely fresh install has nothing to migrate and is skipped.
    const effectiveSeen = seen || "0.0.0";

    if (!this._isFreshInstall && compareVersions(effectiveSeen, SHELL_ALIAS_BREAKING_VERSION) < 0) {
      new ShellAliasNoticeModal(this.app).open();
    }

    if (seen !== current) {
      this.settings.lastNoticeVersion = current;
      await this.saveSettings();
    }
  }

  onunload() {
    if (this._autoThemeTimer !== null) {
      window.clearTimeout(this._autoThemeTimer);
      this._autoThemeTimer = null;
    }
    if (this._skipSyncTimer !== null) {
      window.clearTimeout(this._skipSyncTimer);
      this._skipSyncTimer = null;
    }
    // Kill all running processes
    for (const proc of this.runningProcs.values()) {
      proc.cancel();
    }
    this.runningProcs.clear();
    this.lpWrapperCache.clear();
    this.highlighter.dispose();
    activeDocument.body.removeClass("ocode-wide-blocks");
    activeDocument.body.removeClass("ocode-wrap-code");
    activeDocument.body.removeClass("ocode-lp-lnum");
    // Remove all view-header action buttons so a plugin reload doesn't duplicate them.
    for (const el of this.viewActionEls) el.remove();
    this.viewActionEls = [];
  }

  async loadSettings() {
    // loadData() returns null only when no data file exists yet (fresh install).
    // An existing user upgrading from a pre-1.5.0 version has a data file but no
    // lastNoticeVersion key — we must still show them the upgrade notice, so the
    // two cases have to be told apart here, before any save backfills the field.
    const raw = (await this.loadData()) as Partial<CodePluginSettings> | null;
    this._isFreshInstall = raw == null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, raw ?? {});
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async refreshHighlighter() {
    // Grab a sequence number before the first async gap. If a newer call starts
    // while we are awaiting init(), it will increment _refreshSeq and we discard
    // our stale results rather than double-rendering or corrupting state.
    const seq = ++this._refreshSeq;
    this.highlighter.dispose();
    this.highlighter = new Highlighter();
    await this.highlighter.init();
    if (seq !== this._refreshSeq) return; // Superseded — a newer refresh is in progress
    // Reload custom themes
    for (const ct of this.settings.customThemes) {
      this.highlighter.loadCustomTheme(ct);
    }
    // Trigger editor ViewPlugins to re-tokenize (lastTheme check in update())
    this.app.workspace.updateOptions();
    // Cached Live Preview wrappers were highlighted with the old theme — drop
    // them, force block-widget rebuilds, and re-render open reading views.
    this.refreshRenderedBlocks();
  }

  /**
   * Force every open editor's Live Preview block-widget field to rebuild by
   * dispatching {@link lpRebuildEffect}. Used after a theme/highlighter refresh
   * where the document and selection are unchanged but the chrome is stale.
   */
  private forceLpRebuild(): void {
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) return;
      const cm = (view.editor as unknown as { cm?: EditorView }).cm;
      if (cm) cm.dispatch({ effects: lpRebuildEffect.of(null) });
    });
  }

  /**
   * Re-render all open notes so a rendering-related setting change (e.g. the
   * html-preview default) takes effect immediately. Drops cached Live Preview
   * wrappers, forces the block-widget field to rebuild, and re-renders reading
   * views — without the full highlighter teardown {@link refreshHighlighter} does.
   */
  refreshRenderedBlocks(): void {
    this.lpWrapperCache.clear();
    this.forceLpRebuild();
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.getMode() === "preview") {
        view.previewMode.rerender(true);
      }
    });
  }

  /**
   * Debounced entry point for auto-theme switching.
   * css-change fires several times per mode switch; we coalesce them into one
   * actual switch by resetting the timer on every call.
   */
  applyAutoTheme() {
    if (!this.settings.autoTheme) return;
    if (this._autoThemeTimer !== null) {
      window.clearTimeout(this._autoThemeTimer);
    }
    this._autoThemeTimer = window.setTimeout(() => {
      this._autoThemeTimer = null;
      void this._runAutoTheme();
    }, 75);
  }

  /** Performs the actual auto-theme switch after the debounce delay. */
  private async _runAutoTheme() {
    if (!this.settings.autoTheme) return;
    const isDark = activeDocument.body.classList.contains("theme-dark");
    const newTheme = isDark ? this.settings.darkAutoTheme : this.settings.lightAutoTheme;
    if (this.settings.theme === newTheme) {
      // Theme ID is already correct but CSS vars may have drifted (e.g. after
      // Obsidian reloads stylesheets). Re-sync them.
      this.applyThemeColors();
      return;
    }
    this.settings.theme = newTheme;
    await this.saveSettings();
    this.applyThemeColors();
    await this.refreshHighlighter();
  }

  /**
   * Demo/recording only — advance to the next theme in DEMO_THEME_CYCLE and
   * apply it the same way the auto-theme switch does. Registered only when the
   * hidden `demoThemeCycle` setting is on.
   */
  private async demoCycleTheme(): Promise<void> {
    const list = CodePlugin.DEMO_THEME_CYCLE;
    this._demoThemeIdx = (this._demoThemeIdx + 1) % list.length;
    const next = list[this._demoThemeIdx];
    this.settings.theme = next;
    await this.saveSettings();
    this.applyThemeColors();
    await this.refreshHighlighter();
    new Notice(`Theme: ${BUNDLED_THEMES[next] ?? next}`);
  }

  /** Apply the current theme's bg/fg colors as CSS variables on the body */
  applyThemeColors() {
    const bg = this.highlighter.getThemeBg(this.settings.theme);
    const fg = this.highlighter.getThemeFg(this.settings.theme);
    const root = activeDocument.documentElement;
    if (bg) {
      // For light themes, shift toward darker to create contrast;
      // for dark themes, shift toward lighter. +/- are relative to bg.
      const light = this.isLightColor(bg);
      root.style.setProperty("--ocode-bg", bg);
      root.style.setProperty("--ocode-header-bg", this.adjustBrightness(bg, light ? -10 : 10));
      root.style.setProperty("--ocode-border",    this.adjustBrightness(bg, light ? -25 : 25));
      root.style.setProperty("--ocode-output-bg", this.adjustBrightness(bg, light ?  -8 : -5));
    }
    if (fg) {
      root.style.setProperty("--ocode-fg", fg);
      root.style.setProperty("--ocode-muted",    this.blendColor(fg, bg || "#000000", 0.6));
      root.style.setProperty("--ocode-line-num", this.blendColor(fg, bg || "#000000", 0.35));
    }
  }

  /** True if hex colour is perceptually light (luminance > 50%). */
  private isLightColor(hex: string): boolean {
    const c = hex.replace("#", "");
    const r = parseInt(c.substring(0, 2), 16);
    const g = parseInt(c.substring(2, 4), 16);
    const b = parseInt(c.substring(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5;
  }

  /** Adjust hex color brightness by amount (-255 to 255) */
  private adjustBrightness(hex: string, amount: number): string {
    const c = hex.replace("#", "");
    const r = Math.max(0, Math.min(255, parseInt(c.substring(0, 2), 16) + amount));
    const g = Math.max(0, Math.min(255, parseInt(c.substring(2, 4), 16) + amount));
    const b = Math.max(0, Math.min(255, parseInt(c.substring(4, 6), 16) + amount));
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  }

  /** Blend fg toward bg by ratio (0 = fully fg, 1 = fully bg) */
  private blendColor(fg: string, bg: string, ratio: number): string {
    const f = fg.replace("#", "");
    const b = bg.replace("#", "");
    const mix = (fi: number, bi: number) => Math.round(fi + (bi - fi) * (1 - ratio));
    const r = mix(parseInt(b.substring(0, 2), 16), parseInt(f.substring(0, 2), 16));
    const g = mix(parseInt(b.substring(2, 4), 16), parseInt(f.substring(2, 4), 16));
    const bl = mix(parseInt(b.substring(4, 6), 16), parseInt(f.substring(4, 6), 16));
    return `#${Math.max(0, Math.min(255, r)).toString(16).padStart(2, "0")}${Math.max(0, Math.min(255, g)).toString(16).padStart(2, "0")}${Math.max(0, Math.min(255, bl)).toString(16).padStart(2, "0")}`;
  }

  // ─── Editor Shiki Extension ─────────────────────────────────

  private buildShikiEditorExtension() {
    const resolveLanguage = (raw: string) => this.highlighter.resolveLanguage(raw);
    const tokenize = (code: string, lang: string, theme: string) =>
      this.highlighter.tokenize(code, lang, theme);
    const getTheme = () => this.settings.theme;

    return ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        private lastTheme: string;

        constructor(view: EditorView) {
          this.lastTheme = getTheme();
          this.decorations = this.buildDecorations(view);
        }

        update(update: ViewUpdate) {
          const currentTheme = getTheme();
          if (update.docChanged || update.viewportChanged || currentTheme !== this.lastTheme) {
            this.lastTheme = currentTheme;
            this.decorations = this.buildDecorations(update.view);
          }
        }

        buildDecorations(view: EditorView): DecorationSet {
          const builder = new RangeSetBuilder<Decoration>();
          const doc = view.state.doc;

          // Tokenize every closed fenced block that carries a language. Blocks
          // hidden behind a Live Preview widget are simply painted underneath —
          // the replace decoration covers them, so the wasted marks are harmless.
          for (const block of scanFencedBlocks(doc)) {
            if (!block.lang || block.innerLines.length === 0) continue;
            const lang = resolveLanguage(block.lang);
            const code = block.code;

            const tokens = tokenize(code, lang, getTheme());
            if (!tokens) continue;

            for (let lineIdx = 0; lineIdx < block.innerLines.length; lineIdx++) {
              const codeLine = block.innerLines[lineIdx];

              const lineTokens = tokens[lineIdx] ?? [];
              let offset = codeLine.from;

              for (const token of lineTokens) {
                const tokenFrom = offset;
                const tokenTo = offset + token.content.length;

                if (token.color && tokenFrom < tokenTo && tokenTo <= codeLine.from + codeLine.text.length) {
                  let style = `color: ${token.color} !important`;
                  if (token.fontStyle) {
                    if (token.fontStyle & 1) style += "; font-style: italic";
                    if (token.fontStyle & 2) style += "; font-weight: bold";
                    if (token.fontStyle & 4) style += "; text-decoration: underline";
                  }
                  builder.add(
                    tokenFrom,
                    tokenTo,
                    Decoration.mark({ attributes: { style } })
                  );
                }

                offset = tokenTo;
              }
            }
          }

          return builder.finish();
        }
      },
      { decorations: (v) => v.decorations }
    );
  }

  // ─── Live Preview block widgets ──────────────────────────────

  /**
   * Settings fingerprint folded into a block's cache key + widget identity, so
   * a settings change rebuilds widgets (and evicts stale cached DOM) instead of
   * leaving stale chrome. Only settings that change the rendered wrapper matter.
   */
  private lpRenderSig(): string {
    const s = this.settings;
    return [
      s.theme,
      s.showLanguageLabel,
      s.showLineNumbers,
      s.enableExecution,
      s.inlineCollapsedByDefault,
      s.collapseEmbeds,
      s.renderEmbeddedFiles,
      s.renderHtmlBlocks,
      s.htmlBlockPdfExport,
      s.htmlTemplating,
    ].join("|");
  }

  /**
   * CM6 editor extension that renders full code-block chrome (header, Run/Copy,
   * line numbers, collapse, live output) and embedded code files in Live
   * Preview, by replacing each block with a {@link CodeBlockWidget}. The block
   * the cursor sits in is left untouched so its raw source stays editable (the
   * Shiki token extension still colours it). Block-replacing decorations must
   * come from a StateField, not a ViewPlugin, so they can affect line layout.
   */
  private buildBlockWidgetExtension(): Extension {
    const build = (state: EditorState): DecorationSet => {
      // Only in Live Preview — raw Source mode must stay plain text.
      if (!state.field(editorLivePreviewField)) return Decoration.none;
      const info = state.field(editorInfoField, false);
      const notePath = info?.file?.path;
      if (!notePath) return Decoration.none;

      const sig = this.lpRenderSig();
      const doc = state.doc;
      const sel = state.selection;
      const overlapsSelection = (from: number, to: number) =>
        sel.ranges.some((r) => r.from <= to && r.to >= from);

      const liveKeys = new Set<string>();
      const items: { from: number; to: number; deco: Decoration }[] = [];

      // ─── Fenced code blocks (and ```vars) ───
      // Hash of the most recent non-baked block, so a baked-output block can tell
      // whether the code above it changed since the output was baked.
      let prevCodeHash: string | null = null;
      for (const block of scanFencedBlocks(doc)) {
        const rawLang = (block.lang || "").toLowerCase();
        if (PASSTHROUGH_LANGS.has(rawLang)) continue;

        // Baked-output blocks (opt-in): render the saved output as a read-only
        // panel widget. Leave prevCodeHash untouched so the staleness check keys
        // off the code block, not the baked block.
        if (this.settings.bakedOutputs && rawLang === BAKED_OUTPUT_LANG) {
          const output = parseBakedOutput(block.code);
          if (output) {
            const stale = prevCodeHash !== null && prevCodeHash !== output.hash;
            const key = `baked\0${output.hash}\0${stale}\0${block.code}\0${sig}`;
            liveKeys.add(key);
            if (!overlapsSelection(block.openFrom, block.closeTo)) {
              const resolve = (): HTMLElement | null =>
                this.getCachedLpWrapper(notePath, key, () =>
                  this.buildBakedOutputWrapper(output, notePath, stale));
              items.push({
                from: block.openFrom,
                to: block.closeTo,
                deco: Decoration.replace({ block: true, widget: new CodeBlockWidget(key, resolve) }),
              });
            }
          }
          continue;
        }

        const attrs = new Set(
          block.info.split(/\s+/).slice(1).map((w) => w.toLowerCase()).filter(Boolean)
        );
        const forceSkip = attrs.has("skip");
        const forceCollapsed: boolean | null =
          attrs.has("collapsed") ? true : attrs.has("expanded") ? false : null;
        const htmlPdf = this.htmlPdfState(rawLang, attrs);

        const isVars = rawLang === "vars";
        const resolvedLang = isVars ? "vars" : this.highlighter.resolveLanguage(block.lang);
        // A list-nested block's lines carry the fence's indentation — strip it
        // (like the reading-view markdown renderer does) so the rendered code,
        // its cache key, and what Run executes are all dedented (#27).
        const code = block.indent
          ? block.innerLines.map((l) => stripFenceIndent(l.text, block.indent)).join("\n")
          : block.code;
        prevCodeHash = codeHash(code.trim());
        // A `template` html block renders through the templating engine and is
        // implicitly preview-eligible (like `pdf`). Activation needs the code, so
        // it's computed here after `code`. Its output depends on the note's
        // frontmatter, not just the block source — fold a frontmatter fingerprint
        // into the cache key so editing the data rebuilds the widget instead of
        // serving a stale render.
        const htmlTemplate = this.htmlTemplateState(rawLang, attrs, code);
        let htmlPreview = this.htmlPreviewState(rawLang, attrs);
        if (htmlTemplate && htmlPreview === null) htmlPreview = true;
        const tmplSig = htmlTemplate ? this.frontmatterSig(notePath) : "";
        // Visual indent in editor columns, so the widget lines up with its list.
        const indentCols = this.indentColumns(block.indent, state.tabSize);
        const key = `${this.lpBlockKey(resolvedLang, code)}\0${forceSkip}\0${forceCollapsed}\0${htmlPreview}\0${htmlPdf}\0${htmlTemplate}\0${tmplSig}\0${indentCols}\0${sig}`;
        // Register the key BEFORE the cursor check so a block being edited (or
        // running) is never pruned out from under its live output / process.
        liveKeys.add(key);

        // Cursor inside (incl. fence lines) → reveal raw source for editing.
        if (overlapsSelection(block.openFrom, block.closeTo)) continue;

        const resolve = (): HTMLElement | null =>
          this.getCachedLpWrapper(notePath, key, () => {
            const w = isVars
              ? this.buildVarsWrapper(code, notePath)
              : this.buildCodeBlockWrapper(
                  code, resolvedLang, block.lang, undefined, notePath, forceSkip, forceCollapsed, htmlPreview, htmlPdf, htmlTemplate,
                );
            // Indent the widget to match its list nesting (#27); ch units track
            // the indent's column width closely enough for a clear visual cue.
            if (w && indentCols > 0) {
              w.addClass("ocode-lp-indented");
              w.setCssProps({ "--ocode-lp-indent": `${indentCols}ch` });
            }
            return w;
          });

        items.push({
          from: block.openFrom,
          to: block.closeTo,
          deco: Decoration.replace({ block: true, widget: new CodeBlockWidget(key, resolve) }),
        });
      }

      // ─── Embedded code files: `![[file.py]]` on its own line ───
      if (this.settings.renderEmbeddedFiles) {
        const embedRe = /^!\[\[([^\]|]+?\.[a-zA-Z0-9]+)(?:\|([^\]]*))?\]\]$/;
        for (let i = 1; i <= doc.lines; i++) {
          const line = doc.line(i);
          const m = line.text.trim().match(embedRe);
          if (!m) continue;
          const ext = (m[1].match(/\.[a-zA-Z0-9]+$/)?.[0] ?? "").toLowerCase();
          if (!CODE_FILE_EXTENSIONS.has(ext)) continue;
          const file = this.app.metadataCache.getFirstLinkpathDest(m[1], notePath);
          if (!(file instanceof TFile)) continue;

          const alias = m[2] ?? null;
          const htmlPreview = this.embedHtmlPreview(ext, alias);
          const htmlPdf = this.embedHtmlPdf(ext, alias);
          // A template embed's rendered output depends on the note's frontmatter,
          // not just the file — fold a frontmatter fingerprint into the key so
          // editing the data rebuilds the widget. The precise template decision
          // needs the file's contents (read async in populateEmbedContainer), so
          // the key uses the coarse, content-free guess; a false positive only
          // costs a harmless extra rebuild on a frontmatter edit.
          const maybeTemplate = this.embedMaybeTemplate(ext, alias);
          const tmplSig = maybeTemplate ? this.frontmatterSig(notePath) : "";
          const key = `embed\0${file.path}\0${htmlPreview}\0${htmlPdf}\0${maybeTemplate}\0${tmplSig}\0${sig}`;
          liveKeys.add(key);
          if (overlapsSelection(line.from, line.to)) continue;
          const resolve = (): HTMLElement | null =>
            this.getCachedLpWrapper(notePath, key, () => {
              const container = createDiv({ cls: "ocode-embed-container" });
              void this.populateEmbedContainer(container, file, ext, notePath, alias);
              return container;
            });
          items.push({
            from: line.from,
            to: line.to,
            deco: Decoration.replace({ block: true, widget: new CodeBlockWidget(key, resolve) }),
          });
        }
      }

      this.pruneLpWrapperCache(notePath, liveKeys);

      items.sort((a, b) => a.from - b.from);
      const builder = new RangeSetBuilder<Decoration>();
      for (const it of items) builder.add(it.from, it.to, it.deco);
      return builder.finish();
    };

    // Highest precedence so our block-replace widgets win over Obsidian's own
    // Live Preview code-block rendering. Without this, the two compete over the
    // same fence lines and Obsidian's native render (language flag, no chrome)
    // intermittently shows through until a selection change re-asserts ours.
    const field = StateField.define<DecorationSet>({
      create: (state) => build(state),
      update(value, tr) {
        // Toggling Live Preview ↔ Source mode flips this field with no doc or
        // selection change — rebuild so chrome appears/disappears immediately
        // instead of staying stale until the next click.
        const lpChanged =
          tr.startState.field(editorLivePreviewField, false) !==
          tr.state.field(editorLivePreviewField, false);
        if (
          lpChanged ||
          tr.docChanged ||
          tr.selection ||
          tr.effects.some((e) => e.is(lpRebuildEffect))
        ) {
          return build(tr.state);
        }
        return value.map(tr.changes);
      },
      provide: (f) => EditorView.decorations.from(f),
    });
    return Prec.highest(field);
  }

  // ─── Shared Execution Context ────────────────────────────────

  /** Languages that support shared context (prepend-and-suppress approach). */
  private static readonly SHARED_CTX_LANGS = new Set(["python", "bash", "zsh", "shell"]);

  /** Clear accumulated context, var store, and inline var DOM state for a note. */
  private clearNoteSession(notePath: string): void {
    this.noteContexts.delete(notePath);
    this.noteVarStore.delete(notePath);
    // Drop runtime mutations so shared vars fall back to their declared seeds.
    this.noteLiveVars.delete(notePath);
    // Drop cached Live Preview wrappers (with their stale output panels).
    this.dropLpWrapperCache(notePath);
    // Drop persisted output snapshots so re-rendered blocks come back empty.
    this.noteOutputs.delete(notePath);
    this.noteOutputData.delete(notePath);
    // Remove already-rendered output panels still on screen (dropping the cache
    // and snapshots above doesn't touch the live DOM), and revert any block that
    // was mid-run back to its idle "Run" pill. Scoped to this note's views.
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView) || view.file?.path !== notePath) continue;
      view.contentEl.querySelectorAll(".ocode-output").forEach((p) => p.remove());
      view.contentEl.querySelectorAll<HTMLButtonElement>(".ocode-run-pill.ocode-cancel-pill").forEach((btn) => {
        setSvgContent(btn.querySelector(".ocode-pill-icon")!, ICON.play);
        btn.querySelector(".ocode-pill-text")!.textContent = "Run";
        btn.classList.remove("ocode-cancel-pill");
      });
    }
    // Reset all inline $var spans back to their placeholder appearance
    const els = activeDocument.querySelectorAll<HTMLElement>("code.ocode-var-ref");
    for (const el of Array.from(els)) {
      const name = el.getAttribute("data-ocode-var");
      if (name) {
        el.textContent = `$${name}`;
        el.removeAttribute("data-resolved");
      }
    }
  }

  // ─── Live Preview wrapper cache ──────────────────────────────

  /** Stable identity for a block's cached wrapper: language + exact source. */
  private lpBlockKey(lang: string, code: string): string {
    return `${lang}\0${code}`;
  }

  /** Visual width of a fence indent in editor columns (tabs expand to tab stops). */
  private indentColumns(indent: string, tabSize: number): number {
    let cols = 0;
    for (const ch of indent) cols += ch === "\t" ? tabSize - (cols % tabSize) : 1;
    return cols;
  }

  /**
   * Return the cached `ocode-wrapper` for a block, building and caching it via
   * `build()` on a miss. Reusing the same node keeps streaming output and the
   * running process alive across the cursor moving in/out of the block.
   */
  private getCachedLpWrapper(notePath: string, key: string, build: () => HTMLElement | null): HTMLElement | null {
    let perNote = this.lpWrapperCache.get(notePath);
    const existing = perNote?.get(key);
    if (existing) return existing;
    const wrapper = build();
    if (!wrapper) return null;
    if (!perNote) { perNote = new Map(); this.lpWrapperCache.set(notePath, perNote); }
    perNote.set(key, wrapper);
    return wrapper;
  }

  /**
   * Evict cached wrappers for a note whose keys are no longer present in the
   * document, so edited/removed blocks don't leak DOM (and their processes).
   * `liveKeys` is the set of block keys currently in the doc.
   */
  private pruneLpWrapperCache(notePath: string, liveKeys: Set<string>): void {
    const perNote = this.lpWrapperCache.get(notePath);
    if (!perNote) return;
    for (const [key, wrapper] of perNote) {
      if (!liveKeys.has(key)) {
        this.runningProcs.get(wrapper)?.cancel();
        this.runningProcs.delete(wrapper);
        perNote.delete(key);
      }
    }
    if (perNote.size === 0) this.lpWrapperCache.delete(notePath);
  }

  /** Drop all cached wrappers for a note, cancelling any processes they own. */
  private dropLpWrapperCache(notePath: string): void {
    const perNote = this.lpWrapperCache.get(notePath);
    if (!perNote) return;
    for (const wrapper of perNote.values()) {
      this.runningProcs.get(wrapper)?.cancel();
      this.runningProcs.delete(wrapper);
    }
    this.lpWrapperCache.delete(notePath);
  }

  /**
   * Add "Run All" and "Clear Session" icon buttons to a MarkdownView's header.
   * Each view only receives the actions once (tracked via WeakSet).
   */
  private ensureViewActions(view: MarkdownView): void {
    if (this.viewActionsAdded.has(view)) return;
    // DOM guard: previous plugin load may have left buttons behind (plugin reload/update).
    if (view.containerEl.querySelector('[aria-label="Clear execution session"]')) return;
    this.viewActionsAdded.add(view);

    // Clear-session button is desktop-only (no execution on mobile) and can be
    // hidden via the showClearSessionButton setting to declutter the tab bar.
    if (this.settings.showClearSessionButton && Platform.isDesktop) {
      this.viewActionEls.push(
        view.addAction("rotate-ccw", "Clear execution session", () => {
          const file = view.file;
          if (file) {
            this.clearNoteSession(file.path);
            new Notice("Execution session cleared.");
          }
        })
      );
    }

    if (this.settings.enableExecution && Platform.isDesktop) {
      const runAllEl = view.addAction("play-circle", "Run all code blocks", () => {
        // Toggle: cancel an in-flight pass, otherwise start one.
        if (this.activeRunAll.has(view)) this.cancelRunAll(view);
        else void this.runAllBlocks(view, runAllEl);
      });
      this.viewActionEls.push(runAllEl);
    }
  }

  /** Flip the Run All header button between its idle and running (cancel) look. */
  private setRunAllButtonState(btnEl: HTMLElement | undefined, running: boolean): void {
    if (!btnEl) return;
    setIcon(btnEl, running ? "stop-circle" : "play-circle");
    btnEl.setAttribute("aria-label", running ? "Cancel run all" : "Run all code blocks");
    btnEl.classList.toggle("ocode-run-all-active", running);
  }

  /** Cancel an in-flight Run All: stop the live block (its stop ends the loop) and flag the pass. */
  private cancelRunAll(view: MarkdownView): void {
    const ctl = this.activeRunAll.get(view);
    if (!ctl) return;
    ctl.cancelled = true;
    const cancelBtn = ctl.current?.querySelector<HTMLButtonElement>(".ocode-run-pill.ocode-cancel-pill");
    cancelBtn?.click();
  }

  /**
   * Tear down and re-add all view-header actions across open MarkdownViews.
   * Used when a setting that affects which buttons appear (e.g.
   * showClearSessionButton) changes, so the change is reflected without a reload.
   */
  refreshViewActions(): void {
    for (const el of this.viewActionEls) el.remove();
    this.viewActionEls = [];
    this.viewActionsAdded = new WeakSet();
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof MarkdownView) this.ensureViewActions(leaf.view);
    });
  }

  /**
   * Parse the note source into the ordered list of runnable units Run All
   * works through: executable fenced blocks (with their dedented code, skip
   * state, and a hash for matching the rendered wrapper) and embedded code
   * files. Source-driven so skip markers edited since the last render are
   * honoured (#15) and blocks virtualized out of the reading view are still
   * found (#25).
   */
  private parseRunAllPlan(source: string): RunAllEntry[] {
    const entries: RunAllEntry[] = [];
    const lines = source.split("\n");
    const embedRe = /^!\[\[([^\]|]+?\.[a-zA-Z0-9]+)(?:\|[^\]]*)?\]\]$/;
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const fenceMatch = line.match(/^(\s*)([`~]{3,})(.*)/);
      if (!fenceMatch) {
        const em = line.trim().match(embedRe);
        if (em) {
          const ext = (em[1].match(/\.[a-zA-Z0-9]+$/)?.[0] ?? "").toLowerCase();
          if (CODE_FILE_EXTENSIONS.has(ext)) {
            entries.push({ kind: "embed", line: i, skip: false, name: em[1].split("/").pop() });
          }
        }
        i++; continue;
      }
      const indent    = fenceMatch[1];
      const fenceChar = fenceMatch[2][0];
      const fenceLen  = fenceMatch[2].length;
      const infoStr   = fenceMatch[3].trim();
      const parts     = infoStr.split(/\s+/);
      const rawLang   = (parts[0] ?? "").toLowerCase();
      const forceSkip = parts.slice(1).map((w) => w.toLowerCase()).includes("skip");
      const openLine  = i;
      // Collect block content
      const contentLines: string[] = [];
      i++;
      while (i < lines.length) {
        const l = lines[i];
        const cm = l.match(/^(\s*)([`~]{3,})(.*)/);
        if (cm && cm[2][0] === fenceChar && cm[2].length >= fenceLen && cm[3].trim() === "") {
          i++; break; // consume closing fence
        }
        contentLines.push(l);
        i++;
      }
      // Apply the same filters as processCodeBlocks: skip passthrough langs,
      // vars blocks, and non-executable languages (those don't get Run buttons).
      if (PASSTHROUGH_LANGS.has(rawLang) || rawLang === "vars") continue;
      const resolvedLang = this.highlighter.resolveLanguage(rawLang);
      if (!isExecutable(resolvedLang)) continue;
      // Dedent like the markdown renderer so the hash matches the rendered code.
      const code = contentLines.map((l) => stripFenceIndent(l, indent)).join("\n");
      entries.push({
        kind: "fence",
        line: openLine,
        skip: forceSkip || blockHasSkipMarker(code),
        hash: codeHash(code.trim()),
      });
    }
    return entries;
  }

  /** Queue a lightweight skip-badge DOM sync for already-rendered views. */
  private queueSkipBadgeSync(notePath?: string, delay = 0): void {
    if (this._skipSyncTimer !== null) {
      window.clearTimeout(this._skipSyncTimer);
    }
    this._skipSyncTimer = window.setTimeout(() => {
      this._skipSyncTimer = null;
      const views: MarkdownView[] = [];
      this.app.workspace.iterateAllLeaves((leaf) => {
        const view = leaf.view;
        if (!(view instanceof MarkdownView)) return;
        if (notePath && view.file?.path !== notePath) return;
        views.push(view);
      });
      if (views.length === 0) return;
      for (const view of views) this.syncSkipBadges(view);
    }, delay) as unknown as number;
  }

  /**
   * Sync the skip-badge and ocode-skip-run-all class for every inline fenced
   * code block in the view against the current source state. Called on every
    * file save and (debounced) on every editor change so already-rendered badges
    * stay live without forcing a markdown preview rerender.
   */
  private syncSkipBadges(view: MarkdownView): void {
    const source = view.getViewData();
    if (!source) return;
    // Match wrappers to source blocks by code hash, not by index — the reading
    // view virtualizes sections, so off-screen blocks have no wrapper and any
    // positional alignment shifts the skip states onto the wrong blocks (#25).
    // Duplicate blocks share a hash; their states queue up in source order.
    const statesByHash = new Map<string, boolean[]>();
    for (const entry of this.parseRunAllPlan(source)) {
      if (entry.kind !== "fence" || !entry.hash) continue;
      let queue = statesByHash.get(entry.hash);
      if (!queue) statesByHash.set(entry.hash, (queue = []));
      queue.push(entry.skip);
    }
    // Scope to the reading view only. Live Preview widgets bake their skip
    // badge in at build time, and the cursor's block has no widget.
    const wrappers = Array.from(
      view.contentEl.querySelectorAll<HTMLElement>('.markdown-reading-view .ocode-wrapper[data-ocode-fenced="1"]')
    );
    for (const wrapper of wrappers) {
      const queue = statesByHash.get(wrapper.getAttribute("data-ocode-hash") ?? "");
      // No source entry for this wrapper (stale render mid-edit) — leave it.
      const shouldSkip = queue && queue.length > 0
        ? queue.shift()!
        : wrapper.classList.contains("ocode-skip-run-all");
      const wasMarked = wrapper.classList.contains("ocode-skip-run-all");
      if (shouldSkip === wasMarked) continue;
      if (shouldSkip) {
        wrapper.classList.add("ocode-skip-run-all");
        const btnGroup = wrapper.querySelector(".ocode-btn-group");
        if (btnGroup && !btnGroup.querySelector(".ocode-skip-badge")) {
          const badge = createSpan({ cls: "ocode-skip-badge", text: "skip" });
          badge.setAttribute("aria-label", "Excluded from run all");
          badge.setAttribute("title", "Excluded from run all");
          btnGroup.insertBefore(badge, btnGroup.firstChild);
        }
      } else {
        wrapper.classList.remove("ocode-skip-run-all");
        wrapper.querySelector(".ocode-skip-badge")?.remove();
      }
    }
  }

  /**
   * Run every executable code block in the view sequentially, waiting for each
   * to finish before starting the next (so shared context accumulates in order).
   *
   * Plan-driven from the note *source*, not the DOM: the reading view
   * virtualizes sections, so blocks scrolled far off screen have no wrapper —
   * the old DOM-snapshot approach silently missed them (#25). Each entry is
   * located (scrolling its section into render if needed), brought into view
   * so progress is visible, run, and awaited.
   */
  private async runAllBlocks(view: MarkdownView, btnEl?: HTMLElement): Promise<void> {
    if (view.getMode() !== "preview") {
      new Notice("Switch to reading view to run all code blocks.");
      return;
    }
    const plan = this.parseRunAllPlan(view.getViewData());
    const runnable = plan.filter((e) => !e.skip);
    if (runnable.length === 0) {
      new Notice("No executable code blocks found.");
      return;
    }
    // Sync badges first so the visual state is correct before we start running.
    this.syncSkipBadges(view);

    // Register the pass so the header button can cancel it mid-run.
    const ctl = { cancelled: false, current: null as HTMLElement | null };
    this.activeRunAll.set(view, ctl);
    this.setRunAllButtonState(btnEl, true);

    const used = new Set<HTMLElement>();
    let ran = 0;
    let missing = 0;
    try {
      for (const entry of runnable) {
        if (ctl.cancelled) { new Notice("Run all stopped."); return; }
        const wrapper = await this.locateRunAllWrapper(view, entry, used);
        if (!wrapper) { missing++; continue; }
        used.add(wrapper);
        const btn = wrapper.querySelector<HTMLButtonElement>(".ocode-run-pill");
        if (!btn) continue;                                          // execution disabled / not runnable
        if (btn.classList.contains("ocode-cancel-pill")) continue;   // already running or queued
        // Embedded files aren't in skipStates — honour their DOM skip class.
        if (entry.kind === "embed" && wrapper.classList.contains("ocode-skip-run-all")) continue;

        // Follow progress: keep the running block in view (it also carries the
        // ocode-running highlight while its process is live).
        wrapper.scrollIntoView({ block: "center" });
        ctl.current = wrapper;
        btn.click();
        ran++;
        // runCode runs synchronously up to its first await, so runningProcs.set()
        // is already called by the time btn.click() returns. Poll for completion.
        await this.waitForBlockCompletion(wrapper);
        ctl.current = null;
        // Cancelled mid-block: the stop click above ended this block; bail out.
        if (ctl.cancelled) { new Notice("Run all stopped."); return; }
        // Stop Run All if the block exited with an error so later blocks don't
        // run against incomplete shared context and produce confusing failures.
        const label = wrapper.querySelector<HTMLElement>(".ocode-output-label");
        if (label) {
          const t = label.textContent ?? "";
          if (t.startsWith("Output (exit:") || t === "Output (timed out)") {
            new Notice("Run all stopped: a block exited with an error.");
            return;
          }
        }
        // A manually stopped block halts Run All too (its panel may be gone, so
        // also treat a now-empty wrapper as a stop signal).
        if (!label || label.textContent === "Output (stopped)") {
          new Notice("Run all stopped.");
          return;
        }
        // Brief pause so the shared-context store is fully committed and any
        // rapid-fire OS process startup races are avoided before the next block.
        await new Promise<void>((resolve) => window.setTimeout(resolve, 500));
      }
      if (ran === 0) new Notice("All code blocks are currently running.");
      else if (missing > 0) new Notice(`Run all: ${missing} block${missing === 1 ? "" : "s"} could not be located and ${missing === 1 ? "was" : "were"} skipped.`);
    } finally {
      this.activeRunAll.delete(view);
      this.setRunAllButtonState(btnEl, false);
    }
  }

  /**
   * Find the rendered reading-view wrapper for a Run All entry. When its
   * section is virtualized out of the DOM, scroll the preview to the entry's
   * source line so Obsidian renders it, then wait for the wrapper (and an
   * embed's async file read) to appear. `used` prevents a duplicate code block
   * from matching the same wrapper twice.
   */
  private async locateRunAllWrapper(
    view: MarkdownView,
    entry: RunAllEntry,
    used: Set<HTMLElement>,
  ): Promise<HTMLElement | null> {
    const selector = entry.kind === "fence"
      ? `.markdown-reading-view .ocode-wrapper[data-ocode-hash="${entry.hash}"]`
      : ".markdown-reading-view .ocode-wrapper.ocode-embedded";
    const find = (): HTMLElement | null => {
      for (const w of Array.from(view.contentEl.querySelectorAll<HTMLElement>(selector))) {
        if (used.has(w)) continue;
        // Embeds carry no hash — pin the match to the file shown in the header
        // so a missing/unrendered embed can't steal a later one's wrapper.
        if (entry.name && w.querySelector(".ocode-label")?.textContent !== entry.name) continue;
        return w;
      }
      return null;
    };
    let wrapper = find();
    if (wrapper) return wrapper;
    view.currentMode.applyScroll(entry.line);
    const deadline = Date.now() + 3000;
    while (!wrapper && Date.now() < deadline) {
      await new Promise<void>((r) => window.setTimeout(r, 100));
      wrapper = find();
    }
    return wrapper;
  }

  /** Resolve when the wrapper's process has finished (or the safety deadline passes). */
  private waitForBlockCompletion(wrapper: HTMLElement): Promise<void> {
    return new Promise<void>((resolve) => {
      // Safety net sized to the execution timeout (which kills the process)
      // plus slack for spawn/teardown, so Run All never gives up on a block
      // the executor itself would still allow to finish.
      const deadline = Date.now() + this.settings.executionTimeout + 10_000;
      const poll = () => {
        if (!this.runningProcs.has(wrapper) || Date.now() > deadline) {
          resolve();
        } else {
          window.setTimeout(poll, 150);
        }
      };
      window.setTimeout(poll, 150);
    });
  }

  /**
   * After a run, record the variables a block *changed* into the live
   * cross-language namespace. A var whose post-run value equals what we seeded
   * is treated as untouched (so a pure reader doesn't claim ownership or
   * degrade a value's type on a round-trip). Shell-produced values are
   * re-inferred since shells stringify everything.
   *
   * Each write remembers the block that made it and the value the variable held
   * beforehand (`prev`), so re-running that same block can recover the value it
   * originally consumed instead of feeding its own result back in (#36).
   */
  private recordRuntimeVars(
    notePath: string,
    lang: string,
    blockKey: string,
    snapshot: Record<string, unknown>,
    seeded: Record<string, VarValue>
  ): void {
    if (!this.noteLiveVars.has(notePath)) this.noteLiveVars.set(notePath, new Map());
    const live = this.noteLiveVars.get(notePath)!;
    const isShell = lang === "bash" || lang === "zsh" || lang === "shell";
    for (const [name, raw] of Object.entries(snapshot)) {
      const seededVal = seeded[name];
      let derived = false;
      if (seededVal !== undefined) {
        // Compare against the exact form the language was given. Shells stringify
        // everything, so compare scalar strings; typed languages compare values.
        const unchanged = isShell
          ? String(raw) === toShellScalar(seededVal)
          : JSON.stringify(raw) === JSON.stringify(toJs(seededVal));
        if (unchanged) continue; // pure read — don't claim ownership or change type
        // A seeded var that changed is a transform of incoming state; a plain
        // replay (which lacks that seed) can't reproduce it, so it must be
        // re-seeded when a later same-language block reads it.
        derived = true;
      }
      const value = isShell ? inferVarValue(String(raw)) : fromJsValue(raw);
      const existing = live.get(name);
      // Keep the value written by a *different* block as `prev`. Re-running the
      // same block shouldn't deepen the chain, so inherit the existing `prev`.
      const prev = existing && existing.block !== blockKey ? existing : existing?.prev;
      live.set(name, { value, lang, derived, block: blockKey, prev });
    }
  }

  /**
   * Rebuild the inline `$varname` display store from declared seeds overlaid
   * with the live runtime values, then push the result to the DOM.
   */
  private refreshDisplayVars(notePath: string): void {
    const display: Record<string, string> = {};
    const declared = this.noteVarsBlockStore.get(notePath) ?? {};
    for (const [name, v] of Object.entries(declared)) display[name] = toDisplay(v);
    const live = this.noteLiveVars.get(notePath);
    if (live) for (const [name, entry] of live) display[name] = toDisplay(entry.value);
    this.noteVarStore.set(notePath, display);
    this.updateInlineVarRefs(notePath, display);
  }

  /**
   * Build the full execution script for a shared-context run.
   *
   * Layering (this order is what makes the live cross-language namespace work):
   *   1. `preSeeds`  — declared vars (vars block / frontmatter / table), the
   *                    *initial* values, injected before replay.
   *   2. replay      — the current language's accumulated session blocks
   *                    (including this block's own earlier run, so later blocks
   *                    that depend on it still resolve), run with output
   *                    suppressed so they re-establish functions/imports/vars.
   *   3. `postSeeds` — values *changed by other languages*, injected after
   *                    replay so they win over this language's own earlier
   *                    assignments (last-writer-wins across languages).
   *   4. current block — the only block that produces visible output.
   */
  private buildSharedContextCode(
    lang: string,
    prevBlocks: string[],
    currentBlock: string,
    preSeeds?: Record<string, VarValue>,
    postSeeds?: Record<string, VarValue>
  ): string {
    const accum = prevBlocks.join("\n\n");

    // Build language-specific seed-var assignment lines. Each value is rendered
    // as a native literal for the target language (typed for Python; scalar/
    // JSON-string for shells) — see src/vars.ts.
    const renderPy = (m?: Record<string, VarValue>) =>
      m && Object.keys(m).length ? Object.entries(m).map(([k, v]) => pythonSeedLine(k, v)).join("\n") + "\n" : "";
    const renderSh = (m?: Record<string, VarValue>) =>
      m && Object.keys(m).length ? Object.entries(m).map(([k, v]) => shellSeedLine(k, v)).join("\n") + "\n" : "";
    const pythonSeed = renderPy(preSeeds);
    const pythonPost = renderPy(postSeeds);
    const bashSeed   = renderSh(preSeeds);
    const bashPost   = renderSh(postSeeds);

    if (lang === "python") {
      // Fast path: only seed vars, no accumulated blocks
      if (!accum.trim()) return pythonSeed + pythonPost + currentBlock;

      // Redirect stdout/stderr to a sink while the accumulated blocks run,
      // then restore before the current block so only the new output is shown.
      // Also suppress matplotlib/plotly plot saves so images from previous runs
      // don't bleed into the current block's output panel.
      const indented = accum.split("\n").map((l) => "    " + l).join("\n");
      return [
        pythonSeed,
        "import sys as __sys, io as __io",
        "__ocode_null = __io.StringIO()",
        "__ocode_prev_out, __ocode_prev_err, __ocode_prev_in = __sys.stdout, __sys.stderr, __sys.stdin",
        "__sys.stdout = __sys.stderr = __ocode_null",
        // Replay runs non-interactively with output suppressed — no input bar is
        // shown for it. Point stdin at an empty (EOF) stream so a replayed input()
        // or sys.stdin read returns immediately instead of blocking forever on a
        // bar that never appears. Restored before the current block, which reads
        // the real stdin normally and still gets its input bar.
        "__sys.stdin = __io.StringIO('')",
        // Suppress matplotlib plot saves during replay
        "try:",
        "    __ocode_plt_bak = __plt.show; __plt.show = lambda *a,**kw: None",
        "except Exception: pass",
        // Suppress plotly saves during replay — null out __ocode_save_plotly, which
        // both __patched_pio_show and __patched_pgo_show route through.
        "try:",
        "    __ocode_save_plotly_bak = __ocode_save_plotly; __ocode_save_plotly = lambda *a,**kw: None",
        "except Exception: pass",
        "try:",
        indented,
        // A replayed input() hits the EOF stdin above and raises EOFError. That's
        // expected — interactive input can't be replayed — and must not abort the
        // current block, so swallow it here. Genuine replay errors still propagate.
        "except EOFError: pass",
        "finally:",
        "    __sys.stdout = __ocode_prev_out",
        "    __sys.stderr = __ocode_prev_err",
        "    __sys.stdin = __ocode_prev_in",
        "    __ocode_null.close()",
        "    del __ocode_null, __ocode_prev_out, __ocode_prev_err, __ocode_prev_in",
        "    try: __plt.show = __ocode_plt_bak; del __ocode_plt_bak",
        "    except Exception: pass",
        "    try: __ocode_save_plotly = __ocode_save_plotly_bak; del __ocode_save_plotly_bak",
        "    except Exception: pass",
        "",
        pythonPost,
        currentBlock,
      ].join("\n");
    }

    if (lang === "bash" || lang === "zsh" || lang === "shell") {
      // Fast path: only seed vars, no accumulated blocks
      if (!accum.trim()) return bashSeed + bashPost + currentBlock;
      // Use exec-based fd swapping to run the preamble silently. This is more
      // reliable than { } > /dev/null 2>&1 because it avoids nested-brace
      // parser edge cases (e.g. functions with complex bodies or heredocs) and
      // guarantees function definitions are available in the current shell scope.
      // Save stdout/stderr to fds 3/4 and stdin to fd 5, then run the replay with
      // all three pointed at /dev/null: output is suppressed and a replayed `read`
      // gets EOF immediately instead of blocking on an input bar that's never shown
      // for the suppressed replay. All three are restored before the current block.
      return (
        `${bashSeed}` +
        `exec 3>&1 4>&2 5<&0 1>/dev/null 2>&1 0</dev/null\n` +
        `${accum}\n` +
        `exec 1>&3 2>&4 0<&5 3>&- 4>&- 5<&-\n\n` +
        `${bashPost}` +
        `${currentBlock}`
      );
    }

    return currentBlock;
  }

  /**
   * Python postamble: serialise all non-private globals to a single
   * `__OCODE_VARS__=<json>` line printed to stdout. The onStdout handler
   * intercepts and removes this line before it reaches the output panel.
   */
  private static readonly PYTHON_VAR_POSTAMBLE = `
try:
    import json as __json, types as __types
    __ocode_snap = {}
    for __k in list(globals().keys()):
        if __k.startswith('_'):
            continue
        __v = globals()[__k]
        if isinstance(__v, (__types.ModuleType, __types.FunctionType,
                             __types.BuiltinFunctionType, __types.MethodType, type)):
            continue
        try:
            __ocode_snap[__k] = __json.loads(__json.dumps(__v))
        except Exception:
            try:
                __ocode_snap[__k] = repr(__v)
            except Exception:
                pass
    print('\\n__OCODE_VARS__=' + __json.dumps(__ocode_snap), flush=True)
    del __json, __types, __ocode_snap
except Exception:
    pass
`;

  /**
   * Bash postamble: emit non-builtin, non-environment scalar variables as JSON.
   * Filters out shell internals, exported env, and arrays/functions for safety.
   */
  private static readonly BASH_VAR_POSTAMBLE = `
__ocode_emit_vars() {
  local __ocode_k __ocode_v __ocode_first=1
  local __ocode_skip='^(BASH|BASHOPTS|BASHPID|BASH_.*|COMP_.*|DIRSTACK|EPOCHREALTIME|EPOCHSECONDS|EUID|FUNCNAME|GROUPS|HISTCMD|HOSTNAME|HOSTTYPE|IFS|LINENO|MACHTYPE|OLDPWD|OPTERR|OPTIND|OSTYPE|PATH|PIPESTATUS|PPID|PS[0-9]|PWD|RANDOM|SECONDS|SHELL|SHELLOPTS|SHLVL|SRANDOM|TERM|UID|_|__ocode_.*)$'
  printf '\\n__OCODE_VARS__={'
  while IFS= read -r __ocode_k; do
    [[ -z $__ocode_k || $__ocode_k == _* ]] && continue
    [[ $__ocode_k =~ $__ocode_skip ]] && continue
    declare -p "$__ocode_k" 2>/dev/null | grep -q '^declare -[^ ]*x' && continue
    declare -p "$__ocode_k" 2>/dev/null | grep -qE '^declare -[^ ]*[afA]' && continue
    __ocode_v="\${!__ocode_k}"
    __ocode_v="\${__ocode_v//\\\\/\\\\\\\\}"
    __ocode_v="\${__ocode_v//\\"/\\\\\\"}"
    __ocode_v="\${__ocode_v//$'\\n'/\\\\n}"
    __ocode_v="\${__ocode_v//$'\\t'/\\\\t}"
    __ocode_v="\${__ocode_v//$'\\r'/\\\\r}"
    [[ $__ocode_first -eq 1 ]] || printf ','
    __ocode_first=0
    printf '"%s":"%s"' "$__ocode_k" "$__ocode_v"
  done < <(compgen -v)
  printf '}\\n'
}
__ocode_emit_vars
`;

  /**
   * Zsh postamble: emit ordinary non-exported scalar parameters as JSON.
   * Uses zsh/parameter metadata instead of Bash-only compgen/declare.
   */
  private static readonly ZSH_VAR_POSTAMBLE = `
__ocode_emit_vars() {
  emulate -L zsh
  zmodload zsh/parameter 2>/dev/null || return 0
  local __ocode_k __ocode_v __ocode_type __ocode_first=1 __ocode_quote=$'"'
  local __ocode_skip='^(0|ARGC|BAUD|COLUMNS|CONTEXT|CPUTYPE|DIRSTACKSIZE|EGID|ERRNO|EUID|FIGNORE|FPATH|GID|HISTCMD|HISTCHARS|HOST|HOSTTYPE|IFS|KEYBOARD_HACK|KEYTIMEOUT|LANG|LINENO|LISTMAX|LOGCHECK|MACHTYPE|MAILCHECK|MAILPATH|MODULE_PATH|NULLCMD|OLDPWD|OPTARG|OPTIND|OSTYPE|PPID|PROMPT.*|PS[0-9]?|PSVAR|PWD|RANDOM|READNULLCMD|REPORTTIME|RPROMPT.*|SAVEHIST|SECONDS|SHELL|SHLVL|SPROMPT|TERM|TIMEFMT|TMPPREFIX|TTY|UID|USERNAME|VENDOR|WATCH|WORDCHARS|ZDOTDIR|ZSH_.*|_|__ocode_.*)$'
  printf '\n__OCODE_VARS__={'
  for __ocode_k in \${(k)parameters}; do
    [[ -z $__ocode_k || $__ocode_k == _* ]] && continue
    [[ $__ocode_k =~ $__ocode_skip ]] && continue
    __ocode_type=\${parameters[$__ocode_k]}
    [[ $__ocode_type == *scalar* ]] || continue
    [[ $__ocode_type == *export* ]] && continue
    [[ $__ocode_type == *special* ]] && continue
    __ocode_v=\${(P)__ocode_k}
    __ocode_v="\${__ocode_v//\\/\\\\}"
    __ocode_v=\${__ocode_v//$__ocode_quote/\\\\$__ocode_quote}
    __ocode_v="\${__ocode_v//$'\n'/\\n}"
    __ocode_v="\${__ocode_v//$'\t'/\\t}"
    __ocode_v="\${__ocode_v//$'\r'/\\r}"
    [[ $__ocode_first -eq 1 ]] || printf ','
    __ocode_first=0
    printf '"%s":"%s"' "$__ocode_k" "$__ocode_v"
  done
  printf '}\n'
}
__ocode_emit_vars
`;

  /**
   * Broadcast the latest var values to all matching inline `$varname` spans in
   * the current document. Iterates by class then looks up the var name on each
   * element — avoids any attribute-selector escaping pitfalls.
   */
  private updateInlineVarRefs(_notePath: string, store: Record<string, string>): void {
    const els = activeDocument.querySelectorAll<HTMLElement>("code.ocode-var-ref");
    for (const el of Array.from(els)) {
      const name = el.getAttribute("data-ocode-var");
      if (name && Object.prototype.hasOwnProperty.call(store, name)) {
        el.textContent = String(store[name]);
        el.setAttribute("data-resolved", "");
      }
    }
  }

  // ─── Code file integration ───────────────────────────────────

  /**
   * Register all known code file extensions with Obsidian so they appear in
   * the file explorer and open via CodeFileView. We skip extensions that
   * Obsidian or other plugins already own (`.md`, `.css`, `.html`, `.json`,
   * `.xml`) to avoid stomping on built-in behaviour.
   */
  private registerCodeFileExtensions(): void {
    const reserved = new Set([".md", ".css", ".html", ".htm", ".json", ".xml"]);
    const exts = Object.keys(EXT_TO_LANG)
      .filter((e) => !reserved.has(e))
      .map((e) => e.startsWith(".") ? e.slice(1) : e);
    try {
      this.registerExtensions(exts, CODE_FILE_VIEW_TYPE);
    } catch {
      // Some extensions may already be claimed by another plugin — Obsidian
      // throws in that case. Fall back to per-extension registration so we
      // still grab everything we can.
      for (const e of exts) {
        try { this.registerExtensions([e], CODE_FILE_VIEW_TYPE); } catch { /* skip taken extension */ }
      }
    }
  }

  /**
   * Import an external code file as an alias (symlink) inside the vault.
   * Opens a native file picker, then creates a symlink in the configured
   * imports folder (created on demand). The file then appears in the
   * Obsidian file explorer and can be opened, edited, and run like any
   * other vault file.
   */
  private async importCodeFileAsAlias(): Promise<void> {
    if (!Platform.isDesktop) {
      new Notice("Importing code files is only available on desktop.");
      return;
    }
    const nodeRequire = (window as unknown as { require: (id: string) => unknown }).require;
    const fs = nodeRequire("fs") as typeof import("fs");
    const path = nodeRequire("path") as typeof import("path");

    // Prefer Electron's native open-file dialog — it always returns a real
    // absolute path. (Newer Electron strips `File.path` from <input type=file>
    // for sandboxing reasons, which is why the old DOM-input approach was
    // silently failing for some users.)
    const externalPath = await this.pickExternalCodeFile();
    if (!externalPath) return;

    const ext = path.extname(externalPath).toLowerCase();
    if (!CODE_FILE_EXTENSIONS.has(ext)) {
      new Notice(`Unsupported file type: ${ext || "(no extension)"}.`);
      return;
    }

    const vaultPath = (this.app.vault.adapter as unknown as { basePath: string }).basePath;
    const folderRel = (this.settings.codeImportsFolder || "CodeSuiteImports").replace(/^\/+|\/+$/g, "");
    const folderAbs = path.join(vaultPath, folderRel);

    // Guarantee the destination folder exists ON DISK first (this is what the
    // symlink will actually need). Then make sure Obsidian's vault index knows
    // about it. Doing it in this order avoids the case where vault.createFolder
    // silently no-ops due to an index/disk mismatch.
    try {
      fs.mkdirSync(folderAbs, { recursive: true });
    } catch (err) {
      new Notice(`Cannot create imports folder: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    const existingFolder = this.app.vault.getAbstractFileByPath(folderRel);
    if (!existingFolder) {
      try { await this.app.vault.createFolder(folderRel); } catch { /* already exists */ }
    } else if (!(existingFolder instanceof TFolder)) {
      new Notice(`Cannot import: "${folderRel}" exists and is not a folder.`);
      return;
    }

    const baseName = path.basename(externalPath);
    let targetRel = `${folderRel}/${baseName}`;
    let targetAbs = path.join(vaultPath, targetRel);
    // Disambiguate against existing files: file.py → file-1.py → file-2.py
    if (fs.existsSync(targetAbs)) {
      const stem = baseName.slice(0, baseName.length - ext.length);
      let n = 1;
      while (fs.existsSync(path.join(vaultPath, `${folderRel}/${stem}-${n}${ext}`))) n++;
      targetRel = `${folderRel}/${stem}-${n}${ext}`;
      targetAbs = path.join(vaultPath, targetRel);
    }

    try {
      fs.symlinkSync(externalPath, targetAbs);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`Failed to create alias: ${msg}`);
      return;
    }

    new Notice(`Aliased "${baseName}" → ${targetRel}`);

    // Open the alias in a new tab as soon as the vault indexes the symlink.
    // The "create" event fires at the same moment the file-explorer sidebar
    // updates, so both happen in sync. A polling fallback with exponential
    // back-off handles slow/NFS filesystems where the watcher is delayed.
    let done = false;
    const openInNewTab = async (file: TFile) => {
      if (done) return;
      done = true;
      await this.app.workspace.getLeaf("tab").openFile(file);
    };

    const ref = this.app.vault.on("create", (file) => {
      if (file instanceof TFile && file.path === targetRel) {
        this.app.vault.offref(ref);
        void openInNewTab(file);
      }
    });

    // Fallback: poll with exponential back-off for up to ~5 s.
    let delay = 300;
    const poll = () => {
      if (done) { this.app.vault.offref(ref); return; }
      const f = this.app.vault.getAbstractFileByPath(targetRel);
      if (f instanceof TFile) {
        this.app.vault.offref(ref);
        void openInNewTab(f);
      } else if (delay < 5000) {
        delay = Math.min(delay * 2, 5000);
        window.setTimeout(poll, delay);
      } else {
        this.app.vault.offref(ref);
      }
    };
    window.setTimeout(poll, delay);
  }

  /**
   * Show an OS-native open dialog and return the selected absolute path
   * (or null if the user cancelled). Tries Electron's `dialog.showOpenDialog`
   * via every API path it might be exposed on, then falls back to a hidden
   * `<input type="file">` for environments where Electron is unreachable.
   */
  private async pickExternalCodeFile(): Promise<string | null> {
    const nodeRequire = (window as unknown as { require?: (id: string) => unknown }).require;
    interface ShowOpenDialog {
      (opts: { properties?: string[]; filters?: { name: string; extensions: string[] }[] }):
        Promise<{ canceled: boolean; filePaths: string[] }>;
    }
    let showOpenDialog: ShowOpenDialog | null = null;

    if (nodeRequire) {
      try {
        const electron = nodeRequire("electron") as {
          remote?: { dialog?: { showOpenDialog?: ShowOpenDialog } };
          dialog?: { showOpenDialog?: ShowOpenDialog };
        };
        showOpenDialog =
          electron?.remote?.dialog?.showOpenDialog ??
          electron?.dialog?.showOpenDialog ??
          null;
      } catch { /* electron not available — fall through */ }

      if (!showOpenDialog) {
        try {
          const remote = nodeRequire("@electron/remote") as {
            dialog?: { showOpenDialog?: ShowOpenDialog };
          };
          showOpenDialog = remote?.dialog?.showOpenDialog ?? null;
        } catch { /* @electron/remote not available — fall through */ }
      }
    }

    const extList = Array.from(CODE_FILE_EXTENSIONS, (e) => e.replace(/^\./, ""));

    if (showOpenDialog) {
      const result = await showOpenDialog({
        properties: ["openFile"],
        filters: [{ name: "Code files", extensions: extList }],
      });
      if (result.canceled || !result.filePaths.length) return null;
      return result.filePaths[0];
    }

    // Fallback: hidden file input (may not work on Electron ≥ 32 where File.path is stripped).
    return new Promise<string | null>((resolve) => {
      const input = createEl("input");
      input.type = "file";
      input.addClass("ocode-hidden-input");
      input.addEventListener("change", () => {
        const f = input.files?.[0] as (File & { path?: string }) | undefined;
        const p = f?.path;
        input.remove();
        if (!p) new Notice("Could not read file path from picker. Try again, or report this issue.");
        resolve(p ?? null);
      });
      input.addEventListener("cancel", () => { input.remove(); resolve(null); });
      activeDocument.body.appendChild(input);
      input.click();
    });
  }

  // ─── Import / export / conversion (#5) ────────────────────────

  /** Reach Electron's dialog module (renderer remote), or null if unavailable. */
  private getDialog(): ElectronDialog | null {
    const nodeRequire = (window as unknown as { require?: (id: string) => unknown }).require;
    if (!nodeRequire) return null;
    try {
      const electron = nodeRequire("electron") as { remote?: { dialog?: ElectronDialog }; dialog?: ElectronDialog };
      const d = electron?.remote?.dialog ?? electron?.dialog;
      if (d) return d;
    } catch { /* electron unavailable — try @electron/remote */ }
    try {
      const remote = nodeRequire("@electron/remote") as { dialog?: ElectronDialog };
      return remote?.dialog ?? null;
    } catch { return null; }
  }

  /** Reach Electron's BrowserWindow constructor (renderer remote), or null. */
  private getBrowserWindow(): ElectronBrowserWindowCtor | null {
    const nodeRequire = (window as unknown as { require?: (id: string) => unknown }).require;
    if (!nodeRequire) return null;
    try {
      const electron = nodeRequire("electron") as { remote?: { BrowserWindow?: ElectronBrowserWindowCtor } };
      const bw = electron?.remote?.BrowserWindow;
      if (bw) return bw;
    } catch { /* electron unavailable — try @electron/remote */ }
    try {
      const remote = nodeRequire("@electron/remote") as { BrowserWindow?: ElectronBrowserWindowCtor };
      return remote?.BrowserWindow ?? null;
    } catch { return null; }
  }

  /** Native open dialog filtered to the given extensions; null if cancelled/unavailable. */
  private async pickOpenFile(name: string, extensions: string[]): Promise<string | null> {
    const dialog = this.getDialog();
    if (!dialog?.showOpenDialog) {
      new Notice("File picker is unavailable in this environment.");
      return null;
    }
    const res = await dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name, extensions }] });
    if (res.canceled || !res.filePaths.length) return null;
    return res.filePaths[0];
  }

  /**
   * Write an export to disk. Offers a native save dialog when available;
   * otherwise falls back to writing at `defaultAbsPath` (inside the vault).
   */
  private async saveExport(
    defaultAbsPath: string,
    name: string,
    extensions: string[],
    data: string | Uint8Array,
  ): Promise<void> {
    const nodeRequire = (window as unknown as { require: (id: string) => unknown }).require;
    const fs = nodeRequire("fs") as typeof import("fs");
    const dialog = this.getDialog();
    let out = defaultAbsPath;
    if (dialog?.showSaveDialog) {
      const res = await dialog.showSaveDialog({ defaultPath: defaultAbsPath, filters: [{ name, extensions }] });
      if (res.canceled || !res.filePath) return; // user cancelled
      out = res.filePath;
    }
    try {
      fs.writeFileSync(out, data);
      new Notice(`Exported → ${out}`);
    } catch (err) {
      new Notice(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Import a Jupyter notebook as a new (unrun) CodeSuite markdown note. */
  private async importNotebook(): Promise<void> {
    if (!Platform.isDesktop) { new Notice("Importing notebooks is desktop-only."); return; }
    const nodeRequire = (window as unknown as { require: (id: string) => unknown }).require;
    const fs = nodeRequire("fs") as typeof import("fs");
    const path = nodeRequire("path") as typeof import("path");

    const src = await this.pickOpenFile("Jupyter notebook", ["ipynb"]);
    if (!src) return;

    let nb: Notebook;
    try {
      nb = JSON.parse(fs.readFileSync(src, "utf8")) as Notebook;
    } catch (err) {
      new Notice(`Could not read notebook: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    if (!nb || !Array.isArray(nb.cells)) { new Notice("Not a valid .ipynb notebook."); return; }

    const { markdown } = ipynbToMarkdown(nb);

    // Land the note beside the active file (or in vault root), basename from the ipynb.
    const stem = path.basename(src).replace(/\.ipynb$/i, "");
    const activeFile = this.app.workspace.getActiveFile();
    const folder = activeFile?.parent && activeFile.parent.path !== "/" ? activeFile.parent.path + "/" : "";
    let target = `${folder}${stem}.md`;
    let n = 1;
    while (this.app.vault.getAbstractFileByPath(target)) target = `${folder}${stem}-${n++}.md`;

    try {
      const file = await this.app.vault.create(target, markdown);
      await this.app.workspace.getLeaf("tab").openFile(file);
      new Notice(`Imported notebook → ${target}`);
    } catch (err) {
      new Notice(`Failed to create note: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Export the active note's code blocks + prose to an (unrun) Jupyter notebook. */
  private async exportNotebook(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") return;
    const markdown = await this.app.vault.read(file);
    const nb = markdownToIpynb(
      markdown,
      (raw) => this.highlighter.resolveLanguage(raw),
      (lang) => isExecutable(lang),
    );
    const json = JSON.stringify(nb, null, 1);
    const defaultPath = this.exportDefaultPath(file, "ipynb");
    await this.saveExport(defaultPath, "Jupyter notebook", ["ipynb"], json);
  }

  /** Absolute on-disk path next to the note, with the given extension. */
  private exportDefaultPath(file: TFile, ext: string): string {
    const nodeRequire = (window as unknown as { require: (id: string) => unknown }).require;
    const path = nodeRequire("path") as typeof import("path");
    const vaultPath = (this.app.vault.adapter as unknown as { basePath: string }).basePath;
    const folder = file.parent && file.parent.path !== "/" ? file.parent.path : "";
    return path.join(vaultPath, folder, `${file.basename}.${ext}`);
  }

  /**
   * Locate a MarkdownView for the active file that is currently rendered in
   * reading view — the only place where executed code outputs live in the DOM.
   */
  private getRenderedPreview(): { view: MarkdownView; previewEl: HTMLElement } | null {
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    const wantFile = active?.file ?? this.app.workspace.getActiveFile();
    const candidates: MarkdownView[] = [];
    if (active) candidates.push(active);
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof MarkdownView && !candidates.includes(leaf.view)) candidates.push(leaf.view);
    });
    for (const view of candidates) {
      if (wantFile && view.file?.path !== wantFile.path) continue;
      if (view.getMode() !== "preview") continue;
      const previewEl = view.contentEl.querySelector<HTMLElement>(".markdown-preview-view");
      if (previewEl) return { view, previewEl };
    }
    return null;
  }

  /** Export the rendered note (with current outputs) to HTML or PDF. */
  private async exportRenderedNote(format: "html" | "pdf"): Promise<void> {
    if (!Platform.isDesktop) { new Notice("Export is desktop-only."); return; }
    const found = this.getRenderedPreview();
    if (!found || !found.view.file) {
      new Notice("Open the note in reading view (and run its code blocks) before exporting.");
      return;
    }
    const { view, previewEl } = found;
    const file = view.file!;

    const options = await this.promptExportOptions(format);
    if (!options) return; // user cancelled
    await this.persistExportOptions(options);

    const html = await this.buildNoteHtml(previewEl, file, format, options);

    if (format === "html") {
      await this.saveExport(this.exportDefaultPath(file, "html"), "HTML", ["html"], html);
    } else {
      await this.exportPdf(html, this.exportDefaultPath(file, "pdf"), options);
    }
  }

  /** Show the per-export options modal, seeded from the last-used choices. */
  private promptExportOptions(format: "html" | "pdf"): Promise<ExportOptions | null> {
    const seed: ExportOptions = {
      widthMode: this.settings.exportWidthMode ?? DEFAULT_EXPORT_OPTIONS.widthMode,
      keepCodeBlocksWhole: this.settings.exportKeepCodeBlocksWhole ?? DEFAULT_EXPORT_OPTIONS.keepCodeBlocksWhole,
      singlePage: this.settings.exportSinglePage ?? DEFAULT_EXPORT_OPTIONS.singlePage,
      includeTitle: this.settings.exportIncludeTitle ?? DEFAULT_EXPORT_OPTIONS.includeTitle,
    };
    return new Promise((resolve) => {
      new ExportOptionsModal(this.app, format, seed, resolve).open();
    });
  }

  /** Remember the chosen export options for next time. */
  private async persistExportOptions(o: ExportOptions): Promise<void> {
    this.settings.exportWidthMode = o.widthMode;
    this.settings.exportKeepCodeBlocksWhole = o.keepCodeBlocksWhole;
    this.settings.exportSinglePage = o.singlePage;
    this.settings.exportIncludeTitle = o.includeTitle;
    await this.saveSettings();
  }

  /** Build a self-contained, themed HTML document from a rendered preview clone. */
  private async buildNoteHtml(previewEl: HTMLElement, file: TFile, format: "html" | "pdf", options: ExportOptions): Promise<string> {
    const nodeRequire = (window as unknown as { require: (id: string) => unknown }).require;
    const fs = nodeRequire("fs") as typeof import("fs");
    const path = nodeRequire("path") as typeof import("path");

    // Reading view *virtualizes*: only the sections near the viewport actually
    // live in the DOM, so cloning previewEl drops everything scrolled out of
    // view. Render the full note from source instead — that guarantees every
    // section is present — then graft in the execution outputs that the live
    // (partial) preview is currently showing.
    const markdown = await this.app.vault.read(file);
    const full = activeDocument.createElement("div");
    full.className = "markdown-preview-view ocode-export";

    // Short-lived component owns the render's child lifecycles; unloaded below.
    const comp = new Component();
    comp.load();
    // Collect html-preview panes built during this render so their (otherwise
    // lazily-built, layout-gated) iframes can be materialized for the export (#33).
    this._exportHtmlPanes = [];
    try {
      await MarkdownRenderer.render(this.app, markdown, full, file.path, comp);

      await this.buildExportHtmlFrames(full, file.path);
      this.graftLiveOutputs(previewEl, full);
      this.cleanExportClone(full);
      this.inlineImages(full, fs, path);

      const pluginCss = await this.readPluginCss();
      const themeVars = this.captureThemeVars();
      const singlePage = format === "pdf" && options.singlePage;
      let bodyClass = this.captureBodyClass();
      if (singlePage) bodyClass += " ocode-singlepage";
      // PDF always matches the current reading-view width (the width dropdown is
      // HTML-only); "full width" on a fixed/endless page breaks the layout.
      const contentWidth = format === "pdf"
        ? this.captureContentWidth(previewEl)
        : this.resolveContentWidth(previewEl, options.widthMode);

      return buildExportHtml({
        title: file.basename,
        bodyHtml: full.innerHTML,
        pluginCss,
        themeVars,
        bodyClass,
        contentWidth,
        keepBlocksWhole: format === "pdf" && options.keepCodeBlocksWhole,
        singlePage,
        paginated: format === "pdf" && !singlePage,
        includeTitle: options.includeTitle,
      });
    } finally {
      this._exportHtmlPanes = null;
      comp.unload();
    }
  }

  /**
   * Materialize the html-preview iframes collected during an export render.
   * Only panes whose block is showing the preview (`ocode-show-preview`) get a
   * frame — a code-mode block exports its source as usual. Template blocks have
   * their `{{ … }}` resolved against the note's data first. The frame's `srcdoc`
   * serializes into the exported HTML; a tiny listener in {@link buildExportHtml}
   * sizes each iframe from the same postMessage the live preview uses.
   */
  private async buildExportHtmlFrames(root: HTMLElement, sourcePath: string): Promise<void> {
    const panes = this._exportHtmlPanes;
    if (!panes || !panes.length) return;
    for (const { pane, wrapper, code, htmlTemplate } of panes) {
      // Only touch panes inside this export render — a live reading-view render
      // could have pushed its own panes into the shared array mid-export.
      if (!root.contains(pane)) continue;
      if (!wrapper.classList.contains("ocode-show-preview")) continue;
      if (pane.querySelector("iframe")) continue; // already built (e.g. was on-screen)
      const html = htmlTemplate ? await this.resolveTemplate(code, sourcePath) : code;
      const iframe = createEl("iframe");
      iframe.className = "ocode-html-frame";
      iframe.setAttribute("sandbox", "allow-scripts");
      iframe.setAttribute("scrolling", "no");
      // Reuse the live srcdoc builder (theme-wrapped fragment / verbatim full
      // document + resize shim). The shim posts its height to the parent; the
      // export document's listener matches the iframe by source, so the embedded
      // token is unused here but harmless.
      iframe.srcdoc = this.buildHtmlSrcdoc(html, `ocode-export-frame-${++this._frameSeq}`);
      pane.appendChild(iframe);
    }
  }

  /** Resolve the requested width mode to a max-width in px (0 = full width). */
  private resolveContentWidth(previewEl: HTMLElement, mode: ExportWidthMode): number {
    if (mode === "full") return 0;
    if (mode === "current") return this.captureContentWidth(previewEl);
    // "default": Obsidian's readable-line-length width, independent of the
    // current window size. Falls back to 700px (Obsidian's own default).
    const v = activeWindow.getComputedStyle(activeDocument.body).getPropertyValue("--file-line-width").trim();
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 700;
  }

  /**
   * The reading view's content column width (px), so the export matches the
   * width the user sees in Obsidian. Reads the `.markdown-preview-sizer` box
   * minus its horizontal padding; returns 0 (full width) when unavailable.
   */
  private captureContentWidth(previewEl: HTMLElement): number {
    const sizer = previewEl.querySelector<HTMLElement>(".markdown-preview-sizer");
    if (!sizer) return 0;
    const cs = activeWindow.getComputedStyle(sizer);
    const w = sizer.clientWidth - parseFloat(cs.paddingLeft || "0") - parseFloat(cs.paddingRight || "0");
    return w > 0 ? Math.round(w) : 0;
  }

  /**
   * The live <body> classes the export needs to reproduce the reading view:
   * the active theme plus CodeSuite's own setting-scoped body classes (wrap /
   * wide), which the wrapping and width rules in styles.css are scoped to.
   */
  private captureBodyClass(): string {
    const keep = Array.from(activeDocument.body.classList).filter((c) =>
      c === "theme-dark" || c === "theme-light" || c.startsWith("ocode-")
    );
    if (!keep.some((c) => c === "theme-dark" || c === "theme-light")) {
      keep.push(activeDocument.body.classList.contains("theme-dark") ? "theme-dark" : "theme-light");
    }
    return keep.join(" ");
  }

  /**
   * Copy execution outputs from the live (virtualized) preview into the freshly
   * rendered, complete document. Code blocks are matched by their rendered code
   * text, FIFO per identical block, so duplicate snippets keep their own output.
   */
  private graftLiveOutputs(live: HTMLElement, full: HTMLElement): void {
    const codeKey = (w: Element): string =>
      (w.querySelector("pre.shiki code")?.textContent ?? "").trim();

    const queues = new Map<string, HTMLElement[]>();
    for (const w of Array.from(live.querySelectorAll(".ocode-wrapper"))) {
      const out = w.querySelector<HTMLElement>(".ocode-output");
      const key = codeKey(w);
      if (!out || !key) continue;
      const q = queues.get(key);
      if (q) q.push(out); else queues.set(key, [out]);
    }
    if (queues.size === 0) return;

    for (const w of Array.from(full.querySelectorAll(".ocode-wrapper"))) {
      if (w.querySelector(".ocode-output")) continue;
      const q = queues.get(codeKey(w));
      const out = q?.shift();
      if (out) w.appendChild(out.cloneNode(true));
    }
  }

  /** Strip reading-view scaffolding + interactive chrome from an export clone. */
  private cleanExportClone(root: HTMLElement): void {
    const drop = [
      ".markdown-preview-pusher", ".mod-header", ".mod-footer",
      ".ocode-btn-group", ".ocode-pill", ".ocode-input-bar",
      ".edit-block-button", ".collapse-indicator",
    ];
    for (const sel of drop) {
      for (const el of Array.from(root.querySelectorAll(sel))) el.remove();
    }
    // Expand collapsed blocks so all code is visible in the static document.
    for (const el of Array.from(root.querySelectorAll(".ocode-collapsed"))) el.classList.remove("ocode-collapsed");
    for (const el of Array.from(root.querySelectorAll(".ocode-hidden"))) el.classList.remove("ocode-hidden");
  }

  /** Convert vault/app:// image sources to inline data-URIs (matplotlib already is). */
  private inlineImages(root: HTMLElement, fs: typeof import("fs"), path: typeof import("path")): void {
    const mime: Record<string, string> = {
      ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
      ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp", ".bmp": "image/bmp",
    };
    for (const img of Array.from(root.querySelectorAll("img"))) {
      const src = img.getAttribute("src") || "";
      if (!src || src.startsWith("data:")) continue;
      try {
        const u = new URL(src);
        let p = decodeURIComponent(u.pathname);
        if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1); // Windows drive paths: /C:/… → C:/…
        const buf = fs.readFileSync(p);
        const m = mime[path.extname(p).toLowerCase()] || "application/octet-stream";
        img.setAttribute("src", `data:${m};base64,${buf.toString("base64")}`);
        img.removeAttribute("srcset");
      } catch { /* leave external/unreadable images untouched */ }
    }
  }

  /** Read the plugin's own styles.css so the export carries CodeSuite styling. */
  private async readPluginCss(): Promise<string> {
    const dir = this.manifest.dir;
    if (!dir) return "";
    const cssPath = `${dir}/styles.css`;
    try {
      if (await this.app.vault.adapter.exists(cssPath)) {
        return await this.app.vault.adapter.read(cssPath);
      }
    } catch { /* styles.css unreadable — export still works, just less styled */ }
    return "";
  }

  /** Snapshot the theme custom properties the export CSS relies on. */
  private captureThemeVars(): string {
    const names = [
      "--ocode-bg", "--ocode-fg", "--ocode-header-bg", "--ocode-border",
      "--ocode-output-bg", "--ocode-muted", "--ocode-line-num",
      "--background-primary", "--background-secondary", "--background-modifier-border",
      "--text-normal", "--text-muted", "--text-accent", "--code-background",
      "--font-monospace", "--font-text",
    ];
    const rootStyle = activeWindow.getComputedStyle(activeDocument.documentElement);
    const bodyStyle = activeWindow.getComputedStyle(activeDocument.body);
    const lines: string[] = [];
    for (const v of names) {
      const val = (rootStyle.getPropertyValue(v) || bodyStyle.getPropertyValue(v)).trim();
      if (val) lines.push(`  ${v}: ${val};`);
    }
    const font = (bodyStyle.getPropertyValue("--font-text") || bodyStyle.fontFamily).trim();
    if (font) lines.push(`  --export-font: ${font};`);
    return `:root {\n${lines.join("\n")}\n}`;
  }

  /** Render HTML to PDF in a hidden Electron window via webContents.printToPDF. */
  private async exportPdf(html: string, defaultPath: string, options: ExportOptions): Promise<void> {
    const BrowserWindow = this.getBrowserWindow();
    if (!BrowserWindow) {
      new Notice("PDF export needs Electron. Export to HTML and print to PDF from a browser instead.");
      return;
    }
    const nodeRequire = (window as unknown as { require: (id: string) => unknown }).require;
    const fs = nodeRequire("fs") as typeof import("fs");
    const os = nodeRequire("os") as typeof import("os");
    const path = nodeRequire("path") as typeof import("path");

    // Pick the destination up front (matching the other exporters).
    const dialog = this.getDialog();
    let out = defaultPath;
    if (dialog?.showSaveDialog) {
      const res = await dialog.showSaveDialog({ defaultPath, filters: [{ name: "PDF", extensions: ["pdf"] }] });
      if (res.canceled || !res.filePath) return;
      out = res.filePath;
    }

    const tmpHtml = path.join(os.tmpdir(), `codesuite-export-${Date.now()}.html`);
    let win: ElectronBrowserWindow | null = null;
    try {
      fs.writeFileSync(tmpHtml, html);
      win = new BrowserWindow({ show: false, width: 820, height: 1160, webPreferences: { sandbox: true } });
      await win.loadFile(tmpHtml);

      // Margins 0 so the dark themed background bleeds to the paper edge.
      const printOpts: Record<string, unknown> = {
        printBackground: true,
        pageSize: "A4",
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      };

      if (options.singlePage) {
        // One tall page, no breaks. Measure the FULL rendered document height via
        // the root element's bounding box — that's the true content height even
        // though the offscreen window's viewport is short (scrollHeight there can
        // collapse to ~viewport, which paginated the page into many short pages).
        // Wait for fonts + every inlined image to load first so the height is final.
        const dims = await win.webContents.executeJavaScript(`
          (async () => {
            try { await document.fonts.ready; } catch { /* fonts API unavailable */ }
            await Promise.all(Array.from(document.images).map((img) =>
              img.complete ? null : new Promise((res) => { img.onload = img.onerror = () => res(null); })
            ));
            await new Promise((r) => setTimeout(r, 50));
            const r = document.documentElement.getBoundingClientRect();
            return { w: Math.ceil(r.width), h: Math.ceil(r.height) };
          })()
        `) as { w: number; h: number };
        // Modern Electron (Obsidian runs Chrome 142+) takes pageSize in INCHES,
        // not microns. 96 CSS px = 1 inch. PDF caps a page at 200 inches. A single
        // explicit pageSize (with margins 0, already set) means no page breaks;
        // the dark body/html background fills it and ocode-singlepage pads it.
        const wIn = (dims && dims.w > 0 ? dims.w : 820) / 96;
        const hIn = (dims && dims.h > 0 ? dims.h : 1160) / 96;
        printOpts.pageSize = {
          width: Number(wIn.toFixed(3)),
          height: Number(Math.min(hIn, 200).toFixed(3)),
        };
      }

      const pdf = await win.webContents.printToPDF(printOpts);

      fs.writeFileSync(out, pdf);
      new Notice(`Exported → ${out}`);
    } catch (err) {
      new Notice(`PDF export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (win) { try { win.destroy(); } catch { /* window already closed */ } }
      try { fs.unlinkSync(tmpHtml); } catch { /* temp file already gone */ }
    }
  }

  // ─── Code Block Processing ────────────────────────────────────

  private processCodeBlocks(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
    const codeBlocks = el.querySelectorAll("pre > code");
    if (!codeBlocks.length) return;

    // Seed any `code_vars:` frontmatter variables into the note's var stores
    // before processing blocks. This is idempotent — re-rendering a note just
    // re-applies the same values. Block-level `vars` declarations are merged
    // *after* this in renderVarsBlock and therefore override frontmatter vars.
    this.applyFrontmatterVars(ctx);

    // Extract OPENING fence info strings from the raw section source so we can
    // read space-separated attributes next to the language, e.g.
    //     ```python skip collapsed
    // Important: a code fence is a *pair* of fence lines. We must skip the
    // closing fence; otherwise `fenceInfoStrings[bi]` becomes off-by-one as
    // soon as the section contains more than one code block.
    const fenceInfoStrings: string[] = [];
    const sectionInfo = ctx.getSectionInfo(el);
    if (sectionInfo) {
      // sectionInfo.text is the WHOLE file, not just this section — scanning
      // it all would make every section's block inherit the attrs of the
      // first fence in the note. Slice to this section's own lines.
      const lines = sectionInfo.text
        .split("\n")
        .slice(sectionInfo.lineStart, sectionInfo.lineEnd + 1);
      let openFence: string | null = null;  // current open fence chars (``` or ~~~), or null when outside
      for (const line of lines) {
        const m = line.match(/^([`~]{3,})(.*)$/);
        if (!m) continue;
        const fenceChars = m[1][0].repeat(m[1].length);
        if (openFence === null) {
          // Opening fence
          fenceInfoStrings.push(m[2].trim());
          openFence = fenceChars;
        } else if (line.startsWith(openFence) && m[2].trim() === "") {
          // Closing fence (same char, length ≥ opener, no info text)
          openFence = null;
        }
      }
    }

    for (let bi = 0; bi < codeBlocks.length; bi++) {
      const codeEl = codeBlocks[bi];
      const pre = codeEl.parentElement;
      if (!pre) continue;
      if (pre.parentElement?.hasClass("ocode-wrapper")) continue;

      // Skip YAML frontmatter — Obsidian wraps it in a .frontmatter div
      // and the el passed to the post-processor IS that div at the top of the note
      if (
        pre.closest(".frontmatter") ||
        pre.closest("[data-type='frontmatter']") ||
        el.classList.contains("frontmatter") ||
        el.hasAttribute("data-role") && el.getAttribute("data-role") === "frontmatter"
      ) continue;

      const langClass = Array.from(codeEl.classList).find((c) =>
        c.startsWith("language-")
      );
      const rawLang = langClass ? langClass.replace("language-", "") : "";

      // Skip languages that Obsidian (or its plugins) render natively — let
      // them handle the block so we don't swallow their output.
      if (PASSTHROUGH_LANGS.has(rawLang.toLowerCase())) continue;

      // `vars` blocks define note-scoped variables inline — parse and store immediately.
      if (rawLang.toLowerCase() === "vars") {
        this.renderVarsBlock(pre, codeEl.textContent || "", ctx.sourcePath);
        continue;
      }

      // Baked-output blocks (opt-in): render the saved output as a panel instead
      // of a runnable code block. When the feature is off they fall through and
      // render as a normal (JSON) code block.
      if (this.settings.bakedOutputs && rawLang.toLowerCase() === BAKED_OUTPUT_LANG) {
        this.renderBakedOutputBlock(pre, codeEl.textContent || "", ctx, el);
        continue;
      }

      // Parse space-separated attributes from the fence info string, e.g.:
      //   ```python skip collapsed   → attrs: { "skip", "collapsed" }
      const infoStr = fenceInfoStrings[bi] ?? "";
      const blockAttrs = new Set(
        infoStr.split(/\s+/).slice(1).map((w) => w.toLowerCase()).filter(Boolean)
      );
      // Also pick up any extra classes Obsidian might add from the info string
      for (const cls of Array.from(codeEl.classList)) {
        if (!cls.startsWith("language-")) blockAttrs.add(cls.toLowerCase());
      }
      const forceSkip = blockAttrs.has("skip");
      // `collapsed` / `expanded` per-block overrides for the default state.
      // `null` means "use the global setting".
      const forceCollapsed: boolean | null =
        blockAttrs.has("collapsed") ? true
        : blockAttrs.has("expanded") ? false
        : null;

      const lang = this.highlighter.resolveLanguage(rawLang);
      const code = codeEl.textContent || "";
      const htmlTemplate = this.htmlTemplateState(rawLang, blockAttrs, code);
      // A template block is implicitly preview-eligible (it renders), exactly as
      // a `pdf` block is — promote a null preview state to "render".
      let htmlPreview = this.htmlPreviewState(rawLang, blockAttrs);
      if (htmlTemplate && htmlPreview === null) htmlPreview = true;
      const htmlPdf = this.htmlPdfState(rawLang, blockAttrs);

      this.renderCodeBlock(pre, code, lang, rawLang, undefined, ctx.sourcePath, forceSkip, forceCollapsed, htmlPreview, htmlPdf, htmlTemplate);
    }
  }

  /**
   * Seed typed variable entries into both stores: noteVarStore (display strings
   * for inline `$varname` spans) and noteVarsBlockStore (typed values for
   * injection into code execution). Shared by vars blocks, the Apply button,
   * and data tables.
   */
  private seedVarEntries(sourcePath: string, entries: VarEntry[]): void {
    if (!entries.length || !sourcePath) return;
    if (!this.noteVarStore.has(sourcePath)) this.noteVarStore.set(sourcePath, {});
    if (!this.noteVarsBlockStore.has(sourcePath)) this.noteVarsBlockStore.set(sourcePath, {});
    const displayStore = this.noteVarStore.get(sourcePath)!;
    const varsStore = this.noteVarsBlockStore.get(sourcePath)!;
    for (const e of entries) {
      displayStore[e.name] = toDisplay(e.value);
      varsStore[e.name] = e.value;
    }
    this.updateInlineVarRefs(sourcePath, displayStore);
  }

  /**
   * Render a ```vars block using the same ocode-wrapper / Shiki structure as a
   * regular code block. Variables are seeded into noteVarStore (for inline
   * $varname spans) and noteVarsBlockStore (for injection into code execution).
   * Syntax: one `key = value` (or `key: value`) assignment per line; blank
   * lines and lines starting with `#` are ignored. Values may carry a `:type`
   * hint and use triple-quoted (`"""` / `'''`) multiline strings.
   */
  private renderVarsBlock(originalPre: HTMLElement, source: string, sourcePath: string): void {
    originalPre.replaceWith(this.buildVarsWrapper(source, sourcePath));
  }

  /**
   * Build the `ocode-wrapper` for a ```vars block (INI-highlighted body, vars
   * header with Copy + Apply) and seed the note's var stores. Shared by the
   * reading-view post-processor ({@link renderVarsBlock}) and the Live Preview
   * block widget.
   */
  private buildVarsWrapper(source: string, sourcePath: string): HTMLElement {
    const entries = parseVarsSource(source);

    // Seed both stores with the typed values
    this.seedVarEntries(sourcePath, entries);

    // Format as INI-style assignments for Shiki highlighting (values as written)
    const displayCode = entries.length
      ? entries.map((e) => `${e.name} = ${e.raw}`).join("\n")
      : "# (no variables defined)";

    const wrapper = createDiv({ cls: "ocode-wrapper ocode-vars-wrapper" });

    const html = this.highlighter.highlight(displayCode, "ini", this.settings.theme);
    if (html) {
      const parsedHtml = new DOMParser().parseFromString(html, "text/html");
      for (const node of Array.from(parsedHtml.body.childNodes)) {
        wrapper.appendChild(activeDocument.adoptNode(node));
      }
    }

    // Header bar — "vars" label, copy button, apply button
    const header = createDiv({ cls: "ocode-header" });
    const label = createSpan({ cls: "ocode-label", text: "vars" });
    header.appendChild(label);

    const spacer = createSpan({ cls: "ocode-spacer" });
    header.appendChild(spacer);

    const btnGroup = createDiv({ cls: "ocode-btn-group" });

    // Copy — copies the raw source text as the user wrote it
    const copyBtn = this.createPillButton("Copy", ICON.copy, () => {
      void navigator.clipboard.writeText(source).then(() => {
        setSvgContent(copyBtn.querySelector(".ocode-pill-icon")!, ICON.check);
        copyBtn.querySelector(".ocode-pill-text")!.textContent = "Copied";
        window.setTimeout(() => {
          setSvgContent(copyBtn.querySelector(".ocode-pill-icon")!, ICON.copy);
          copyBtn.querySelector(".ocode-pill-text")!.textContent = "Copy";
        }, 2000) as unknown as number;
      });
    });
    btnGroup.appendChild(copyBtn);

    // Apply — re-asserts these declared values across all languages, discarding
    // any runtime mutations to them (the explicit "reset to declared" action).
    const applyBtn = this.createPillButton("Apply", ICON.reload, () => {
      this.seedVarEntries(sourcePath, entries);
      const live = this.noteLiveVars.get(sourcePath);
      if (live) for (const e of entries) live.delete(e.name);
      this.refreshDisplayVars(sourcePath);
      setSvgContent(applyBtn.querySelector(".ocode-pill-icon")!, ICON.check);
      applyBtn.querySelector(".ocode-pill-text")!.textContent = "Applied";
      window.setTimeout(() => {
        setSvgContent(applyBtn.querySelector(".ocode-pill-icon")!, ICON.reload);
        applyBtn.querySelector(".ocode-pill-text")!.textContent = "Apply";
      }, 1500) as unknown as number;
    });
    btnGroup.appendChild(applyBtn);

    header.appendChild(btnGroup);
    wrapper.insertBefore(header, wrapper.firstChild);

    return wrapper;
  }

  // ─── Baked outputs ───────────────────────────────────────────
  // Rendering of `codesuite-output` blocks (the serialized output the "Bake
  // outputs" command writes into the note). The bake/clear orchestration and
  // figure-file I/O live further down. See baked-output.ts for the format.

  /** Reading-view: replace a `codesuite-output` <pre> with a rendered output panel. */
  private renderBakedOutputBlock(
    originalPre: HTMLElement,
    body: string,
    ctx: MarkdownPostProcessorContext,
    el: HTMLElement,
  ): void {
    const output = parseBakedOutput(body);
    if (!output) return; // malformed — leave the raw code block visible
    let stale = false;
    try {
      const info = ctx.getSectionInfo(el);
      if (info) {
        const prevHash = precedingCodeHash(info.text, info.lineStart);
        stale = prevHash !== null && prevHash !== output.hash;
      }
    } catch { /* staleness is best-effort */ }
    originalPre.replaceWith(this.buildBakedOutputWrapper(output, ctx.sourcePath, stale));
  }

  /** Build the `ocode-wrapper` holding a baked output panel (shared by reading view + LP). */
  private buildBakedOutputWrapper(output: BakedOutput, notePath: string, stale: boolean): HTMLElement {
    const wrapper = createDiv({ cls: "ocode-wrapper ocode-baked-wrapper" });
    wrapper.appendChild(this.buildBakedOutputPanel(output, notePath, stale));
    return wrapper;
  }

  /** Render a baked output as an `.ocode-output` panel (mirrors a live run's panel). */
  private buildBakedOutputPanel(output: BakedOutput, notePath: string, stale: boolean): HTMLElement {
    const panel = createDiv({ cls: "ocode-output ocode-output-baked" });

    const header = createDiv({ cls: "ocode-output-header" });
    const label = createSpan({ cls: "ocode-output-label", text: output.label });
    if (output.exit !== 0 && output.exit !== null) label.addClass("ocode-output-failed");
    header.appendChild(label);

    const badge = createSpan({ cls: "ocode-baked-badge", text: "baked" });
    badge.setAttr("aria-label", "Saved output baked into the note for sharing.");
    header.appendChild(badge);

    if (stale) {
      const staleBadge = createSpan({ cls: "ocode-baked-stale", text: "stale" });
      staleBadge.setAttr("aria-label", "The code above changed since this output was baked. Re-run it and bake again to update.");
      header.appendChild(staleBadge);
    }
    panel.appendChild(header);

    const content = createDiv({ cls: "ocode-output-content" });
    if (output.stdout) content.appendChild(createSpan({ cls: "ocode-stdout", text: output.stdout }));
    if (output.stderr) {
      const errText = output.stderr.endsWith("\n") ? output.stderr : output.stderr + "\n";
      content.appendChild(createSpan({ cls: "ocode-stderr", text: errText }));
    }
    for (const fig of output.figures) {
      const item = this.buildBakedFigureEl(fig, notePath);
      if (item) content.appendChild(item);
    }

    if (content.childNodes.length) panel.appendChild(content);
    else panel.addClass("ocode-output-headeronly");
    return panel;
  }

  /** Build the DOM for one baked figure (external image file, inline image, or widget). */
  private buildBakedFigureEl(fig: BakedFigure, notePath: string): HTMLElement | null {
    if (fig.kind === "widget") {
      return buildFigureEl({ kind: "widget", html: fig.html, figureIndex: 0 }, this.app);
    }
    // Inline base64 image — reuse the live-output figure element (toolbar + fullscreen).
    if (fig.data) {
      return buildFigureEl({ kind: "image", data: fig.data, figureIndex: 0 }, this.app);
    }
    // External image file — resolve it in the vault and point an <img> at it.
    if (fig.file) {
      const tfile = this.resolveBakedImage(fig.file, notePath);
      if (!tfile) return null; // file missing — skip silently
      const item = createDiv({ cls: "ocode-output-item" });
      item.createEl("img", {
        cls: "ocode-output-img",
        attr: { src: this.app.vault.getResourcePath(tfile), alt: fig.file },
      });
      return item;
    }
    return null;
  }

  /** The configured baked-outputs folder, normalized (with a sane fallback). */
  private bakedFolder(): string {
    return normalizePath(this.settings.bakedOutputsFolder || DEFAULT_SETTINGS.bakedOutputsFolder);
  }

  /** Resolve a baked image filename to its TFile (folder path first, then link resolution). */
  private resolveBakedImage(filename: string, notePath: string): TFile | null {
    const direct = this.app.vault.getAbstractFileByPath(normalizePath(`${this.bakedFolder()}/${filename}`));
    if (direct instanceof TFile) return direct;
    const resolved = this.app.metadataCache.getFirstLinkpathDest(filename, notePath);
    return resolved instanceof TFile ? resolved : null;
  }

  /**
   * Serialize every captured output for the active note into `codesuite-output`
   * blocks (the "Bake outputs" command). Figures are written as external image
   * files by default — keeping the markdown small — and stale image files from a
   * previous bake are swept. See baked-output.ts for the on-disk format.
   */
  private async bakeOutputsIntoNote(file: TFile): Promise<void> {
    const captured = this.noteOutputData.get(file.path);
    if (!captured || captured.size === 0) {
      new Notice("No code outputs to bake yet — run the note's code blocks first.");
      return;
    }

    // Materialize each captured output into a serializable BakedOutput, writing
    // image figures to files (unless the inline-images escape hatch is on).
    const byHash = new Map<string, BakedOutput>();
    try {
      for (const cap of captured.values()) {
        const figures: BakedFigure[] = [];
        let imageIndex = 0;
        for (const fig of cap.figures) {
          if (fig.kind === "widget") {
            figures.push({ kind: "widget", html: fig.html });
            continue;
          }
          if (!fig.data) continue;
          imageIndex++;
          if (this.settings.bakedOutputsInlineImages) {
            figures.push({ kind: "image", data: fig.data });
          } else {
            const name = bakedImageName(file.basename, file.path, cap.hash, imageIndex);
            await this.writeBakedImage(name, fig.data);
            figures.push({ kind: "image", file: name });
          }
        }
        byHash.set(cap.hash, makeBakedOutput({
          hash: cap.hash, exit: cap.exit, label: cap.label,
          stdout: cap.stdout, stderr: cap.stderr, figures,
        }));
      }
    } catch (e) {
      new Notice(`Failed to write baked figures: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    const original = await this.app.vault.read(file);
    const updated = applyBakedOutputs(original, byHash);
    if (updated !== original) await this.app.vault.modify(file, updated);

    // Sweep image files for this note that the (re)baked content no longer uses.
    await this.sweepOrphanBakedImages(file, collectBakedImageFiles(updated));

    // The output now lives in the baked block — drop the live rendered output so
    // it isn't shown twice (live panel + baked panel).
    this.clearLiveOutputs(file.path);

    new Notice(`Baked ${byHash.size} output${byHash.size === 1 ? "" : "s"} into the note.`);
  }

  /**
   * Remove a note's live (non-baked) output so baking doesn't leave a duplicate
   * of the output it just wrote into the markdown: drop the reading-view snapshot
   * cache (so re-renders don't restore it) and the cached LP wrappers (so they
   * rebuild without their appended panel), strip any live panels already on
   * screen, and force an LP rebuild. The structured snapshot (noteOutputData) and
   * the execution session are kept, so re-baking and re-running still work.
   */
  private clearLiveOutputs(notePath: string): void {
    this.noteOutputs.delete(notePath);
    this.dropLpWrapperCache(notePath);
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView) || view.file?.path !== notePath) continue;
      // Reading view virtualizes: only sections near the viewport are in the DOM,
      // so removing on-screen panels would leave scrolled-out ones behind. Force a
      // full preview re-render instead — every section rebuilds from the cleared
      // cache (no live panel restored) and the baked blocks render in their place.
      view.previewMode?.rerender(true);
    }
    this.forceLpRebuild();
  }

  /** Remove all baked-output blocks from the active note and delete their image files. */
  private async clearBakedOutputsFromNote(file: TFile): Promise<void> {
    const original = await this.app.vault.read(file);
    const { content, removedFiles } = clearBakedOutputs(original);
    if (content === original) {
      new Notice("No baked outputs to clear.");
      return;
    }
    await this.app.vault.modify(file, content);

    let deleted = 0;
    for (const name of new Set(removedFiles)) {
      const tfile = this.resolveBakedImage(name, file.path);
      if (tfile) {
        try { await this.app.fileManager.trashFile(tfile); deleted++; } catch { /* best-effort */ }
      }
    }
    new Notice(`Cleared baked outputs${deleted ? ` (+${deleted} image${deleted === 1 ? "" : "s"})` : ""}.`);
  }

  /** Write a base64 PNG into the baked-outputs folder, creating the folder if needed. */
  private async writeBakedImage(name: string, base64: string): Promise<void> {
    const folder = this.bakedFolder();
    await this.ensureFolder(folder);
    const path = normalizePath(`${folder}/${name}`);
    const bytes = base64ToArrayBuffer(base64);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) await this.app.vault.modifyBinary(existing, bytes);
    else await this.app.vault.createBinary(path, bytes);
  }

  /** Create a (possibly nested) vault folder if it doesn't already exist. */
  private async ensureFolder(path: string): Promise<void> {
    let cur = "";
    for (const part of path.split("/")) {
      cur = cur ? `${cur}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(cur)) {
        try { await this.app.vault.createFolder(cur); } catch { /* exists / created concurrently */ }
      }
    }
  }

  /** Delete this note's baked image files that are no longer referenced. */
  private async sweepOrphanBakedImages(file: TFile, referenced: Set<string>): Promise<void> {
    const folder = this.app.vault.getAbstractFileByPath(this.bakedFolder());
    if (!(folder instanceof TFolder)) return;
    const prefix = bakedImagePrefix(file.basename, file.path);
    for (const child of folder.children) {
      if (child instanceof TFile && child.name.startsWith(prefix) && !referenced.has(child.name)) {
        try { await this.app.fileManager.trashFile(child); } catch { /* best-effort */ }
      }
    }
  }

  /**
   * Scan inline `<code>` elements for `$varname` patterns, mark them with a
   * `data-ocode-var` attribute, and apply any already-stored value immediately.
   * Future updates use a live querySelectorAll so stale element references are
   * never a problem.
   */
  private processInlineVarRefs(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
    const notePath = ctx.sourcePath;
    // Frontmatter vars may have been declared without any vars block — seed
    // them here as well so inline `$varname` spans resolve immediately.
    this.applyFrontmatterVars(ctx);
    // Only inline code (not inside <pre>)
    const inlineCodes = el.querySelectorAll("code");
    for (const codeEl of Array.from(inlineCodes)) {
      if (codeEl.closest("pre")) continue;
      const text = (codeEl.textContent || "").trim();
      const match = text.match(/^\$([a-zA-Z_][a-zA-Z0-9_]*)$/);
      if (!match) continue;
      const varName = match[1];

      codeEl.addClass("ocode-var-ref");
      codeEl.setAttribute("data-ocode-var", varName);

      // Apply any already-stored value (e.g. note re-opened after execution)
      const varStore = this.noteVarStore.get(notePath);
      if (varStore && varName in varStore) {
        codeEl.textContent = String(varStore[varName]);
        codeEl.setAttribute("data-resolved", "");
      }
    }
  }

  /**
   * Experimental: expose markdown tables to code as variables. A table is a
   * data source when a `%% codesuite: <name> [as <shape>] %%` directive sits on
   * the line directly above it, or — by convention — when its header row is
   * `var | value`. Cells are typed via the same inference as vars blocks.
   * The table still renders normally; a small badge marks it as a source.
   */
  private processDataTables(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
    const sourcePath = ctx.sourcePath;
    if (!sourcePath) return;
    const tables = el.querySelectorAll("table");
    for (const table of Array.from(tables)) {
      if (table.hasClass("ocode-data-table")) continue; // already processed

      // Extract headers. Obsidian normally emits <thead><th>, but some themes
      // or renderers skip <thead> and put all rows in <tbody>. Use the first
      // row of the first <tr> as fallback so we never miss a table.
      let headers = Array.from(table.querySelectorAll("thead th")).map(
        (th) => (th.textContent || "").trim()
      );
      const hasExplicitThead = headers.length > 0;
      if (!hasExplicitThead) {
        const firstRow = table.querySelector("tr");
        if (firstRow) {
          headers = Array.from(firstRow.querySelectorAll("th, td")).map(
            (cell) => (cell.textContent || "").trim()
          );
        }
      }
      const allBodyRows = Array.from(table.querySelectorAll("tbody tr"));
      // If there was no <thead>, the first tbody row was used as the header above.
      const dataBodyRows = hasExplicitThead ? allBodyRows : allBodyRows.slice(1);
      const rows = dataBodyRows.map((tr) =>
        Array.from(tr.querySelectorAll("td")).map((td) => (td.textContent || "").trim())
      );
      if (!headers.length || !rows.length) continue;

      // Look for a `%% codesuite … %%` directive on the nearest non-blank line
      // above the table's data. Depending on blank-line placement, Obsidian may
      // bundle the comment into the table's section or keep it separate, so we
      // scan upward from the section start and skip the table's own rows.
      let directive = null as ReturnType<typeof parseTableDirective>;
      const info = ctx.getSectionInfo(table) ?? ctx.getSectionInfo(el);
      if (info) {
        const lines = info.text.split("\n");
        for (let i = info.lineStart; i >= 0; i--) {
          const above = (lines[i] ?? "").trim();
          if (!above || above.startsWith("|")) continue; // blank or table row
          directive = parseTableDirective(above);
          break; // first non-blank, non-row line decides
        }
      }

      // Header-convention fallback: `var | value` → vars shape.
      if (!directive && headerLooksLikeVars(headers)) {
        directive = { shape: "vars" };
      }
      if (!directive) continue;

      const entries = buildTableVars(headers, rows, directive);
      if (!entries.length) continue;
      this.seedVarEntries(sourcePath, entries);

      // Add a small badge above the table describing what it exposes.
      // The table itself is left unstyled so it looks identical to a regular table.
      const badgeText =
        directive.shape === "vars"
          ? `vars · ${entries.length} ${entries.length === 1 ? "var" : "vars"}`
          : `${directive.name} · ${directive.shape}`;
      const badge = createDiv({ cls: "ocode-table-badge", text: badgeText });
      table.parentElement?.insertBefore(badge, table);
    }
  }

  /**
   * Read `code_vars:` from the note's YAML frontmatter and merge those values
   * into noteVarStore and noteVarsBlockStore for the current note. Called from
   * both code-block and inline post-processors. Frontmatter vars are seeded
   * unconditionally — block-level `vars` declarations run later in the same
   * post-processor pass and overwrite anything from frontmatter (so block
   * vars take precedence, matching what the issue spec asks for).
   */
  private applyFrontmatterVars(ctx: MarkdownPostProcessorContext): void {
    const fm = ctx.frontmatter as Record<string, unknown> | undefined;
    if (!fm) return;
    const entries = this.collectFrontmatterVars(fm["code_vars"]);
    if (!entries.length) return;
    const notePath = ctx.sourcePath;
    if (!notePath) return;

    if (!this.noteVarStore.has(notePath)) this.noteVarStore.set(notePath, {});
    if (!this.noteVarsBlockStore.has(notePath)) this.noteVarsBlockStore.set(notePath, {});
    const varStore = this.noteVarStore.get(notePath)!;
    const seedStore = this.noteVarsBlockStore.get(notePath)!;

    let changed = false;
    for (const [k, typed] of entries) {
      // Only seed if not already present (block-level vars take precedence).
      if (!(k in seedStore)) { seedStore[k] = typed; changed = true; }
      if (!(k in varStore))  { varStore[k]  = toDisplay(typed); changed = true; }
    }
    if (changed) this.updateInlineVarRefs(notePath, varStore);
  }

  /**
   * Normalise a `code_vars:` frontmatter value into typed name/value pairs,
   * accepting both shapes a user can write:
   *
   *   code_vars:               code_vars:
   *     threshold: 0.85          - threshold = 0.85
   *     base_url: "https://…"    - base_url = https://…
   *
   * The mapping form is concise, but a nested object can't be displayed in
   * Obsidian's reading-view Properties panel — it shows an orange
   * "unsupported property type" warning and collapses (#34). The list form is
   * a plain list of strings, which Obsidian renders as a normal List property,
   * so notes that need their `code_vars` to show up in preview can use it.
   * Each list item is parsed with the same `key = value` / `key: value`
   * grammar as a `vars` block (type hints included); a list item that is
   * itself a single-key mapping is accepted too.
   */
  private collectFrontmatterVars(raw: unknown): Array<[string, VarValue]> {
    const out: Array<[string, VarValue]> = [];
    if (!raw || typeof raw !== "object") return out;

    if (Array.isArray(raw)) {
      const lines: string[] = [];
      for (const item of raw) {
        if (typeof item === "string") {
          lines.push(item);
        } else if (item && typeof item === "object" && !Array.isArray(item)) {
          for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
            if (isValidIdent(k)) out.push([k, fromJsValue(v)]);
          }
        }
      }
      if (lines.length) {
        for (const e of parseVarsSource(lines.join("\n"))) out.push([e.name, e.value]);
      }
      return out;
    }

    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (isValidIdent(k)) out.push([k, fromJsValue(v)]);
    }
    return out;
  }

  /**
   * Fix the reading-view display of CodeSuite's nested frontmatter fields
   * (`code_vars:`, `template_context:`). A nested mapping can't be shown by
   * Obsidian's Properties widget — it renders an orange "unsupported property
   * type" warning and collapses (#34). This does two things: it hides that
   * broken property row, and it renders the same data as a clean read-only
   * panel just below the Properties widget. The list form of `code_vars`
   * renders natively, so only mapping-shaped values are handled here.
   */
  private renderFrontmatterVarsPanel(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
    // ctx.frontmatter is absent in the MarkdownRenderer export pass — fall back
    // to the metadata cache so the panel appears in exports too.
    let fm = ctx.frontmatter as Record<string, unknown> | undefined;
    if (!fm && ctx.sourcePath) {
      const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
      if (file instanceof TFile) fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    }
    if (!fm) return;

    const isDict = (v: unknown): v is Record<string, unknown> =>
      !!v && typeof v === "object" && !Array.isArray(v);
    const groups: { title: string; data: Record<string, unknown> }[] = [];
    if (isDict(fm["code_vars"])) groups.push({ title: "code_vars", data: fm["code_vars"] });
    if (isDict(fm["template_context"])) groups.push({ title: "template_context", data: fm["template_context"] });
    if (!groups.length) return;

    // In a live reading view the section element isn't attached to the preview
    // container yet when the post-processor runs, so el.closest(...) is null on
    // the first try; retry next frame once Obsidian has inserted it. The
    // detached export render attaches synchronously, so it succeeds immediately
    // (and never schedules a frame that would fire after serialization).
    const place = () => this.placeFrontmatterVarsPanel(el, groups);
    if (!place()) window.requestAnimationFrame(place);
  }

  /**
   * Suppress the broken Properties rows for our nested keys and insert the
   * read-only panel. Returns false if the reading-view container isn't reachable
   * yet (so the caller can retry on the next frame). Idempotent: the warning is
   * hidden via a class and only one panel is inserted per preview.
   */
  private placeFrontmatterVarsPanel(
    el: HTMLElement,
    groups: { title: string; data: Record<string, unknown> }[]
  ): boolean {
    const view = el.closest<HTMLElement>(".markdown-reading-view, .markdown-preview-view");
    if (!view) return false;

    // Hide Obsidian's orange "unsupported property type" warning for our nested
    // keys — that warning is the bug (#34); the panel below renders the values.
    for (const group of groups) {
      const props = view.querySelectorAll(
        `.metadata-property[data-property-key="${group.title}"]`
      );
      for (const prop of Array.from(props)) prop.addClass("ocode-fm-prop-hidden");
    }

    if (view.querySelector(".ocode-frontmatter-vars")) return true; // one per preview

    const panel = createDiv({ cls: "ocode-frontmatter-vars" });
    const header = createDiv({ cls: "ocode-fm-vars-header" });
    header.appendChild(createSpan({ cls: "ocode-fm-vars-title", text: "CodeSuite variables" }));
    panel.appendChild(header);

    for (const group of groups) {
      const groupEl = createDiv({ cls: "ocode-fm-vars-group" });
      groupEl.appendChild(createDiv({ cls: "ocode-fm-vars-group-title", text: group.title }));
      for (const [k, v] of Object.entries(group.data)) {
        const row = createDiv({ cls: "ocode-fm-var-row" });
        row.appendChild(createSpan({ cls: "ocode-fm-var-key", text: k }));
        row.appendChild(createSpan({ cls: "ocode-fm-var-val", text: this.formatFrontmatterValue(v) }));
        groupEl.appendChild(row);
      }
      panel.appendChild(groupEl);
    }

    // Sit the panel just below the Properties widget when present, else at the
    // very top of the rendered note (e.g. the export render has no widget).
    const meta = view.querySelector(".metadata-container");
    const sizer = view.querySelector<HTMLElement>(".markdown-preview-sizer") ?? view;
    if (meta?.parentElement) meta.insertAdjacentElement("afterend", panel);
    else sizer.prepend(panel);
    return true;
  }

  /** Human-readable rendering of a frontmatter value for the vars panel:
   *  scalars verbatim, arrays/objects as compact JSON. */
  private formatFrontmatterValue(v: unknown): string {
    if (v === null || v === undefined) return "";
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
    // Objects/arrays (and anything else non-scalar) → compact JSON; values JSON
    // can't represent (e.g. a symbol) stringify to undefined, shown as blank.
    try { return JSON.stringify(v) ?? ""; } catch { return ""; }
  }

  /**
   * Decide whether an `html` fence should render as a live preview.
   * Returns `null` for a plain code block with no preview toggle (non-html, or
   * html with the feature off and no explicit flag — preserves the default of
   * just showing the source). Returns a boolean when the block is preview-
   * eligible (so it gets a Preview/Code toggle): `true` = start in preview,
   * `false` = start in source. Per-block `preview`/`render` and `source`/`raw`/
   * `code` fence flags override the `renderHtmlBlocks` setting.
   */
  private htmlPreviewState(rawLang: string, attrs: Set<string>): boolean | null {
    if (rawLang.toLowerCase() !== "html") return null;
    if (attrs.has("preview") || attrs.has("render")) return true;
    if (attrs.has("source") || attrs.has("raw") || attrs.has("code")) return false;
    // An explicit pdf/export flag treats the block as a rendered document.
    if (attrs.has("pdf") || attrs.has("export")) return true;
    if (this.settings.renderHtmlBlocks) return true;
    // The global PDF-export setting gives every html block the preview chrome
    // (so the export pill has a rendered document to capture) but keeps it
    // source-first, preserving the renderHtmlBlocks-off default view.
    if (this.settings.htmlBlockPdfExport) return false;
    return null;
  }

  /**
   * Decide whether a preview-eligible `html` block shows the PDF/print export
   * pill. Per-block `pdf`/`export` and `nopdf` fence flags override the
   * `htmlBlockPdfExport` setting, mirroring {@link htmlPreviewState}.
   */
  private htmlPdfState(rawLang: string, attrs: Set<string>): boolean {
    if (rawLang.toLowerCase() !== "html") return false;
    if (attrs.has("pdf") || attrs.has("export")) return true;
    if (attrs.has("nopdf")) return false;
    return this.settings.htmlBlockPdfExport;
  }

  /**
   * Decide whether an `html` block should be rendered through the templating
   * engine (frontmatter/vars interpolation, `{{> partials }}`, `{{#each}}`).
   * The explicit `template` fence flag always opts in (and `notemplate` always
   * opts out); otherwise, when the global `htmlTemplating` setting is on, a block
   * that *contains* `{{ … }}` is treated as a template. Off by default keeps
   * framework demos (Vue/Angular/Handlebars literal `{{`) untouched.
   */
  private htmlTemplateState(rawLang: string, attrs: Set<string>, code: string): boolean {
    if (rawLang.toLowerCase() !== "html") return false;
    if (attrs.has("notemplate")) return false;
    if (attrs.has("template")) return true;
    return this.settings.htmlTemplating && hasTemplateSyntax(code);
  }

  /** Cheap fingerprint of a note's frontmatter, folded into a template block's
   *  Live Preview cache key so editing the data rebuilds the widget. */
  private frontmatterSig(notePath: string): string {
    const file = this.app.vault.getAbstractFileByPath(notePath);
    const fm = file instanceof TFile ? this.app.metadataCache.getFileCache(file)?.frontmatter : undefined;
    return codeHash(JSON.stringify(fm ?? {}));
  }

  /** Split an embed alias (`![[file.html|preview]]`) into lowercased flag tokens. */
  private parseAliasFlags(alias?: string | null): Set<string> {
    return new Set(
      (alias ?? "").split(/[\s|]+/).map((w) => w.toLowerCase()).filter(Boolean)
    );
  }

  /** Preview state for an embedded code file, honouring a `preview`/`source` alias flag. */
  private embedHtmlPreview(ext: string, alias?: string | null): boolean | null {
    return this.htmlPreviewState(this.highlighter.resolveExtension(ext), this.parseAliasFlags(alias));
  }

  /** PDF/print-export state for an embedded html file, honouring a `pdf`/`nopdf`
   *  alias flag. Mirrors {@link embedHtmlPreview} but for {@link htmlPdfState}. */
  private embedHtmlPdf(ext: string, alias?: string | null): boolean {
    return this.htmlPdfState(this.highlighter.resolveExtension(ext), this.parseAliasFlags(alias));
  }

  /**
   * Templating state for an embedded html file: a `template` alias flag opts in
   * (`notemplate` opts out); otherwise the global `htmlTemplating` setting plus
   * `{{ … }}` in the file does. Mirrors {@link htmlTemplateState} for fenced
   * blocks, so `![[invoice.html|template]]` templates the file against the
   * *embedding* note's frontmatter exactly as a `template` fence flag would.
   */
  private embedHtmlTemplate(ext: string, alias: string | null | undefined, code: string): boolean {
    return this.htmlTemplateState(this.highlighter.resolveExtension(ext), this.parseAliasFlags(alias), code);
  }

  /**
   * Coarse, content-free guess of whether an embedded html file *might* render
   * as a template — an explicit `template` flag, or the global `htmlTemplating`
   * setting with no `notemplate`. Used only to decide whether to fold the note's
   * frontmatter fingerprint into the Live Preview cache key (so editing the data
   * rebuilds the embed); the precise decision, which also needs the file's `{{`,
   * is made in {@link populateEmbedContainer} once the file is read.
   */
  private embedMaybeTemplate(ext: string, alias?: string | null): boolean {
    if (this.highlighter.resolveExtension(ext) !== "html") return false;
    const attrs = this.parseAliasFlags(alias);
    if (attrs.has("notemplate")) return false;
    if (attrs.has("template")) return true;
    return this.settings.htmlTemplating;
  }

  private renderCodeBlock(
    originalPre: HTMLElement,
    code: string,
    lang: string,
    displayLang: string,
    fileName?: string,
    sourcePath?: string,
    forceSkip = false,
    forceCollapsed: boolean | null = null,
    htmlPreview: boolean | null = null,
    htmlPdf = false,
    htmlTemplate = false,
  ) {
    const wrapper = this.buildCodeBlockWrapper(
      code, lang, displayLang, fileName, sourcePath, forceSkip, forceCollapsed, htmlPreview, htmlPdf, htmlTemplate,
    );
    if (wrapper) originalPre.replaceWith(wrapper);
  }

  /**
   * Build the `ocode-wrapper` chrome (header, Shiki body, line numbers, collapse)
   * for a code block and return it. Shared by the reading-view post-processor
   * ({@link renderCodeBlock}) and the Live Preview block widget so both views
   * render identical chrome. Returns `null` only when highlighting fails.
   */
  private buildCodeBlockWrapper(
    code: string,
    lang: string,
    displayLang: string,
    fileName?: string,
    sourcePath?: string,
    forceSkip = false,
    forceCollapsed: boolean | null = null,
    htmlPreview: boolean | null = null,
    htmlPdf = false,
    htmlTemplate = false,
  ): HTMLElement | null {
    // Strip a single trailing newline so Shiki doesn't emit a dangling empty
    // `.line` span — that's what made every block render one line too tall (#24).
    const displayCode = code.replace(/\n$/, "");
    const html = this.highlighter.highlight(displayCode, lang, this.settings.theme);
    if (!html) return null;

    const wrapper = createDiv();
    wrapper.className = "ocode-wrapper";
    const parsedHtml = new DOMParser().parseFromString(html, "text/html");
    for (const node of Array.from(parsedHtml.body.childNodes)) {
      wrapper.appendChild(activeDocument.adoptNode(node));
    }

    // ─── Header bar (label left, buttons right) ───
    const header = createDiv();
    header.className = "ocode-header";

    if (fileName || (this.settings.showLanguageLabel && displayLang)) {
      const label = createSpan();
      label.className = "ocode-label";
      label.textContent = fileName || displayLang;
      header.appendChild(label);
    }

    const lineCount = code.replace(/\n$/, "").split("\n").length;
    const lineHint = createSpan({ cls: "ocode-collapse-hint", text: `${lineCount} ${lineCount === 1 ? "line" : "lines"}` });
    header.appendChild(lineHint);

    const spacer = createSpan();
    spacer.className = "ocode-spacer";
    header.appendChild(spacer);

    const btnGroup = createDiv();
    btnGroup.className = "ocode-btn-group";

    const copyBtn = this.createPillButton("Copy", ICON.copy, () => {
      void navigator.clipboard.writeText(code).then(() => {
        setSvgContent(copyBtn.querySelector(".ocode-pill-icon")!, ICON.check);
        copyBtn.querySelector(".ocode-pill-text")!.textContent = "Copied";
        window.setTimeout(() => {
          setSvgContent(copyBtn.querySelector(".ocode-pill-icon")!, ICON.copy);
          copyBtn.querySelector(".ocode-pill-text")!.textContent = "Copy";
        }, 2000) as unknown as number;
      });
    });
    btnGroup.appendChild(copyBtn);

    if (this.settings.enableExecution && isExecutable(lang) && Platform.isDesktop) {
      const runBtn = this.createPillButton("Run", ICON.play, () => {
        void this.runCode(code, lang, wrapper, runBtn, sourcePath);
      }, "ocode-run-pill");
      btnGroup.appendChild(runBtn);
    }

    // Mark blocks excluded from Run All so the header can show an indicator
    // and runAllBlocks can skip them. Individual Run still works.
    if (forceSkip || blockHasSkipMarker(code)) {
      wrapper.classList.add("ocode-skip-run-all");
      const skipBadge = createSpan({ cls: "ocode-skip-badge", text: "skip" });
      skipBadge.setAttribute("aria-label", "Excluded from run all");
      skipBadge.setAttribute("title", "Excluded from run all");
      btnGroup.insertBefore(skipBadge, btnGroup.firstChild);
    }

    header.appendChild(btnGroup);
    wrapper.prepend(header);

    // ─── Line numbers ───
    if (this.settings.showLineNumbers) {
      const shikiPre = wrapper.querySelector("pre");
      if (shikiPre) {
        const lines = shikiPre.querySelectorAll(".line");
        let lineNum = 1;
        for (const line of Array.from(lines)) {
          const numSpan = createSpan();
          numSpan.className = "ocode-line-num";
          numSpan.textContent = String(lineNum);
          line.prepend(numSpan);
          lineNum++;
        }
        // Marker class so the soft-wrap hang-indent can target gutter lines
        // without a `:has()` selector (broad invalidation / perf).
        if (lines.length) wrapper.addClass("ocode-has-lnum");
      }
    }

    // ─── Collapsible (reading view + Live Preview) ───
    // Every fenced code block is collapsible via its header — Python, html,
    // anything — so the inconsistency where only html-preview blocks folded is
    // gone (#32). `fileName` is only set for embedded files; they already get
    // the embed collapse handler in renderEmbeddedFile, so we skip them here to
    // avoid double-wiring. Per-block `collapsed`/`expanded` attributes override
    // the "collapse by default" setting.
    if (!fileName) {
      const initiallyCollapsed = forceCollapsed ?? this.settings.inlineCollapsedByDefault;
      this.makeCollapsible(wrapper, initiallyCollapsed);
    }

    // Mark inline executable blocks so badge-sync logic can align them with the
    // source-parsed skip-state array. Embedded files, vars blocks, and other
    // non-runnable code blocks are excluded because parseSkipStatesFromSource()
    // does not count them. The code hash lets Run All match a source-parsed
    // block to its rendered wrapper even when duplicates exist (#25).
    if (!fileName && isExecutable(lang)) {
      wrapper.setAttribute("data-ocode-fenced", "1");
      wrapper.setAttribute("data-ocode-hash", codeHash(code.trim()));
    }

    // Re-attach a previously-run output (this session) so it survives reading-
    // view section eviction and is present for HTML/PDF export.
    if (!fileName && isExecutable(lang) && sourcePath) {
      this.restoreBlockOutput(sourcePath, code, wrapper);
    }

    // ─── HTML live preview ───
    // Render the block's HTML alongside its source and add a Preview/Code
    // toggle. `htmlPreview` is non-null only for preview-eligible html blocks.
    if (htmlPreview !== null) {
      this.addHtmlPreview(wrapper, code, htmlPreview, htmlPdf, sourcePath, htmlTemplate);
    }
    return wrapper;
  }

  /**
   * Add a live HTML preview pane and a Preview/Code toggle pill to an html code
   * block wrapper. The source `pre` and the preview pane coexist; the toggle
   * (and the `ocode-show-preview` class) swaps which one is visible.
   *
   * The HTML renders inside a sandboxed `<iframe srcdoc>` (`sandbox="allow-
   * scripts"`, no `allow-same-origin`): full documents work — `<head>`/`<style>`
   * apply and `<script>` runs — but the frame has an opaque origin, so its code
   * cannot reach the vault, the parent DOM, Obsidian's API, or `require`. Styles
   * are scoped to the frame, and ids resolve within it. The frame is built
   * lazily on first preview so its scripts don't run until shown and its height
   * can be measured against real layout.
   */
  private addHtmlPreview(
    wrapper: HTMLElement,
    code: string,
    startInPreview: boolean,
    pdfExport = false,
    sourcePath?: string,
    htmlTemplate = false,
  ): void {
    wrapper.classList.add("ocode-html-block");
    if (htmlTemplate) wrapper.classList.add("ocode-html-template");

    // A template block resolves its `{{ … }}` against the note's data once per
    // consumer (preview frame, PDF, print). Re-resolved per call so an export
    // always reflects the current frontmatter/partials, never a stale render.
    // A non-template block resolves to its source unchanged (zero extra work).
    const resolveHtml = (): Promise<string> =>
      htmlTemplate ? this.resolveTemplate(code, sourcePath) : Promise.resolve(code);

    const pane = createDiv({ cls: "ocode-html-render" });
    // Place the preview directly after the source body so collapse/line-number
    // chrome above it is unaffected.
    const shikiPre = wrapper.querySelector("pre.shiki") ?? wrapper.querySelector("pre");
    if (shikiPre) shikiPre.insertAdjacentElement("afterend", pane);
    else wrapper.appendChild(pane);

    // Build the frame only once the pane has real layout width. The post-
    // processor constructs this DOM *detached*, so at `apply(startInPreview)`
    // time the pane measures 0px wide — and anything the user's scripts size
    // against the viewport (width:100% SVGs, cards) renders permanently tiny
    // if the iframe loads then. A parent-side ResizeObserver fires as soon as
    // the pane is attached, visible, and sized; we build exactly once, then
    // disconnect.
    let frameBuilt = false;
    // Resolve the (possibly templated) HTML, then build the frame. The await is
    // a no-op for plain blocks (already-resolved promise) so the lazy build
    // lifecycle is unchanged; for templates it expands includes + interpolation
    // before the iframe srcdoc is set.
    const buildFrame = () => {
      void resolveHtml().then((html) => this.buildHtmlFrame(pane, html));
    };
    const ensureFrame = () => {
      if (frameBuilt) return;
      frameBuilt = true;
      if (pane.offsetWidth > 0) {
        buildFrame();
        return;
      }
      const ro = new ResizeObserver(() => {
        if (pane.offsetWidth === 0) return;
        ro.disconnect();
        buildFrame();
      });
      ro.observe(pane);
    };

    const apply = (preview: boolean) => {
      // Visibility before build: a hidden (display:none) pane never gets
      // width, so the observer in ensureFrame would never fire.
      wrapper.classList.toggle("ocode-show-preview", preview);
      if (preview) ensureFrame();
      const icon = toggle.querySelector(".ocode-pill-icon");
      const text = toggle.querySelector(".ocode-pill-text");
      // The pill shows the action it performs, i.e. the *other* view.
      if (icon) setSvgContent(icon, preview ? ICON.code : ICON.eye);
      if (text) text.textContent = preview ? "Code" : "Preview";
    };

    const toggle = this.createPillButton("Preview", ICON.eye, () => {
      apply(!wrapper.classList.contains("ocode-show-preview"));
    }, "ocode-html-toggle");

    // Sits to the right of Copy, mirroring where the Run pill goes.
    const btnGroup = wrapper.querySelector(".ocode-btn-group");
    if (btnGroup) btnGroup.appendChild(toggle);
    else wrapper.querySelector(".ocode-header")?.appendChild(toggle);

    // PDF/print export pill (desktop only — both paths need Electron). Opens a
    // small menu so a single pill covers "save as PDF" and "print" without
    // adding two buttons to the header.
    if (pdfExport && Platform.isDesktop) {
      const exportPill = this.createPillButton("PDF", ICON.printer, () => {
        const menu = new Menu();
        menu.addItem((i) =>
          i.setTitle("Save as PDF…").setIcon("download")
            .onClick(() => void resolveHtml().then((html) => this.exportHtmlBlockToPdf(html, sourcePath))));
        menu.addItem((i) =>
          i.setTitle("Print…").setIcon("printer")
            .onClick(() => void resolveHtml().then((html) => this.printHtmlBlock(html))));
        const r = exportPill.getBoundingClientRect();
        menu.showAtPosition({ x: r.left, y: r.bottom });
      }, "ocode-pdf-pill");
      if (btnGroup) btnGroup.appendChild(exportPill);
      else wrapper.querySelector(".ocode-header")?.appendChild(exportPill);
    }

    apply(startInPreview);

    // Export render: the lazy frame build above is driven by a ResizeObserver
    // that never fires while the document is detached, so the preview pane would
    // serialize empty — a preview-mode html block then exports as a bare header
    // (#33). Record the pane so buildNoteHtml can build the frame eagerly.
    this._exportHtmlPanes?.push({ pane, wrapper, code, htmlTemplate });
  }

  /**
   * Resolve a template `html` block to final HTML: build the layered context,
   * expand `{{> partials }}`, then interpolate. Never throws — on any failure it
   * degrades to the raw source so a broken template can't blank the document.
   */
  private async resolveTemplate(code: string, sourcePath?: string): Promise<string> {
    try {
      const ctx = await this.buildTemplateContext(sourcePath);
      const expanded = await expandIncludes(code, (p) => this.readPartial(p));
      return renderTemplate(expanded, ctx);
    } catch (err) {
      console.warn("CodeSuite: HTML template resolution failed — rendering source.", err);
      return code;
    }
  }

  /**
   * Assemble the layered template context for an html block from its note's
   * frontmatter, CodeSuite var stores, and any `template_context:` notes.
   * Precedence (lowest → highest, later overrides earlier in the base record):
   * frontmatter → CodeSuite vars; `{{#each}}` loop scope sits above both at
   * render time. `template_context:` notes are exposed under their own namespace
   * key (e.g. `biz`), so they sit alongside rather than collide. Frontmatter is
   * read from `metadataCache` so it works in both reading view and Live Preview.
   */
  private async buildTemplateContext(sourcePath?: string): Promise<TemplateContext> {
    const base: Record<string, unknown> = {};
    const file = sourcePath
      ? this.app.vault.getAbstractFileByPath(sourcePath)
      : this.app.workspace.getActiveFile();

    if (file instanceof TFile) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as
        | Record<string, unknown>
        | undefined;
      if (fm) {
        for (const [k, v] of Object.entries(fm)) base[k] = v;
        // Named context notes: expose each linked note's frontmatter under its
        // namespace, so shared data (e.g. business details) stays single-source.
        const tc = fm["template_context"];
        if (tc && typeof tc === "object" && !Array.isArray(tc)) {
          for (const [ns, link] of Object.entries(tc as Record<string, unknown>)) {
            const name = this.linkTarget(link);
            if (!name) continue;
            const dest = this.app.metadataCache.getFirstLinkpathDest(name, sourcePath ?? "");
            if (dest instanceof TFile) {
              const cfm = this.app.metadataCache.getFileCache(dest)?.frontmatter;
              base[ns] = cfm ? { ...cfm } : {};
            }
          }
        }
      }
    }

    // CodeSuite vars (block `vars` + `code_vars:`) override frontmatter, matching
    // the existing rule that block vars win. Stored typed → unwrap to plain JS.
    const varStore = sourcePath ? this.noteVarsBlockStore.get(sourcePath) : undefined;
    if (varStore) {
      for (const [k, v] of Object.entries(varStore)) base[k] = toJs(v);
    }

    return createContext(base);
  }

  /** Extract the note name a `template_context:` value points at — a wikilink
   *  string (`"[[Business Config]]"`, with optional alias/heading) or a plain
   *  note name. Returns null for a non-string value. */
  private linkTarget(v: unknown): string | null {
    if (typeof v !== "string") return null;
    const m = v.match(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/);
    return (m ? m[1] : v).trim() || null;
  }

  /**
   * Read a `{{> partial }}` target. Resolved relative to `codeImportsFolder`
   * (`.html` assumed when no extension), confined to the vault, and read via the
   * vault API so it works on desktop and mobile. Returns null when the path
   * escapes the imports folder or the file doesn't exist.
   */
  private async readPartial(p: string): Promise<string | null> {
    const folder = (this.settings.codeImportsFolder || "CodeSuiteImports").replace(/^\/+|\/+$/g, "");
    let rel = p.trim().replace(/^\/+/, "");
    if (!rel || rel.includes("..")) return null;
    if (!/\.[a-zA-Z0-9]+$/.test(rel)) rel += ".html";
    const full = normalizePath(`${folder}/${rel}`);
    const file = this.app.vault.getAbstractFileByPath(full);
    if (!(file instanceof TFile)) return null;
    return await this.app.vault.cachedRead(file);
  }

  /**
   * Build a standalone A4 document from an html block's source for PDF/print.
   * A full document (the block already declares `<html>`/`<!doctype>`) renders
   * verbatim — it styles itself, including any `@media print` rules. A bare
   * fragment is hosted on a clean white A4 page so the block's own CSS drives
   * the layout instead of falling back to browser defaults.
   *
   * The page margin is baked into the body as padding rather than via `@page`
   * margins or the print options: that keeps both export paths identical (PDF
   * prints with zero page margins, the dialog with `marginType: none`) and
   * survives a block's own `@media print { body { margin: 0 } }`, which only
   * resets the margin, not the padding.
   */
  private buildHtmlBlockDocument(code: string): string {
    if (/<!doctype html|<html[\s>]/i.test(code)) return code;
    const base =
      `@page{size:A4;margin:0}` +
      `html{background:#fff}` +
      `body{margin:0;padding:15mm;background:#fff;color:#1b1b1b;` +
      `font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;` +
      `font-size:13.5px;line-height:1.55}`;
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${base}</style></head>` +
      `<body>${code}</body></html>`;
  }

  /** Resolve the note a block belongs to, for naming/placing its export. */
  private blockSourceFile(sourcePath?: string): TFile | null {
    const f = sourcePath
      ? this.app.vault.getAbstractFileByPath(sourcePath)
      : this.app.workspace.getActiveFile();
    return f instanceof TFile ? f : null;
  }

  /** Export a single html block to an A4 PDF, defaulting beside its note. */
  private async exportHtmlBlockToPdf(code: string, sourcePath?: string): Promise<void> {
    if (!Platform.isDesktop) { new Notice("PDF export is desktop-only."); return; }
    const file = this.blockSourceFile(sourcePath);
    if (!file) { new Notice("Open the note before exporting its HTML block."); return; }
    const html = this.buildHtmlBlockDocument(code);
    // Paginated A4 (not single-page) so a long document flows onto extra pages.
    await this.exportPdf(html, this.exportDefaultPath(file, "pdf"), {
      ...DEFAULT_EXPORT_OPTIONS,
      singlePage: false,
    });
  }

  /** Open the system print dialog for a single html block, rendered on A4. */
  private async printHtmlBlock(code: string): Promise<void> {
    if (!Platform.isDesktop) { new Notice("Printing is desktop-only."); return; }
    const BrowserWindow = this.getBrowserWindow();
    if (!BrowserWindow) {
      new Notice("Printing needs Electron. Save as PDF or print from a browser instead.");
      return;
    }
    const nodeRequire = (window as unknown as { require: (id: string) => unknown }).require;
    const fs = nodeRequire("fs") as typeof import("fs");
    const os = nodeRequire("os") as typeof import("os");
    const path = nodeRequire("path") as typeof import("path");

    const html = this.buildHtmlBlockDocument(code);
    const tmpHtml = path.join(os.tmpdir(), `codesuite-print-${Date.now()}.html`);
    let win: ElectronBrowserWindow | null = null;
    try {
      fs.writeFileSync(tmpHtml, html);
      win = new BrowserWindow({ show: false, width: 820, height: 1160, webPreferences: { sandbox: true } });
      await win.loadFile(tmpHtml);
      const w = win;
      await new Promise<void>((resolve, reject) => {
        // marginType "none" so the only inset is the document's own 15mm body
        // padding — matching the zero-margin PDF path. The dialog still lets the
        // user override margins before printing.
        w.webContents.print({ printBackground: true, margins: { marginType: "none" } }, (success, reason) => {
          // A user dismissing the dialog reports failure with a "cancel" reason —
          // that's not an error, so only reject on a genuine print failure.
          if (!success && reason && !/cancel/i.test(reason)) reject(new Error(reason));
          else resolve();
        });
      });
    } catch (err) {
      new Notice(`Print failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (win) { try { win.destroy(); } catch { /* window already closed */ } }
      try { fs.unlinkSync(tmpHtml); } catch { /* temp file already gone */ }
    }
  }

  /**
   * Build the sandboxed preview iframe into `pane`. Wraps a fragment in a
   * theme-aware host document (so bare markup picks up Obsidian's font/colors)
   * or renders a full document as-is, then appends a tiny resize shim that
   * posts the content height back so the iframe can auto-size. The shim runs in
   * the sandbox alongside the user's scripts — it can only message the parent,
   * not touch it.
   */
  private buildHtmlFrame(pane: HTMLElement, code: string): void {
    const token = `ocode-frame-${++this._frameSeq}`;
    const iframe = createEl("iframe");
    iframe.className = "ocode-html-frame";
    // No allow-same-origin → the frame is an opaque origin and cannot reach the
    // vault, parent DOM, Obsidian APIs, or require. allow-scripts lets the
    // user's own (and our resize) script run, sandboxed.
    iframe.setAttribute("sandbox", "allow-scripts");
    // The frame is sized to its content from the resize shim, so it never needs
    // its own scrollbar. `scrolling="no"` is deprecated but still the only way
    // to suppress an iframe scrollbar cross-origin (the inner doc can't be
    // styled from here); the modern equivalent overflow lives in the srcdoc.
    iframe.setAttribute("scrolling", "no");
    iframe.srcdoc = this.buildHtmlSrcdoc(code, token);
    pane.appendChild(iframe);

    // The sandboxed frame can't be read cross-origin, so it reports its own
    // height via postMessage. All frames share one window listener (installed
    // lazily, cleaned up by registerDomEvent on unload) keyed by token —
    // one listener per note full of html blocks, not one per block.
    // WeakRef so a pruned block's iframe can be GC'd; dead entries are swept
    // here so the map stays bounded across a long session. (A merely *detached*
    // frame — e.g. an LP cache wrapper while the cursor reveals its block —
    // stays reachable through the cache, so its entry survives until then.)
    for (const [t, ref] of this._htmlFrames) {
      if (!ref.deref()) this._htmlFrames.delete(t);
    }
    this._htmlFrames.set(token, new WeakRef(iframe));
    if (!this._htmlFrameListenerInstalled) {
      this._htmlFrameListenerInstalled = true;
      this.registerDomEvent(activeWindow, "message", (e: MessageEvent) => {
        this.onHtmlFrameMessage(e);
      });
    }
  }

  /** Shared resize handler for all html-preview iframes. */
  private onHtmlFrameMessage(e: MessageEvent): void {
    const data = e.data as { __ocodeFrame?: string; height?: number } | null;
    if (!data || typeof data.__ocodeFrame !== "string" || typeof data.height !== "number") return;
    const iframe = this._htmlFrames.get(data.__ocodeFrame)?.deref();
    if (!iframe) {
      this._htmlFrames.delete(data.__ocodeFrame);
      return;
    }
    // A detached frame can't legitimately message (its doc is unloaded) — this
    // only catches a message in flight while the block was being pruned.
    if (!iframe.isConnected) return;
    // Only the frame itself may report its height.
    if (e.source !== iframe.contentWindow) return;
    // Size to content with no upper clamp — capping forces clipped content
    // (the frame never scrolls), which we never want. +2 covers fractional
    // layout heights the shim's ceil can still undershoot across DPI scales.
    iframe.style.height = `${Math.ceil(Math.max(data.height, 24)) + 2}px`;
  }

  /** Assemble the iframe `srcdoc`: theme-wrapped fragment or verbatim full document, plus the resize shim. */
  private buildHtmlSrcdoc(code: string, token: string): string {
    // The frame auto-sizes to content, so full-viewport layout idioms
    // (height:100%/min-height:100vh) are meaningless inside it and create a
    // feedback loop: viewport-height-driven content can never report a height
    // other than the current frame height. Force html/body to wrap content;
    // overflow:hidden suppresses any inner scrollbar (we size, never scroll).
    const heightFix =
      `<style>html,body{height:auto !important;min-height:0 !important;` +
      `overflow:hidden !important}</style>`;
    // Measure the body, never documentElement.scrollHeight — that is clamped
    // to at least the viewport, so it tracks the frame height we set and the
    // size can never converge. Re-measure on load, on body resize, and on any
    // DOM mutation (script-built content like charts/SVGs appears long after
    // load), coalesced through one rAF so mutation bursts post once.
    const resizeShim =
      `<script>(function(){var q=false;` +
      `var post=function(){q=false;var b=document.body;if(!b)return;` +
      `var h=Math.max(b.scrollHeight,b.offsetHeight,Math.ceil(b.getBoundingClientRect().height));` +
      `parent.postMessage({__ocodeFrame:${JSON.stringify(token)},height:h},"*")};` +
      `var sched=function(){if(q)return;q=true;requestAnimationFrame(post)};` +
      `addEventListener("load",sched);` +
      `try{new ResizeObserver(sched).observe(document.body)}catch(e){}` +
      `try{new MutationObserver(sched).observe(document.body,` +
      `{subtree:true,childList:true,attributes:true,characterData:true})}catch(e){}` +
      `sched();setTimeout(sched,250);setTimeout(sched,1000)})();</` + `script>`;

    // A full document styles itself — render it verbatim, then append the
    // height override and resize shim.
    if (/<!doctype html|<html[\s>]/i.test(code)) {
      return code + heightFix + resizeShim;
    }

    // Fragment: host it in a minimal document seeded with the current Obsidian
    // theme's font/colors so it doesn't fall back to browser defaults.
    const cs = activeWindow.getComputedStyle(activeDocument.body);
    const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
    const isDark = activeDocument.body.classList.contains("theme-dark");
    const fg = v("--text-normal", isDark ? "#dcddde" : "#222");
    const bg = v("--background-primary", isDark ? "#1e1e1e" : "#fff");
    const accent = v("--text-accent", "#7f6df2");
    const font = v("--font-text", "-apple-system, system-ui, sans-serif");
    const base =
      `:root{color-scheme:${isDark ? "dark" : "light"}}` +
      `html,body{margin:0;height:auto;min-height:0;overflow:hidden}` +
      `body{padding:8px;background:${bg};color:${fg};` +
      `font-family:${font};font-size:14px;line-height:1.5}` +
      `a{color:${accent}}`;
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${base}</style></head>` +
      `<body>${code}${resizeShim}</body></html>`;
  }

  /** Store a finished output panel's HTML, keyed by note path + block source. */
  private saveBlockOutput(notePath: string, code: string, panel: HTMLElement): void {
    let byCode = this.noteOutputs.get(notePath);
    if (!byCode) { byCode = new Map(); this.noteOutputs.set(notePath, byCode); }
    byCode.set(code, panel.outerHTML);
  }

  /** Store a finished output's structured data, keyed by note path + block source. */
  private saveBlockOutputData(notePath: string, code: string, data: CapturedOutput): void {
    let byCode = this.noteOutputData.get(notePath);
    if (!byCode) { byCode = new Map(); this.noteOutputData.set(notePath, byCode); }
    byCode.set(code, data);
  }

  /** Re-attach a saved output snapshot to a freshly rendered block, if one exists. */
  private restoreBlockOutput(notePath: string, code: string, wrapper: HTMLElement): void {
    if (wrapper.querySelector(".ocode-output")) return;
    const html = this.noteOutputs.get(notePath)?.get(code);
    if (!html) return;
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const panel = parsed.querySelector<HTMLElement>(".ocode-output");
    if (!panel) return;
    const adopted = activeDocument.adoptNode(panel);
    // The outerHTML round-trip drops all event listeners — rewire the header
    // buttons so the restored panel behaves like a live one.
    adopted.querySelector(".ocode-clear-pill")?.addEventListener("click", () => adopted.remove());
    const content = adopted.querySelector<HTMLElement>(".ocode-output-content");
    adopted.querySelector(".ocode-copy-out-pill")?.addEventListener("click", () => {
      void navigator.clipboard.writeText(content?.textContent ?? "");
    });
    adopted.querySelector(".ocode-copy-stderr-pill")?.addEventListener("click", () => {
      const err = Array.from(adopted.querySelectorAll(".ocode-stderr")).map((s) => s.textContent ?? "").join("");
      void navigator.clipboard.writeText(err.trim());
    });
    wrapper.appendChild(adopted);
  }

  /**
   * Add a collapse toggle to a code block wrapper.
   *
   * Shared by inline code blocks (this method) and embedded files
   * (which call it with `defaultCollapsed=true`).
   */
  private makeCollapsible(wrapper: HTMLElement, defaultCollapsed: boolean): void {
    const codeArea = wrapper.querySelector<HTMLElement>("pre.shiki");
    const header = wrapper.querySelector(".ocode-header");
    if (!codeArea || !header) return;
    if (header.classList.contains("ocode-collapse-toggle")) return;

    if (defaultCollapsed) {
      wrapper.classList.add("ocode-collapsed");
      codeArea.classList.add("ocode-hidden");
    }

    const toggle = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      const collapsed = wrapper.classList.toggle("ocode-collapsed");
      codeArea.classList.toggle("ocode-hidden", collapsed);
    };

    // Clicking anywhere on the header (except buttons / links) also toggles.
    header.classList.add("ocode-collapse-toggle");
    header.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target.closest(".ocode-pill")) return;
      if (target.closest(".ocode-label-link")) return;
      toggle(e);
    });
  }

  /** Create a pill-style button (icon + text) */
  private createPillButton(
    text: string,
    icon: string,
    onClick: () => void,
    extraClass?: string
  ): HTMLButtonElement {
    const btn = createEl("button");
    btn.className = `ocode-pill ${extraClass || ""}`.trim();
    const iconSpan = createSpan();
    iconSpan.className = "ocode-pill-icon";
    iconSpan.appendChild(parseSvg(icon));
    btn.appendChild(iconSpan);
    const textSpan = createSpan();
    textSpan.className = "ocode-pill-text";
    textSpan.textContent = text;
    btn.appendChild(textSpan);
    btn.addEventListener("click", (e) => {
      // Stop the bubble to the header's collapse toggle. Its closest(".ocode-pill")
      // guard is not enough: handlers like Run/Copy swap the icon SVG, so by the
      // time the event reaches the header, e.target (the old SVG) is detached and
      // closest() finds nothing — collapsing the block on an exact icon click (#26).
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  // ─── Code Execution ──────────────────────────────────────────

  private async runCode(
    code: string,
    lang: string,
    wrapper: HTMLElement,
    runBtn: HTMLButtonElement,
    sourcePath?: string
  ) {
    // If already running (or queued), this is a cancel click
    const existingProc = this.runningProcs.get(wrapper);
    if (existingProc) {
      existingProc.cancel();
      return;
    }

    // ─── Per-note run queue (#25) ──────────────────────────────────
    // With shared context, concurrent runs in one note race the session replay
    // (and each other's variable snapshots). Serialize: each run waits for the
    // note's previous run before *building* its execution script, so context
    // accumulates in click order. The queued state is cancellable via a
    // placeholder process entry (a second click on "Queued" aborts it).
    let releaseQueue: (() => void) | undefined;
    let queueTail: Promise<void> | null = null;
    if (this.settings.sharedContext && sourcePath !== undefined) {
      const prevTail = this.noteRunQueue.get(sourcePath);
      // The executor runs synchronously, so `resolveTail` is assigned here.
      let resolveTail!: () => void;
      queueTail = new Promise<void>((r) => (resolveTail = r));
      releaseQueue = resolveTail;
      this.noteRunQueue.set(sourcePath, queueTail);
      if (prevTail) {
        let cancelledWhileQueued = false;
        const revertQueuedButton = () => {
          setSvgContent(runBtn.querySelector(".ocode-pill-icon")!, ICON.play);
          runBtn.querySelector(".ocode-pill-text")!.textContent = "Run";
          runBtn.classList.remove("ocode-cancel-pill");
        };
        this.runningProcs.set(wrapper, {
          promise: Promise.resolve({ stdout: "", stderr: "", exitCode: null, killed: false, cancelled: true, figures: [] }),
          // Cancelling a queued block must revert the pill immediately — the wait
          // on prevTail below can outlive the click, so deferring the UI update
          // there leaves the button stuck on "Queued" until the prior run ends.
          cancel: () => {
            cancelledWhileQueued = true;
            this.runningProcs.delete(wrapper);
            revertQueuedButton();
          },
          writeStdin: () => {},
          closeStdin: () => {},
        });
        setSvgContent(runBtn.querySelector(".ocode-pill-icon")!, ICON.stop);
        runBtn.querySelector(".ocode-pill-text")!.textContent = "Queued";
        runBtn.classList.add("ocode-cancel-pill");
        await prevTail;
        if (cancelledWhileQueued) {
          releaseQueue?.();
          if (this.noteRunQueue.get(sourcePath) === queueTail) this.noteRunQueue.delete(sourcePath);
          return;
        }
        this.runningProcs.delete(wrapper);
      }
    }

    // ─── Shared context ───────────────────────────────────────────
    const useSharedCtx =
      this.settings.sharedContext &&
      sourcePath !== undefined &&
      CodePlugin.SHARED_CTX_LANGS.has(lang);

    // Build the code to actually execute (may prepend accumulated blocks).
    // preSeeds  = declared initials (injected before replay).
    // postSeeds = the incoming live values this block can't reconstruct from its
    //             own-language replay (injected after replay so they win).
    // effectiveSeeds (their merge) is captured so the snapshot handler can tell
    // which variables a block actually *changed* vs. just read.
    //
    // Re-run semantics (#36): a block must see the value it *consumed*, not the
    // value it *produced*. So for each live var we take the value written by the
    // most recent block *other than this one* (`prev` when we are that block's
    // current owner) and re-seed it when our own-language replay can't recreate
    // it — i.e. it came from another language, or was itself derived from a seed.
    const blockKey = lang + "\0" + code;
    let execCode = code;
    const preSeeds  = useSharedCtx ? (this.noteVarsBlockStore.get(sourcePath) ?? {}) : {};
    const postSeeds: Record<string, VarValue> = {};
    if (useSharedCtx) {
      const live = this.noteLiveVars.get(sourcePath);
      if (live) for (const [name, entry] of live) {
        const eff = entry.block !== blockKey ? entry : entry.prev;
        if (!eff) continue;
        if (eff.lang !== lang || eff.derived) postSeeds[name] = eff.value;
      }
    }
    const effectiveSeeds: Record<string, VarValue> = { ...preSeeds, ...postSeeds };
    if (useSharedCtx) {
      // Replay the full accumulated session, including this block's own earlier
      // run. Dropping it would break later blocks that depend on its definitions
      // (e.g. Run All, then re-run block 1: the replay of block 3 would hit a
      // NameError before block 1 ever executes). Running once in the suppressed
      // replay and once visibly matches notebook re-run semantics.
      const prevBlocks = this.noteContexts.get(sourcePath)?.get(lang) ?? [];
      const hasSeed    = Object.keys(preSeeds).length > 0 || Object.keys(postSeeds).length > 0;
      if (prevBlocks.length > 0 || hasSeed) {
        execCode = this.buildSharedContextCode(lang, prevBlocks, code, preSeeds, postSeeds);
      }
      // Append the var-extraction postamble where we have a language-specific
      // snapshotter. Plain sh still gets shared replay, but reliable variable
      // introspection is intentionally limited to shells with suitable APIs.
      if (lang === "python") {
        execCode = execCode + CodePlugin.PYTHON_VAR_POSTAMBLE;
      } else if (lang === "bash") {
        execCode = execCode + CodePlugin.BASH_VAR_POSTAMBLE;
      } else if (lang === "zsh") {
        execCode = execCode + CodePlugin.ZSH_VAR_POSTAMBLE;
      }
    }

    // Switch button to "Stop" cancel mode
    setSvgContent(runBtn.querySelector(".ocode-pill-icon")!, ICON.stop);
    runBtn.querySelector(".ocode-pill-text")!.textContent = "Stop";
    runBtn.classList.add("ocode-cancel-pill");

    // Remove previous output
    wrapper.querySelector(".ocode-output")?.remove();

    // ─── Build live output panel immediately ───
    const outputPanel = createDiv();
    outputPanel.className = "ocode-output";

    // Output header
    const outHeader = createDiv();
    outHeader.className = "ocode-output-header";

    const outLabel = createSpan();
    outLabel.className = "ocode-output-label";
    outLabel.textContent = "Running\u2026";
    outHeader.appendChild(outLabel);

    const clearBtn = createEl("button");
    clearBtn.className = "ocode-pill ocode-clear-pill";
    const clearBtnIcon = createSpan();
    clearBtnIcon.className = "ocode-pill-icon";
    clearBtnIcon.appendChild(parseSvg(ICON.close));
    clearBtn.appendChild(clearBtnIcon);
    clearBtn.setAttribute("aria-label", "Clear output");
    clearBtn.addEventListener("click", () => outputPanel.remove());
    outHeader.appendChild(clearBtn);
    outputPanel.appendChild(outHeader);

    // Scrollable output content area (div so figures can be interleaved with text)
    const outContent = createDiv();
    outContent.className = "ocode-output-content";
    outputPanel.appendChild(outContent);

    // Stdin input bar — only shown if the code reads from stdin
    const needsStdin = this.codeUsesStdin(code, lang);
    const isSudo = this.codeUsesSudo(code, lang);
    const inputBar = createDiv();
    inputBar.className = needsStdin ? "ocode-input-bar ocode-input-bar-visible" : "ocode-input-bar";

    const inputField = createEl("input");
    inputField.type = isSudo ? "password" : "text";
    inputField.className = "ocode-input-field";
    inputField.placeholder = isSudo ? "Enter password\u2026" : "Type input and press enter\u2026";
    inputBar.appendChild(inputField);

    const sendBtn = createEl("button");
    sendBtn.className = "ocode-pill ocode-send-pill";
    const sendBtnIcon = createSpan();
    sendBtnIcon.className = "ocode-pill-icon";
    sendBtnIcon.appendChild(parseSvg(ICON.send));
    sendBtn.appendChild(sendBtnIcon);
    sendBtn.setAttribute("aria-label", "Send input");
    inputBar.appendChild(sendBtn);
    outputPanel.appendChild(inputBar);

    wrapper.appendChild(outputPanel);

    // Auto-focus the input field if the stdin bar is visible from the start
    if (needsStdin) {
      // requestAnimationFrame ensures the element is rendered before focusing
      window.requestAnimationFrame(() => inputField.focus());
    }

    // ─── Start execution with live streaming ───
    let stderrText = "";
    // Track whether the current input is a password prompt (sudo or dynamic detection)
    let isPasswordMode = isSudo;
    const vaultPath = (this.app.vault.adapter as unknown as { basePath: string }).basePath;

    // Always line-buffer stdout so we can filter __OCODE_VARS__ lines (shared
    // context) and replace figure sentinels (\x00OCODE_FIG_N\x00) with
    // placeholder elements that are filled in after execution completes.
    let stdoutLineBuffer = "";
    const SENTINEL_RE = /^OCODE_FIG_(\d+)$/;

    const appendStdout = (text: string) => {
      const span = createSpan({ cls: "ocode-stdout", text });
      outContent.appendChild(span);
      outContent.scrollTop = outContent.scrollHeight;
    };

    // Blank stdout lines are held back and only flushed when real content
    // follows. The var postamble prints "\n__OCODE_VARS__=…" to guarantee its
    // marker starts on a fresh line; when user output already ends with a
    // newline that spacer becomes a spurious empty line, which used to render
    // as a trailing blank line (and made truly output-less runs look non-empty).
    let pendingBlankLines = 0;
    const flushBlankLines = () => {
      for (; pendingBlankLines > 0; pendingBlankLines--) appendStdout("\n");
    };

    const processStdoutLine = (line: string) => {
      if (useSharedCtx && line.startsWith("__OCODE_VARS__=")) {
        pendingBlankLines = 0; // drop the postamble's spacer newline
        try {
          const vars = JSON.parse(line.slice("__OCODE_VARS__=".length)) as Record<string, unknown>;
          this.recordRuntimeVars(sourcePath, lang, blockKey, vars, effectiveSeeds);
          this.refreshDisplayVars(sourcePath);
        } catch { /* ignore parse failures */ }
        return;
      }
      if (line === "") {
        pendingBlankLines++;
        return;
      }
      flushBlankLines();
      const sentinelMatch = SENTINEL_RE.exec(line);
      if (sentinelMatch) {
        // Insert a placeholder; replaced with the real figure after execution.
        const placeholder = createDiv({ cls: "ocode-fig-placeholder" });
        placeholder.dataset.figIdx = sentinelMatch[1];
        outContent.appendChild(placeholder);
        outContent.scrollTop = outContent.scrollHeight;
        return;
      }
      appendStdout(line + "\n");
    };

    const proc = startExecution(execCode, lang, this.settings, {
      onStdout: (data) => {
        stdoutLineBuffer += data;
        const lines = stdoutLineBuffer.split("\n");
        stdoutLineBuffer = lines.pop()!; // last (possibly incomplete) chunk
        for (const line of lines) processStdoutLine(line);
      },
      onStderr: (data) => {
        stderrText += data;
        // Dynamically detect password prompts so we mask input even when static
        // detection didn't fire (indirect sudo, wrong password retry, ssh keys, etc.)
        if (/password[:\s]/i.test(data) || /\bpassphrase\b/i.test(data)) {
          isPasswordMode = true;
          inputField.type = "password";
          inputField.placeholder = "Enter password\u2026";
          inputBar.classList.add("ocode-input-bar-visible");
          window.requestAnimationFrame(() => inputField.focus());
        }
        const span = createSpan();
        span.className = "ocode-stderr";
        // Ensure stderr chunks end with a newline so subsequent stdout starts on a new line
        span.textContent = data.endsWith("\n") ? data : data + "\n";
        outContent.appendChild(span);
        outContent.scrollTop = outContent.scrollHeight;
      },
    }, vaultPath);
    this.runningProcs.set(wrapper, proc);
    // Progress cue (#25): highlight the block while its process is live.
    wrapper.classList.add("ocode-running");

    // ─── Wire up stdin ───
    const doSend = () => {
      const text = inputField.value;
      if (text !== undefined) {
        proc.writeStdin(text + "\n");
        inputField.value = "";
        // Never echo password input; reset to text mode after sending so
        // normal (non-password) prompts following the password work correctly.
        if (isPasswordMode) {
          isPasswordMode = false;
          inputField.type = "text";
          inputField.placeholder = "Type input and press enter\u2026";
        } else {
          const echo = createSpan();
          echo.className = "ocode-stdin-echo";
          echo.textContent = `> ${text}\n`;
          outContent.appendChild(echo);
          outContent.scrollTop = outContent.scrollHeight;
        }
      }
    };
    inputField.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); doSend(); }
    });
    sendBtn.addEventListener("click", doSend);

    try {
      const result = await proc.promise;

      // Flush any remaining buffered stdout (no trailing newline at end of script)
      if (stdoutLineBuffer) {
        processStdoutLine(stdoutLineBuffer);
        stdoutLineBuffer = "";
      }

      // Process finished — remove input bar
      inputBar.remove();

      // User clicked Stop. Don't surface a "timed out" result: if nothing was
      // produced, drop the panel entirely so a stop reads as "nothing"; keep
      // any partial output under a clear label. Cancelled runs never persist
      // or accumulate into the shared session.
      if (result.cancelled) {
        if (!outContent.childNodes.length) outputPanel.remove();
        else outLabel.textContent = "Output (stopped)";
        return;
      }

      // Update label
      const failed = !result.killed && result.exitCode !== 0 && result.exitCode !== null;
      outLabel.textContent = result.killed
        ? "Output (timed out)"
        : result.exitCode === 0
        ? "Output"
        : `Output (exit: ${result.exitCode})`;

      // stderr is coloured by stream, not by exit code. A failed run's stderr is
      // often a mix of intentional messages and the actual error, and the two
      // are indistinguishable within the single stream — so we never repaint
      // stderr red (it would mislabel ordinary stderr as an error, #29). stderr
      // stays orange; failure is signalled by the red exit badge in the header.
      if (result.killed || failed) {
        outLabel.classList.add("ocode-output-failed");
      }

      // Copy buttons are split by stream — stdout vs stderr is the only
      // distinction we can reliably make (warnings and errors share stderr, with
      // no marker between them), so we expose one button per stream and never
      // claim to separate stderr further.
      // Strip the sudo password prompt line from stderr — it's not output.
      const errorText = stderrText.replace(/^Password:\s*/m, "").trim();
      const hasStdout = Array.from(outContent.querySelectorAll<HTMLElement>(".ocode-stdout"))
        .some((s) => (s.textContent ?? "").trim() !== "");

      // Copy-all-output: only when there's stdout to copy. With no stdout the
      // panel is nothing but stderr, which the stderr pill below already copies
      // — showing this too would just duplicate it (#29).
      if (hasStdout && outContent.textContent?.trim()) {
        const copyOutBtn = this.createPillButton("", ICON.copy, () => {
          const text = outContent.textContent || "";
          void navigator.clipboard.writeText(text).then(() => {
            setSvgContent(copyOutBtn.querySelector(".ocode-pill-icon")!, ICON.check);
            window.setTimeout(() => {
              setSvgContent(copyOutBtn.querySelector(".ocode-pill-icon")!, ICON.copy);
            }, 2000);
          });
        }, "ocode-copy-out-pill");
        copyOutBtn.title = "Copy output";
        outHeader.insertBefore(copyOutBtn, clearBtn);
      }

      // Copy-stderr: shown whenever there's stderr, tinted orange to match the
      // stderr text. It copies *all* stderr — warnings and errors alike — since
      // there is no reliable way to tell them apart within the one stream (#29).
      if (errorText) {
        const copyErrBtn = this.createPillButton("", ICON.copy, () => {
          void navigator.clipboard.writeText(errorText).then(() => {
            setSvgContent(copyErrBtn.querySelector(".ocode-pill-icon")!, ICON.check);
            window.setTimeout(() => {
              setSvgContent(copyErrBtn.querySelector(".ocode-pill-icon")!, ICON.copy);
            }, 2000);
          });
        }, "ocode-copy-stderr-pill");
        copyErrBtn.title = "Copy stderr";
        // Insert before the clear button
        outHeader.insertBefore(copyErrBtn, clearBtn);
      }

      // Replace figure placeholders with the real image/widget elements.
      // Placeholders were inserted inline during streaming to preserve order.
      for (const placeholder of Array.from(outContent.querySelectorAll<HTMLElement>(".ocode-fig-placeholder"))) {
        const idx = parseInt(placeholder.dataset.figIdx ?? "0", 10);
        const fig = result.figures.find((f) => f.figureIndex === idx);
        if (fig) {
          placeholder.replaceWith(buildFigureEl(fig, this.app));
        } else {
          placeholder.remove();
        }
      }

      // Snapshot the visible stdout text now, before the empty-panel branch
      // below may detach outContent. Used by the "Bake outputs" command.
      const visibleStdout = Array.from(outContent.querySelectorAll<HTMLElement>(".ocode-stdout"))
        .map((s) => s.textContent ?? "").join("");

      // If no output at all, collapse the panel to just the header so a clean
      // run still reads as "ran fine" without an empty content box.
      if (!outContent.childNodes.length) {
        if (result.exitCode === 0 && !result.killed) outLabel.textContent = "Output (none)";
        outContent.remove();
        outputPanel.classList.add("ocode-output-headeronly");
      }

      // Persist a static snapshot of the finished output so it survives reading-
      // view section eviction and is picked up by HTML/PDF export.
      if (sourcePath) {
        this.saveBlockOutput(sourcePath, code, outputPanel);
        this.saveBlockOutputData(sourcePath, code, {
          hash: codeHash(code.trim()),
          exit: result.exitCode,
          label: outLabel.textContent ?? "Output",
          stdout: visibleStdout,
          stderr: errorText,
          figures: result.figures,
        });
      }

      // ─── Accumulate into session on clean exit ───
      if (useSharedCtx && result.exitCode === 0) {
        const notePath = sourcePath;
        if (!this.noteContexts.has(notePath)) {
          this.noteContexts.set(notePath, new Map());
        }
        const noteCtx = this.noteContexts.get(notePath)!;
        if (!noteCtx.has(lang)) noteCtx.set(lang, []);
        const blocks = noteCtx.get(lang)!;
        // Store the original block (not the wrapped version). Dedupe identical
        // sources so re-running a block doesn't stack duplicate replays.
        if (!blocks.includes(code)) blocks.push(code);
      }
    } catch (err: unknown) {
      new Notice(`Execution error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.runningProcs.delete(wrapper);
      wrapper.classList.remove("ocode-running");
      // Hand the note's queue to the next waiting run (and drop the map entry
      // when no one is waiting, so closed notes don't accumulate tails).
      releaseQueue?.();
      if (sourcePath !== undefined && this.noteRunQueue.get(sourcePath) === queueTail) {
        this.noteRunQueue.delete(sourcePath);
      }
      // Restore run button
      setSvgContent(runBtn.querySelector(".ocode-pill-icon")!, ICON.play);
      runBtn.querySelector(".ocode-pill-text")!.textContent = "Run";
      runBtn.classList.remove("ocode-cancel-pill");
    }
  }

  // ─── Stdin Detection ──────────────────────────────────────────

  /** Check if code uses sudo (requires password masking) */
  private codeUsesSudo(code: string, lang: string): boolean {
    return (lang === "bash" || lang === "zsh" || lang === "shell") && /\bsudo\b/.test(code);
  }

  /** Check if code likely reads from stdin, based on common patterns per language */
  private codeUsesStdin(code: string, lang: string): boolean {
    switch (lang) {
      case "python":
        return /\binput\s*\(/.test(code) || /\bsys\.stdin\b/.test(code);
      case "javascript":
      case "typescript":
        return /\bprocess\.stdin\b/.test(code) || /\breadline\b/.test(code) || /\bprompt\s*\(/.test(code);
      case "bash":
      case "zsh":
      case "shell":
        return /\bread\b/.test(code) || /\bsudo\b/.test(code);
      case "ruby":
        return /\bgets\b/.test(code) || /\bSTDIN\b/.test(code) || /\breadline\b/.test(code);
      case "lua":
        return /\bio\.read\b/.test(code) || /\bio\.stdin\b/.test(code);
      case "perl":
        return /\b<STDIN>\b/.test(code) || /\bchomp\b/.test(code);
      case "go":
        return /\bfmt\.Scan/.test(code) || /\bbufio\.NewReader\(os\.Stdin\)/.test(code) || /\bos\.Stdin\b/.test(code);
      case "php":
        return /\bfgets\s*\(\s*STDIN\b/.test(code) || /\breadline\s*\(/.test(code);
      case "powershell":
        return /\bRead-Host\b/i.test(code) || /\[Console\]::ReadLine\s*\(/i.test(code) || /\$Host\.UI\.ReadLine\s*\(/i.test(code);
      case "r":
        return /\breadLines\s*\(\s*["']stdin/.test(code) || /\bscan\s*\(/.test(code);
      case "swift":
        return /\breadLine\s*\(/.test(code);
      default:
        return false;
    }
  }

  // ─── Embedded Code File Rendering ─────────────────────────────

  private processEmbeddedFiles(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
    const embeds = el.querySelectorAll(".internal-embed");
    if (!embeds.length) return;

    for (const embed of Array.from(embeds)) {
      const src = embed.getAttribute("src");
      if (!src) continue;

      const extMatch = src.match(/\.[a-zA-Z0-9]+$/);
      if (!extMatch) continue;
      const ext = extMatch[0].toLowerCase();
      if (!CODE_FILE_EXTENSIONS.has(ext)) continue;

      const file = this.app.metadataCache.getFirstLinkpathDest(src, ctx.sourcePath);
      if (!file || !(file instanceof TFile)) continue;

      // The alias (`![[file.html|preview]]`) lands in the embed's `alt` attribute.
      void this.renderEmbeddedFile(embed as HTMLElement, file, ext, ctx.sourcePath, embed.getAttribute("alt"));
    }
  }

  private async renderEmbeddedFile(embedEl: HTMLElement, file: TFile, ext: string, sourcePath?: string, alias?: string | null) {
    // Replace the .internal-embed element with a plain container so
    // Obsidian's click-to-open handler is completely severed.
    const container = createDiv();
    container.className = "ocode-embed-container";
    embedEl.replaceWith(container);
    await this.populateEmbedContainer(container, file, ext, sourcePath, alias);
  }

  /**
   * Read `file`, render its contents as an embedded code block, and append the
   * resulting `ocode-wrapper` into `container`. Shared by the reading-view
   * embed post-processor ({@link renderEmbeddedFile}) and the Live Preview
   * embed widget. The read is async, so callers get a synchronously-returned
   * (empty) container that fills in once the file is read.
   */
  private async populateEmbedContainer(container: HTMLElement, file: TFile, ext: string, sourcePath?: string, alias?: string | null) {
    const code = await this.app.vault.read(file);
    const lang = this.highlighter.resolveExtension(ext);
    let htmlPreview = this.embedHtmlPreview(ext, alias);
    const htmlPdf = this.embedHtmlPdf(ext, alias);
    const htmlTemplate = this.embedHtmlTemplate(ext, alias, code);
    // A template embed is implicitly preview-eligible (so the resolved document
    // renders), exactly as a `template` fence flag is — otherwise a no-flag embed
    // with `renderHtmlBlocks` off would show raw `{{ … }}` source instead.
    if (htmlTemplate && htmlPreview === null) htmlPreview = true;

    const wrapper = this.buildCodeBlockWrapper(
      code, lang, lang, file.name, sourcePath, false, null, htmlPreview, htmlPdf, htmlTemplate,
    );
    if (!wrapper) return;
    container.empty();
    container.appendChild(wrapper);

    // Mark as embedded
    wrapper.classList.add("ocode-embedded");

    // Always show filename and make it a link to the file
    const labelEl = wrapper.querySelector<HTMLElement>(".ocode-label");
    if (labelEl) {
      labelEl.classList.add("ocode-label-link");
      labelEl.addEventListener("click", () => {
        void this.app.workspace.getLeaf().openFile(file);
      });
    }

    // Collapsible behaviour — uses the shared helper. buildCodeBlockWrapper
    // skips its own collapse wiring for embeds (the `fileName` guard), so this
    // is where an embed becomes collapsible; makeCollapsible no-ops if a toggle
    // somehow already exists, so calling it is always safe.
    if (this.settings.collapseEmbeds) {
      this.makeCollapsible(wrapper, true);
    }
  }
}

/**
 * One-time notice shown when upgrading across {@link SHELL_ALIAS_BREAKING_VERSION}.
 * Explains that `sh` fences now run POSIX sh instead of bash and points at the
 * two escape hatches (rename to `bash`, or set a path in settings).
 */
class ShellAliasNoticeModal extends Modal {
  onOpen(): void {
    const { contentEl, titleEl } = this;
    titleEl.setText("CodeSuite: shell behavior changed");

    contentEl.createEl("p", {
      text: "Heads-up about a behavior change in this update to how shell code blocks are executed.",
    });

    const list = contentEl.createEl("ul");
    list.createEl("li").appendText(
      "`sh` code blocks now run POSIX sh (/bin/sh) — the same as `shell` blocks. Previously `sh` ran bash.",
    );
    list.createEl("li").appendText(
      "`bash`, `zsh`, and `shell` blocks are unchanged.",
    );

    contentEl.createEl("p", {
      text: "If you have `sh` blocks that rely on bash features (arrays, [[ ]], etc.), either:",
    });
    const fixes = contentEl.createEl("ul");
    fixes.createEl("li").appendText("rename the fence from `sh` to `bash`, or");
    fixes.createEl("li").appendText(
      "set Settings → CodeSuite → Environment → Shell (sh) path to a bash binary (e.g. /opt/homebrew/bin/bash).",
    );

    const buttonRow = contentEl.createDiv({ cls: "modal-button-container" });
    const okBtn = buttonRow.createEl("button", { text: "Got it", cls: "mod-cta" });
    okBtn.addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/**
 * Per-export options dialog for HTML/PDF export. Width applies to both formats;
 * the code-block split mode and single-page toggle are PDF-only. Resolves with
 * the chosen options, or `null` if the user cancels / dismisses the modal.
 */
class ExportOptionsModal extends Modal {
  private options: ExportOptions;
  private submitted = false;

  constructor(
    app: App,
    private format: "html" | "pdf",
    seed: ExportOptions,
    private resolve: (result: ExportOptions | null) => void,
  ) {
    super(app);
    this.options = { ...seed };
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    titleEl.setText(this.format === "pdf" ? "Export to PDF" : "Export to HTML");

    if (this.format === "html") {
      // Width is HTML-only. PDF always matches the current reading-view width
      // (a fixed page can't sensibly honour "full width" — it overflows).
      new Setting(contentEl)
        .setName("Content width")
        .setDesc("How wide the document content column should be.")
        .addDropdown((dd) => {
          dd.addOption("default", "Obsidian default (readable line length)");
          dd.addOption("current", "Match current view");
          dd.addOption("full", "Full width");
          dd.setValue(this.options.widthMode);
          dd.onChange((v) => { this.options.widthMode = v as ExportWidthMode; });
        });
    }

    new Setting(contentEl)
      .setName("Include note title")
      .setDesc("Add the note name as a heading at the top of the document.")
      .addToggle((t) => {
        t.setValue(this.options.includeTitle);
        t.onChange((v) => { this.options.includeTitle = v; });
      });

    if (this.format === "pdf") {
      new Setting(contentEl)
        .setName("Keep code blocks together")
        .setDesc("Avoid splitting a code block across pages. A block taller than a page still splits so nothing is clipped.")
        .addToggle((t) => {
          t.setValue(this.options.keepCodeBlocksWhole);
          t.onChange((v) => { this.options.keepCodeBlocksWhole = v; });
        });

      new Setting(contentEl)
        .setName("Single long page")
        .setDesc("Output one continuous page with no page breaks instead of paginated A4.")
        .addToggle((t) => {
          t.setValue(this.options.singlePage);
          t.onChange((v) => { this.options.singlePage = v; });
        });
    }

    const buttonRow = contentEl.createDiv({ cls: "modal-button-container" });
    const cancelBtn = buttonRow.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.close());
    const exportBtn = buttonRow.createEl("button", { text: "Export", cls: "mod-cta" });
    exportBtn.addEventListener("click", () => {
      this.submitted = true;
      this.resolve({ ...this.options });
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.submitted) this.resolve(null);
  }
}

import {
  Plugin,
  MarkdownPostProcessorContext,
  MarkdownView,
  Modal,
  TFile,
  TFolder,
  Notice,
  Platform,
  editorInfoField,
  editorLivePreviewField,
} from "obsidian";
import { ViewPlugin, Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder, StateField, StateEffect, Prec } from "@codemirror/state";
import type { Extension, Text, EditorState } from "@codemirror/state";
import { Highlighter, EXT_TO_LANG } from "./highlighter";
import { CodeSettingTab } from "./settings-tab";
import { startExecution, isExecutable, type RunningProcess } from "./executor";
import {
  type CodePluginSettings,
  DEFAULT_SETTINGS,
} from "./settings";
import { CodeFileView, CODE_FILE_VIEW_TYPE } from "./code-file-view";
import {
  type VarValue,
  type VarEntry,
  parseVarsSource,
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
};

const CODE_FILE_EXTENSIONS = new Set(Object.keys(EXT_TO_LANG));

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

/** A fenced code block located in an editor document, with absolute positions. */
interface FencedBlock {
  /** Raw language token from the opening fence info string (may be ""). */
  lang: string;
  /** Full opening fence info string (everything after the backticks, trimmed). */
  info: string;
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
  let openFrom = 0;
  let innerLines: { text: string; from: number }[] = [];
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const trimmed = line.text.trimStart();
    if (!inBlock && trimmed.startsWith("```")) {
      inBlock = true;
      info = trimmed.slice(3).trim();
      lang = info.split(/\s/)[0];
      openFrom = line.from;
      innerLines = [];
    } else if (inBlock && /^`{3,}\s*$/.test(trimmed)) {
      blocks.push({
        lang,
        info,
        openFrom,
        closeTo: line.to,
        innerLines: [...innerLines],
        code: innerLines.map((l) => l.text).join("\n"),
      });
      inBlock = false;
      lang = "";
      info = "";
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
   * { varName → { value, lang } }.
   */
  private noteLiveVars: Map<string, Map<string, { value: VarValue; lang: string }>> = new Map();
  /** Tracks which MarkdownView instances have already had view-header actions added. */
  private viewActionsAdded = new WeakSet<MarkdownView>();
  /** All action buttons added to view headers — removed in onunload so plugin reloads don't duplicate them. */
  private viewActionEls: HTMLElement[] = [];

  /** Monotonically increasing counter — refreshHighlighter checks this to bail if superseded */
  private _refreshSeq = 0;
  /** Debounce timer for auto-theme switching (css-change can fire many times per mode switch) */
  private _autoThemeTimer: number | null = null;
  /** Debounce timer for queued skip-badge sync passes. */
  private _skipSyncTimer: number | null = null;
  /** True when no persisted data existed at load — i.e. a genuinely fresh install. */
  private _isFreshInstall = false;

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
    // them and force each editor's block-widget field to rebuild.
    this.lpWrapperCache.clear();
    this.forceLpRebuild();
    // Re-render all open reading views so post-processors re-run with new theme
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.getMode() === "preview") {
        view.previewMode.rerender(true);
      }
    });
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
      s.inlineCollapsible,
      s.inlineCollapsedByDefault,
      s.collapseEmbeds,
      s.renderEmbeddedFiles,
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
      for (const block of scanFencedBlocks(doc)) {
        const rawLang = (block.lang || "").toLowerCase();
        if (PASSTHROUGH_LANGS.has(rawLang)) continue;

        const attrs = new Set(
          block.info.split(/\s+/).slice(1).map((w) => w.toLowerCase()).filter(Boolean)
        );
        const forceSkip = attrs.has("skip");
        const forceCollapsed: boolean | null =
          attrs.has("collapsed") ? true : attrs.has("expanded") ? false : null;

        const isVars = rawLang === "vars";
        const resolvedLang = isVars ? "vars" : this.highlighter.resolveLanguage(block.lang);
        const key = `${this.lpBlockKey(resolvedLang, block.code)}\0${forceSkip}\0${forceCollapsed}\0${sig}`;
        // Register the key BEFORE the cursor check so a block being edited (or
        // running) is never pruned out from under its live output / process.
        liveKeys.add(key);

        // Cursor inside (incl. fence lines) → reveal raw source for editing.
        if (overlapsSelection(block.openFrom, block.closeTo)) continue;

        const code = block.code;
        const resolve = (): HTMLElement | null =>
          this.getCachedLpWrapper(notePath, key, () =>
            isVars
              ? this.buildVarsWrapper(code, notePath)
              : this.buildCodeBlockWrapper(
                  code, resolvedLang, block.lang, undefined, notePath, forceSkip, forceCollapsed,
                )
          );

        items.push({
          from: block.openFrom,
          to: block.closeTo,
          deco: Decoration.replace({ block: true, widget: new CodeBlockWidget(key, resolve) }),
        });
      }

      // ─── Embedded code files: `![[file.py]]` on its own line ───
      if (this.settings.renderEmbeddedFiles) {
        const embedRe = /^!\[\[([^\]|]+?\.[a-zA-Z0-9]+)(?:\|[^\]]*)?\]\]$/;
        for (let i = 1; i <= doc.lines; i++) {
          const line = doc.line(i);
          const m = line.text.trim().match(embedRe);
          if (!m) continue;
          const ext = (m[1].match(/\.[a-zA-Z0-9]+$/)?.[0] ?? "").toLowerCase();
          if (!CODE_FILE_EXTENSIONS.has(ext)) continue;
          const file = this.app.metadataCache.getFirstLinkpathDest(m[1], notePath);
          if (!(file instanceof TFile)) continue;

          const key = `embed\0${file.path}\0${sig}`;
          liveKeys.add(key);
          if (overlapsSelection(line.from, line.to)) continue;
          const resolve = (): HTMLElement | null =>
            this.getCachedLpWrapper(notePath, key, () => {
              const container = createDiv({ cls: "ocode-embed-container" });
              void this.populateEmbedContainer(container, file, ext, notePath);
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
      this.viewActionEls.push(
        view.addAction("play-circle", "Run all code blocks", () => {
          void this.runAllBlocks(view);
        })
      );
    }
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
   * Parse the current note source and return a skip-state boolean for each
   * executable fenced code block (in source order). Used by runAllBlocks so
   * that skip markers added/removed since the last reading-view render are
   * honoured without requiring a note reopen (fixes GitHub issue #15).
   */
  private parseSkipStatesFromSource(source: string): boolean[] {
    const PASSTHROUGH = new Set(["mermaid", "dataview", "dataviewjs", "query"]);
    const states: boolean[] = [];
    const lines = source.split("\n");
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const fenceMatch = line.match(/^([`~]{3,})(.*)/);
      if (!fenceMatch) { i++; continue; }
      const fenceChar = fenceMatch[1][0];
      const fenceLen  = fenceMatch[1].length;
      const infoStr   = fenceMatch[2].trim();
      const parts     = infoStr.split(/\s+/);
      const rawLang   = (parts[0] ?? "").toLowerCase();
      const forceSkip = parts.slice(1).map((w) => w.toLowerCase()).includes("skip");
      // Collect block content
      const contentLines: string[] = [];
      i++;
      while (i < lines.length) {
        const l = lines[i];
        const cm = l.match(/^([`~]{3,})(.*)/);
        if (cm && cm[1][0] === fenceChar && cm[1].length >= fenceLen && cm[2].trim() === "") {
          i++; break; // consume closing fence
        }
        contentLines.push(l);
        i++;
      }
      // Apply the same filters as processCodeBlocks: skip passthrough langs,
      // vars blocks, and non-executable languages (those don't get Run buttons).
      if (PASSTHROUGH.has(rawLang) || rawLang === "vars") continue;
      const resolvedLang = this.highlighter.resolveLanguage(rawLang);
      if (!isExecutable(resolvedLang)) continue;
      states.push(forceSkip || blockHasSkipMarker(contentLines.join("\n")));
    }
    return states;
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
    const skipStates = this.parseSkipStatesFromSource(source);
    // Scope to the reading view only. Live Preview widgets bake their skip
    // badge in at build time, and the cursor's block has no widget — including
    // them here would misalign the source-parsed skip-state index.
    const wrappers = Array.from(
      view.contentEl.querySelectorAll<HTMLElement>('.markdown-reading-view .ocode-wrapper[data-ocode-fenced="1"]')
    );
    let idx = 0;
    for (const wrapper of wrappers) {
      const shouldSkip = idx < skipStates.length
        ? skipStates[idx]
        : wrapper.classList.contains("ocode-skip-run-all");
      idx++;
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
   */
  private async runAllBlocks(view: MarkdownView): Promise<void> {
    // Run All operates on the reading view (deterministic block order with no
    // cursor-revealed gaps). Live Preview blocks have their own Run buttons.
    const runBtns = Array.from(
      view.contentEl.querySelectorAll<HTMLButtonElement>(".markdown-reading-view .ocode-run-pill")
    );
    if (runBtns.length === 0) {
      new Notice("No executable code blocks found. Switch to reading view first.");
      return;
    }
    // Sync badges first so the visual state is correct before we start running.
    this.syncSkipBadges(view);
    const skipStates = this.parseSkipStatesFromSource(view.getViewData());
    let ran = 0;
    let fencedIdx = 0;
    for (const btn of runBtns) {
      const wrapper = btn.closest<HTMLElement>(".ocode-wrapper");
      if (!wrapper) continue;
      // Embedded file blocks are not present in the note source and are
      // excluded from skipStates — fall back to their DOM class.
      // All other (inline fenced) blocks use the live-parsed state. We check
      // ocode-embedded rather than data-ocode-fenced so this works even for
      // blocks rendered before the attribute was introduced (fixes #15).
      let shouldSkip: boolean;
      if (!wrapper.classList.contains("ocode-embedded")) {
        // Inline fenced block — use source-parsed state.
        shouldSkip = fencedIdx < skipStates.length
          ? skipStates[fencedIdx]
          : wrapper.classList.contains("ocode-skip-run-all");
        // Advance BEFORE the cancel-pill check so already-running blocks still
        // consume their slot in skipStates (they exist in the source too).
        fencedIdx++;
      } else {
        // Embedded file block — fall back to DOM class.
        shouldSkip = wrapper.classList.contains("ocode-skip-run-all");
      }
      if (btn.classList.contains("ocode-cancel-pill")) continue; // already running
      if (shouldSkip) continue;
      btn.click();
      ran++;
      // runCode runs synchronously up to its first await, so runningProcs.set()
      // is already called by the time btn.click() returns. Poll for completion.
      await new Promise<void>((resolve) => {
        const deadline = Date.now() + 120_000; // 2-min safety timeout
        const poll = () => {
          if (!this.runningProcs.has(wrapper) || Date.now() > deadline) {
            resolve();
          } else {
            window.setTimeout(poll, 150);
          }
        };
        window.setTimeout(poll, 150);
      });
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
      // Brief pause so the shared-context store is fully committed and any
      // rapid-fire OS process startup races are avoided before the next block.
      await new Promise<void>((resolve) => window.setTimeout(resolve, 500));
    }
    if (ran === 0) new Notice("All code blocks are currently running.");
  }

  /**
   * After a run, record the variables a block *changed* into the live
   * cross-language namespace. A var whose post-run value equals what we seeded
   * is treated as untouched (so a pure reader doesn't claim ownership or
   * degrade a value's type on a round-trip). Shell-produced values are
   * re-inferred since shells stringify everything.
   */
  private recordRuntimeVars(
    notePath: string,
    lang: string,
    snapshot: Record<string, unknown>,
    seeded: Record<string, VarValue>
  ): void {
    if (!this.noteLiveVars.has(notePath)) this.noteLiveVars.set(notePath, new Map());
    const live = this.noteLiveVars.get(notePath)!;
    const isShell = lang === "bash" || lang === "zsh" || lang === "shell";
    for (const [name, raw] of Object.entries(snapshot)) {
      const seededVal = seeded[name];
      if (seededVal !== undefined) {
        // Compare against the exact form the language was given. Shells stringify
        // everything, so compare scalar strings; typed languages compare values.
        const unchanged = isShell
          ? String(raw) === toShellScalar(seededVal)
          : JSON.stringify(raw) === JSON.stringify(toJs(seededVal));
        if (unchanged) continue; // pure read — don't claim ownership or change type
      }
      const value = isShell ? inferVarValue(String(raw)) : fromJsValue(raw);
      live.set(name, { value, lang });
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
   *   2. replay      — the current language's earlier blocks, run with output
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
        "__ocode_prev_out, __ocode_prev_err = __sys.stdout, __sys.stderr",
        "__sys.stdout = __sys.stderr = __ocode_null",
        // Suppress matplotlib plot saves during replay
        "try:",
        "    __ocode_plt_bak = __plt.show; __plt.show = lambda *a,**kw: None",
        "except Exception: pass",
        // Suppress plotly saves during replay
        "try:",
        "    import plotly.io as __ocode_pio; __ocode_pio_bak = __ocode_pio.show; __ocode_pio.show = lambda *a,**kw: None",
        "except Exception: pass",
        "try:",
        indented,
        "finally:",
        "    __sys.stdout = __ocode_prev_out",
        "    __sys.stderr = __ocode_prev_err",
        "    __ocode_null.close()",
        "    del __ocode_null, __ocode_prev_out, __ocode_prev_err",
        "    try: __plt.show = __ocode_plt_bak; del __ocode_plt_bak",
        "    except Exception: pass",
        "    try: __ocode_pio.show = __ocode_pio_bak; del __ocode_pio, __ocode_pio_bak",
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
      return (
        `${bashSeed}` +
        `exec 3>&1 4>&2 1>/dev/null 2>&1\n` +
        `${accum}\n` +
        `exec 1>&3 2>&4 3>&- 4>&-\n\n` +
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
      const lines = sectionInfo.text.split("\n");
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

      this.renderCodeBlock(pre, code, lang, rawLang, undefined, ctx.sourcePath, forceSkip, forceCollapsed);
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
    const raw = fm["code_vars"];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    const notePath = ctx.sourcePath;
    if (!notePath) return;

    if (!this.noteVarStore.has(notePath)) this.noteVarStore.set(notePath, {});
    if (!this.noteVarsBlockStore.has(notePath)) this.noteVarsBlockStore.set(notePath, {});
    const varStore = this.noteVarStore.get(notePath)!;
    const seedStore = this.noteVarsBlockStore.get(notePath)!;

    let changed = false;
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k)) continue;
      const typed = fromJsValue(v);
      // Only seed if not already present (block-level vars take precedence).
      if (!(k in seedStore)) { seedStore[k] = typed; changed = true; }
      if (!(k in varStore))  { varStore[k]  = toDisplay(typed); changed = true; }
    }
    if (changed) this.updateInlineVarRefs(notePath, varStore);
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
  ) {
    const wrapper = this.buildCodeBlockWrapper(
      code, lang, displayLang, fileName, sourcePath, forceSkip, forceCollapsed,
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

    // ─── Inline collapsible (reading view) ───
    // `fileName` is only set for embedded files — they already get the embed
    // collapse handler in renderEmbeddedFile, so we don't duplicate it here.
    // Per-block `collapsed` / `expanded` attributes override the global default.
    if (!fileName) {
      const enabled = this.settings.inlineCollapsible || forceCollapsed !== null;
      if (enabled) {
        const initiallyCollapsed = forceCollapsed ?? this.settings.inlineCollapsedByDefault;
        this.makeCollapsible(wrapper, initiallyCollapsed);
      }
    }

    // Mark inline executable blocks so badge-sync logic can align them with the
    // source-parsed skip-state array. Embedded files, vars blocks, and other
    // non-runnable code blocks are excluded because parseSkipStatesFromSource()
    // does not count them.
    if (!fileName && isExecutable(lang)) {
      wrapper.setAttribute("data-ocode-fenced", "1");
    }
    return wrapper;
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
    btn.addEventListener("click", onClick);
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
    // If already running, this is a cancel click
    const existingProc = this.runningProcs.get(wrapper);
    if (existingProc) {
      existingProc.cancel();
      return;
    }

    // ─── Shared context ───────────────────────────────────────────
    const useSharedCtx =
      this.settings.sharedContext &&
      sourcePath !== undefined &&
      CodePlugin.SHARED_CTX_LANGS.has(lang);

    // Build the code to actually execute (may prepend accumulated blocks).
    // preSeeds  = declared initials (injected before replay).
    // postSeeds = values another language changed (injected after replay, so
    //             they win over this language's own earlier assignments).
    // effectiveSeeds (their merge) is captured so the snapshot handler can tell
    // which variables a block actually *changed* vs. just read.
    let execCode = code;
    const preSeeds  = useSharedCtx ? (this.noteVarsBlockStore.get(sourcePath) ?? {}) : {};
    const postSeeds: Record<string, VarValue> = {};
    if (useSharedCtx) {
      const live = this.noteLiveVars.get(sourcePath);
      if (live) for (const [name, entry] of live) if (entry.lang !== lang) postSeeds[name] = entry.value;
    }
    const effectiveSeeds: Record<string, VarValue> = { ...preSeeds, ...postSeeds };
    if (useSharedCtx) {
      // Exclude the current block from its own replay so re-running it doesn't
      // double-apply (the block runs once, after replaying the blocks before it).
      const prevBlocks = (this.noteContexts.get(sourcePath)?.get(lang) ?? []).filter((b) => b !== code);
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

    // Scrollable text content area
    const outContent = createEl("pre");
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

    // For Python shared context: buffer stdout line-by-line to intercept the
    // __OCODE_VARS__ snapshot line without disrupting live streaming.
    let stdoutLineBuffer = "";
    const appendStdout = (text: string) => {
      const span = createSpan();
      span.className = "ocode-stdout";
      span.textContent = text;
      outContent.appendChild(span);
      outContent.scrollTop = outContent.scrollHeight;
    };

    const proc = startExecution(execCode, lang, this.settings, {
      onStdout: (data) => {
        if (useSharedCtx) {
          // Buffer to cleanly strip the __OCODE_VARS__ line from streamed output
          stdoutLineBuffer += data;
          const lines = stdoutLineBuffer.split("\n");
          stdoutLineBuffer = lines.pop()!; // last (possibly incomplete) chunk
          for (const line of lines) {
            if (line.startsWith("__OCODE_VARS__=")) {
              try {
                const vars = JSON.parse(line.slice("__OCODE_VARS__=".length)) as Record<string, unknown>;
                // Record any var this block changed into the live cross-language
                // namespace, then refresh inline $varname display from it.
                this.recordRuntimeVars(sourcePath, lang, vars, effectiveSeeds);
                this.refreshDisplayVars(sourcePath);
              } catch { /* ignore parse failures */ }
            } else {
              appendStdout(line + "\n");
            }
          }
        } else {
          appendStdout(data);
        }
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
        if (!stdoutLineBuffer.startsWith("__OCODE_VARS__=")) {
          appendStdout(stdoutLineBuffer);
        }
        stdoutLineBuffer = "";
      }

      // Process finished — remove input bar
      inputBar.remove();

      // Update label
      outLabel.textContent = result.killed
        ? "Output (timed out)"
        : result.exitCode === 0
        ? "Output"
        : `Output (exit: ${result.exitCode})`;

      // When the process failed, colour stderr red so it stands out as an error.
      // On success, stderr stays orange (it may carry informational/progress text).
      if (!result.killed && result.exitCode !== 0 && result.exitCode !== null) {
        outContent.classList.add("ocode-has-error");
      }

      // Copy-output button — copies the rendered stdout/stderr text from the panel.
      // Reads from the DOM so we always include exactly what the user sees
      // (with the __OCODE_VARS__ snapshot line already stripped).
      const copyOutBtn = this.createPillButton("", ICON.copy, () => {
        const text = outContent.textContent || "";
        void navigator.clipboard.writeText(text).then(() => {
          setSvgContent(copyOutBtn.querySelector(".ocode-pill-icon")!, ICON.check);
          window.setTimeout(() => {
            setSvgContent(copyOutBtn.querySelector(".ocode-pill-icon")!, ICON.copy);
          }, 2000);
        });
      });
      copyOutBtn.classList.add("ocode-copy-out-pill");
      outHeader.insertBefore(copyOutBtn, clearBtn);

      // Add copy-error button if there was meaningful stderr
      // Strip the sudo password prompt line — it's not an error
      const errorText = stderrText.replace(/^Password:\s*/m, "").trim();
      if (errorText) {
        const copyErrBtn = this.createPillButton("", ICON.copy, () => {
          void navigator.clipboard.writeText(errorText).then(() => {
            setSvgContent(copyErrBtn.querySelector(".ocode-pill-icon")!, ICON.check);
            window.setTimeout(() => {
              setSvgContent(copyErrBtn.querySelector(".ocode-pill-icon")!, ICON.copy);
            }, 2000);
          });
        });
        copyErrBtn.classList.add("ocode-copy-err-pill");
        // Insert before the clear button
        outHeader.insertBefore(copyErrBtn, clearBtn);
      }

      // Add images (before text content)
      if (result.images.length > 0) {
        const imgContainer = createDiv();
        imgContainer.className = "ocode-output-images";
        for (const base64 of result.images) {
          const img = createEl("img");
          img.src = `data:image/png;base64,${base64}`;
          img.className = "ocode-output-img";
          imgContainer.appendChild(img);
        }
        outputPanel.insertBefore(imgContainer, outContent);
      }

      // If no output at all
      if (!outContent.childNodes.length && result.images.length === 0) {
        outContent.textContent = "(no output)";
        outContent.classList.add("ocode-no-output");
      }

      // Hide text area if only images, no text
      if (!outContent.childNodes.length && result.images.length > 0) {
        outContent.classList.add("ocode-hidden");
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

      void this.renderEmbeddedFile(embed as HTMLElement, file, ext, ctx.sourcePath);
    }
  }

  private async renderEmbeddedFile(embedEl: HTMLElement, file: TFile, ext: string, sourcePath?: string) {
    // Replace the .internal-embed element with a plain container so
    // Obsidian's click-to-open handler is completely severed.
    const container = createDiv();
    container.className = "ocode-embed-container";
    embedEl.replaceWith(container);
    await this.populateEmbedContainer(container, file, ext, sourcePath);
  }

  /**
   * Read `file`, render its contents as an embedded code block, and append the
   * resulting `ocode-wrapper` into `container`. Shared by the reading-view
   * embed post-processor ({@link renderEmbeddedFile}) and the Live Preview
   * embed widget. The read is async, so callers get a synchronously-returned
   * (empty) container that fills in once the file is read.
   */
  private async populateEmbedContainer(container: HTMLElement, file: TFile, ext: string, sourcePath?: string) {
    const code = await this.app.vault.read(file);
    const lang = this.highlighter.resolveExtension(ext);

    const wrapper = this.buildCodeBlockWrapper(code, lang, lang, file.name, sourcePath);
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

    // Collapsible behaviour — uses the shared helper. Inline blocks may have
    // already had a collapse toggle attached (via inlineCollapsible), but
    // makeCollapsible no-ops when an arrow is already present, so this is safe.
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

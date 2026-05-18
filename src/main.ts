import {
  Plugin,
  MarkdownPostProcessorContext,
  MarkdownView,
  TFile,
  TFolder,
  Notice,
  Platform,
} from "obsidian";
import { ViewPlugin, Decoration, EditorView } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { Highlighter, EXT_TO_LANG } from "./highlighter";
import { CodeSettingTab } from "./settings-tab";
import { startExecution, isExecutable, type RunningProcess } from "./executor";
import {
  type CodePluginSettings,
  DEFAULT_SETTINGS,
} from "./settings";
import { CodeFileView, CODE_FILE_VIEW_TYPE } from "./code-file-view";

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
 *   /* codesuite:skip *​/   (any C-style)
 */
const SKIP_MARKER_RE = /^\s*(?:#|\/\/|--|%|\/\*)\s*codesuite\s*:\s*skip(?:[\s*/]|$)/i;
function blockHasSkipMarker(code: string): boolean {
  for (const raw of code.split("\n")) {
    if (!raw.trim()) continue;
    return SKIP_MARKER_RE.test(raw);
  }
  return false;
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
   * Shared execution context. Maps note path → language → ordered list of
   * previously-executed code blocks. In-memory only; cleared on unload.
   */
  private noteContexts: Map<string, Map<string, string[]>> = new Map();
  /** Latest variable snapshot per note (Python only). Maps note path → {varName: displayValue}. */
  private noteVarStore: Map<string, Record<string, string>> = new Map();
  /** Variables declared in ```vars blocks — injected into code execution as seed assignments. */
  private noteVarsBlockStore: Map<string, Record<string, string>> = new Map();
  /** Tracks which MarkdownView instances have already had view-header actions added. */
  private viewActionsAdded = new WeakSet<MarkdownView>();
  /** All action buttons added to view headers — removed in onunload so plugin reloads don't duplicate them. */
  private viewActionEls: HTMLElement[] = [];

  /** Monotonically increasing counter — refreshHighlighter checks this to bail if superseded */
  private _refreshSeq = 0;
  /** Debounce timer for auto-theme switching (css-change can fire many times per mode switch) */
  private _autoThemeTimer: ReturnType<typeof setTimeout> | null = null;

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

    // Apply theme CSS variables
    this.applyThemeColors();

    // Auto-theme: re-apply whenever Obsidian's dark/light mode changes
    this.registerEvent(
      this.app.workspace.on("css-change", () => {
        void this.applyAutoTheme();
      })
    );

    // Editor (CM6): Shiki-based syntax highlighting via ViewPlugin
    this.registerEditorExtension([
      this.buildShikiEditorExtension(),
    ]);

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
  }

  onunload() {
    if (this._autoThemeTimer !== null) {
      activeWindow.clearTimeout(this._autoThemeTimer);
      this._autoThemeTimer = null;
    }
    // Kill all running processes
    for (const proc of this.runningProcs.values()) {
      proc.cancel();
    }
    this.runningProcs.clear();
    this.highlighter.dispose();
    activeDocument.body.removeClass("ocode-wide-blocks");
    // Remove all view-header action buttons so a plugin reload doesn't duplicate them.
    for (const el of this.viewActionEls) el.remove();
    this.viewActionEls = [];
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
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
    // Re-render all open reading views so post-processors re-run with new theme
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
      activeWindow.clearTimeout(this._autoThemeTimer);
    }
    this._autoThemeTimer = activeWindow.setTimeout(() => {
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

          // Collect all code blocks from the full document
          const blocks: { lang: string; lines: { text: string; from: number }[] }[] = [];
          let inBlock = false;
          let blockLang = "";
          let codeLines: { text: string; from: number }[] = [];

          for (let i = 1; i <= doc.lines; i++) {
            const line = doc.line(i);
            const trimmed = line.text.trimStart();

            if (!inBlock && trimmed.startsWith("```")) {
              inBlock = true;
              blockLang = trimmed.slice(3).trim().split(/\s/)[0];
              codeLines = [];
            } else if (inBlock && /^`{3,}\s*$/.test(trimmed)) {
              if (codeLines.length > 0 && blockLang) {
                blocks.push({ lang: blockLang, lines: [...codeLines] });
              }
              inBlock = false;
              blockLang = "";
              codeLines = [];
            } else if (inBlock) {
              codeLines.push({ text: line.text, from: line.from });
            }
          }

          for (const block of blocks) {
            const lang = resolveLanguage(block.lang);
            const code = block.lines.map((l) => l.text).join("\n");

            const tokens = tokenize(code, lang, getTheme());
            if (!tokens) continue;

            for (let lineIdx = 0; lineIdx < block.lines.length; lineIdx++) {
              const codeLine = block.lines[lineIdx];

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

  // ─── Shared Execution Context ────────────────────────────────

  /** Languages that support shared context (prepend-and-suppress approach). */
  private static readonly SHARED_CTX_LANGS = new Set(["python", "bash", "zsh", "shell"]);

  /** Clear accumulated context, var store, and inline var DOM state for a note. */
  private clearNoteSession(notePath: string): void {
    this.noteContexts.delete(notePath);
    this.noteVarStore.delete(notePath);
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

  /**
   * Add "Run All" and "Clear Session" icon buttons to a MarkdownView's header.
   * Each view only receives the actions once (tracked via WeakSet).
   */
  private ensureViewActions(view: MarkdownView): void {
    if (this.viewActionsAdded.has(view)) return;
    // DOM guard: previous plugin load may have left buttons behind (plugin reload/update).
    if (view.containerEl.querySelector('[aria-label="Clear execution session"]')) return;
    this.viewActionsAdded.add(view);

    this.viewActionEls.push(
      view.addAction("rotate-ccw", "Clear execution session", () => {
        const file = view.file;
        if (file) {
          this.clearNoteSession(file.path);
          new Notice("Execution session cleared.");
        }
      })
    );

    if (this.settings.enableExecution && Platform.isDesktop) {
      this.viewActionEls.push(
        view.addAction("play-circle", "Run all code blocks", () => {
          void this.runAllBlocks(view);
        })
      );
    }
  }

  /**
   * Run every executable code block in the view sequentially, waiting for each
   * to finish before starting the next (so shared context accumulates in order).
   */
  private async runAllBlocks(view: MarkdownView): Promise<void> {
    const runBtns = Array.from(
      view.contentEl.querySelectorAll<HTMLButtonElement>(".ocode-run-pill")
    );
    if (runBtns.length === 0) {
      new Notice("No executable code blocks found. Switch to Reading view first.");
      return;
    }
    let ran = 0;
    for (const btn of runBtns) {
      if (btn.classList.contains("ocode-cancel-pill")) continue; // already running
      const wrapper = btn.closest<HTMLElement>(".ocode-wrapper");
      if (!wrapper) continue;
      // Skip blocks marked with the "codesuite:skip" comment marker
      if (wrapper.classList.contains("ocode-skip-run-all")) continue;
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
            activeWindow.setTimeout(poll, 150);
          }
        };
        activeWindow.setTimeout(poll, 150);
      });
      // Stop Run All if the block exited with an error so later blocks don't
      // run against incomplete shared context and produce confusing failures.
      const label = wrapper.querySelector<HTMLElement>(".ocode-output-label");
      if (label) {
        const t = label.textContent ?? "";
        if (t.startsWith("Output (exit:") || t === "Output (timed out)") {
          new Notice("Run All stopped: a block exited with an error.");
          return;
        }
      }
      // Brief pause so the shared-context store is fully committed and any
      // rapid-fire OS process startup races are avoided before the next block.
      await new Promise<void>((resolve) => activeWindow.setTimeout(resolve, 500));
    }
    if (ran === 0) new Notice("All code blocks are currently running.");
  }

  /**
   * Build the full execution script for a shared-context run.
   * Previous blocks are prepended with their stdout/stderr suppressed so they
   * re-establish variables silently. Only the current block produces visible output.
   */
  private buildSharedContextCode(
    lang: string,
    prevBlocks: string[],
    currentBlock: string,
    seedVars?: Record<string, string>
  ): string {
    const accum = prevBlocks.join("\n\n");

    // Build language-specific seed-var assignment lines from the vars block store
    const pythonSeedLines: string[] = [];
    const bashSeedLines: string[] = [];
    if (seedVars) {
      for (const [k, v] of Object.entries(seedVars)) {
        pythonSeedLines.push(`${k} = ${JSON.stringify(String(v))}`);
        bashSeedLines.push(`${k}='${String(v).replace(/'/g, "'\\''")}' `);
      }
    }
    const pythonSeed = pythonSeedLines.length ? pythonSeedLines.join("\n") + "\n" : "";
    const bashSeed   = bashSeedLines.length   ? bashSeedLines.join("\n")   + "\n" : "";

    if (lang === "python") {
      // Fast path: only seed vars, no accumulated blocks
      if (!accum.trim()) return pythonSeed + currentBlock;

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
        currentBlock,
      ].join("\n");
    }

    if (lang === "bash" || lang === "zsh" || lang === "shell") {
      // Fast path: only seed vars, no accumulated blocks
      if (!accum.trim()) return bashSeed + currentBlock;
      // Use exec-based fd swapping to run the preamble silently. This is more
      // reliable than { } > /dev/null 2>&1 because it avoids nested-brace
      // parser edge cases (e.g. functions with complex bodies or heredocs) and
      // guarantees function definitions are available in the current shell scope.
      return (
        `${bashSeed}` +
        `exec 3>&1 4>&2 1>/dev/null 2>&1\n` +
        `${accum}\n` +
        `exec 1>&3 2>&4 3>&- 4>&-\n\n` +
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
   * Bash postamble: emit non-builtin, non-environment variables as JSON.
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
    } catch (_e) {
      // Some extensions may already be claimed by another plugin — Obsidian
      // throws in that case. Fall back to per-extension registration so we
      // still grab everything we can.
      for (const e of exts) {
        try { this.registerExtensions([e], CODE_FILE_VIEW_TYPE); } catch (_err) { /* skip taken extension */ }
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
    const nodeRequire = (globalThis as unknown as { require: (id: string) => unknown }).require;
    const fs = nodeRequire("fs") as typeof import("fs");
    const path = nodeRequire("path") as typeof import("path");

    // Use a hidden <input type="file"> to spawn the OS file picker. In Electron
    // the resulting File object exposes the absolute path via `.path`.
    const externalPath = await new Promise<string | null>((resolve) => {
      const input = createEl("input");
      input.type = "file";
      input.style.display = "none";
      input.addEventListener("change", () => {
        const f = input.files?.[0] as (File & { path?: string }) | undefined;
        const p = f?.path;
        input.remove();
        resolve(p ?? null);
      });
      // If the user cancels there is no change event — clean up via focus.
      activeWindow.setTimeout(() => {
        activeDocument.body.addEventListener("focus", function once() {
          activeDocument.body.removeEventListener("focus", once, true);
          activeWindow.setTimeout(() => { if (input.isConnected) { input.remove(); resolve(null); } }, 300);
        }, true);
      }, 0);
      activeDocument.body.appendChild(input);
      input.click();
    });

    if (!externalPath) return;

    const ext = path.extname(externalPath).toLowerCase();
    if (!CODE_FILE_EXTENSIONS.has(ext)) {
      new Notice(`Unsupported file type: ${ext || "(no extension)"}.`);
      return;
    }

    const vaultPath = (this.app.vault.adapter as unknown as { basePath: string }).basePath;
    const folderRel = (this.settings.codeImportsFolder || "CodeSuiteImports").replace(/^\/+|\/+$/g, "");

    // Make sure the destination folder exists both on disk and as a TFolder.
    const folder = this.app.vault.getAbstractFileByPath(folderRel);
    if (!folder) {
      try { await this.app.vault.createFolder(folderRel); } catch (_e) { /* race-safe: folder may have appeared between checks */ }
    } else if (!(folder instanceof TFolder)) {
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

    // Trigger a vault refresh so the symlink shows up immediately, then open it.
    new Notice(`Aliased "${baseName}" → ${targetRel}`);
    // Give the vault a tick to pick up the new file.
    activeWindow.setTimeout(() => {
      const tfile = this.app.vault.getAbstractFileByPath(targetRel);
      if (tfile instanceof TFile) {
        void this.app.workspace.getLeaf().openFile(tfile);
      }
    }, 200);
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

    for (const codeEl of Array.from(codeBlocks)) {
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
      const PASSTHROUGH_LANGS = new Set(["mermaid", "dataview", "dataviewjs", "query"]);
      if (PASSTHROUGH_LANGS.has(rawLang.toLowerCase())) continue;

      // `vars` blocks define note-scoped variables inline — parse and store immediately.
      if (rawLang.toLowerCase() === "vars") {
        this.renderVarsBlock(pre, codeEl.textContent || "", ctx.sourcePath);
        continue;
      }

      const lang = this.highlighter.resolveLanguage(rawLang);
      const code = codeEl.textContent || "";

      this.renderCodeBlock(pre, code, lang, rawLang, undefined, ctx.sourcePath);
    }
  }

  /**
   * Render a ```vars block using the same ocode-wrapper / Shiki structure as a
   * regular code block. Variables are seeded into noteVarStore (for inline
   * $varname spans) and noteVarsBlockStore (for injection into code execution).
   * Syntax: one `key = value` (or `key: value`) assignment per line; blank
   * lines and lines starting with `#` are ignored.
   */
  private renderVarsBlock(originalPre: HTMLElement, source: string, sourcePath: string): void {
    const entries: Array<[string, string]> = [];
    for (const raw of source.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const sep = line.indexOf("=") !== -1
        ? line.indexOf("=")
        : line.indexOf(":");
      if (sep === -1) continue;
      const key = line.slice(0, sep).trim();
      const val = line.slice(sep + 1).trim();
      if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) entries.push([key, val]);
    }

    // Seed both stores
    if (entries.length && sourcePath) {
      if (!this.noteVarStore.has(sourcePath)) this.noteVarStore.set(sourcePath, {});
      const store = this.noteVarStore.get(sourcePath)!;
      for (const [k, v] of entries) store[k] = v;
      this.updateInlineVarRefs(sourcePath, store);

      if (!this.noteVarsBlockStore.has(sourcePath)) this.noteVarsBlockStore.set(sourcePath, {});
      const varsStore = this.noteVarsBlockStore.get(sourcePath)!;
      for (const [k, v] of entries) varsStore[k] = v;
    }

    // Format as INI-style assignments for Shiki highlighting (values unquoted, as written)
    const displayCode = entries.length
      ? entries.map(([k, v]) => `${k} = ${v}`).join("\n")
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
        activeWindow.setTimeout(() => {
          setSvgContent(copyBtn.querySelector(".ocode-pill-icon")!, ICON.copy);
          copyBtn.querySelector(".ocode-pill-text")!.textContent = "Copy";
        }, 2000) as unknown as number;
      });
    });
    btnGroup.appendChild(copyBtn);

    // Apply — re-seeds both stores (useful after clearing a session)
    const applyBtn = this.createPillButton("Apply", ICON.reload, () => {
      if (entries.length && sourcePath) {
        if (!this.noteVarStore.has(sourcePath)) this.noteVarStore.set(sourcePath, {});
        const store = this.noteVarStore.get(sourcePath)!;
        for (const [k, v] of entries) store[k] = v;
        this.updateInlineVarRefs(sourcePath, store);

        if (!this.noteVarsBlockStore.has(sourcePath)) this.noteVarsBlockStore.set(sourcePath, {});
        const varsStore = this.noteVarsBlockStore.get(sourcePath)!;
        for (const [k, v] of entries) varsStore[k] = v;
      }
      setSvgContent(applyBtn.querySelector(".ocode-pill-icon")!, ICON.check);
      applyBtn.querySelector(".ocode-pill-text")!.textContent = "Applied";
      activeWindow.setTimeout(() => {
        setSvgContent(applyBtn.querySelector(".ocode-pill-icon")!, ICON.reload);
        applyBtn.querySelector(".ocode-pill-text")!.textContent = "Apply";
      }, 1500) as unknown as number;
    });
    btnGroup.appendChild(applyBtn);

    header.appendChild(btnGroup);
    wrapper.insertBefore(header, wrapper.firstChild);

    originalPre.replaceWith(wrapper);
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
      const str = v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
      // Only seed if not already present (block-level vars take precedence).
      if (!(k in seedStore)) { seedStore[k] = str; changed = true; }
      if (!(k in varStore))  { varStore[k]  = str; changed = true; }
    }
    if (changed) this.updateInlineVarRefs(notePath, varStore);
  }

  private renderCodeBlock(
    originalPre: HTMLElement,
    code: string,
    lang: string,
    displayLang: string,
    fileName?: string,
    sourcePath?: string
  ) {
    const html = this.highlighter.highlight(code, lang, this.settings.theme);
    if (!html) return;

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

    const spacer = createSpan();
    spacer.className = "ocode-spacer";
    header.appendChild(spacer);

    const btnGroup = createDiv();
    btnGroup.className = "ocode-btn-group";

    const copyBtn = this.createPillButton("Copy", ICON.copy, () => {
      void navigator.clipboard.writeText(code).then(() => {
        setSvgContent(copyBtn.querySelector(".ocode-pill-icon")!, ICON.check);
        copyBtn.querySelector(".ocode-pill-text")!.textContent = "Copied";
        activeWindow.setTimeout(() => {
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
    if (blockHasSkipMarker(code)) {
      wrapper.classList.add("ocode-skip-run-all");
      const skipBadge = createSpan({ cls: "ocode-skip-badge", text: "skip" });
      skipBadge.setAttribute("aria-label", "Excluded from Run All");
      skipBadge.setAttribute("title", "Excluded from Run All");
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
      }
    }

    // ─── Inline collapsible (reading view) ───
    // `fileName` is only set for embedded files — they already get the embed
    // collapse handler in renderEmbeddedFile, so we don't duplicate it here.
    if (this.settings.inlineCollapsible && !fileName) {
      this.makeCollapsible(wrapper, this.settings.inlineCollapsedByDefault, code);
    }

    originalPre.replaceWith(wrapper);
  }

  /**
   * Add a collapse toggle to a code block wrapper.
   * Shared by inline code blocks (this method) and embedded files
   * (which call it with `defaultCollapsed=true`).
   */
  private makeCollapsible(wrapper: HTMLElement, defaultCollapsed: boolean, sourceCode: string): void {
    const codeArea = wrapper.querySelector("pre.shiki") as HTMLElement | null;
    const header = wrapper.querySelector(".ocode-header");
    if (!codeArea || !header) return;
    if (header.querySelector(".ocode-collapse-arrow")) return; // already added

    const arrow = createSpan({ cls: "ocode-collapse-arrow" });
    arrow.textContent = defaultCollapsed ? "\u25B6" : "\u25BC"; // ▶ / ▼
    header.prepend(arrow);

    const lineCount = sourceCode.split("\n").length;
    const hint = createSpan({ cls: "ocode-collapse-hint", text: `${lineCount} lines` });
    const spacer = header.querySelector(".ocode-spacer");
    if (spacer) spacer.before(hint); else header.appendChild(hint);

    if (defaultCollapsed) {
      wrapper.classList.add("ocode-collapsed");
      codeArea.classList.add("ocode-hidden");
    }

    header.classList.add("ocode-collapse-toggle");
    header.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target.closest(".ocode-pill")) return;
      if (target.closest(".ocode-label-link")) return;
      e.preventDefault();
      e.stopPropagation();
      const collapsed = wrapper.classList.toggle("ocode-collapsed");
      codeArea.classList.toggle("ocode-hidden", collapsed);
      arrow.textContent = collapsed ? "\u25B6" : "\u25BC";
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

    // Build the code to actually execute (may prepend accumulated blocks)
    let execCode = code;
    if (useSharedCtx) {
      const prevBlocks = this.noteContexts.get(sourcePath)?.get(lang) ?? [];
      const seedVars   = this.noteVarsBlockStore.get(sourcePath);
      const hasSeed    = seedVars && Object.keys(seedVars).length > 0;
      if (prevBlocks.length > 0 || hasSeed) {
        execCode = this.buildSharedContextCode(lang, prevBlocks, code, seedVars);
      }
      // Append the var-extraction postamble so we can snapshot variables
      if (lang === "python") {
        execCode = execCode + CodePlugin.PYTHON_VAR_POSTAMBLE;
      } else if (lang === "bash" || lang === "zsh" || lang === "shell") {
        execCode = execCode + CodePlugin.BASH_VAR_POSTAMBLE;
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
      requestAnimationFrame(() => inputField.focus());
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
                const store: Record<string, string> = {};
                for (const [k, v] of Object.entries(vars)) {
                  store[k] = typeof v === "string" ? v : JSON.stringify(v);
                }
                this.noteVarStore.set(sourcePath, store);
                this.updateInlineVarRefs(sourcePath, store);
              } catch (_e) { /* ignore parse failures */ }
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
          requestAnimationFrame(() => inputField.focus());
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

      // Copy-output button — copies the rendered stdout/stderr text from the panel.
      // Reads from the DOM so we always include exactly what the user sees
      // (with the __OCODE_VARS__ snapshot line already stripped).
      const copyOutBtn = this.createPillButton("Copy output", ICON.copy, () => {
        const text = outContent.textContent || "";
        void navigator.clipboard.writeText(text).then(() => {
          setSvgContent(copyOutBtn.querySelector(".ocode-pill-icon")!, ICON.check);
          copyOutBtn.querySelector(".ocode-pill-text")!.textContent = "Copied";
          activeWindow.setTimeout(() => {
            setSvgContent(copyOutBtn.querySelector(".ocode-pill-icon")!, ICON.copy);
            copyOutBtn.querySelector(".ocode-pill-text")!.textContent = "Copy output";
          }, 2000);
        });
      });
      copyOutBtn.classList.add("ocode-copy-out-pill");
      outHeader.insertBefore(copyOutBtn, clearBtn);

      // Add copy-error button if there was meaningful stderr
      // Strip the sudo password prompt line — it's not an error
      const errorText = stderrText.replace(/^Password:\s*/m, "").trim();
      if (errorText) {
        const copyErrBtn = this.createPillButton("Copy error", ICON.copy, () => {
          void navigator.clipboard.writeText(errorText).then(() => {
            setSvgContent(copyErrBtn.querySelector(".ocode-pill-icon")!, ICON.check);
            copyErrBtn.querySelector(".ocode-pill-text")!.textContent = "Copied";
            activeWindow.setTimeout(() => {
              setSvgContent(copyErrBtn.querySelector(".ocode-pill-icon")!, ICON.copy);
              copyErrBtn.querySelector(".ocode-pill-text")!.textContent = "Copy error";
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
        noteCtx.get(lang)!.push(code); // store the original block, not the wrapped version
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
    return (lang === "bash" || lang === "shell") && /\bsudo\b/.test(code);
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
    const code = await this.app.vault.read(file);
    const lang = this.highlighter.resolveExtension(ext);

    // Replace the .internal-embed element with a plain container so
    // Obsidian's click-to-open handler is completely severed.
    const container = createDiv();
    container.className = "ocode-embed-container";
    embedEl.replaceWith(container);

    // Re-use the same render path
    const tempPre = createEl("pre");
    container.appendChild(tempPre);

    this.renderCodeBlock(tempPre, code, lang, lang, file.name, sourcePath);

    // Mark as embedded
    const wrapper = container.querySelector(".ocode-wrapper");
    if (!wrapper) return;
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
      this.makeCollapsible(wrapper as HTMLElement, true, code);
    }
  }
}

/**
 * CodeFileView — renders vault code files (.py, .js, .sh, …) as a single
 * always-editable page with Shiki syntax highlighting, plus a Run button.
 *
 * Implementation: a transparent <textarea> overlays a Shiki-highlighted
 * background layer. The two layers share the same font metrics so the
 * cursor lines up with the highlighted glyphs underneath. This is the
 * standard "transparent textarea overlay" technique used by libraries like
 * react-simple-code-editor. It keeps native text-input behaviour (selection,
 * IME, OS spellcheck) while showing live syntax colours.
 */

import { TextFileView, WorkspaceLeaf } from "obsidian";
import type CodePlugin from "./main";
import { startExecution, isExecutable, type RunningProcess } from "./executor";

export const CODE_FILE_VIEW_TYPE = "codesuite-code-file-view";

// Mirror the ICON map from main.ts exactly so buttons look identical.
const ICON = {
  copy:  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  check: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`,
  play:  `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
  stop:  `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>`,
  close: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
};

function parseSvg(svgString: string): Node {
  const doc = new DOMParser().parseFromString(svgString, "text/html");
  return activeDocument.adoptNode(doc.body.firstChild!);
}

function setSvgContent(el: Element, svgString: string): void {
  el.textContent = "";
  el.appendChild(parseSvg(svgString));
}

export class CodeFileView extends TextFileView {
  plugin: CodePlugin;

  private content = "";

  // DOM nodes built in onOpen — non-null after the view is mounted.
  private wrapper!: HTMLElement;
  private labelEl!: HTMLElement;
  private editorWrap!: HTMLElement;
  private highlightBg!: HTMLElement;
  private textarea!: HTMLTextAreaElement;
  private copyBtn!: HTMLButtonElement;
  private runBtn!: HTMLButtonElement;

  private outputPanel: HTMLElement | null = null;
  private runningProc: RunningProcess | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: CodePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  // ─── Obsidian view contract ──────────────────────────────────

  getViewType(): string     { return CODE_FILE_VIEW_TYPE; }
  getIcon(): string         { return "file-code"; }
  getDisplayText(): string  { return this.file?.name ?? "Code file"; }
  getViewData(): string     { return this.content; }

  setViewData(data: string, clear: boolean): void {
    this.content = data;
    if (clear) {
      // New file loaded in this leaf — discard stale output from the previous file.
      this.removeOutput();
    }
    this.updateHeaderLabel();
    this.renderEditor();
  }

  clear(): void {
    this.content = "";
    if (this.textarea) this.textarea.value = "";
    if (this.highlightBg) this.highlightBg.empty();
    this.removeOutput();
  }

  // ─── Lifecycle ───────────────────────────────────────────────

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("ocode-file-page");

    // Main wrapper — same class as inline code blocks so existing CSS applies.
    this.wrapper = this.contentEl.createDiv({ cls: "ocode-wrapper ocode-file-full-page" });

    // ── Header bar ──
    const header = this.wrapper.createDiv({ cls: "ocode-header" });
    this.labelEl = header.createSpan({ cls: "ocode-label" });
    header.createSpan({ cls: "ocode-spacer" });

    const btnGroup = header.createDiv({ cls: "ocode-btn-group" });
    this.copyBtn = this.makePill("Copy", ICON.copy, btnGroup, () => this.onCopyClick());
    this.runBtn  = this.makePill("Run",  ICON.play, btnGroup, () => this.toggleRun(), "ocode-run-pill");

    // ── Editor area ──
    const codeArea = this.wrapper.createDiv({ cls: "ocode-file-code-area" });
    this.buildEditorSkeleton(codeArea);

    this.updateHeaderLabel();
    this.renderEditor();
  }

  async onClose(): Promise<void> {
    this.runningProc?.cancel();
    this.runningProc = null;
    this.contentEl.empty();
  }

  // ─── Editor construction ─────────────────────────────────────

  /**
   * Build the persistent editor DOM ONCE. setViewData / renderEditor then
   * just update its value and the highlight layer — no full rebuild. This
   * avoids losing focus/selection on every keystroke and keeps listener
   * attachment to a single setup step.
   */
  private buildEditorSkeleton(parent: HTMLElement): void {
    this.editorWrap = parent.createDiv({ cls: "ocode-file-editor-wrap" });
    this.highlightBg = this.editorWrap.createDiv({ cls: "ocode-file-editor-bg" });

    this.textarea = this.editorWrap.createEl("textarea", { cls: "ocode-file-editor-ta" });
    this.textarea.spellcheck = false;
    this.textarea.setAttribute("autocomplete", "off");
    this.textarea.setAttribute("autocorrect", "off");
    this.textarea.setAttribute("autocapitalize", "off");

    // Live re-highlight + autosave on every change.
    this.textarea.addEventListener("input", () => {
      this.content = this.textarea.value;
      this.requestSave();
      this.refreshHighlight();
    });

    // Tab inserts two spaces (don't move focus out of the textarea).
    this.textarea.addEventListener("keydown", (e) => {
      if (e.key !== "Tab") return;
      e.preventDefault();
      const start = this.textarea.selectionStart;
      const end   = this.textarea.selectionEnd;
      this.textarea.value =
        this.textarea.value.slice(0, start) + "  " + this.textarea.value.slice(end);
      this.textarea.selectionStart = this.textarea.selectionEnd = start + 2;
      this.content = this.textarea.value;
      this.requestSave();
      this.refreshHighlight();
    });
  }

  /** Push current content into the textarea + refresh the highlight layer. */
  private renderEditor(): void {
    if (!this.textarea) return;
    if (this.textarea.value !== this.content) {
      this.textarea.value = this.content;
    }
    this.editorWrap.toggleClass("ocode-file-editor-wrap--lnum", this.plugin.settings.showLineNumbers);
    this.refreshHighlight();
  }

  /** Re-render Shiki HTML into the background layer for the current content. */
  private refreshHighlight(): void {
    const lang = this.currentLang();
    this.highlightBg.empty();
    const html = this.plugin.highlighter.highlight(this.content, lang, this.plugin.settings.theme);
    if (!html) {
      // Highlighter not ready (or unsupported lang) — fall back to plain text.
      this.highlightBg.createEl("pre", { cls: "shiki ocode-file-editor-fallback-pre", text: this.content });
      return;
    }
    const parsed = new DOMParser().parseFromString(html, "text/html");
    for (const node of Array.from(parsed.body.childNodes)) {
      this.highlightBg.appendChild(activeDocument.adoptNode(node));
    }
    if (this.plugin.settings.showLineNumbers) {
      let n = 1;
      for (const line of Array.from(this.highlightBg.querySelectorAll(".line"))) {
        line.prepend(createSpan({ cls: "ocode-line-num", text: String(n++) }));
      }
    }
  }

  private updateHeaderLabel(): void {
    if (!this.labelEl) return;
    const lang = this.currentLang();
    this.labelEl.textContent = lang || this.file?.extension || "";
  }

  private currentLang(): string {
    const ext = this.file ? "." + this.file.extension.toLowerCase() : "";
    return this.plugin.highlighter.resolveExtension(ext);
  }

  // ─── Helpers ─────────────────────────────────────────────────

  private makePill(
    text: string,
    icon: string,
    parent: HTMLElement,
    onClick: () => void,
    extraCls = ""
  ): HTMLButtonElement {
    const btn = parent.createEl("button", { cls: `ocode-pill ${extraCls}`.trim() });
    btn.createSpan({ cls: "ocode-pill-icon" }).appendChild(parseSvg(icon));
    btn.createSpan({ cls: "ocode-pill-text", text });
    btn.addEventListener("click", onClick);
    return btn;
  }

  private onCopyClick(): void {
    void navigator.clipboard.writeText(this.content).then(() => {
      setSvgContent(this.copyBtn.querySelector(".ocode-pill-icon")!, ICON.check);
      this.copyBtn.querySelector(".ocode-pill-text")!.textContent = "Copied";
      activeWindow.setTimeout(() => {
        setSvgContent(this.copyBtn.querySelector(".ocode-pill-icon")!, ICON.copy);
        this.copyBtn.querySelector(".ocode-pill-text")!.textContent = "Copy";
      }, 2000);
    });
  }

  // ─── Run / output ────────────────────────────────────────────

  private removeOutput(): void {
    this.outputPanel?.remove();
    this.outputPanel = null;
  }

  private toggleRun(): void {
    if (this.runningProc) {
      this.runningProc.cancel();
      return;
    }
    void this.runCode();
  }

  private async runCode(): Promise<void> {
    if (!this.file) return;
    const lang = this.currentLang();
    if (!isExecutable(lang)) return;

    await this.save();
    this.removeOutput();

    const panel = this.wrapper.createDiv({ cls: "ocode-output" });
    this.outputPanel = panel;

    const outHeader = panel.createDiv({ cls: "ocode-output-header" });
    const outLabel  = outHeader.createSpan({ cls: "ocode-output-label", text: "Running\u2026" });

    const clearBtn = outHeader.createEl("button", { cls: "ocode-pill ocode-clear-pill" });
    clearBtn.createSpan({ cls: "ocode-pill-icon" }).appendChild(parseSvg(ICON.close));
    clearBtn.setAttribute("aria-label", "Clear output");
    clearBtn.addEventListener("click", () => this.removeOutput());

    const outContent = panel.createEl("pre", { cls: "ocode-output-content" });

    // Swap Run → Stop
    setSvgContent(this.runBtn.querySelector(".ocode-pill-icon")!, ICON.stop);
    this.runBtn.querySelector(".ocode-pill-text")!.textContent = "Stop";
    this.runBtn.classList.add("ocode-cancel-pill");

    const vaultPath = (this.app.vault.adapter as unknown as { basePath: string }).basePath;

    const proc = startExecution(this.content, lang, this.plugin.settings, {
      onStdout: (data) => {
        outContent.appendChild(createSpan({ cls: "ocode-stdout", text: data }));
        outContent.scrollTop = outContent.scrollHeight;
      },
      onStderr: (data) => {
        const span = createSpan({ cls: "ocode-stderr" });
        span.textContent = data.endsWith("\n") ? data : data + "\n";
        outContent.appendChild(span);
        outContent.scrollTop = outContent.scrollHeight;
      },
    }, vaultPath);
    this.runningProc = proc;

    try {
      const result = await proc.promise;

      outLabel.textContent = result.killed
        ? "Output (timed out)"
        : result.exitCode === 0
        ? "Output"
        : `Output (exit: ${result.exitCode})`;

      // Icon-only copy-output button.
      const copyOutBtn = this.makePill("", ICON.copy, outHeader, () => {
        void navigator.clipboard.writeText(outContent.textContent ?? "").then(() => {
          setSvgContent(copyOutBtn.querySelector(".ocode-pill-icon")!, ICON.check);
          activeWindow.setTimeout(() => {
            setSvgContent(copyOutBtn.querySelector(".ocode-pill-icon")!, ICON.copy);
          }, 2000);
        });
      }, "ocode-copy-out-pill");
      outHeader.insertBefore(copyOutBtn, clearBtn);

      if (result.images.length > 0) {
        const imgContainer = panel.createDiv({ cls: "ocode-output-images" });
        for (const base64 of result.images) {
          const img = imgContainer.createEl("img");
          img.src = `data:image/png;base64,${base64}`;
          img.className = "ocode-output-img";
        }
        panel.insertBefore(imgContainer, outContent);
      }

      if (!outContent.childNodes.length && result.images.length === 0) {
        outContent.textContent = "(no output)";
        outContent.classList.add("ocode-no-output");
      }
    } finally {
      this.runningProc = null;
      setSvgContent(this.runBtn.querySelector(".ocode-pill-icon")!, ICON.play);
      this.runBtn.querySelector(".ocode-pill-text")!.textContent = "Run";
      this.runBtn.classList.remove("ocode-cancel-pill");
    }
  }
}

/**
 * CodeFileView — opens code files (`.py`, `.js`, `.sh`, …) directly inside
 * Obsidian with Shiki syntax highlighting, a Run button with live output,
 * and a plain-text editor mode for quick changes.
 *
 * Extends Obsidian's TextFileView so save / dirty-tracking / auto-save all
 * work like any built-in file type.
 */

import { TextFileView, WorkspaceLeaf, Platform } from "obsidian";
import type CodePlugin from "./main";
import { startExecution, isExecutable, type RunningProcess } from "./executor";

export const CODE_FILE_VIEW_TYPE = "codesuite-code-file-view";

const ICON_PLAY = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
const ICON_STOP = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>`;
const ICON_EDIT = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
const ICON_PREVIEW = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const ICON_CLOSE = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

function svgEl(svg: string): Node {
  const doc = new DOMParser().parseFromString(svg, "text/html");
  return activeDocument.adoptNode(doc.body.firstChild!);
}

export class CodeFileView extends TextFileView {
  plugin: CodePlugin;
  private content = "";
  private mode: "preview" | "edit" = "preview";
  private codeContainer!: HTMLElement;
  private outputPanel: HTMLElement | null = null;
  private runningProc: RunningProcess | null = null;
  private runBtn!: HTMLButtonElement;
  private modeBtn!: HTMLButtonElement;

  constructor(leaf: WorkspaceLeaf, plugin: CodePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return CODE_FILE_VIEW_TYPE;
  }

  getIcon(): string {
    return "file-code";
  }

  getDisplayText(): string {
    return this.file?.name ?? "Code file";
  }

  getViewData(): string {
    return this.content;
  }

  setViewData(data: string, _clear: boolean): void {
    this.content = data;
    this.render();
  }

  clear(): void {
    this.content = "";
    if (this.codeContainer) this.codeContainer.empty();
    this.removeOutput();
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("ocode-file-view");

    const toolbar = this.contentEl.createDiv({ cls: "ocode-file-toolbar" });

    const ext = this.file ? "." + this.file.extension.toLowerCase() : "";
    const lang = this.plugin.highlighter.resolveExtension(ext);

    const langLabel = toolbar.createSpan({ cls: "ocode-file-lang", text: lang });
    langLabel.setAttribute("title", "Language");

    const spacer = toolbar.createSpan({ cls: "ocode-spacer ocode-spacer-flex" });

    // Edit / preview toggle
    this.modeBtn = toolbar.createEl("button", { cls: "ocode-pill ocode-mode-pill" });
    this.updateModeBtn();
    this.modeBtn.addEventListener("click", () => {
      this.mode = this.mode === "preview" ? "edit" : "preview";
      this.updateModeBtn();
      this.render();
    });

    // Run button (only if the language is executable)
    if (Platform.isDesktop && this.plugin.settings.enableExecution && isExecutable(lang)) {
      this.runBtn = toolbar.createEl("button", { cls: "ocode-pill ocode-run-pill" });
      this.runBtn.appendChild(this.makePillContent(ICON_PLAY, "Run"));
      this.runBtn.addEventListener("click", () => this.toggleRun());
    }

    this.codeContainer = this.contentEl.createDiv({ cls: "ocode-file-body" });
    this.render();
  }

  async onClose(): Promise<void> {
    this.runningProc?.cancel();
    this.runningProc = null;
    this.contentEl.empty();
  }

  // ─── Rendering ────────────────────────────────────────────

  private makePillContent(svg: string, text: string): DocumentFragment {
    const frag = activeDocument.createDocumentFragment();
    const ic = createSpan({ cls: "ocode-pill-icon" });
    ic.appendChild(svgEl(svg));
    frag.appendChild(ic);
    frag.appendChild(createSpan({ cls: "ocode-pill-text", text }));
    return frag;
  }

  private updateModeBtn(): void {
    this.modeBtn.empty();
    this.modeBtn.appendChild(
      this.makePillContent(
        this.mode === "preview" ? ICON_EDIT : ICON_PREVIEW,
        this.mode === "preview" ? "Edit" : "Preview"
      )
    );
  }

  private render(): void {
    if (!this.codeContainer) return;
    this.codeContainer.empty();

    const ext = this.file ? "." + this.file.extension.toLowerCase() : "";
    const lang = this.plugin.highlighter.resolveExtension(ext);

    if (this.mode === "edit") {
      const ta = this.codeContainer.createEl("textarea", { cls: "ocode-file-editor" });
      ta.value = this.content;
      ta.spellcheck = false;
      ta.addEventListener("input", () => {
        this.content = ta.value;
        this.requestSave();
      });
      // Tab → indent (2 spaces) instead of leaving the textarea
      ta.addEventListener("keydown", (e) => {
        if (e.key === "Tab") {
          e.preventDefault();
          const s = ta.selectionStart, eEnd = ta.selectionEnd;
          ta.value = ta.value.slice(0, s) + "  " + ta.value.slice(eEnd);
          ta.selectionStart = ta.selectionEnd = s + 2;
          this.content = ta.value;
          this.requestSave();
        }
      });
      return;
    }

    // Preview: Shiki-highlighted, non-editable
    const html = this.plugin.highlighter.highlight(
      this.content,
      lang,
      this.plugin.settings.theme
    );
    if (html) {
      const parsed = new DOMParser().parseFromString(html, "text/html");
      for (const node of Array.from(parsed.body.childNodes)) {
        this.codeContainer.appendChild(activeDocument.adoptNode(node));
      }
      // Line numbers for parity with reading-view blocks
      if (this.plugin.settings.showLineNumbers) {
        const lines = this.codeContainer.querySelectorAll("pre .line");
        let n = 1;
        for (const line of Array.from(lines)) {
          const num = createSpan({ cls: "ocode-line-num", text: String(n++) });
          line.prepend(num);
        }
      }
    } else {
      const pre = this.codeContainer.createEl("pre");
      pre.textContent = this.content;
    }
  }

  // ─── Run / output ─────────────────────────────────────────

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
    const ext = "." + this.file.extension.toLowerCase();
    const lang = this.plugin.highlighter.resolveExtension(ext);
    if (!isExecutable(lang)) return;

    // Make sure the latest edits are persisted before running.
    await this.save();

    this.removeOutput();
    const panel = this.contentEl.createDiv({ cls: "ocode-output" });
    this.outputPanel = panel;

    const header = panel.createDiv({ cls: "ocode-output-header" });
    const label = header.createSpan({ cls: "ocode-output-label", text: "Running\u2026" });

    const clearBtn = header.createEl("button", { cls: "ocode-pill ocode-clear-pill" });
    const ci = createSpan({ cls: "ocode-pill-icon" });
    ci.appendChild(svgEl(ICON_CLOSE));
    clearBtn.appendChild(ci);
    clearBtn.setAttribute("aria-label", "Clear output");
    clearBtn.addEventListener("click", () => this.removeOutput());

    const content = panel.createEl("pre", { cls: "ocode-output-content" });

    // Swap Run → Stop
    this.runBtn.empty();
    this.runBtn.appendChild(this.makePillContent(ICON_STOP, "Stop"));
    this.runBtn.classList.add("ocode-cancel-pill");

    const vaultPath = (this.app.vault.adapter as unknown as { basePath: string }).basePath;
    let stderrText = "";

    const proc = startExecution(this.content, lang, this.plugin.settings, {
      onStdout: (data) => {
        const span = createSpan({ cls: "ocode-stdout", text: data });
        content.appendChild(span);
        content.scrollTop = content.scrollHeight;
      },
      onStderr: (data) => {
        stderrText += data;
        const span = createSpan({ cls: "ocode-stderr" });
        span.textContent = data.endsWith("\n") ? data : data + "\n";
        content.appendChild(span);
        content.scrollTop = content.scrollHeight;
      },
    }, vaultPath);
    this.runningProc = proc;

    try {
      const result = await proc.promise;
      label.textContent = result.killed
        ? "Output (timed out)"
        : result.exitCode === 0
        ? "Output"
        : `Output (exit: ${result.exitCode})`;
      if (result.images.length > 0) {
        const imgContainer = createDiv({ cls: "ocode-output-images" });
        for (const base64 of result.images) {
          const img = createEl("img");
          img.src = `data:image/png;base64,${base64}`;
          img.className = "ocode-output-img";
          imgContainer.appendChild(img);
        }
        panel.insertBefore(imgContainer, content);
      }
      if (!content.childNodes.length && result.images.length === 0) {
        content.textContent = "(no output)";
        content.classList.add("ocode-no-output");
      }
      // Suppress unused-var lint by referencing stderrText if needed in future
      void stderrText;
    } finally {
      this.runningProc = null;
      this.runBtn.empty();
      this.runBtn.appendChild(this.makePillContent(ICON_PLAY, "Run"));
      this.runBtn.classList.remove("ocode-cancel-pill");
    }
  }
}

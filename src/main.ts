import {
  Plugin,
  MarkdownPostProcessorContext,
  TFile,
  Notice,
  Platform,
} from "obsidian";
import { syntaxHighlighting } from "@codemirror/language";
import { classHighlighter } from "@lezer/highlight";
import { Highlighter, EXT_TO_LANG } from "./highlighter";
import { CodeSettingTab } from "./settings-tab";
import { startExecution, isExecutable, type RunningProcess } from "./executor";
import {
  type CodePluginSettings,
  DEFAULT_SETTINGS,
} from "./settings";

// SVG icons as constants
const ICON = {
  copy: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  check: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`,
  play: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
  stop: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>`,
  close: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  send: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`,
};

const CODE_FILE_EXTENSIONS = new Set(Object.keys(EXT_TO_LANG));

export default class CodePlugin extends Plugin {
  settings: CodePluginSettings = DEFAULT_SETTINGS;
  highlighter: Highlighter = new Highlighter();
  /** Track running processes per wrapper element for cancel */
  private runningProcs: Map<HTMLElement, RunningProcess> = new Map();

  async onload() {
    await this.loadSettings();
    await this.highlighter.init();

    this.addSettingTab(new CodeSettingTab(this.app, this));

    if (this.settings.wideCodeBlocks) {
      document.body.addClass("ocode-wide-blocks");
    }

    // Editor (CM6): register classHighlighter so .tok-* CSS classes appear on tokens
    this.registerEditorExtension([
      syntaxHighlighting(classHighlighter),
    ]);

    // Reading view: syntax highlighting + execution
    this.registerMarkdownPostProcessor(
      (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
        this.processCodeBlocks(el, ctx);
      },
      1000
    );

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
    // Kill all running processes
    for (const proc of this.runningProcs.values()) {
      proc.cancel();
    }
    this.runningProcs.clear();
    this.highlighter.dispose();
    document.body.removeClass("ocode-wide-blocks");
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async refreshHighlighter() {
    this.highlighter.dispose();
    this.highlighter = new Highlighter();
    await this.highlighter.init();
    this.app.workspace.updateOptions();
  }

  // ─── Code Block Processing ────────────────────────────────────

  private processCodeBlocks(el: HTMLElement, _ctx: MarkdownPostProcessorContext) {
    const codeBlocks = el.querySelectorAll("pre > code");
    if (!codeBlocks.length) return;

    for (const codeEl of Array.from(codeBlocks)) {
      const pre = codeEl.parentElement;
      if (!pre) continue;
      if (pre.parentElement?.hasClass("ocode-wrapper")) continue;

      const langClass = Array.from(codeEl.classList).find((c) =>
        c.startsWith("language-")
      );
      const rawLang = langClass ? langClass.replace("language-", "") : "";
      const lang = this.highlighter.resolveLanguage(rawLang);
      const code = codeEl.textContent || "";

      this.renderCodeBlock(pre, code, lang, rawLang);
    }
  }

  private renderCodeBlock(
    originalPre: HTMLElement,
    code: string,
    lang: string,
    displayLang: string,
    fileName?: string
  ) {
    const html = this.highlighter.highlight(code, lang, this.settings.theme);
    if (!html) return;

    const wrapper = document.createElement("div");
    wrapper.className = "ocode-wrapper";
    wrapper.innerHTML = html;

    // ─── Header bar (label left, buttons right) ───
    const header = document.createElement("div");
    header.className = "ocode-header";

    if (this.settings.showLanguageLabel && (displayLang || fileName)) {
      const label = document.createElement("span");
      label.className = "ocode-label";
      label.textContent = fileName || displayLang;
      header.appendChild(label);
    }

    const spacer = document.createElement("span");
    spacer.className = "ocode-spacer";
    header.appendChild(spacer);

    const btnGroup = document.createElement("div");
    btnGroup.className = "ocode-btn-group";

    const copyBtn = this.createPillButton("Copy", ICON.copy, () => {
      navigator.clipboard.writeText(code).then(() => {
        copyBtn.querySelector(".ocode-pill-icon")!.innerHTML = ICON.check;
        copyBtn.querySelector(".ocode-pill-text")!.textContent = "Copied";
        setTimeout(() => {
          copyBtn.querySelector(".ocode-pill-icon")!.innerHTML = ICON.copy;
          copyBtn.querySelector(".ocode-pill-text")!.textContent = "Copy";
        }, 2000);
      });
    });
    btnGroup.appendChild(copyBtn);

    if (this.settings.enableExecution && isExecutable(lang) && Platform.isDesktop) {
      const runBtn = this.createPillButton("Run", ICON.play, () => {
        this.runCode(code, lang, wrapper, runBtn);
      }, "ocode-run-pill");
      btnGroup.appendChild(runBtn);
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
          const numSpan = document.createElement("span");
          numSpan.className = "ocode-line-num";
          numSpan.textContent = String(lineNum);
          line.prepend(numSpan);
          lineNum++;
        }
      }
    }

    originalPre.replaceWith(wrapper);
  }

  /** Create a pill-style button (icon + text) */
  private createPillButton(
    text: string,
    icon: string,
    onClick: () => void,
    extraClass?: string
  ): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = `ocode-pill ${extraClass || ""}`.trim();
    btn.innerHTML = `<span class="ocode-pill-icon">${icon}</span><span class="ocode-pill-text">${text}</span>`;
    btn.addEventListener("click", onClick);
    return btn;
  }

  // ─── Code Execution ──────────────────────────────────────────

  private async runCode(
    code: string,
    lang: string,
    wrapper: HTMLElement,
    runBtn: HTMLButtonElement
  ) {
    // If already running, this is a cancel click
    const existingProc = this.runningProcs.get(wrapper);
    if (existingProc) {
      existingProc.cancel();
      return;
    }

    // Switch button to "Stop" cancel mode
    runBtn.querySelector(".ocode-pill-icon")!.innerHTML = ICON.stop;
    runBtn.querySelector(".ocode-pill-text")!.textContent = "Stop";
    runBtn.classList.add("ocode-cancel-pill");

    // Remove previous output
    wrapper.querySelector(".ocode-output")?.remove();

    // ─── Build live output panel immediately ───
    const outputPanel = document.createElement("div");
    outputPanel.className = "ocode-output";

    // Output header
    const outHeader = document.createElement("div");
    outHeader.className = "ocode-output-header";

    const outLabel = document.createElement("span");
    outLabel.className = "ocode-output-label";
    outLabel.textContent = "Running\u2026";
    outHeader.appendChild(outLabel);

    const clearBtn = document.createElement("button");
    clearBtn.className = "ocode-pill ocode-clear-pill";
    clearBtn.innerHTML = `<span class="ocode-pill-icon">${ICON.close}</span>`;
    clearBtn.setAttribute("aria-label", "Clear output");
    clearBtn.addEventListener("click", () => outputPanel.remove());
    outHeader.appendChild(clearBtn);
    outputPanel.appendChild(outHeader);

    // Scrollable text content area
    const outContent = document.createElement("pre");
    outContent.className = "ocode-output-content";
    outputPanel.appendChild(outContent);

    // Stdin input bar (shown while running, hidden when done)
    const inputBar = document.createElement("div");
    inputBar.className = "ocode-input-bar ocode-input-bar-visible";

    const inputField = document.createElement("input");
    inputField.type = "text";
    inputField.className = "ocode-input-field";
    inputField.placeholder = "Type input and press Enter\u2026";
    inputBar.appendChild(inputField);

    const sendBtn = document.createElement("button");
    sendBtn.className = "ocode-pill ocode-send-pill";
    sendBtn.innerHTML = `<span class="ocode-pill-icon">${ICON.send}</span>`;
    sendBtn.setAttribute("aria-label", "Send input");
    inputBar.appendChild(sendBtn);
    outputPanel.appendChild(inputBar);

    wrapper.appendChild(outputPanel);

    // ─── Start execution with live streaming ───
    let stderrText = "";
    const proc = startExecution(code, lang, this.settings, {
      onStdout: (data) => {
        const span = document.createElement("span");
        span.className = "ocode-stdout";
        span.textContent = data;
        outContent.appendChild(span);
        outContent.scrollTop = outContent.scrollHeight;
      },
      onStderr: (data) => {
        stderrText += data;
        const span = document.createElement("span");
        span.className = "ocode-stderr";
        span.textContent = data;
        outContent.appendChild(span);
        outContent.scrollTop = outContent.scrollHeight;
      },
    });
    this.runningProcs.set(wrapper, proc);

    // ─── Wire up stdin ───
    const doSend = () => {
      const text = inputField.value;
      if (text !== undefined) {
        proc.writeStdin(text + "\n");
        inputField.value = "";
        const echo = document.createElement("span");
        echo.className = "ocode-stdin-echo";
        echo.textContent = `> ${text}\n`;
        outContent.appendChild(echo);
        outContent.scrollTop = outContent.scrollHeight;
      }
    };
    inputField.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); doSend(); }
    });
    sendBtn.addEventListener("click", doSend);

    try {
      const result = await proc.promise;

      // Process finished — remove input bar
      inputBar.remove();

      // Update label
      outLabel.textContent = result.killed
        ? "Output (timed out)"
        : result.exitCode === 0
        ? "Output"
        : `Output (exit: ${result.exitCode})`;

      // Add copy-error button if there was stderr
      if (stderrText) {
        const copyErrBtn = this.createPillButton("Copy Error", ICON.copy, () => {
          navigator.clipboard.writeText(stderrText).then(() => {
            copyErrBtn.querySelector(".ocode-pill-icon")!.innerHTML = ICON.check;
            copyErrBtn.querySelector(".ocode-pill-text")!.textContent = "Copied";
            setTimeout(() => {
              copyErrBtn.querySelector(".ocode-pill-icon")!.innerHTML = ICON.copy;
              copyErrBtn.querySelector(".ocode-pill-text")!.textContent = "Copy Error";
            }, 2000);
          });
        });
        copyErrBtn.classList.add("ocode-copy-err-pill");
        // Insert before the clear button
        outHeader.insertBefore(copyErrBtn, clearBtn);
      }

      // Add images (before text content)
      if (result.images.length > 0) {
        const imgContainer = document.createElement("div");
        imgContainer.className = "ocode-output-images";
        for (const base64 of result.images) {
          const img = document.createElement("img");
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
        outContent.style.display = "none";
      }
    } catch (err: unknown) {
      new Notice(`Execution error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.runningProcs.delete(wrapper);
      // Restore run button
      runBtn.querySelector(".ocode-pill-icon")!.innerHTML = ICON.play;
      runBtn.querySelector(".ocode-pill-text")!.textContent = "Run";
      runBtn.classList.remove("ocode-cancel-pill");
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

      this.renderEmbeddedFile(embed as HTMLElement, file, ext);
    }
  }

  private async renderEmbeddedFile(embedEl: HTMLElement, file: TFile, ext: string) {
    const code = await this.app.vault.read(file);
    const lang = this.highlighter.resolveExtension(ext);

    // Re-use the same render path
    const tempPre = document.createElement("pre");
    embedEl.empty();
    embedEl.appendChild(tempPre);
    embedEl.classList.add("ocode-embed-container");

    this.renderCodeBlock(tempPre, code, lang, lang, file.name);

    // Mark as embedded
    const wrapper = embedEl.querySelector(".ocode-wrapper");
    if (wrapper) wrapper.classList.add("ocode-embedded");
  }
}

import {
  Plugin,
  MarkdownPostProcessorContext,
  TFile,
  Notice,
  Platform,
} from "obsidian";
import { Highlighter, EXT_TO_LANG } from "./highlighter";
import { CodeSettingTab } from "./settings-tab";
import { executeCode, isExecutable } from "./executor";
import {
  type CodePluginSettings,
  DEFAULT_SETTINGS,
  type GruvboxVariant,
} from "./settings";

const CODE_FILE_EXTENSIONS = new Set(Object.keys(EXT_TO_LANG));

export default class CodePlugin extends Plugin {
  settings: CodePluginSettings = DEFAULT_SETTINGS;
  highlighter: Highlighter = new Highlighter();

  async onload() {
    await this.loadSettings();
    await this.highlighter.init();

    // Settings tab
    this.addSettingTab(new CodeSettingTab(this.app, this));

    // Apply wide code blocks class on load
    if (this.settings.wideCodeBlocks) {
      document.body.addClass("ocode-wide-blocks");
    }

    // --- Reading view: syntax highlighting + execution ---
    this.registerMarkdownPostProcessor(
      (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
        this.processCodeBlocks(el, ctx);
      },
      1000
    );

    // --- Reading view: embedded code file rendering ---
    if (this.settings.renderEmbeddedFiles) {
      this.registerMarkdownPostProcessor(
        (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
          this.processEmbeddedFiles(el, ctx);
        },
        999
      );
    }
  }

  onunload() {
    this.highlighter.dispose();
    document.body.removeClass("ocode-wide-blocks");
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  /** Re-initialize highlighter (called when theme changes) */
  async refreshHighlighter() {
    this.highlighter.dispose();
    this.highlighter = new Highlighter();
    await this.highlighter.init();
    // Trigger re-render of open notes
    this.app.workspace.updateOptions();
  }

  // ─── Code Block Processing ─────────────────────────────────────

  private processCodeBlocks(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
    const codeBlocks = el.querySelectorAll("pre > code");
    if (!codeBlocks.length) return;

    for (const codeEl of Array.from(codeBlocks)) {
      const pre = codeEl.parentElement;
      if (!pre) continue;
      // Skip if already processed
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

  /** Render a single code block with highlighting, line numbers, exec button, etc. */
  private renderCodeBlock(
    originalPre: HTMLElement,
    code: string,
    lang: string,
    displayLang: string,
    fileName?: string
  ) {
    const html = this.highlighter.highlight(code, lang, this.settings.theme);
    if (!html) return;

    // Build wrapper
    const wrapper = document.createElement("div");
    wrapper.className = "ocode-wrapper";
    wrapper.innerHTML = html;

    // --- Header bar ---
    const header = document.createElement("div");
    header.className = "ocode-header";

    // Language / filename label
    if (this.settings.showLanguageLabel && (displayLang || fileName)) {
      const label = document.createElement("span");
      label.className = "ocode-label";
      label.textContent = fileName || displayLang;
      header.appendChild(label);
    }

    // Spacer
    const spacer = document.createElement("span");
    spacer.className = "ocode-spacer";
    header.appendChild(spacer);

    // Copy button
    const copyBtn = document.createElement("button");
    copyBtn.className = "ocode-btn ocode-copy-btn";
    copyBtn.setAttribute("aria-label", "Copy code");
    copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(code).then(() => {
        copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`;
        setTimeout(() => {
          copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
        }, 2000);
      });
    });
    header.appendChild(copyBtn);

    // Run button (for executable languages)
    if (this.settings.enableExecution && isExecutable(lang) && Platform.isDesktop) {
      const runBtn = document.createElement("button");
      runBtn.className = "ocode-btn ocode-run-btn";
      runBtn.setAttribute("aria-label", "Run code");
      runBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
      runBtn.addEventListener("click", () => this.runCode(code, lang, wrapper, runBtn));
      header.appendChild(runBtn);
    }

    wrapper.prepend(header);

    // --- Line numbers ---
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

  // ─── Code Execution ───────────────────────────────────────────

  private async runCode(code: string, lang: string, wrapper: HTMLElement, runBtn: HTMLButtonElement) {
    // Disable button & show spinner
    runBtn.disabled = true;
    runBtn.classList.add("ocode-running");
    runBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="ocode-spin"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`;

    // Remove previous output
    const existingOutput = wrapper.querySelector(".ocode-output");
    if (existingOutput) existingOutput.remove();

    try {
      const result = await executeCode(code, lang, this.settings.executionTimeout);

      // Build output panel
      const outputPanel = document.createElement("div");
      outputPanel.className = "ocode-output";

      // Output header
      const outHeader = document.createElement("div");
      outHeader.className = "ocode-output-header";

      const outLabel = document.createElement("span");
      outLabel.className = "ocode-output-label";
      outLabel.textContent = result.killed
        ? "Output (timed out)"
        : result.exitCode === 0
        ? "Output"
        : `Output (exit: ${result.exitCode})`;
      outHeader.appendChild(outLabel);

      // Clear button
      const clearBtn = document.createElement("button");
      clearBtn.className = "ocode-btn ocode-clear-btn";
      clearBtn.setAttribute("aria-label", "Clear output");
      clearBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
      clearBtn.addEventListener("click", () => outputPanel.remove());
      outHeader.appendChild(clearBtn);

      outputPanel.appendChild(outHeader);

      // Output content
      const outContent = document.createElement("pre");
      outContent.className = "ocode-output-content";

      if (result.stderr) {
        const errSpan = document.createElement("span");
        errSpan.className = "ocode-stderr";
        errSpan.textContent = result.stderr;
        outContent.appendChild(errSpan);
      }
      if (result.stdout) {
        const outSpan = document.createElement("span");
        outSpan.className = "ocode-stdout";
        outSpan.textContent = result.stdout;
        outContent.appendChild(outSpan);
      }
      if (!result.stdout && !result.stderr) {
        outContent.textContent = "(no output)";
        outContent.classList.add("ocode-no-output");
      }

      outputPanel.appendChild(outContent);
      wrapper.appendChild(outputPanel);
    } catch (err: unknown) {
      new Notice(`Execution error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      // Restore run button
      runBtn.disabled = false;
      runBtn.classList.remove("ocode-running");
      runBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
    }
  }

  // ─── Embedded Code File Rendering ─────────────────────────────

  private processEmbeddedFiles(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
    // Obsidian renders ![[file]] embeds as elements with class "internal-embed"
    const embeds = el.querySelectorAll(".internal-embed");
    if (!embeds.length) return;

    for (const embed of Array.from(embeds)) {
      const src = embed.getAttribute("src");
      if (!src) continue;

      // Check if the embedded file has a code extension
      const extMatch = src.match(/\.[a-zA-Z0-9]+$/);
      if (!extMatch) continue;
      const ext = extMatch[0].toLowerCase();
      if (!CODE_FILE_EXTENSIONS.has(ext)) continue;

      // Find the file in the vault
      const file = this.app.metadataCache.getFirstLinkpathDest(src, ctx.sourcePath);
      if (!file || !(file instanceof TFile)) continue;

      // Read and render the file
      this.renderEmbeddedFile(embed as HTMLElement, file, ext);
    }
  }

  private async renderEmbeddedFile(embedEl: HTMLElement, file: TFile, ext: string) {
    const code = await this.app.vault.read(file);
    const lang = this.highlighter.resolveExtension(ext);

    const html = this.highlighter.highlight(code, lang, this.settings.theme);
    if (!html) return;

    // Build the same wrapper as regular code blocks
    const wrapper = document.createElement("div");
    wrapper.className = "ocode-wrapper ocode-embedded";
    wrapper.innerHTML = html;

    // Header with filename
    const header = document.createElement("div");
    header.className = "ocode-header";

    const label = document.createElement("span");
    label.className = "ocode-label";
    label.textContent = file.name;
    header.appendChild(label);

    const spacer = document.createElement("span");
    spacer.className = "ocode-spacer";
    header.appendChild(spacer);

    // Copy button
    const copyBtn = document.createElement("button");
    copyBtn.className = "ocode-btn ocode-copy-btn";
    copyBtn.setAttribute("aria-label", "Copy code");
    copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(code).then(() => {
        copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`;
        setTimeout(() => {
          copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
          }, 2000);
      });
    });
    header.appendChild(copyBtn);

    // Run button for embedded files too
    if (this.settings.enableExecution && isExecutable(lang) && Platform.isDesktop) {
      const runBtn = document.createElement("button");
      runBtn.className = "ocode-btn ocode-run-btn";
      runBtn.setAttribute("aria-label", "Run code");
      runBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
      runBtn.addEventListener("click", () => this.runCode(code, lang, wrapper, runBtn));
      header.appendChild(runBtn);
    }

    wrapper.prepend(header);

    // Line numbers
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

    // Replace the embed element
    embedEl.empty();
    embedEl.appendChild(wrapper);
    embedEl.classList.add("ocode-embed-container");
  }
}

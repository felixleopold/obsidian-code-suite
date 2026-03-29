import {
  Plugin,
  MarkdownPostProcessorContext,
  TFile,
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

/** Parse an SVG string into a DOM element without using innerHTML */
function parseSvg(svgString: string): Node {
  const doc = new DOMParser().parseFromString(svgString, "text/html");
  return document.adoptNode(doc.body.firstChild!);
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

  async onload() {
    await this.loadSettings();
    await this.highlighter.init();

    // Load any custom themes from settings
    for (const ct of this.settings.customThemes) {
      this.highlighter.loadCustomTheme(ct);
    }

    this.addSettingTab(new CodeSettingTab(this.app, this));

    if (this.settings.wideCodeBlocks) {
      document.body.addClass("ocode-wide-blocks");
    }

    // Apply theme CSS variables
    this.applyThemeColors();

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
    // Reload custom themes
    for (const ct of this.settings.customThemes) {
      this.highlighter.loadCustomTheme(ct);
    }
    this.app.workspace.updateOptions();
  }

  /** Apply the current theme's bg/fg colors as CSS variables on the body */
  applyThemeColors() {
    const bg = this.highlighter.getThemeBg(this.settings.theme);
    const fg = this.highlighter.getThemeFg(this.settings.theme);
    const root = document.documentElement;
    if (bg) {
      root.style.setProperty("--ocode-bg", bg);
      // Derive a slightly lighter/darker header bg
      root.style.setProperty("--ocode-header-bg", this.adjustBrightness(bg, 10));
      // Derive border from bg
      root.style.setProperty("--ocode-border", this.adjustBrightness(bg, 25));
      root.style.setProperty("--ocode-output-bg", this.adjustBrightness(bg, -5));
    }
    if (fg) {
      root.style.setProperty("--ocode-fg", fg);
      // Muted = fg at 60% opacity approximation
      root.style.setProperty("--ocode-muted", this.blendColor(fg, bg || "#000000", 0.6));
      root.style.setProperty("--ocode-line-num", this.blendColor(fg, bg || "#000000", 0.35));
    }
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

        constructor(view: EditorView) {
          this.decorations = this.buildDecorations(view);
        }

        update(update: ViewUpdate) {
          if (update.docChanged || update.viewportChanged) {
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

            for (let lineIdx = 0; lineIdx < tokens.length && lineIdx < block.lines.length; lineIdx++) {
              const codeLine = block.lines[lineIdx];
              let offset = codeLine.from;

              for (const token of tokens[lineIdx]) {
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

  // ─── Code Block Processing ────────────────────────────────────

  private processCodeBlocks(el: HTMLElement, _ctx: MarkdownPostProcessorContext) {
    const codeBlocks = el.querySelectorAll("pre > code");
    if (!codeBlocks.length) return;

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
    const parsedHtml = new DOMParser().parseFromString(html, "text/html");
    for (const node of Array.from(parsedHtml.body.childNodes)) {
      wrapper.appendChild(document.adoptNode(node));
    }

    // ─── Header bar (label left, buttons right) ───
    const header = document.createElement("div");
    header.className = "ocode-header";

    if (fileName || (this.settings.showLanguageLabel && displayLang)) {
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
      void navigator.clipboard.writeText(code).then(() => {
        setSvgContent(copyBtn.querySelector(".ocode-pill-icon")!, ICON.check);
        copyBtn.querySelector(".ocode-pill-text")!.textContent = "Copied";
        setTimeout(() => {
          setSvgContent(copyBtn.querySelector(".ocode-pill-icon")!, ICON.copy);
          copyBtn.querySelector(".ocode-pill-text")!.textContent = "Copy";
        }, 2000);
      });
    });
    btnGroup.appendChild(copyBtn);

    if (this.settings.enableExecution && isExecutable(lang) && Platform.isDesktop) {
      const runBtn = this.createPillButton("Run", ICON.play, () => {
        void this.runCode(code, lang, wrapper, runBtn);
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
    const iconSpan = document.createElement("span");
    iconSpan.className = "ocode-pill-icon";
    iconSpan.appendChild(parseSvg(icon));
    btn.appendChild(iconSpan);
    const textSpan = document.createElement("span");
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
    runBtn: HTMLButtonElement
  ) {
    // If already running, this is a cancel click
    const existingProc = this.runningProcs.get(wrapper);
    if (existingProc) {
      existingProc.cancel();
      return;
    }

    // Switch button to "Stop" cancel mode
    setSvgContent(runBtn.querySelector(".ocode-pill-icon")!, ICON.stop);
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
    const clearBtnIcon = document.createElement("span");
    clearBtnIcon.className = "ocode-pill-icon";
    clearBtnIcon.appendChild(parseSvg(ICON.close));
    clearBtn.appendChild(clearBtnIcon);
    clearBtn.setAttribute("aria-label", "Clear output");
    clearBtn.addEventListener("click", () => outputPanel.remove());
    outHeader.appendChild(clearBtn);
    outputPanel.appendChild(outHeader);

    // Scrollable text content area
    const outContent = document.createElement("pre");
    outContent.className = "ocode-output-content";
    outputPanel.appendChild(outContent);

    // Stdin input bar — only shown if the code reads from stdin
    const needsStdin = this.codeUsesStdin(code, lang);
    const isSudo = this.codeUsesSudo(code, lang);
    const inputBar = document.createElement("div");
    inputBar.className = needsStdin ? "ocode-input-bar ocode-input-bar-visible" : "ocode-input-bar";

    const inputField = document.createElement("input");
    inputField.type = isSudo ? "password" : "text";
    inputField.className = "ocode-input-field";
    inputField.placeholder = isSudo ? "Enter password\u2026" : "Type input and press enter\u2026";
    inputBar.appendChild(inputField);

    const sendBtn = document.createElement("button");
    sendBtn.className = "ocode-pill ocode-send-pill";
    const sendBtnIcon = document.createElement("span");
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
        // Ensure stderr chunks end with a newline so subsequent stdout starts on a new line
        span.textContent = data.endsWith("\n") ? data : data + "\n";
        outContent.appendChild(span);
        outContent.scrollTop = outContent.scrollHeight;
      },
    });
    this.runningProcs.set(wrapper, proc);

    // ─── Wire up stdin ───
    // Track whether the current input is a password prompt (sudo or stderr 'Password:')
    let isPasswordMode = isSudo;
    const doSend = () => {
      const text = inputField.value;
      if (text !== undefined) {
        proc.writeStdin(text + "\n");
        inputField.value = "";
        // Never echo password input — switch back to text mode after sending
        if (isPasswordMode) {
          isPasswordMode = false;
          inputField.type = "text";
          inputField.placeholder = "Type input and press enter\u2026";
        } else {
          const echo = document.createElement("span");
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

      // Process finished — remove input bar
      inputBar.remove();

      // Update label
      outLabel.textContent = result.killed
        ? "Output (timed out)"
        : result.exitCode === 0
        ? "Output"
        : `Output (exit: ${result.exitCode})`;

      // Add copy-error button if there was meaningful stderr
      // Strip the sudo password prompt line — it's not an error
      const errorText = stderrText.replace(/^Password:\s*/m, "").trim();
      if (errorText) {
        const copyErrBtn = this.createPillButton("Copy error", ICON.copy, () => {
          void navigator.clipboard.writeText(errorText).then(() => {
            setSvgContent(copyErrBtn.querySelector(".ocode-pill-icon")!, ICON.check);
            copyErrBtn.querySelector(".ocode-pill-text")!.textContent = "Copied";
            setTimeout(() => {
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
        outContent.classList.add("ocode-hidden");
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

      void this.renderEmbeddedFile(embed as HTMLElement, file, ext);
    }
  }

  private async renderEmbeddedFile(embedEl: HTMLElement, file: TFile, ext: string) {
    const code = await this.app.vault.read(file);
    const lang = this.highlighter.resolveExtension(ext);
    const lineCount = code.split("\n").length;

    // Replace the .internal-embed element with a plain container so
    // Obsidian's click-to-open handler is completely severed.
    const container = document.createElement("div");
    container.className = "ocode-embed-container";
    embedEl.replaceWith(container);

    // Re-use the same render path
    const tempPre = document.createElement("pre");
    container.appendChild(tempPre);

    this.renderCodeBlock(tempPre, code, lang, lang, file.name);

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

    // Collapsible behaviour
    if (this.settings.collapseEmbeds) {
      const codeArea = wrapper.querySelector("pre.shiki") as HTMLElement;
      if (!codeArea) return;

      wrapper.classList.add("ocode-collapsed");
      codeArea.classList.add("ocode-hidden");

      // Add toggle arrow to the header
      const header = wrapper.querySelector(".ocode-header");
      if (!header) return;

      const arrow = document.createElement("span");
      arrow.className = "ocode-collapse-arrow";
      arrow.textContent = "\u25B6"; // ▶
      header.prepend(arrow);

      // Add line count hint
      const hint = document.createElement("span");
      hint.className = "ocode-collapse-hint";
      hint.textContent = `${lineCount} lines`;
      const spacer = header.querySelector(".ocode-spacer");
      if (spacer) spacer.before(hint);

      // Click header to toggle
      header.classList.add("ocode-collapse-toggle");
      header.addEventListener("click", (e) => {
        // Don't toggle when clicking buttons or the filename label
        if ((e.target as HTMLElement).closest(".ocode-pill")) return;
        if ((e.target as HTMLElement).closest(".ocode-label")) return;
        // Prevent Obsidian from opening the embedded file
        e.preventDefault();
        e.stopPropagation();
        const collapsed = wrapper.classList.toggle("ocode-collapsed");
        if (collapsed) {
          codeArea.classList.add("ocode-hidden");
        } else {
          codeArea.classList.remove("ocode-hidden");
        }
        arrow.textContent = collapsed ? "\u25B6" : "\u25BC"; // ▶ / ▼
      });
    }
  }
}

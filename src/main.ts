import { Plugin, MarkdownPostProcessorContext } from "obsidian";
import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

// Fine-grained theme imports (only Gruvbox)
import gruvboxDarkHard from "shiki/themes/gruvbox-dark-hard.mjs";
import gruvboxLightHard from "shiki/themes/gruvbox-light-hard.mjs";

// Fine-grained language imports — only the common ones we eagerly load
import langPython from "shiki/langs/python.mjs";
import langJavascript from "shiki/langs/javascript.mjs";
import langTypescript from "shiki/langs/typescript.mjs";
import langJava from "shiki/langs/java.mjs";
import langC from "shiki/langs/c.mjs";
import langCpp from "shiki/langs/cpp.mjs";
import langCsharp from "shiki/langs/csharp.mjs";
import langRust from "shiki/langs/rust.mjs";
import langGo from "shiki/langs/go.mjs";
import langBash from "shiki/langs/bash.mjs";
import langShell from "shiki/langs/shellscript.mjs";
import langHtml from "shiki/langs/html.mjs";
import langCss from "shiki/langs/css.mjs";
import langJson from "shiki/langs/json.mjs";
import langYaml from "shiki/langs/yaml.mjs";
import langToml from "shiki/langs/toml.mjs";
import langSql from "shiki/langs/sql.mjs";
import langMarkdown from "shiki/langs/markdown.mjs";
import langLatex from "shiki/langs/latex.mjs";
import langR from "shiki/langs/r.mjs";
import langRuby from "shiki/langs/ruby.mjs";
import langLua from "shiki/langs/lua.mjs";
import langSwift from "shiki/langs/swift.mjs";
import langKotlin from "shiki/langs/kotlin.mjs";
import langXml from "shiki/langs/xml.mjs";
import langDiff from "shiki/langs/diff.mjs";
import langDockerfile from "shiki/langs/dockerfile.mjs";
import langMakefile from "shiki/langs/makefile.mjs";
import langPowershell from "shiki/langs/powershell.mjs";
import langGraphql from "shiki/langs/graphql.mjs";
import langHaskell from "shiki/langs/haskell.mjs";
import langScala from "shiki/langs/scala.mjs";
import langPhp from "shiki/langs/php.mjs";
import langPerl from "shiki/langs/perl.mjs";
import langTsx from "shiki/langs/tsx.mjs";
import langJsx from "shiki/langs/jsx.mjs";

const EAGER_LANGS = [
  langPython, langJavascript, langTypescript, langJava, langC, langCpp,
  langCsharp, langRust, langGo, langBash, langShell, langHtml, langCss,
  langJson, langYaml, langToml, langSql, langMarkdown, langLatex, langR,
  langRuby, langLua, langSwift, langKotlin, langXml, langDiff,
  langDockerfile, langMakefile, langPowershell, langGraphql, langHaskell,
  langScala, langPhp, langPerl, langTsx, langJsx,
];

/** Map common aliases people use in code fences to Shiki language IDs */
const LANGUAGE_ALIASES: Record<string, string> = {
  "py": "python",
  "js": "javascript",
  "ts": "typescript",
  "sh": "bash",
  "zsh": "bash",
  "yml": "yaml",
  "rs": "rust",
  "rb": "ruby",
  "cs": "csharp",
  "c++": "cpp",
  "c#": "csharp",
  "kt": "kotlin",
  "hs": "haskell",
  "tex": "latex",
  "docker": "dockerfile",
  "make": "makefile",
  "ps1": "powershell",
  "gql": "graphql",
  "text": "text",
  "txt": "text",
  "plaintext": "text",
  "plain": "text",
};

export default class SyntaxHighlightingPlugin extends Plugin {
  private highlighter: HighlighterCore | null = null;
  private loadedLanguages: Set<string> = new Set();

  async onload() {
    // Initialize Shiki highlighter with Gruvbox dark hard theme using fine-grained core
    this.highlighter = await createHighlighterCore({
      themes: [gruvboxDarkHard, gruvboxLightHard],
      langs: EAGER_LANGS,
      engine: createJavaScriptRegexEngine(),
    });

    // Track loaded language names
    for (const lang of this.highlighter.getLoadedLanguages()) {
      this.loadedLanguages.add(lang);
    }

    // Register a post-processor that replaces Obsidian's default code block rendering
    this.registerMarkdownPostProcessor(
      (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
        this.processCodeBlocks(el);
      },
      // High priority to run before other processors
      1000
    );
  }

  onunload() {
    if (this.highlighter) {
      this.highlighter.dispose();
      this.highlighter = null;
    }
  }

  private async processCodeBlocks(el: HTMLElement) {
    const codeBlocks = el.querySelectorAll("pre > code");
    if (!codeBlocks.length) return;

    for (const codeEl of Array.from(codeBlocks)) {
      const pre = codeEl.parentElement;
      if (!pre) continue;

      // Extract language from class (Obsidian sets class="language-python" etc.)
      const langClass = Array.from(codeEl.classList).find((c) =>
        c.startsWith("language-")
      );
      const rawLang = langClass ? langClass.replace("language-", "") : "";
      const lang = this.resolveLanguage(rawLang);

      // Get the raw code text
      const code = codeEl.textContent || "";

      // Ensure language is loaded
      await this.ensureLanguageLoaded(lang);

      // Generate highlighted HTML
      const html = this.highlight(code, lang);
      if (!html) continue;

      // Create wrapper
      const wrapper = document.createElement("div");
      wrapper.className = "shiki-wrapper";
      wrapper.innerHTML = html;

      // Add language label
      if (rawLang) {
        const label = document.createElement("div");
        label.className = "shiki-language-label";
        label.textContent = rawLang;
        wrapper.prepend(label);
      }

      // Add line numbers
      const shikiPre = wrapper.querySelector("pre");
      if (shikiPre) {
        const lines = shikiPre.querySelectorAll(".line");
        let lineNum = 1;
        for (const line of Array.from(lines)) {
          const numSpan = document.createElement("span");
          numSpan.className = "shiki-line-number";
          numSpan.textContent = String(lineNum);
          line.prepend(numSpan);
          lineNum++;
        }
      }

      // Replace original pre with our rendered version
      pre.replaceWith(wrapper);
    }
  }

  private resolveLanguage(raw: string): string {
    const lower = raw.toLowerCase().trim();
    if (!lower) return "text";
    if (LANGUAGE_ALIASES[lower]) return LANGUAGE_ALIASES[lower];
    if (this.loadedLanguages.has(lower)) return lower;
    return "text";
  }

  private async ensureLanguageLoaded(lang: string): Promise<void> {
    // With fine-grained imports, all supported languages are already loaded at init
    // No dynamic loading needed — unknown languages fall back to "text"
  }

  private highlight(code: string, lang: string): string | null {
    if (!this.highlighter) return null;

    try {
      // Use "text" fallback for unknown languages — Shiki renders it unstyled
      const resolvedLang = this.loadedLanguages.has(lang) ? lang : "text";

      return this.highlighter.codeToHtml(code, {
        lang: resolvedLang,
        theme: "gruvbox-dark-hard",
      });
    } catch {
      return null;
    }
  }
}

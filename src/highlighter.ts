/** Highlighter module — manages Shiki highlighter lifecycle */

import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import type { GruvboxVariant } from "./settings";

// Theme imports (all 6 Gruvbox variants)
import gruvboxDarkHard from "shiki/themes/gruvbox-dark-hard.mjs";
import gruvboxDarkMedium from "shiki/themes/gruvbox-dark-medium.mjs";
import gruvboxDarkSoft from "shiki/themes/gruvbox-dark-soft.mjs";
import gruvboxLightHard from "shiki/themes/gruvbox-light-hard.mjs";
import gruvboxLightMedium from "shiki/themes/gruvbox-light-medium.mjs";
import gruvboxLightSoft from "shiki/themes/gruvbox-light-soft.mjs";

// Language imports
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

const ALL_THEMES = [
  gruvboxDarkHard, gruvboxDarkMedium, gruvboxDarkSoft,
  gruvboxLightHard, gruvboxLightMedium, gruvboxLightSoft,
];

const ALL_LANGS = [
  langPython, langJavascript, langTypescript, langJava, langC, langCpp,
  langCsharp, langRust, langGo, langBash, langShell, langHtml, langCss,
  langJson, langYaml, langToml, langSql, langMarkdown, langLatex, langR,
  langRuby, langLua, langSwift, langKotlin, langXml, langDiff,
  langDockerfile, langMakefile, langPowershell, langGraphql, langHaskell,
  langScala, langPhp, langPerl, langTsx, langJsx,
];

/** Map common aliases to Shiki language IDs */
export const LANGUAGE_ALIASES: Record<string, string> = {
  py: "python", js: "javascript", ts: "typescript",
  sh: "bash", zsh: "bash", yml: "yaml", rs: "rust",
  rb: "ruby", cs: "csharp", "c++": "cpp", "c#": "csharp",
  kt: "kotlin", hs: "haskell", tex: "latex",
  docker: "dockerfile", make: "makefile", ps1: "powershell",
  gql: "graphql", text: "text", txt: "text",
  plaintext: "text", plain: "text",
};

/** Map file extensions to language IDs */
export const EXT_TO_LANG: Record<string, string> = {
  ".py": "python", ".js": "javascript", ".ts": "typescript",
  ".jsx": "jsx", ".tsx": "tsx",
  ".java": "java", ".c": "c", ".h": "c",
  ".cpp": "cpp", ".cc": "cpp", ".cxx": "cpp", ".hpp": "cpp",
  ".cs": "csharp", ".rs": "rust", ".go": "go",
  ".sh": "bash", ".bash": "bash", ".zsh": "bash",
  ".html": "html", ".htm": "html",
  ".css": "css", ".json": "json", ".yaml": "yaml", ".yml": "yaml",
  ".toml": "toml", ".sql": "sql", ".md": "markdown",
  ".tex": "latex", ".r": "r", ".rb": "ruby",
  ".lua": "lua", ".swift": "swift", ".kt": "kotlin",
  ".xml": "xml", ".diff": "diff", ".patch": "diff",
  ".dockerfile": "dockerfile",
  ".ps1": "powershell", ".graphql": "graphql", ".gql": "graphql",
  ".hs": "haskell", ".scala": "scala", ".sc": "scala",
  ".php": "php", ".pl": "perl", ".pm": "perl",
  ".makefile": "makefile",
};

export class Highlighter {
  private core: HighlighterCore | null = null;
  private loadedLanguages: Set<string> = new Set();

  async init(): Promise<void> {
    this.core = await createHighlighterCore({
      themes: ALL_THEMES,
      langs: ALL_LANGS,
      engine: createJavaScriptRegexEngine(),
    });
    for (const lang of this.core.getLoadedLanguages()) {
      this.loadedLanguages.add(lang);
    }
  }

  dispose(): void {
    this.core?.dispose();
    this.core = null;
  }

  /** Resolve a raw language string (from code fence or alias) to a Shiki language ID */
  resolveLanguage(raw: string): string {
    const lower = raw.toLowerCase().trim();
    if (!lower) return "text";
    if (LANGUAGE_ALIASES[lower]) return LANGUAGE_ALIASES[lower];
    if (this.loadedLanguages.has(lower)) return lower;
    return "text";
  }

  /** Resolve a file extension to a language ID */
  resolveExtension(ext: string): string {
    return EXT_TO_LANG[ext.toLowerCase()] || "text";
  }

  /** Generate highlighted HTML for code */
  highlight(code: string, lang: string, theme: GruvboxVariant): string | null {
    if (!this.core) return null;
    try {
      const resolved = this.loadedLanguages.has(lang) ? lang : "text";
      return this.core.codeToHtml(code, { lang: resolved, theme });
    } catch {
      return null;
    }
  }
}

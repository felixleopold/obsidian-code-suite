/** Highlighter module — manages Shiki highlighter lifecycle */

import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import type { CustomTheme } from "./settings";

// ─── Theme imports (all 65 bundled Shiki themes) ────────────
import gruvboxDarkHard from "shiki/themes/gruvbox-dark-hard.mjs";
import gruvboxDarkMedium from "shiki/themes/gruvbox-dark-medium.mjs";
import gruvboxDarkSoft from "shiki/themes/gruvbox-dark-soft.mjs";
import gruvboxLightHard from "shiki/themes/gruvbox-light-hard.mjs";
import gruvboxLightMedium from "shiki/themes/gruvbox-light-medium.mjs";
import gruvboxLightSoft from "shiki/themes/gruvbox-light-soft.mjs";
import catppuccinFrappe from "shiki/themes/catppuccin-frappe.mjs";
import catppuccinLatte from "shiki/themes/catppuccin-latte.mjs";
import catppuccinMacchiato from "shiki/themes/catppuccin-macchiato.mjs";
import catppuccinMocha from "shiki/themes/catppuccin-mocha.mjs";
import githubDark from "shiki/themes/github-dark.mjs";
import githubDarkDefault from "shiki/themes/github-dark-default.mjs";
import githubDarkDimmed from "shiki/themes/github-dark-dimmed.mjs";
import githubDarkHighContrast from "shiki/themes/github-dark-high-contrast.mjs";
import githubLight from "shiki/themes/github-light.mjs";
import githubLightDefault from "shiki/themes/github-light-default.mjs";
import githubLightHighContrast from "shiki/themes/github-light-high-contrast.mjs";
import materialTheme from "shiki/themes/material-theme.mjs";
import materialDarker from "shiki/themes/material-theme-darker.mjs";
import materialLighter from "shiki/themes/material-theme-lighter.mjs";
import materialOcean from "shiki/themes/material-theme-ocean.mjs";
import materialPalenight from "shiki/themes/material-theme-palenight.mjs";
import ayuDark from "shiki/themes/ayu-dark.mjs";
import ayuLight from "shiki/themes/ayu-light.mjs";
import ayuMirage from "shiki/themes/ayu-mirage.mjs";
import rosePine from "shiki/themes/rose-pine.mjs";
import rosePineDawn from "shiki/themes/rose-pine-dawn.mjs";
import rosePineMoon from "shiki/themes/rose-pine-moon.mjs";
import vitesseBlack from "shiki/themes/vitesse-black.mjs";
import vitesseDark from "shiki/themes/vitesse-dark.mjs";
import vitesseLight from "shiki/themes/vitesse-light.mjs";
import kanagawaDragon from "shiki/themes/kanagawa-dragon.mjs";
import kanagawaLotus from "shiki/themes/kanagawa-lotus.mjs";
import kanagawaWave from "shiki/themes/kanagawa-wave.mjs";
import everforestDark from "shiki/themes/everforest-dark.mjs";
import everforestLight from "shiki/themes/everforest-light.mjs";
import dracula from "shiki/themes/dracula.mjs";
import draculaSoft from "shiki/themes/dracula-soft.mjs";
import solarizedDark from "shiki/themes/solarized-dark.mjs";
import solarizedLight from "shiki/themes/solarized-light.mjs";
import nightOwl from "shiki/themes/night-owl.mjs";
import nightOwlLight from "shiki/themes/night-owl-light.mjs";
import oneDarkPro from "shiki/themes/one-dark-pro.mjs";
import oneLight from "shiki/themes/one-light.mjs";
import horizon from "shiki/themes/horizon.mjs";
import horizonBright from "shiki/themes/horizon-bright.mjs";
import tokyoNight from "shiki/themes/tokyo-night.mjs";
import nord from "shiki/themes/nord.mjs";
import monokai from "shiki/themes/monokai.mjs";
import andromeeda from "shiki/themes/andromeeda.mjs";
import auroraX from "shiki/themes/aurora-x.mjs";
import darkPlus from "shiki/themes/dark-plus.mjs";
import houston from "shiki/themes/houston.mjs";
import laserwave from "shiki/themes/laserwave.mjs";
import lightPlus from "shiki/themes/light-plus.mjs";
import minDark from "shiki/themes/min-dark.mjs";
import minLight from "shiki/themes/min-light.mjs";
import plastic from "shiki/themes/plastic.mjs";
import poimandres from "shiki/themes/poimandres.mjs";
import red from "shiki/themes/red.mjs";
import slackDark from "shiki/themes/slack-dark.mjs";
import slackOchin from "shiki/themes/slack-ochin.mjs";
import snazzyLight from "shiki/themes/snazzy-light.mjs";
import synthwave84 from "shiki/themes/synthwave-84.mjs";
import vesper from "shiki/themes/vesper.mjs";

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
  catppuccinFrappe, catppuccinLatte, catppuccinMacchiato, catppuccinMocha,
  githubDark, githubDarkDefault, githubDarkDimmed, githubDarkHighContrast,
  githubLight, githubLightDefault, githubLightHighContrast,
  materialTheme, materialDarker, materialLighter, materialOcean, materialPalenight,
  ayuDark, ayuLight, ayuMirage,
  rosePine, rosePineDawn, rosePineMoon,
  vitesseBlack, vitesseDark, vitesseLight,
  kanagawaDragon, kanagawaLotus, kanagawaWave,
  everforestDark, everforestLight,
  dracula, draculaSoft,
  solarizedDark, solarizedLight,
  nightOwl, nightOwlLight,
  oneDarkPro, oneLight,
  horizon, horizonBright,
  tokyoNight, nord, monokai,
  andromeeda, auroraX, darkPlus, houston, laserwave, lightPlus,
  minDark, minLight, plastic, poimandres, red,
  slackDark, slackOchin, snazzyLight, synthwave84, vesper,
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
  private loadedThemes: Set<string> = new Set();

  async init(): Promise<void> {
    this.core = await createHighlighterCore({
      themes: ALL_THEMES,
      langs: ALL_LANGS,
      engine: createJavaScriptRegexEngine(),
    });
    for (const lang of this.core.getLoadedLanguages()) {
      this.loadedLanguages.add(lang);
    }
    for (const theme of this.core.getLoadedThemes()) {
      this.loadedThemes.add(theme);
    }
  }

  dispose(): void {
    this.core?.dispose();
    this.core = null;
  }

  /** Load a custom VS Code / TextMate theme JSON into the highlighter */
  async loadCustomTheme(customTheme: CustomTheme): Promise<string | null> {
    if (!this.core) return null;
    try {
      const themeData = JSON.parse(customTheme.json);
      // Ensure the theme has a name
      if (!themeData.name) themeData.name = customTheme.name;
      this.core.loadTheme(themeData);
      const id = themeData.name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
      this.loadedThemes.add(id);
      return id;
    } catch {
      return null;
    }
  }

  /** Check if a theme is loaded */
  isThemeLoaded(theme: string): boolean {
    return this.loadedThemes.has(theme);
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
  highlight(code: string, lang: string, theme: string): string | null {
    if (!this.core) return null;
    try {
      const resolved = this.loadedLanguages.has(lang) ? lang : "text";
      const resolvedTheme = this.loadedThemes.has(theme) ? theme : "gruvbox-dark-hard";
      return this.core.codeToHtml(code, { lang: resolved, theme: resolvedTheme });
    } catch {
      return null;
    }
  }

  /** Tokenize code for editor use — returns array of lines, each with tokens */
  tokenize(code: string, lang: string, theme: string): { content: string; color?: string; fontStyle?: number }[][] | null {
    if (!this.core) return null;
    try {
      const resolved = this.loadedLanguages.has(lang) ? lang : "text";
      const resolvedTheme = this.loadedThemes.has(theme) ? theme : "gruvbox-dark-hard";
      return this.core.codeToTokensBase(code, { lang: resolved, theme: resolvedTheme });
    } catch {
      return null;
    }
  }

  /** Get the background color of a theme */
  getThemeBg(theme: string): string | null {
    if (!this.core) return null;
    try {
      const resolvedTheme = this.loadedThemes.has(theme) ? theme : "gruvbox-dark-hard";
      const themeObj = this.core.getTheme(resolvedTheme);
      return themeObj.bg || null;
    } catch {
      return null;
    }
  }

  /** Get the foreground color of a theme */
  getThemeFg(theme: string): string | null {
    if (!this.core) return null;
    try {
      const resolvedTheme = this.loadedThemes.has(theme) ? theme : "gruvbox-dark-hard";
      const themeObj = this.core.getTheme(resolvedTheme);
      return themeObj.fg || null;
    } catch {
      return null;
    }
  }
}

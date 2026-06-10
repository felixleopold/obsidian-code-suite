/** Settings types and defaults for CodeSuite plugin */

/** All bundled Shiki themes available */
export const BUNDLED_THEMES: Record<string, string> = {
  // ── Gruvbox ──
  "gruvbox-dark-hard": "Gruvbox Dark Hard",
  "gruvbox-dark-medium": "Gruvbox Dark Medium",
  "gruvbox-dark-soft": "Gruvbox Dark Soft",
  "gruvbox-light-hard": "Gruvbox Light Hard",
  "gruvbox-light-medium": "Gruvbox Light Medium",
  "gruvbox-light-soft": "Gruvbox Light Soft",
  // ── Catppuccin ──
  "catppuccin-frappe": "Catppuccin Frappé",
  "catppuccin-latte": "Catppuccin Latte",
  "catppuccin-macchiato": "Catppuccin Macchiato",
  "catppuccin-mocha": "Catppuccin Mocha",
  // ── GitHub ──
  "github-dark": "GitHub Dark",
  "github-dark-default": "GitHub Dark Default",
  "github-dark-dimmed": "GitHub Dark Dimmed",
  "github-dark-high-contrast": "GitHub Dark High Contrast",
  "github-light": "GitHub Light",
  "github-light-default": "GitHub Light Default",
  "github-light-high-contrast": "GitHub Light High Contrast",
  // ── Material ──
  "material-theme": "Material Theme",
  "material-theme-darker": "Material Darker",
  "material-theme-lighter": "Material Lighter",
  "material-theme-ocean": "Material Ocean",
  "material-theme-palenight": "Material Palenight",
  // ── Ayu ──
  "ayu-dark": "Ayu Dark",
  "ayu-light": "Ayu Light",
  "ayu-mirage": "Ayu Mirage",
  // ── Rose Pine ──
  "rose-pine": "Rosé Pine",
  "rose-pine-dawn": "Rosé Pine Dawn",
  "rose-pine-moon": "Rosé Pine Moon",
  // ── Vitesse ──
  "vitesse-black": "Vitesse Black",
  "vitesse-dark": "Vitesse Dark",
  "vitesse-light": "Vitesse Light",
  // ── Kanagawa ──
  "kanagawa-dragon": "Kanagawa Dragon",
  "kanagawa-lotus": "Kanagawa Lotus",
  "kanagawa-wave": "Kanagawa Wave",
  // ── Everforest ──
  "everforest-dark": "Everforest Dark",
  "everforest-light": "Everforest Light",
  // ── Dracula ──
  "dracula": "Dracula",
  "dracula-soft": "Dracula Soft",
  // ── Solarized ──
  "solarized-dark": "Solarized Dark",
  "solarized-light": "Solarized Light",
  // ── Night Owl ──
  "night-owl": "Night Owl",
  "night-owl-light": "Night Owl Light",
  // ── One ──
  "one-dark-pro": "One Dark Pro",
  "one-light": "One Light",
  // ── Horizon ──
  "horizon": "Horizon",
  "horizon-bright": "Horizon Bright",
  // ── Tokyo Night ──
  "tokyo-night": "Tokyo Night",
  // ── Nord ──
  "nord": "Nord",
  // ── Monokai ──
  "monokai": "Monokai",
  // ── Others ──
  "andromeeda": "Andromeeda",
  "aurora-x": "Aurora X",
  "dark-plus": "Dark+ (VS Code)",
  "houston": "Houston",
  "laserwave": "Laserwave",
  "light-plus": "Light+ (VS Code)",
  "min-dark": "Min Dark",
  "min-light": "Min Light",
  "plastic": "Plastic",
  "poimandres": "Poimandres",
  "red": "Red",
  "slack-dark": "Slack Dark",
  "slack-ochin": "Slack Ochin",
  "snazzy-light": "Snazzy Light",
  "synthwave-84": "Synthwave '84",
  "vesper": "Vesper",
};

/** Custom theme stored in settings */
export interface CustomTheme {
  name: string;
  json: string; // Raw VS Code theme JSON
}

export type ExecutionCwdMode = "vault" | "home" | "custom";

export interface CodePluginSettings {
  theme: string;
  /** Automatically switch theme based on Obsidian's dark/light mode */
  autoTheme: boolean;
  /** Theme to use in dark mode when autoTheme is enabled */
  darkAutoTheme: string;
  /** Theme to use in light mode when autoTheme is enabled */
  lightAutoTheme: string;
  showLineNumbers: boolean;
  showLanguageLabel: boolean;
  /** Soft-wrap long lines in reading view instead of showing a horizontal scrollbar. */
  wrapCodeInReadingView: boolean;
  enableExecution: boolean;
  renderEmbeddedFiles: boolean;
  /**
   * When true, `html` code blocks render as a live HTML preview by default
   * instead of showing their source. Per-block `preview`/`source` fence flags
   * override this. Either way an eligible html block gets a Preview/Code toggle.
   */
  renderHtmlBlocks: boolean;
  collapseEmbeds: boolean;
  wideCodeBlocks: boolean;
  /**
   * Show the "Clear execution session" button in the note tab/header bar.
   * Desktop only — the button is never added on mobile (no code execution there).
   */
  showClearSessionButton: boolean;
  executionTimeout: number;
  /** Working directory for code execution */
  executionCwd: ExecutionCwdMode;
  /** Custom working directory path (used when executionCwd is "custom") */
  executionCwdCustom: string;
  /** Custom Python path or virtualenv path (e.g. /path/to/venv/bin/python) */
  pythonPath: string;
  /** Custom Node.js path */
  nodePath: string;
  /** Custom path to the bash executable (used by the `bash` language). */
  bashPath: string;
  /** Custom path to the zsh executable (used by the `zsh` language). */
  zshPath: string;
  /** Custom path used by the `shell`/`sh` languages (default POSIX `/bin/sh`). */
  shPath: string;
  /** Automatically prepend `<?php` to PHP snippets that omit an opening tag. */
  autoPrependPhpOpenTag: boolean;
  /** Run Bash and Zsh code blocks as login shells. */
  shellLogin: boolean;
  /** Newline-separated absolute paths to shell files sourced before POSIX shell blocks run. */
  shellSourceFiles: string;
  /**
   * When true, each code block execution accumulates into a per-note session.
  * Later blocks can reference variables defined in earlier blocks (Python, Bash & Zsh).
   * The session lives in memory and resets when Obsidian is closed.
   */
  sharedContext: boolean;
  /** Extra environment variables for code execution (KEY=VALUE per line) */
  extraEnv: string;
  /**
   * Optional absolute path to a `.env` file. Variables defined there are
   * loaded into the process environment at execution time. `extraEnv` (and
   * any frontmatter overrides) take precedence over `.env` values.
   */
  envFilePath: string;
  /** Show a collapse toggle on inline (non-embedded) code blocks in reading view. */
  inlineCollapsible: boolean;
  /** When inlineCollapsible is on, default all inline blocks to collapsed. */
  inlineCollapsedByDefault: boolean;
  /**
   * Register code file extensions (`.py`, `.js`, etc.) with Obsidian so they
   * appear in the file explorer and open in a CodeSuite editor view.
   */
  enableCodeFileView: boolean;
  /** Default folder (relative to vault root) for "Import code file as alias". */
  codeImportsFolder: string;
  /** User-imported VS Code themes */
  customThemes: CustomTheme[];
  /**
   * Render Plotly figures as interactive HTML widgets (zoom/pan/hover preserved)
   * instead of static PNG images. PNG fallback (the old behavior) needs the
   * `kaleido` package; the interactive path does not.
   */
  interactivePlots: boolean;
  /**
   * Embed plotly.js inline in interactive plot output so it works offline.
   * Larger output; when false, plotly.js is loaded from a CDN (needs internet).
   */
  embedPlotlyJs: boolean;
  /**
   * Matplotlib style applied before user code runs. Accepts any matplotlib
   * built-in style name (e.g. `dark_background`, `seaborn-v0_8`) or an
   * absolute path to a `.mplstyle` file. Leave blank to use matplotlib defaults.
   */
  matplotlibStyle: string;
  /**
   * Experimental: expose markdown tables to code as variables via a
   * `%% codesuite: <name> [as <shape>] %%` directive (or a `var | value`
   * header). Off by default.
   */
  experimentalTables: boolean;
  /**
   * Last plugin version for which the one-time upgrade notice was shown.
   * Empty on a fresh install. Used to surface breaking-change notices once
   * to users upgrading across them; not user-facing.
   */
  lastNoticeVersion: string;
}

export const DEFAULT_SETTINGS: CodePluginSettings = {
  theme: "gruvbox-dark-hard",
  autoTheme: false,
  darkAutoTheme: "gruvbox-dark-hard",
  lightAutoTheme: "github-light",
  showLineNumbers: true,
  showLanguageLabel: true,
  wrapCodeInReadingView: true,
  enableExecution: true,
  renderEmbeddedFiles: true,
  renderHtmlBlocks: false,
  collapseEmbeds: true,
  wideCodeBlocks: false,
  showClearSessionButton: true,
  executionTimeout: 30000,
  executionCwd: "vault",
  executionCwdCustom: "",
  pythonPath: "",
  nodePath: "",
  bashPath: "",
  zshPath: "",
  shPath: "",
  autoPrependPhpOpenTag: true,
  shellLogin: false,
  shellSourceFiles: "",
  extraEnv: "",
  envFilePath: "",
  inlineCollapsible: false,
  inlineCollapsedByDefault: false,
  enableCodeFileView: true,
  codeImportsFolder: "CodeSuiteImports",
  sharedContext: true,
  interactivePlots: true,
  embedPlotlyJs: false,
  matplotlibStyle: "dark_background",
  experimentalTables: false,
  customThemes: [],
  lastNoticeVersion: "",
};

/** Parse extra env string (KEY=VALUE per line) into Record */
export function parseExtraEnv(envStr: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of envStr.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      let val = trimmed.slice(eqIdx + 1).trim();
      // Strip surrounding single or double quotes (common when copy-pasting shell assignments)
      if (val.length >= 2 &&
          ((val.startsWith('"') && val.endsWith('"')) ||
           (val.startsWith("'") && val.endsWith("'")))) {
        val = val.slice(1, -1);
      }
      result[trimmed.slice(0, eqIdx).trim()] = val;
    }
  }
  return result;
}

/** Parse newline-separated shell source files from settings. */
export function parseShellSourceFiles(sourceFiles: string): string[] {
  const result: string[] = [];
  for (const line of sourceFiles.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    result.push(trimmed);
  }
  return result;
}

/**
 * Parse a `.env` file. Supports `KEY=value`, `export KEY=value`,
 * surrounding quotes, and `#` comments. Returns {} on read/parse failure.
 */
export function parseDotEnvFile(filePath: string): Record<string, string> {
  if (!filePath) return {};
  try {
    const nodeRequire = (window as unknown as { require: (id: string) => unknown }).require;
    const fs = nodeRequire("fs") as typeof import("fs");
    if (!fs.existsSync(filePath)) return {};
    const text = fs.readFileSync(filePath, "utf-8");
    const stripped = text
      .split("\n")
      .map((l) => l.replace(/^\s*export\s+/, ""))
      .join("\n");
    return parseExtraEnv(stripped);
  } catch {
    return {};
  }
}

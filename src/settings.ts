/** Settings types and defaults for Obsidian Code plugin */

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

export interface CodePluginSettings {
  theme: string;
  showLineNumbers: boolean;
  showLanguageLabel: boolean;
  enableExecution: boolean;
  renderEmbeddedFiles: boolean;
  collapseEmbeds: boolean;
  wideCodeBlocks: boolean;
  executionTimeout: number;
  /** Custom Python path or virtualenv path (e.g. /path/to/venv/bin/python) */
  pythonPath: string;
  /** Custom Node.js path */
  nodePath: string;
  /** Extra environment variables for code execution (KEY=VALUE per line) */
  extraEnv: string;
  /** User-imported VS Code themes */
  customThemes: CustomTheme[];
}

export const DEFAULT_SETTINGS: CodePluginSettings = {
  theme: "gruvbox-dark-hard",
  showLineNumbers: true,
  showLanguageLabel: true,
  enableExecution: true,
  renderEmbeddedFiles: true,
  collapseEmbeds: true,
  wideCodeBlocks: false,
  executionTimeout: 30000,
  pythonPath: "",
  nodePath: "",
  extraEnv: "",
  customThemes: [],
};

/** Parse extra env string (KEY=VALUE per line) into Record */
export function parseExtraEnv(envStr: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of envStr.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      result[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
    }
  }
  return result;
}

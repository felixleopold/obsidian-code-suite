/** Settings types and defaults for Obsidian Code plugin */

export type GruvboxVariant =
  | "gruvbox-dark-hard"
  | "gruvbox-dark-medium"
  | "gruvbox-dark-soft"
  | "gruvbox-light-hard"
  | "gruvbox-light-medium"
  | "gruvbox-light-soft";

export interface CodePluginSettings {
  theme: GruvboxVariant;
  showLineNumbers: boolean;
  showLanguageLabel: boolean;
  enableExecution: boolean;
  renderEmbeddedFiles: boolean;
  wideCodeBlocks: boolean;
  executionTimeout: number;
  /** Custom Python path or virtualenv path (e.g. /path/to/venv/bin/python) */
  pythonPath: string;
  /** Custom Node.js path */
  nodePath: string;
  /** Extra environment variables for code execution (KEY=VALUE per line) */
  extraEnv: string;
}

export const DEFAULT_SETTINGS: CodePluginSettings = {
  theme: "gruvbox-dark-hard",
  showLineNumbers: true,
  showLanguageLabel: true,
  enableExecution: true,
  renderEmbeddedFiles: true,
  wideCodeBlocks: false,
  executionTimeout: 30000,
  pythonPath: "",
  nodePath: "",
  extraEnv: "",
};

export const THEME_NAMES: Record<GruvboxVariant, string> = {
  "gruvbox-dark-hard": "Gruvbox Dark Hard",
  "gruvbox-dark-medium": "Gruvbox Dark Medium",
  "gruvbox-dark-soft": "Gruvbox Dark Soft",
  "gruvbox-light-hard": "Gruvbox Light Hard",
  "gruvbox-light-medium": "Gruvbox Light Medium",
  "gruvbox-light-soft": "Gruvbox Light Soft",
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

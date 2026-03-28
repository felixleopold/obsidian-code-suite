/** Settings types and defaults for Obsidian Code plugin */

export type GruvboxVariant =
  | "gruvbox-dark-hard"
  | "gruvbox-dark-medium"
  | "gruvbox-dark-soft"
  | "gruvbox-light-hard"
  | "gruvbox-light-medium"
  | "gruvbox-light-soft";

export interface CodePluginSettings {
  /** Which Gruvbox theme variant to use */
  theme: GruvboxVariant;
  /** Show line numbers in code blocks */
  showLineNumbers: boolean;
  /** Show language label badge */
  showLanguageLabel: boolean;
  /** Enable run button for executable languages */
  enableExecution: boolean;
  /** Render embedded code files (![[file.py]]) as syntax-highlighted blocks */
  renderEmbeddedFiles: boolean;
  /** Use wider width for code blocks (break out of content width) */
  wideCodeBlocks: boolean;
  /** Timeout for code execution in ms */
  executionTimeout: number;
}

export const DEFAULT_SETTINGS: CodePluginSettings = {
  theme: "gruvbox-dark-hard",
  showLineNumbers: true,
  showLanguageLabel: true,
  enableExecution: true,
  renderEmbeddedFiles: true,
  wideCodeBlocks: true,
  executionTimeout: 30000,
};

/** Map Gruvbox variant to human-readable name */
export const THEME_NAMES: Record<GruvboxVariant, string> = {
  "gruvbox-dark-hard": "Gruvbox Dark Hard",
  "gruvbox-dark-medium": "Gruvbox Dark Medium",
  "gruvbox-dark-soft": "Gruvbox Dark Soft",
  "gruvbox-light-hard": "Gruvbox Light Hard",
  "gruvbox-light-medium": "Gruvbox Light Medium",
  "gruvbox-light-soft": "Gruvbox Light Soft",
};

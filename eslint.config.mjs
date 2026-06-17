import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

// Globals provided by the Obsidian runtime / browser DOM that aren't declared
// in plain eslint's defaults. Listed here so the linter doesn't flag every
// usage as "no-undef".
const OBSIDIAN_GLOBALS = {
  createEl: "readonly",
  createDiv: "readonly",
  createSpan: "readonly",
  createFragment: "readonly",
  activeDocument: "readonly",
  activeWindow: "readonly",
  document: "readonly",
  window: "readonly",
  navigator: "readonly",
  atob: "readonly",
  Blob: "readonly",
  Uint8Array: "readonly",
  ClipboardItem: "readonly",
  globalThis: "readonly",
  requestAnimationFrame: "readonly",
  cancelAnimationFrame: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  console: "readonly",
  DOMParser: "readonly",
  HTMLElement: "readonly",
  HTMLInputElement: "readonly",
  HTMLTextAreaElement: "readonly",
  HTMLButtonElement: "readonly",
  Element: "readonly",
  Node: "readonly",
  File: "readonly",
  Notice: "readonly",
  // Node.js (executor.ts loads these via require at runtime)
  process: "readonly",
  Buffer: "readonly",
};

// Proper nouns / brand names / command identifiers that legitimately appear
// capitalised inside UI strings. Excluded from the sentence-case rule.
const SENTENCE_CASE_IGNORES = [
  "Shiki",
  "Python",
  "Jupyter",
  "A4",
  "JavaScript",
  "TypeScript",
  "Bash",
  "Node\\.?js",
  "Obsidian",
  "VS Code",
  "Plotly(?:\\.js)?",
  "Matplotlib",
  "HTML",
  "CDN",
  "Ctrl\\+Shift\\+P",
  "CodeSuite\\w*",
  "Generate Color Theme From Current Settings",
  "Clear execution session",
  "Extra environment variables",
  "Import code file as alias",
  "Bake code outputs into note",
  "Clear baked outputs from note",
  "Vault",
];

export default defineConfig([
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: "./tsconfig.json" },
      globals: OBSIDIAN_GLOBALS,
    },
    rules: {
      "obsidianmd/ui/sentence-case": ["error", { ignoreRegex: SENTENCE_CASE_IGNORES }],
      // Allow `catch (_e)` / `catch (_err)` — leading underscore is the project
      // convention for "intentionally ignored caught error".
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
]);

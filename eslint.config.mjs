import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: "./tsconfig.json" },
    },
    rules: {
      // "Shiki" is a proper brand name (third-party syntax highlighting library) that cannot
      // follow standard sentence case — it must always be capitalised as a brand.
      "obsidianmd/ui/sentence-case": ["error", { ignoreRegex: ["Shiki"] }],
    },
  },
]);

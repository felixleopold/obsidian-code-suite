import { fenceLanguage } from "./block-options";
import { EXT_TO_LANG, LANGUAGE_ALIASES } from "./highlighter";
import { scanMarkdownCode } from "./markdown-code-context";

/** First extension per language; `.md` is skipped because `![[x.md]]` transcludes a note. */
const LANG_TO_EXT = new Map<string, string>();
for (const [ext, lang] of Object.entries(EXT_TO_LANG)) {
  if (ext !== ".md" && !LANG_TO_EXT.has(lang)) LANG_TO_EXT.set(lang, ext);
}

/** Fence flags an html embed alias understands (`![[page.html|preview pdf]]`). */
const HTML_ALIAS_FLAGS = new Set([
  "preview", "render", "source", "raw", "code", "pdf", "export", "nopdf", "template", "notemplate",
]);

export interface CodeBlockMove {
  /** Opening and closing fence lines (1-based). */
  openLine: number;
  closeLine: number;
  /** Container prefix of the opening fence (quote markers, list indentation), kept on the embed line. */
  prefix: string;
  /** Fence body without container prefixes. */
  code: string;
  lang: string;
  /** Code file extension whose embed resolves to the same language, if any. */
  ext: string | null;
  /** Fence options carried into the embed alias, and the ones the embed can't express. */
  aliasFlags: string[];
  dropped: string[];
}

/** Describe moving the closed fence that contains `lineNumber` into its own code file. */
export function codeBlockMoveAt(source: string, lineNumber: number): CodeBlockMove | null {
  const fence = scanMarkdownCode(source).fences.find((block) =>
    block.closeLine !== undefined && block.openLine <= lineNumber && lineNumber <= block.closeLine,
  );
  if (!fence?.closeLine) return null;
  const lines = source.split("\n");
  const opening = lines[fence.openLine - 1];
  const lang = fenceLanguage(fence.info).toLowerCase();
  const ext = LANG_TO_EXT.get(LANGUAGE_ALIASES[lang] ?? lang) ?? null;
  const options = fence.info.split(/\s+/).slice(1).filter(Boolean);
  const carried = (option: string) => ext === ".html" && HTML_ALIAS_FLAGS.has(option.toLowerCase());
  return {
    openLine: fence.openLine,
    closeLine: fence.closeLine,
    prefix: opening.slice(0, opening.search(/`{3,}|~{3,}/)),
    code: [...fence.lines].map(([line, { offset }]) => lines[line - 1].slice(offset)).join("\n"),
    lang,
    ext,
    aliasFlags: options.filter(carried),
    dropped: options.filter((option) => !carried(option)),
  };
}

/** The line replacing the fence: its container prefix plus the link as an embed. */
export function embedLine(prefix: string, link: string): string {
  return prefix + (link.startsWith("!") ? link : `!${link}`);
}

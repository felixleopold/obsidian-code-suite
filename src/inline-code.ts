import { Decoration, ViewPlugin } from "@codemirror/view";
import type { DecorationSet, EditorView, ViewUpdate } from "@codemirror/view";
import type { Range } from "@codemirror/state";

export interface InlineCodeToken {
  content: string;
  color?: string;
  fontStyle?: number;
}

export interface InlineCodeHighlighter {
  resolveLanguage(raw: string): string;
  tokenize(code: string, lang: string, theme: string): InlineCodeToken[][] | null;
}

export interface InlineCodeOptions {
  highlighter: InlineCodeHighlighter;
  theme: string;
  styleInlineCode: boolean;
  highlightInlineCode: boolean;
}

export interface LanguageInlineCode {
  language: string;
  code: string;
  codeOffset: number;
}

export interface InlineCodeSpan {
  from: number;
  to: number;
  markerFrom: number;
  markerTo: number;
  text: string;
}

const PLAIN_TEXT_LANGUAGES = new Set(["text", "txt", "plaintext", "plain"]);

/** Parse CodeSuite's `{lang} code` form without deciding whether lang is known. */
export function parseLanguageInlineCode(text: string): LanguageInlineCode | null {
  const match = /^\{([^{}\s]+)\}[ \t]?/.exec(text);
  if (!match) return null;
  return {
    language: match[1].toLowerCase(),
    code: text.slice(match[0].length),
    codeOffset: match[0].length,
  };
}

function resolveInlineLanguage(
  parsed: LanguageInlineCode,
  highlighter: InlineCodeHighlighter,
): string | null {
  const resolved = highlighter.resolveLanguage(parsed.language);
  if (resolved !== "text" || PLAIN_TEXT_LANGUAGES.has(parsed.language)) return resolved;
  return null;
}

function applyTokenStyle(el: HTMLElement, token: InlineCodeToken): void {
  const styles: Record<string, string> = {};
  if (token.color) styles.color = token.color;
  if (token.fontStyle) {
    if (token.fontStyle & 1) styles["font-style"] = "italic";
    if (token.fontStyle & 2) styles["font-weight"] = "bold";
    if (token.fontStyle & 4) styles["text-decoration"] = "underline";
  }
  el.setCssProps(styles);
}

/** Style ordinary inline code and highlight recognized `{lang}` spans in reading view. */
export function processInlineCode(root: HTMLElement, options: InlineCodeOptions): void {
  for (const codeEl of Array.from(root.querySelectorAll<HTMLElement>("code"))) {
    if (codeEl.closest("pre")) continue;
    if (options.styleInlineCode) codeEl.addClass("ocode-inline-code");
    if (codeEl.hasClass("ocode-var-ref")) continue;
    if (!options.highlightInlineCode || codeEl.hasAttribute("data-ocode-inline-language")) continue;

    const parsed = parseLanguageInlineCode(codeEl.textContent ?? "");
    if (!parsed) continue;
    const language = resolveInlineLanguage(parsed, options.highlighter);
    if (!language) continue;
    const tokenLines = options.highlighter.tokenize(parsed.code, language, options.theme);
    if (!tokenLines) continue;

    codeEl.textContent = "";
    codeEl.addClass("ocode-inline-code-highlighted");
    codeEl.setAttribute("data-ocode-inline-language", language);
    tokenLines.forEach((line, lineIndex) => {
      if (lineIndex > 0) codeEl.appendText("\n");
      for (const token of line) {
        const span = codeEl.createSpan();
        span.textContent = token.content;
        applyTokenStyle(span, token);
      }
    });
  }
}

/** Find single-line Markdown code spans outside fenced code blocks. */
export function scanInlineCodeSpans(source: string): InlineCodeSpan[] {
  const spans: InlineCodeSpan[] = [];
  let activeFence: { marker: string; length: number } | null = null;
  let lineFrom = 0;

  const isEscaped = (line: string, position: number) => {
    let slashes = 0;
    for (let index = position - 1; index >= 0 && line[index] === "\\"; index--) slashes++;
    return slashes % 2 === 1;
  };

  while (lineFrom <= source.length) {
    const newline = source.indexOf("\n", lineFrom);
    const lineTo = newline === -1 ? source.length : newline;
    const line = source.slice(lineFrom, lineTo);
    // Remove quote/list containers before recognizing a fence. Arbitrary
    // indentation is accepted after the container so nested-list fences and
    // indented code are both safely excluded from inline decoration.
    const containerPrefix = /^(?:(?:[ \t]*>[ \t]?)|(?:[ \t]*(?:[-+*]|\d+[.)])[ \t]+))*/.exec(line)?.[0] ?? "";
    const rest = line.slice(containerPrefix.length);
    const fence = /^[ \t]*(`{3,}|~{3,})(.*)$/.exec(rest);

    if (activeFence) {
      if (fence && fence[1][0] === activeFence.marker
          && fence[1].length >= activeFence.length && !fence[2].trim()) {
        activeFence = null;
      }
    } else if (fence && (fence[1][0] === "~" || !fence[2].includes("`"))) {
      activeFence = { marker: fence[1][0], length: fence[1].length };
    } else if (!/^(?: {4}|\t)/.test(line)) {
      let cursor = 0;
      while (cursor < line.length) {
        const opening = line.indexOf("`", cursor);
        if (opening === -1) break;
        if (isEscaped(line, opening)) {
          cursor = opening + 1;
          continue;
        }
        let markerLength = 1;
        while (line[opening + markerLength] === "`") markerLength++;

        let closing = opening + markerLength;
        while ((closing = line.indexOf("`", closing)) !== -1) {
          let closingLength = 1;
          while (line[closing + closingLength] === "`") closingLength++;
          // Backslashes inside the span are literal and cannot escape this.
          if (closingLength === markerLength) break;
          closing += closingLength;
        }
        if (closing === -1) {
          cursor = opening + markerLength;
          continue;
        }

        const from = lineFrom + opening + markerLength;
        const to = lineFrom + closing;
        spans.push({
          from,
          to,
          markerFrom: lineFrom + opening,
          markerTo: lineFrom + closing + markerLength,
          text: source.slice(from, to),
        });
        cursor = closing + markerLength;
      }
    }

    if (newline === -1) break;
    lineFrom = newline + 1;
  }
  return spans;
}

function tokenStyle(token: InlineCodeToken): string | null {
  if (!token.color) return null;
  let style = `color: ${token.color} !important`;
  if (token.fontStyle) {
    if (token.fontStyle & 1) style += "; font-style: italic";
    if (token.fontStyle & 2) style += "; font-weight: bold";
    if (token.fontStyle & 4) style += "; text-decoration: underline";
  }
  return style;
}

/** Build editor decorations for enhanced inline styling and `{lang}` token colors. */
export function buildInlineCodeEditorExtension(getOptions: () => InlineCodeOptions) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      private lastSignature: string;

      constructor(view: EditorView) {
        this.lastSignature = this.signature();
        this.decorations = this.buildDecorations(view);
      }

      update(update: ViewUpdate): void {
        const signature = this.signature();
        if (update.docChanged || update.viewportChanged || signature !== this.lastSignature) {
          this.lastSignature = signature;
          this.decorations = this.buildDecorations(update.view);
        }
      }

      private signature(): string {
        const options = getOptions();
        return `${options.theme}|${options.styleInlineCode}|${options.highlightInlineCode}`;
      }

      private buildDecorations(view: EditorView): DecorationSet {
        const options = getOptions();
        const decorations: Range<Decoration>[] = [];
        for (const span of scanInlineCodeSpans(view.state.doc.toString())) {
          if (options.styleInlineCode && span.markerFrom < span.markerTo) {
            decorations.push(
              Decoration.mark({ class: "ocode-inline-code" }).range(span.markerFrom, span.markerTo),
            );
          }
          if (!options.highlightInlineCode) continue;

          const parsed = parseLanguageInlineCode(span.text);
          if (!parsed) continue;
          const language = resolveInlineLanguage(parsed, options.highlighter);
          if (!language) continue;
          const tokens = options.highlighter.tokenize(parsed.code, language, options.theme)?.[0];
          if (!tokens) continue;

          let offset = span.from + parsed.codeOffset;
          for (const token of tokens) {
            const tokenFrom = offset;
            const tokenTo = tokenFrom + token.content.length;
            const style = tokenStyle(token);
            if (style && tokenFrom < tokenTo && tokenTo <= span.to) {
              decorations.push(Decoration.mark({ attributes: { style } }).range(tokenFrom, tokenTo));
            }
            offset = tokenTo;
          }
        }
        return Decoration.set(decorations, true);
      }
    },
    { decorations: (value) => value.decorations },
  );
}

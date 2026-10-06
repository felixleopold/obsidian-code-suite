import { countColumn } from "@codemirror/state";

export interface MarkdownFence {
  lang: string;
  fromLine: number;
  toLine: number;
  lines: Map<number, { offset: number; missingIndent: string }>;
}

function columnWidth(line: string, from: number, to: number): number {
  return countColumn(line, 4, to) - countColumn(line, 4, from);
}

/** Track Markdown containers so literal code is never treated as inline prose. */
export function scanMarkdownCode(source: string): { fences: MarkdownFence[]; codeLines: Set<number> } {
  const fences: MarkdownFence[] = [];
  const codeLines = new Set<number>();
  const lines = source.split("\n");
  let listIndents: number[] = [];
  let quoteDepth = 0;
  let paragraph: boolean = false;
  let open: {
    marker: string;
    length: number;
    quoteDepth: number;
    quoteIndents: number[];
    listIndent: number;
    indent: number;
    block: MarkdownFence;
  } | null = null;

  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    const line = lines[index];
    let offset = 0;
    let quotes = 0;
    const quoteIndents: number[] = [];
    let quote: RegExpExecArray | null;
    while ((!open || quotes < open.quoteDepth)
        && (quote = /^([ \t]*)>[ \t]?/.exec(line.slice(offset)))) {
      const indent = columnWidth(line, offset, offset + quote[1].length);
      const requiredIndent = open?.quoteIndents[quotes] ?? 0;
      if (indent < requiredIndent || indent > requiredIndent + 3) break;
      quoteIndents.push(requiredIndent);
      offset += quote[0].length;
      quotes++;
    }
    const leading = /^[ \t]*/.exec(line.slice(offset))?.[0] ?? "";
    const columns = columnWidth(line, offset, offset + leading.length);
    const blank = !line.slice(offset).trim();

    if (open) {
      if (quotes === open.quoteDepth && (blank || columns >= open.listIndent)) {
        const rest = line.slice(offset + leading.length);
        const closing = /^(`{3,}|~{3,})[ \t]*$/.exec(rest);
        codeLines.add(lineNumber);
        if (columns - open.listIndent <= 3 && closing
            && closing[1][0] === open.marker && closing[1].length >= open.length) {
          open.block.toLine = lineNumber - 1;
          open = null;
        } else {
          let consumed = 0;
          let width = 0;
          while (consumed < leading.length && width < open.indent) {
            consumed++;
            width = columnWidth(line, offset, offset + consumed);
          }
          open.block.lines.set(lineNumber, {
            offset: offset + consumed,
            missingIndent: " ".repeat(Math.max(0, open.indent - width)),
          });
          open.block.toLine = lineNumber;
        }
        paragraph = false;
        continue;
      }
      open = null;
      paragraph = false;
    }

    if (quotes !== quoteDepth) {
      listIndents = [];
      paragraph = paragraph && quotes < quoteDepth;
      quoteDepth = quotes;
    }
    if (!blank) {
      while (listIndents.length && columns < listIndents[listIndents.length - 1]) listIndents.pop();
    }
    let listIndent = listIndents[listIndents.length - 1] ?? 0;
    let restOffset = offset + leading.length;
    let rest = line.slice(restOffset);
    let relativeIndent = columns - listIndent;
    const thematic = /^(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(rest);
    while (relativeIndent <= 3 && !thematic) {
      const item = /^([-+*]|\d{1,9}[.)])([ \t]+|$)/.exec(rest);
      const nestedQuote = /^>[ \t]?/.exec(rest);
      if (item) {
        const padding = columnWidth(line, restOffset, restOffset + item[0].length) - item[1].length;
        const prefixLength = padding > 4 ? item[1].length + 1 : item[0].length;
        listIndent += relativeIndent + columnWidth(line, restOffset, restOffset + prefixLength);
        listIndents.push(listIndent);
        restOffset += prefixLength;
      } else if (nestedQuote) {
        quoteIndents.push(listIndent);
        quotes++;
        quoteDepth = quotes;
        listIndent = 0;
        listIndents = [];
        restOffset += nestedQuote[0].length;
      } else {
        break;
      }
      const containerLeading = /^[ \t]*/.exec(line.slice(restOffset))?.[0] ?? "";
      relativeIndent = columnWidth(line, restOffset, restOffset + containerLeading.length);
      restOffset += containerLeading.length;
      rest = line.slice(restOffset);
      paragraph = false;
    }
    const marker = relativeIndent <= 3 ? /^(`{3,}|~{3,})(.*)$/.exec(rest) : null;
    if (marker && (marker[1][0] === "~" || !marker[2].includes("`"))) {
      const block: MarkdownFence = {
        lang: marker[2].trim().split(/\s/)[0].toLowerCase(),
        fromLine: lineNumber + 1,
        toLine: lineNumber,
        lines: new Map(),
      };
      fences.push(block);
      open = {
        marker: marker[1][0], length: marker[1].length,
        quoteDepth: quotes, quoteIndents, listIndent,
        indent: listIndent + relativeIndent, block,
      };
      codeLines.add(lineNumber);
      paragraph = false;
      continue;
    }
    const indentedCode: boolean = relativeIndent >= 4 && !paragraph && !blank;
    if (indentedCode) codeLines.add(lineNumber);
    const boundary: boolean = relativeIndent <= 3 && (thematic
      || (paragraph && /^(?:=+|-+)[ \t]*$/.test(rest))
      || /^#{1,6}(?:[ \t]|$)/.test(rest));
    paragraph = !blank && !indentedCode && !boundary;
  }
  return { fences, codeLines };
}

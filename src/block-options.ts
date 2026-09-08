export type LineRange = readonly [number, number];

export interface BlockOptions {
  flags: Set<string>;
  title?: string;
  static?: boolean;
  showLineNumbers?: boolean;
  collapsed?: boolean;
  highlight: LineRange[];
  insert: LineRange[];
  delete: LineRange[];
}

function parseRanges(value: string): LineRange[] {
  const ranges: LineRange[] = [];
  if (!value.startsWith("{") || !value.endsWith("}")) return ranges;
  for (const part of value.slice(1, -1).split(",")) {
    const match = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(part);
    if (!match) continue;
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (Number.isSafeInteger(start) && Number.isSafeInteger(end) && start > 0 && end >= start) {
      ranges.push([start, end]);
    }
  }
  return ranges;
}

/** Parse the complete info string following the fence, including its language. */
export function parseBlockOptions(info: string): BlockOptions {
  const options: BlockOptions = {
    flags: new Set<string>(),
    highlight: [],
    insert: [],
    delete: [],
  };
  // Keep quoted titles and spaced line ranges together as single attributes.
  const attributes = info.trim().replace(/^\S+\s*/, "");
  const tokens = attributes.match(/(?:[^\s"'{}]+|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\{[^}]*\})+/g) ?? [];
  for (const token of tokens) {
    if (token.startsWith("{")) {
      options.highlight.push(...parseRanges(token));
      continue;
    }
    const match = /^([^=:]+)(?:[=:](.*))?$/.exec(token);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = match[2];
    if (value === undefined) options.flags.add(key);
    if (key === "title" && value !== undefined) {
      const quote = value[0];
      options.title = (quote === '"' || quote === "'") && value.endsWith(quote)
        ? value.slice(1, -1).replace(/\\([\\"'])/g, "$1")
        : value;
      continue;
    }
    if (key === "ins" || key === "del") {
      options[key === "ins" ? "insert" : "delete"].push(...parseRanges(value ?? ""));
      continue;
    }
    const boolean = value === undefined || value.toLowerCase() === "true"
      ? true
      : value.toLowerCase() === "false" ? false : undefined;
    if (boolean === undefined) continue;
    switch (key) {
      case "static": options.static = boolean; break;
      case "showlinenumbers":
      case "ln": options.showLineNumbers = boolean; break;
      case "hidelinenumbers": options.showLineNumbers = !boolean; break;
      case "collapse":
      case "collapsed":
      case "fold": options.collapsed = boolean; break;
      case "expanded": options.collapsed = !boolean; break;
    }
  }
  return options;
}

export function isStaticBlock(options: BlockOptions, defaultStatic = false): boolean {
  return options.static ?? defaultStatic;
}

/** Source fences for matching rendered blocks without relying on DOM order. */
export function fencedBlockInfos(source: string): { info: string; code: string; line: number }[] {
  const blocks: { info: string; code: string; line: number }[] = [];
  const lines = source.split("\n");
  for (let index = 0; index < lines.length; index++) {
    let opening = lines[index];
    let quoteDepth = 0;
    while (/^[ \t]*>[ \t]?/.test(opening)) {
      opening = opening.replace(/^[ \t]*>[ \t]?/, "");
      quoteDepth++;
    }
    opening = opening.replace(/^([ \t]*)(?:[-+*]|\d+[.)])([ \t]+)/, (match: string) => " ".repeat(match.length));
    const fence = /^([ \t]*)(`{3,}|~{3,})(.*)$/.exec(opening);
    if (!fence || (fence[2][0] === "`" && fence[3].includes("`"))) continue;
    const line = index;
    const content: string[] = [];
    while (++index < lines.length) {
      let text = lines[index];
      for (let depth = 0; depth < quoteDepth; depth++) text = text.replace(/^[ \t]*>[ \t]?/, "");
      const closing = /^[ \t]*(`{3,}|~{3,})[ \t]*$/.exec(text);
      if (closing && closing[1][0] === fence[2][0] && closing[1].length >= fence[2].length) break;
      let indent = 0;
      while (indent < fence[1].length && (text[indent] === " " || text[indent] === "\t")) indent++;
      content.push(text.slice(indent));
    }
    blocks.push({ info: fence[3].trim(), code: content.join("\n"), line });
  }
  return blocks;
}

/** Fingerprint fence option lines without changing when only block code changes. */
export function fencedBlockOptionsSignature(source: string): string {
  return fencedBlockInfos(source)
    .map(({ line, info }) => `${line}:${info}`)
    .join("\0");
}

export function lineHighlightClass(
  options: BlockOptions,
  lineNumber: number,
  text: string,
  lang: string,
): string {
  const contains = (ranges: LineRange[]) => ranges.some(([start, end]) => lineNumber >= start && lineNumber <= end);
  if (contains(options.delete)) return "ocode-line-delete";
  if (contains(options.insert)) return "ocode-line-insert";
  if (contains(options.highlight)) return "ocode-line-highlight";
  if (lang.toLowerCase() === "diff") {
    if (text.startsWith("+") && !/^\+\+\+\s/.test(text)) return "ocode-line-insert";
    if (text.startsWith("-") && !/^---\s/.test(text)) return "ocode-line-delete";
  }
  return "";
}

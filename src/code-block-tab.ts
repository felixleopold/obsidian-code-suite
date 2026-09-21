import { countColumn, Prec } from "@codemirror/state";
import type { EditorState, Text } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import type { Command, EditorView } from "@codemirror/view";

export type CodeBlockIndentation = "auto" | "tabs" | "2-spaces" | "4-spaces" | "8-spaces";

interface EditableFence {
  lang: string;
  indent: string;
  fromLine: number;
  toLine: number;
}

interface Indentation {
  kind: "tabs" | "spaces";
  width: number;
}

interface Change {
  from: number;
  to?: number;
  insert: string;
}

function scanEditableFences(doc: Text): EditableFence[] {
  const blocks: EditableFence[] = [];
  let open: { marker: string; lang: string; indent: string; line: number } | null = null;

  for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber++) {
    const line = doc.line(lineNumber);
    const trimmed = line.text.trimStart();
    const marker = /^(`{3,}|~{3,})(.*)$/.exec(trimmed);
    if (!open) {
      if (!marker || (marker[1][0] === "`" && marker[2].includes("`"))) continue;
      open = {
        marker: marker[1],
        lang: marker[2].trim().split(/\s/)[0].toLowerCase(),
        indent: line.text.slice(0, line.text.length - trimmed.length),
        line: lineNumber,
      };
      continue;
    }

    if (marker && marker[1][0] === open.marker[0] && marker[1].length >= open.marker.length && !marker[2].trim()) {
      blocks.push({ lang: open.lang, indent: open.indent, fromLine: open.line + 1, toLine: lineNumber - 1 });
      open = null;
    }
  }

  if (open) {
    blocks.push({ lang: open.lang, indent: open.indent, fromLine: open.line + 1, toLine: doc.lines });
  }
  return blocks;
}

function blockAtLine(blocks: readonly EditableFence[], lineNumber: number): EditableFence | undefined {
  return blocks.find((block) => lineNumber >= block.fromLine && lineNumber <= block.toLine);
}

function stripStructuralIndent(text: string, indent: string): string {
  let offset = 0;
  while (offset < indent.length && offset < text.length && (text[offset] === " " || text[offset] === "\t")) offset++;
  return text.slice(offset);
}

function detectIndentation(doc: Text, blocks: readonly EditableFence[]): Indentation | null {
  let tabLines = 0;
  const spaceIndents: number[] = [];

  for (const block of blocks) {
    for (let lineNumber = block.fromLine; lineNumber <= block.toLine; lineNumber++) {
      const text = stripStructuralIndent(doc.line(lineNumber).text, block.indent);
      if (!text.trim()) continue;
      const leading = /^[ \t]*/.exec(text)?.[0] ?? "";
      if (leading.includes("\t") || /\S[ ]*\t[ \t]*\S/.test(text)) tabLines++;
      if (leading.length >= 2 && !leading.includes("\t")) spaceIndents.push(leading.length);
    }
  }

  if (tabLines > spaceIndents.length) return { kind: "tabs", width: 4 };
  if (spaceIndents.length === 0) return tabLines > 0 ? { kind: "tabs", width: 4 } : null;

  const candidates = [8, 4, 2];
  const width = candidates.find((candidate) => spaceIndents.every((indent) => indent % candidate === 0)) ?? 2;
  return { kind: "spaces", width };
}

function configuredIndentation(mode: CodeBlockIndentation, tabSize: number): Indentation | null {
  if (mode === "auto") return null;
  if (mode === "tabs") return { kind: "tabs", width: tabSize };
  return { kind: "spaces", width: Number.parseInt(mode, 10) };
}

function indentationForBlock(
  state: EditorState,
  blocks: readonly EditableFence[],
  block: EditableFence,
  mode: CodeBlockIndentation,
): Indentation {
  const configured = configuredIndentation(mode, state.tabSize);
  if (configured) return configured;
  const detected = detectIndentation(state.doc, [block])
    ?? detectIndentation(state.doc, blocks.filter((candidate) => candidate.lang === block.lang))
    ?? { kind: "tabs", width: state.tabSize };
  return detected.kind === "tabs" ? { ...detected, width: state.tabSize } : detected;
}

function touchedLineNumbers(state: EditorState, from: number, to: number): number[] {
  const first = state.doc.lineAt(from).number;
  const lastPosition = to > from ? to - 1 : to;
  const last = state.doc.lineAt(lastPosition).number;
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

function structuralContentOffset(text: string, indent: string): number {
  let offset = 0;
  while (offset < indent.length && offset < text.length && (text[offset] === " " || text[offset] === "\t")) offset++;
  return offset;
}

function lineIndentChange(
  state: EditorState,
  block: EditableFence,
  lineNumber: number,
  indentation: Indentation,
  outdent: boolean,
): Change | null {
  const line = state.doc.line(lineNumber);
  const offset = structuralContentOffset(line.text, block.indent);
  const position = line.from + offset;
  const content = line.text.slice(offset);

  if (!outdent) {
    const missingStructuralIndent = offset < block.indent.length
      ? block.indent.slice(offset)
      : "";
    const unit = indentation.kind === "tabs" ? "\t" : " ".repeat(indentation.width);
    return { from: position, insert: missingStructuralIndent + unit };
  }

  if (content.startsWith("\t")) return { from: position, to: position + 1, insert: "" };
  const spaces = /^ +/.exec(content)?.[0].length ?? 0;
  if (spaces === 0) return null;
  return { from: position, to: position + Math.min(spaces, indentation.width), insert: "" };
}

/** Build the text edits for Tab/Shift-Tab, or null when Obsidian should handle the key. */
export function codeBlockTabChanges(
  state: EditorState,
  mode: CodeBlockIndentation,
  outdent = false,
): Change[] | null {
  const blocks = scanEditableFences(state.doc);
  const ranges = state.selection.ranges;
  const located = ranges.map((range) => {
    const lines = touchedLineNumbers(state, range.from, range.to);
    const block = blockAtLine(blocks, lines[0]);
    return block && lines.every((line) => blockAtLine(blocks, line) === block)
      ? { range, lines, block }
      : null;
  });
  if (located.some((entry) => entry === null)) return null;

  const entries = located.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  const indentWholeLines = outdent || ranges.some((range) => !range.empty);
  if (indentWholeLines) {
    const changes = new Map<number, Change>();
    for (const { lines, block } of entries) {
      const indentation = indentationForBlock(state, blocks, block, mode);
      for (const line of lines) {
        const change = lineIndentChange(state, block, line, indentation, outdent);
        if (change) changes.set(change.from, change);
      }
    }
    return [...changes.values()].sort((a, b) => a.from - b.from);
  }

  return entries.map(({ range, block }) => {
    const indentation = indentationForBlock(state, blocks, block, mode);
    const line = state.doc.lineAt(range.from);
    const offset = structuralContentOffset(line.text, block.indent);
    const missingStructuralIndent = range.from === line.from + offset && offset < block.indent.length
      ? block.indent.slice(offset)
      : "";
    if (indentation.kind === "tabs") return { from: range.from, insert: missingStructuralIndent + "\t" };
    const prefix = line.text.slice(offset, range.from - line.from);
    const column = countColumn(prefix, state.tabSize);
    const spaces = indentation.width - (column % indentation.width);
    return { from: range.from, insert: missingStructuralIndent + " ".repeat(spaces) };
  });
}

function tabCommand(
  getSettings: () => { enabled: boolean; indentation: CodeBlockIndentation },
  outdent: boolean,
): Command {
  return (view: EditorView): boolean => {
    const settings = getSettings();
    if (!settings.enabled) return false;
    const changes = codeBlockTabChanges(view.state, settings.indentation, outdent);
    if (changes === null) return false;
    if (changes.length > 0) view.dispatch({ changes, scrollIntoView: true, userEvent: "input" });
    return true;
  };
}

export function buildCodeBlockTabExtension(
  getSettings: () => { enabled: boolean; indentation: CodeBlockIndentation },
) {
  return Prec.highest(keymap.of([{
    key: "Tab",
    run: tabCommand(getSettings, false),
    shift: tabCommand(getSettings, true),
  }]));
}

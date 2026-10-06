import { countColumn, EditorSelection, Prec } from "@codemirror/state";
import type { EditorState, Text } from "@codemirror/state";
import { keymap, ViewPlugin } from "@codemirror/view";
import { scanMarkdownCode } from "./markdown-code-context";
import type { MarkdownFence } from "./markdown-code-context";
import type { Command, EditorView } from "@codemirror/view";

export type CodeBlockIndentation = "auto" | "tabs" | "2-spaces" | "4-spaces" | "8-spaces";

interface Indentation {
  kind: "tabs" | "spaces";
  width: number;
}

interface Change {
  from: number;
  to?: number;
  insert: string;
}

function blockAtLine(blocks: readonly MarkdownFence[], lineNumber: number): MarkdownFence | undefined {
  return blocks.find((block) => lineNumber >= block.fromLine && lineNumber <= block.toLine);
}

function detectIndentation(doc: Text, blocks: readonly MarkdownFence[]): Indentation | null {
  let tabLines = 0;
  const spaceIndents: number[] = [];

  for (const block of blocks) {
    for (let lineNumber = block.fromLine; lineNumber <= block.toLine; lineNumber++) {
      const text = doc.line(lineNumber).text.slice(block.lines.get(lineNumber)?.offset ?? 0);
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
  blocks: readonly MarkdownFence[],
  block: MarkdownFence,
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

function lineIndentChange(
  state: EditorState,
  block: MarkdownFence,
  lineNumber: number,
  indentation: Indentation,
  outdent: boolean,
): Change | null {
  const line = state.doc.line(lineNumber);
  const structural = block.lines.get(lineNumber)!;
  const offset = structural.offset;
  const position = line.from + offset;
  const content = line.text.slice(offset);

  if (!outdent) {
    const missingStructuralIndent = structural.missingIndent;
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
  const blocks = scanMarkdownCode(state.doc.toString()).fences;
  const ranges = state.selection.ranges;
  const located = ranges.map((range) => {
    const lines = touchedLineNumbers(state, range.from, range.to);
    const block = blockAtLine(blocks, lines[0]);
    if (!block || !lines.every((line) => blockAtLine(blocks, line) === block)) return null;
    const firstLine = state.doc.line(lines[0]);
    if (!outdent && range.empty && range.from < firstLine.from + block.lines.get(lines[0])!.offset) return null;
    return { range, lines, block };
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
    const structural = block.lines.get(line.number)!;
    const offset = structural.offset;
    const missingStructuralIndent = range.from === line.from + offset ? structural.missingIndent : "";
    if (indentation.kind === "tabs") return { from: range.from, insert: missingStructuralIndent + "\t" };
    const prefix = line.text.slice(offset, range.from - line.from);
    const column = countColumn(prefix, state.tabSize);
    const spaces = indentation.width - (column % indentation.width);
    return { from: range.from, insert: missingStructuralIndent + " ".repeat(spaces) };
  });
}

export function codeBlockTabCommand(
  getSettings: () => { enabled: boolean; indentation: CodeBlockIndentation },
  outdent: boolean,
): Command {
  return (view: EditorView): boolean => {
    const settings = getSettings();
    if (!settings.enabled) return false;
    const changes = codeBlockTabChanges(view.state, settings.indentation, outdent);
    if (changes === null) return false;
    if (changes.length > 0) {
      const changeSet = view.state.changes(changes);
      const selection = !outdent && view.state.selection.ranges.every((range) => range.empty)
        ? EditorSelection.create(
          view.state.selection.ranges.map((range) => EditorSelection.cursor(changeSet.mapPos(range.head, 1))),
          view.state.selection.mainIndex,
        )
        : undefined;
      view.dispatch({ changes: changeSet, selection, scrollIntoView: true, userEvent: "input" });
    }
    return true;
  };
}

export function buildCodeBlockTabExtension(
  getSettings: () => { enabled: boolean; indentation: CodeBlockIndentation },
) {
  const escapeTab = ViewPlugin.fromClass(class {
    private escapeUntil = 0;
    private host: Window | null;
    private onKeyDown = (event: KeyboardEvent): void => {
      if (!event.composedPath().includes(this.view.contentDOM)) return;
      const settings = getSettings();
      if (!settings.enabled) {
        this.escapeUntil = 0;
        return;
      }
      if (event.key === "Escape" && !event.altKey && !event.ctrlKey && !event.metaKey
          && codeBlockTabChanges(this.view.state, settings.indentation) !== null) {
        this.escapeUntil = Date.now() + 2000;
        this.view.setTabFocusMode(2000);
      } else if (event.key === "Tab" && !event.altKey && !event.ctrlKey && !event.metaKey
          && Date.now() <= this.escapeUntil) {
        this.escapeUntil = 0;
        this.view.setTabFocusMode(false);
        // Obsidian's application scope otherwise indents before CM6 can escape.
        // Preserve the browser's default Tab action so focus moves naturally.
        event.stopImmediatePropagation();
      } else if (!["Shift", "Control", "Alt", "Meta"].includes(event.key)) {
        if (this.escapeUntil) this.view.setTabFocusMode(false);
        this.escapeUntil = 0;
      }
    };
    private onBlur = (event: FocusEvent): void => {
      if (!event.composedPath().includes(this.view.contentDOM)) return;
      this.escapeUntil = 0;
    };

    constructor(private view: EditorView) {
      this.host = view.dom.ownerDocument.defaultView;
      this.host?.addEventListener("keydown", this.onKeyDown, true);
      this.host?.addEventListener("blur", this.onBlur, true);
    }

    destroy(): void {
      this.host?.removeEventListener("keydown", this.onKeyDown, true);
      this.host?.removeEventListener("blur", this.onBlur, true);
    }
  });
  return [escapeTab, Prec.highest(keymap.of([{
    key: "Tab",
    run: codeBlockTabCommand(getSettings, false),
    shift: codeBlockTabCommand(getSettings, true),
  }]))];
}

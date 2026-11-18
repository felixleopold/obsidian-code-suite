import assert from "node:assert/strict";
import test from "node:test";
import { EditorSelection, EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { CodeBlockWidget, shouldRevealBlockSource } from "../src/code-block-widget";

test("equal widget replacement cleans up the mounted DOM before it is reused", (t) => {
  const observers: { notify: () => void; disconnected: boolean }[] = [];
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, "ResizeObserver", descriptor);
    else Reflect.deleteProperty(globalThis, "ResizeObserver");
  });
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class {
      disconnected = false;
      constructor(readonly notify: () => void) { observers.push(this); }
      observe() {}
      disconnect() { this.disconnected = true; }
    },
  });
  const codeArea = new EventTarget();
  const wrapper = {
    isConnected: true,
    querySelector: () => codeArea,
  } as unknown as HTMLElement;
  const first = { measures: 0, reveals: 0, focuses: 0 };
  const second = { measures: 0, reveals: 0, focuses: 0 };
  const editor = (counts: typeof first) => ({
    requestMeasure: () => { counts.measures++; },
    posAtDOM: () => 42,
    dispatch: () => { counts.reveals++; },
    focus: () => { counts.focuses++; },
  }) as unknown as EditorView;
  const clickCode = () => {
    const event = new Event("mousedown", { cancelable: true });
    Object.defineProperty(event, "button", { value: 0 });
    codeArea.dispatchEvent(event);
  };
  const owner = {};
  const mounted = new CodeBlockWidget(owner, "block", () => wrapper);
  const replacement = new CodeBlockWidget(owner, "block", () => wrapper);
  assert.equal(mounted.eq(replacement), true);
  mounted.toDOM(editor(first));
  observers[0].notify();
  clickCode();
  assert.deepEqual(first, { measures: 1, reveals: 1, focuses: 1 });

  // CodeMirror destroys the equal replacement, which never received toDOM.
  replacement.destroy(wrapper);
  assert.equal(observers[0].disconnected, true);
  clickCode();
  assert.equal(first.reveals, 1);

  const remounted = new CodeBlockWidget({}, "block", () => wrapper);
  assert.equal(mounted.eq(remounted), false);
  remounted.toDOM(editor(second));
  observers[1].notify();
  clickCode();
  assert.deepEqual(first, { measures: 1, reveals: 1, focuses: 1 });
  assert.deepEqual(second, { measures: 1, reveals: 1, focuses: 1 });
  remounted.destroy(wrapper);
  assert.equal(observers[1].disconnected, true);
});

const sourceDoc = "Before\nAdjacent above\n```c\nint value = 1;\n```\nAdjacent below\nAfter";
const sourceState = EditorState.create({ doc: sourceDoc });
const blockFrom = sourceState.doc.line(3).from;
const blockTo = sourceState.doc.line(5).to;

function sourceVisibleAt(line: number): boolean {
  const state = sourceState.update({
    selection: { anchor: sourceState.doc.line(line).from },
  }).state;
  return shouldRevealBlockSource(state, blockFrom, blockTo);
}

test("keyboard navigation reveals code from the adjacent line in either direction", () => {
  assert.equal(sourceVisibleAt(2), true);
  assert.equal(sourceVisibleAt(6), true);
});

test("moving farther away allows the block to return to a preview", () => {
  assert.equal(sourceVisibleAt(1), false);
  assert.equal(sourceVisibleAt(7), false);
});

test("code stays editable on both fences and inside the block", () => {
  for (const line of [3, 4, 5]) {
    assert.equal(sourceVisibleAt(line), true);
  }
});

test("adjacency uses whole logical lines, including the end of a long line", () => {
  const doc = "x".repeat(200) + "\n```c\nint value;\n```\n" + "y".repeat(200);
  for (const anchor of [0, 199, doc.length - 200, doc.length]) {
    const state = EditorState.create({ doc, selection: { anchor } });
    assert.equal(shouldRevealBlockSource(state, state.doc.line(2).from, state.doc.line(4).to), true);
  }
});

test("forward and backward selections crossing a block reveal its source", () => {
  for (const [anchor, head] of [[0, sourceDoc.length], [sourceDoc.length, 0]]) {
    const state = EditorState.create({ doc: sourceDoc, selection: { anchor, head } });
    assert.equal(shouldRevealBlockSource(state, blockFrom, blockTo), true);
  }
});

test("an adjacent secondary cursor reveals the block", () => {
  const state = EditorState.create({
    doc: sourceDoc,
    selection: EditorSelection.create([
      EditorSelection.cursor(0),
      EditorSelection.cursor(sourceState.doc.line(6).from),
    ]),
    extensions: [EditorState.allowMultipleSelections.of(true)],
  });
  assert.equal(shouldRevealBlockSource(state, blockFrom, blockTo), true);
  const fartherAway = state.update({ selection: EditorSelection.create([
    EditorSelection.cursor(0),
    EditorSelection.cursor(sourceDoc.length),
  ]) }).state;
  assert.equal(shouldRevealBlockSource(fartherAway, blockFrom, blockTo), false);
});

test("blocks at document boundaries reveal without reading beyond the document", () => {
  for (const doc of ["```c\nint value;\n```", "```c\n```\n"]) {
    const state = EditorState.create({ doc });
    assert.equal(shouldRevealBlockSource(state, 0, state.doc.length), true);
    const atEnd = state.update({ selection: { anchor: state.doc.length } }).state;
    assert.equal(shouldRevealBlockSource(atEnd, 0, state.doc.length), true);
  }
});

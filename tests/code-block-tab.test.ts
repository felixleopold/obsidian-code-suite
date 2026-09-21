import assert from "node:assert/strict";
import test from "node:test";
import { EditorSelection, EditorState } from "@codemirror/state";
import { codeBlockTabChanges, type CodeBlockIndentation } from "../src/code-block-tab";

function applyTab(
  doc: string,
  anchor: number,
  mode: CodeBlockIndentation = "auto",
  head = anchor,
  outdent = false,
): string | null {
  const state = EditorState.create({ doc, selection: EditorSelection.single(anchor, head) });
  const changes = codeBlockTabChanges(state, mode, outdent);
  return changes === null ? null : state.changes(changes).apply(state.doc).toString();
}

test("leaves Tab handling to Obsidian outside fence bodies", () => {
  const prose = "before\n```c\nint main(void) {}\n```\nafter";
  assert.equal(applyTab(prose, 2), null);
  assert.equal(applyTab(prose, prose.indexOf("```c") + 1), null);
  assert.equal(applyTab(prose, prose.lastIndexOf("```") + 1), null);
});

test("inserts a literal tab in empty and unfinished fenced blocks", () => {
  assert.equal(applyTab("```c\n\n```", 5), "```c\n\t\n```");
  assert.equal(applyTab("~~~c\nvoid", 9), "~~~c\nvoid\t");
});

test("automatic mode detects space indentation and advances to the next tab stop", () => {
  const doc = "```python\n    if ready:\n        run()\nvalue\n```";
  const cursor = doc.indexOf("value") + 3;
  assert.equal(applyTab(doc, cursor), "```python\n    if ready:\n        run()\nval ue\n```");
});

test("automatic mode borrows indentation from matching-language blocks", () => {
  const doc = "```js\n  if (ready) {\n    run();\n  }\n```\n\n```js\nvalue\n```";
  const cursor = doc.lastIndexOf("value") + 3;
  assert.equal(applyTab(doc, cursor), "```js\n  if (ready) {\n    run();\n  }\n```\n\n```js\nval ue\n```");
});

test("explicit space indentation uses the configured width", () => {
  const doc = "```c\nvoidname(void);\n```";
  const cursor = doc.indexOf("name");
  assert.equal(applyTab(doc, cursor, "4-spaces"), "```c\nvoid    name(void);\n```");
});

test("selections indent whole lines and Shift-Tab removes one unit", () => {
  const doc = "```ts\nfirst();\nsecond();\n```";
  const from = doc.indexOf("first");
  const to = doc.indexOf("second") + "second();".length;
  const indented = applyTab(doc, from, "2-spaces", to);
  assert.equal(indented, "```ts\n  first();\n  second();\n```");
  assert.equal(applyTab(indented!, indented!.indexOf("first"), "2-spaces", indented!.indexOf("second") + 9, true), doc);
});

test("does not capture a selection that crosses a fence boundary", () => {
  const doc = "```js\ninside\n```\noutside";
  assert.equal(applyTab(doc, doc.indexOf("inside"), "tabs", doc.indexOf("outside") + 2), null);
});

test("preserves structural indentation in nested fences", () => {
  const doc = "  ```c\n  value\n  ```";
  const cursor = doc.indexOf("value");
  assert.equal(applyTab(doc, cursor, "2-spaces"), "  ```c\n    value\n  ```");
});

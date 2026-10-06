import assert from "node:assert/strict";
import test from "node:test";
import { EditorSelection, EditorState } from "@codemirror/state";
import type { TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  codeBlockTabChanges,
  codeBlockTabCommand,
  type CodeBlockIndentation,
} from "../src/code-block-tab";

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

test("moves the cursor after whitespace inserted by Tab", () => {
  const doc = "```c\nvoidname(void);\n```";
  const cursor = doc.indexOf("name");
  const state = EditorState.create({ doc, selection: EditorSelection.cursor(cursor) });
  let nextState: EditorState | null = null;
  const view = {
    state,
    dispatch: (spec: TransactionSpec) => { nextState = state.update(spec).state; },
  } as unknown as EditorView;

  assert.equal(codeBlockTabCommand(() => ({ enabled: true, indentation: "4-spaces" }), false)(view), true);
  assert.equal(nextState!.doc.toString(), "```c\nvoid    name(void);\n```");
  assert.equal(nextState!.selection.main.head, cursor + 4);
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

test("recognizes quote, callout and list fences while preserving container prefixes", () => {
  const quote = "> [!note]\n> ```js\n> value\n> ```\nordinary";
  const list = "- ```js\n  value\n  ```\nordinary";
  for (const doc of [quote, list]) {
    const from = doc.indexOf("value");
    const indented = applyTab(doc, from, "2-spaces", from + 5)!;
    assert.equal(indented, doc.replace("value", "  value"));
    assert.equal(applyTab(indented, indented.indexOf("value"), "2-spaces", indented.indexOf("value") + 5, true), doc);
    assert.equal(applyTab(doc, doc.indexOf("ordinary"), "2-spaces"), null);
    assert.equal(applyTab(doc, from - 1, "2-spaces"), null);
  }
});

test("ignores indented pseudo-fences and ends fences at their container boundary", () => {
  for (const doc of [
    "    ```js\n    body\n\nordinary prose",
    "> ```js\n> body\nordinary prose",
    "- ```js\n  body\nordinary prose",
  ]) {
    assert.equal(applyTab(doc, doc.indexOf("ordinary"), "2-spaces"), null);
  }
});

test("preserves repeated and mixed Markdown container prefixes", () => {
  for (const doc of [
    "- - ```js\n    value\n    ```\nordinary",
    "  -\t```js\n    value\n    ```\nordinary",
    "- > ```js\n  > value\n  > ```\nordinary",
    "> - > ```js\n>   > value\n>   > ```\nordinary",
  ]) {
    const from = doc.indexOf("value");
    const indented = applyTab(doc, from, "2-spaces", from + 5)!;
    assert.equal(indented, doc.replace("value", "  value"));
    assert.equal(applyTab(indented, indented.indexOf("value"), "2-spaces", indented.indexOf("value") + 5, true), doc);
    assert.equal(applyTab(doc, doc.indexOf("ordinary"), "2-spaces"), null);
  }
});

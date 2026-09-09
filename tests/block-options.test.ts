import assert from "node:assert/strict";
import test from "node:test";
import {
  fencedBlockInfos,
  fencedBlockOptionsSignature,
  isStaticBlock,
  lineHighlightClass,
  parseBlockOptions,
} from "../src/block-options";

test("preserves legacy bare flags and parses quoted titles without treating their words as options", () => {
  const options = parseBlockOptions('python RUN NoPDF static=false title="A \\"quoted\\" static example"');
  assert.deepEqual([...options.flags], ["run", "nopdf"]);
  assert.equal(options.title, 'A "quoted" static example');
  assert.equal(options.static, false);
  assert.equal(parseBlockOptions("js title='Single quoted title'").title, "Single quoted title");
});

test("static overrides the default only when explicitly specified", () => {
  assert.equal(isStaticBlock(parseBlockOptions("python")), false);
  assert.equal(isStaticBlock(parseBlockOptions("python"), true), true);
  assert.equal(isStaticBlock(parseBlockOptions("python static")), true);
  assert.equal(isStaticBlock(parseBlockOptions("python static=true")), true);
  assert.equal(isStaticBlock(parseBlockOptions("python static=false"), true), false);
  assert.equal(parseBlockOptions("python static=maybe").static, undefined);
});

test("line-number and folding aliases support explicit booleans and last attribute wins", () => {
  for (const alias of ["showLineNumbers", "ln=true", "ln:true", "hideLineNumbers=false"]) {
    assert.equal(parseBlockOptions(`ts ${alias}`).showLineNumbers, true, alias);
  }
  for (const alias of ["hideLineNumbers", "ln=false", "ln:false", "showLineNumbers=false"]) {
    assert.equal(parseBlockOptions(`ts ${alias}`).showLineNumbers, false, alias);
  }
  for (const alias of ["collapse", "collapsed", "fold=true", "fold:true", "expanded=false"]) {
    assert.equal(parseBlockOptions(`ts ${alias}`).collapsed, true, alias);
  }
  for (const alias of ["expanded", "collapse=false", "collapsed=false", "fold=false", "fold:false"]) {
    assert.equal(parseBlockOptions(`ts ${alias}`).collapsed, false, alias);
  }
  const options = parseBlockOptions("ts collapse expanded ln:true hideLineNumbers");
  assert.equal(options.collapsed, false);
  assert.equal(options.showLineNumbers, false);
});

test("line ranges retain bounded pairs, tolerate spaces, and ignore malformed entries", () => {
  const options = parseBlockOptions("js {1, 5-10, 0, 7-2, nope, 2.5} ins={3, 12 - 14} del={4-9007199254740991, 9007199254740992}");
  assert.deepEqual(options.highlight, [[1, 1], [5, 10]]);
  assert.deepEqual(options.insert, [[3, 3], [12, 14]]);
  assert.deepEqual(options.delete, [[4, Number.MAX_SAFE_INTEGER]]);
});

test("explicit deletion, insertion, and highlight ranges take precedence in that order", () => {
  const options = parseBlockOptions("diff {1-4} ins={2-3} del={3}");
  assert.equal(lineHighlightClass(options, 1, "+ explicit highlight", "diff"), "ocode-line-highlight");
  assert.equal(lineHighlightClass(options, 2, "unchanged", "diff"), "ocode-line-insert");
  assert.equal(lineHighlightClass(options, 3, "unchanged", "diff"), "ocode-line-delete");
  assert.equal(lineHighlightClass(options, 5, "unchanged", "diff"), "");
});

test("diff additions and deletions are highlighted without marking file headers or other languages", () => {
  const options = parseBlockOptions("diff");
  assert.equal(lineHighlightClass(options, 1, "+added", "diff"), "ocode-line-insert");
  assert.equal(lineHighlightClass(options, 2, "-removed", "diff"), "ocode-line-delete");
  assert.equal(lineHighlightClass(options, 2, "+++counter", "diff"), "ocode-line-insert");
  assert.equal(lineHighlightClass(options, 2, "---counter", "diff"), "ocode-line-delete");
  for (const text of ["+++ b/file", "--- a/file", " context", "@@ -1 +1 @@"]) {
    assert.equal(lineHighlightClass(options, 3, text, "diff"), "");
  }
  assert.equal(lineHighlightClass(options, 1, "+value", "python"), "");
});

test("reading metadata retains source positions and content for nested container fences", () => {
  const source = [
    "    indented code",
    "",
    "```mermaid",
    "graph TD",
    "```",
    "> > ```python static",
    "> > print(1)",
    "> > ```",
    "- ~~~js title='List example'",
    "  const value = 1;",
    "  ~~~",
  ].join("\n");
  assert.deepEqual(fencedBlockInfos(source), [
    { info: "mermaid", code: "graph TD", line: 2 },
    { info: "python static", code: "print(1)", line: 5 },
    { info: "js title='List example'", code: "const value = 1;", line: 8 },
  ]);
});

test("reading metadata does not confuse shorter inner fences with the closing fence", () => {
  assert.deepEqual(fencedBlockInfos("````md title=example\n```python static\nprint(1)\n```\n````"), [
    { info: "md title=example", code: "```python static\nprint(1)\n```", line: 0 },
  ]);
});


test("backtick inline spans do not swallow later block metadata", () => {
  assert.deepEqual(fencedBlockInfos("```inline```\n\n```python static\nprint(1)\n```"), [
    { info: "python static", code: "print(1)", line: 2 },
  ]);
});

test("fence option signatures change for info edits but not code edits", () => {
  const runnable = "```python\nprint(1)\n```";
  const javascript = "```javascript\nprint(1)\n```";
  const staticBlock = "```python static\nprint(1)\n```";
  const editedCode = "```python static\nprint(2)\n```";
  const twoBlocks = "```python static\nprint(1)\n```\n\n```js title=Example\nrun()\n```";
  const extraCodeLine = "```python static\nprint(1)\nprint(2)\n```\n\n```js title=Example\nrun()\n```";

  assert.notEqual(
    fencedBlockOptionsSignature(runnable),
    fencedBlockOptionsSignature(staticBlock),
  );
  assert.notEqual(
    fencedBlockOptionsSignature(runnable),
    fencedBlockOptionsSignature(javascript),
  );
  assert.equal(
    fencedBlockOptionsSignature(staticBlock),
    fencedBlockOptionsSignature(editedCode),
  );
  assert.equal(
    fencedBlockOptionsSignature(twoBlocks),
    fencedBlockOptionsSignature(extraCodeLine),
  );
});

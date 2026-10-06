import assert from "node:assert/strict";
import test from "node:test";
import {
  inlineCodeStyleRange,
  parseLanguageInlineCode,
  scanInlineCodeSpans,
} from "../src/inline-code";

test("parses language-prefixed inline code", () => {
  assert.deepEqual(parseLanguageInlineCode('{Python} result = df.groupby("region").sum()'), {
    language: "python",
    code: 'result = df.groupby("region").sum()',
    codeOffset: 9,
  });
  assert.equal(parseLanguageInlineCode("ordinary code"), null);
  assert.equal(parseLanguageInlineCode("{not a language} value"), null);
});

test("scans inline code delimiters without crossing lines", () => {
  const source = "Before `{js} const answer = 42` and ``code with ` tick``.\nAfter `plain`.";
  assert.deepEqual(scanInlineCodeSpans(source).map(({ text }) => text), [
    "{js} const answer = 42",
    "code with ` tick",
    "plain",
  ]);
});

test("editor box styling excludes the opening and closing backticks", () => {
  const [span] = scanInlineCodeSpans("Before `{c}int value = 0;` after");
  assert.ok(span);
  assert.deepEqual(inlineCodeStyleRange(span), [span.from, span.to]);
});

test("ignores escaped delimiters and treats backslashes inside spans literally", () => {
  assert.deepEqual(scanInlineCodeSpans("\\`not code\\`").map(({ text }) => text), []);
  assert.deepEqual(scanInlineCodeSpans("`foo\\`").map(({ text }) => text), ["foo\\"]);
});

test("ignores top-level and nested fenced blocks", () => {
  const source = [
    "`before`",
    "```js",
    "`inside`",
    "> `still literal`",
    "```",
    "> - ```python",
    ">   `nested`",
    ">   ```",
    "`after`",
  ].join("\n");
  assert.deepEqual(scanInlineCodeSpans(source).map(({ text }) => text), ["before", "after"]);
});

test("recognizes a same-line triple-backtick code span", () => {
  assert.deepEqual(scanInlineCodeSpans("Use ```code with `` ticks``` here.").map(({ text }) => text), [
    "code with `` ticks",
  ]);
});

test("does not join unmatched spans across paragraphs or fences", () => {
  const source = "`unclosed\n\n```js\n`inside`\n```\n\nend`";
  assert.deepEqual(scanInlineCodeSpans(source), []);
});

test("scans inline code in nested list items", () => {
  const source = [
    "- top `foo`",
    "\t- tab nested `bar`",
    "    - space nested `baz`",
    "\t\t1. ordered `qux`",
    "",
    "\tcontinuation `quux`",
  ].join("\n");
  assert.deepEqual(scanInlineCodeSpans(source).map(({ text }) => text), [
    "foo",
    "bar",
    "baz",
    "qux",
    "quux",
  ]);
});

test("still ignores indented code blocks outside lists", () => {
  const source = [
    "Paragraph `a`",
    "    lazy continuation `b`",
    "",
    "    indented code `c`",
    "",
    "\tstill code `d`",
    "after `e`",
    "## Heading `f`",
    "    code after heading `g`",
  ].join("\n");
  assert.deepEqual(scanInlineCodeSpans(source).map(({ text }) => text), ["a", "b", "e", "f"]);
});

test("excludes indented code inside lists and after Markdown block boundaries", () => {
  const source = [
    "- item", "", "        `{python} list_code`", "",
    "-     `{python} item_code`", "",
    "Title", "=====", "    `{python} heading_code`", "",
    "***", "    `{python} break_code`", "",
    "> quoted paragraph `inline`", ">", ">     `quoted_code`",
  ].join("\n");
  assert.deepEqual(scanInlineCodeSpans(source).map(({ text }) => text), ["inline"]);
});

test("an indented pseudo-fence does not swallow later inline prose", () => {
  const source = "    ```js\n    body\n\nordinary `inline` prose";
  assert.deepEqual(scanInlineCodeSpans(source).map(({ text }) => text), ["inline"]);
});

test("ignores fences behind repeated and mixed Markdown containers", () => {
  for (const source of [
    "- - ```js\n    `literal`\n    ```\nordinary `inline`",
    "  -\t```js\n    `literal`\n    ```\nordinary `inline`",
    "- > ```js\n  > `literal`\n  > ```\nordinary `inline`",
    "> - > ```js\n>   > `literal`\n>   > ```\nordinary `inline`",
  ]) {
    assert.deepEqual(scanInlineCodeSpans(source).map(({ text }) => text), ["inline"]);
  }
});

test("keeps lazy quote paragraph continuation inline", () => {
  assert.deepEqual(scanInlineCodeSpans("> paragraph\n    `{python} inline`").map(({ text }) => text), ["{python} inline"]);
});

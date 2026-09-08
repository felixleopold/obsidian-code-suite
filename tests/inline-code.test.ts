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

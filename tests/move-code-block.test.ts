import assert from "node:assert/strict";
import test from "node:test";
import { codeBlockMoveAt, embedLine } from "../src/move-code-block";

test("finds the closed fence around the cursor, including its fence lines", () => {
  const doc = "intro\n```py\nprint(1)\n```\noutro";
  for (const line of [2, 3, 4]) {
    const move = codeBlockMoveAt(doc, line);
    assert.equal(move?.openLine, 2);
    assert.equal(move?.closeLine, 4);
    assert.equal(move?.content, "print(1)\n");
    assert.equal(move?.ext, ".py");
    assert.equal(move?.prefix, "");
  }
  assert.equal(codeBlockMoveAt(doc, 1), null);
  assert.equal(codeBlockMoveAt(doc, 5), null);
});

test("skips unclosed fences and indented code", () => {
  assert.equal(codeBlockMoveAt("```py\nprint(1)", 2), null);
  assert.equal(codeBlockMoveAt("para\n\n    print(1)\n", 3), null);
});

test("strips container prefixes from the code and keeps them for the embed line", () => {
  const quoted = "> [!note]\n> ```js\n> const a = 1;\n>   nested();\n> ```";
  const callout = codeBlockMoveAt(quoted, 3);
  assert.equal(callout?.prefix, "> ");
  assert.equal(callout?.content, "const a = 1;\n  nested();\n");

  const listed = "- item\n  ```bash\n  echo hi\n  ```";
  const item = codeBlockMoveAt(listed, 3);
  assert.equal(item?.prefix, "  ");
  assert.equal(item?.content, "echo hi\n");
  assert.equal(item?.ext, ".sh");

  const quotedItem = codeBlockMoveAt("> - ```ts\n>   let x = 1\n>   ```", 2);
  assert.equal(quotedItem?.prefix, "> - ");
  assert.equal(quotedItem?.content, "let x = 1\n");
  assert.equal(embedLine(quotedItem!.prefix, "![[a.ts]]"), "> - ![[a.ts]]");
});

test("strips only the container's columns from tab-indented code, as CommonMark does", () => {
  const content = (doc: string) => codeBlockMoveAt(doc, 2)?.content;
  // A tab split by the fence indent keeps its remaining columns as spaces.
  assert.equal(content("  ```py\n\tx\n  ```"), "  x\n");
  assert.equal(codeBlockMoveAt("- a\n\n  ```\n\tx\n  ```", 4)?.content, "  x\n");
  assert.equal(content("  ```\n   \tx\n  ```"), " \tx\n");
  // A tab after `>` lends one column to the marker and otherwise stays code.
  assert.equal(content("> ```\n>\tx\n>  y\n> ```"), "\tx\n y\n");
  assert.equal(content("> ```\n>\t\tx\n> ```"), "\t\tx\n");
  assert.equal(content(">  ```\n>\tx\n> ```"), " x\n");
  assert.equal(content(">\t```\n>\tx\n>\t```"), "x\n");
});

test("keeps the body's line count, including empty bodies", () => {
  assert.equal(codeBlockMoveAt("```py\n```", 1)?.content, "");
  assert.equal(codeBlockMoveAt("```py\n\n```", 1)?.content, "\n");
  assert.equal(codeBlockMoveAt("```py\na\n\n```", 1)?.content, "a\n\n");
});

test("maps fence languages to an extension that embeds as the same language", () => {
  const ext = (lang: string) => codeBlockMoveAt(`\`\`\`${lang}\nx\n\`\`\``, 2)?.ext;
  assert.equal(ext("python"), ".py");
  assert.equal(ext("yml"), ".yaml");
  assert.equal(ext("C++"), ".cpp");
  assert.equal(ext("{r, echo=FALSE}"), ".r");
  // `sh` runs POSIX sh but a `.sh` embed runs bash, and `.md` would transclude a note.
  assert.equal(ext("sh"), null);
  assert.equal(ext("markdown"), null);
  assert.equal(ext("mermaid"), null);
  assert.equal(ext(""), null);
});

test("carries html embed flags and reports options the embed can't express", () => {
  const html = codeBlockMoveAt("```html preview nopdf title=\"Card\"\n<p></p>\n```", 2);
  assert.deepEqual(html?.aliasFlags, ["preview", "nopdf"]);
  assert.deepEqual(html?.dropped, ["title=\"Card\""]);

  const python = codeBlockMoveAt("~~~python static=false {2}\na\nb\n~~~", 2);
  assert.deepEqual(python?.aliasFlags, []);
  assert.deepEqual(python?.dropped, ["static=false", "{2}"]);
});

test("embed lines add the embed marker only when the link lacks it", () => {
  assert.equal(embedLine("", "[[a.py]]"), "![[a.py]]");
  assert.equal(embedLine("> ", "![[a.py|preview]]"), "> ![[a.py|preview]]");
  assert.equal(embedLine("", "[a.py](a.py)"), "![a.py](a.py)");
});

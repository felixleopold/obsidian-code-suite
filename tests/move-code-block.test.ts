import assert from "node:assert/strict";
import test from "node:test";
import { codeBlockMoveAt, embedLine } from "../src/move-code-block";

test("finds the closed fence around the cursor, including its fence lines", () => {
  const doc = "intro\n```py\nprint(1)\n```\noutro";
  for (const line of [2, 3, 4]) {
    const move = codeBlockMoveAt(doc, line);
    assert.equal(move?.openLine, 2);
    assert.equal(move?.closeLine, 4);
    assert.equal(move?.code, "print(1)");
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
  assert.equal(callout?.code, "const a = 1;\n  nested();");

  const listed = "- item\n  ```bash\n  echo hi\n  ```";
  const item = codeBlockMoveAt(listed, 3);
  assert.equal(item?.prefix, "  ");
  assert.equal(item?.code, "echo hi");
  assert.equal(item?.ext, ".sh");

  const quotedItem = codeBlockMoveAt("> - ```ts\n>   let x = 1\n>   ```", 2);
  assert.equal(quotedItem?.prefix, "> - ");
  assert.equal(quotedItem?.code, "let x = 1");
  assert.equal(embedLine(quotedItem!.prefix, "![[a.ts]]"), "> - ![[a.ts]]");
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

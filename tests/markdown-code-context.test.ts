import assert from "node:assert/strict";
import test from "node:test";
import { closedFenceAtLine } from "../src/markdown-code-context";

test("runs a closed fence when the cursor is on either fence or its code", () => {
  const source = "```python static=false\nprint(1)\n```\nordinary";
  const expected = { info: "python static=false", code: "print(1)" };
  for (const line of [1, 2, 3]) assert.deepEqual(closedFenceAtLine(source, line), expected);
  assert.equal(closedFenceAtLine(source, 4), null);
});

test("does not run indented examples or unclosed fences", () => {
  const indented = "    ```python\n    print('example')\n    ```";
  for (const line of [1, 2, 3]) assert.equal(closedFenceAtLine(indented, line), null);
  assert.equal(closedFenceAtLine("```python\nprint('unfinished')", 2), null);
  assert.equal(closedFenceAtLine("> ```python\n> print('unfinished')\noutside", 2), null);
});

test("extracts code from blockquote, callout and list fences", () => {
  const cases = [
    ["> ```python\n> print('quote')\n> ```", "python", "print('quote')"],
    ["> [!note]\n> ```swift\n> print(1)\n> ```", "swift", "print(1)"],
    ["- ```python\n  print('list')\n  ```", "python", "print('list')"],
    ["- > ```python\n  > print('nested')\n  > ```", "python", "print('nested')"],
  ] as const;
  for (const [source, info, code] of cases) {
    const line = source.split("\n").findIndex((text) => text.includes("print")) + 1;
    assert.deepEqual(closedFenceAtLine(source, line), { info, code });
  }
});

test("removes only structural indentation from fenced code", () => {
  const source = "  ```python\n  if ready:\n    print('yes')\n  ```";
  assert.deepEqual(closedFenceAtLine(source, 3), {
    info: "python",
    code: "if ready:\n  print('yes')",
  });
});

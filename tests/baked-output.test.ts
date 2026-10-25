import assert from "node:assert/strict";
import test from "node:test";
import { applyBakedOutputs, bakedSourceHashes, codeHash, makeBakedOutput } from "../src/baked-output";

test("bakedSourceHashes reports only the blocks applyBakedOutputs bakes", () => {
  // A tilde fence isn't baked, even when an older baked block for the same code follows it.
  const hash = codeHash("print(1)");
  const old = makeBakedOutput({ hash, stdout: "old\n" });
  const source = [
    "~~~python", "print(1)", "~~~", "",
    "```codesuite-output", JSON.stringify(old), "```", "",
    "```python", "print(2)", "```",
  ].join("\n");
  const byHash = new Map([hash, codeHash("print(2)")].map((h) => [h, makeBakedOutput({ hash: h, stdout: "new\n" })]));
  const baked = bakedSourceHashes(source, byHash);
  assert.deepEqual([...baked], [codeHash("print(2)")]);
  assert.ok(applyBakedOutputs(source, byHash).includes(JSON.stringify(old)));
});

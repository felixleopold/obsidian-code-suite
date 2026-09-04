import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  JAVASCRIPT_VAR_POSTAMBLE,
  buildJavascriptContextCode,
} from "../src/shared-context";
import type { VarValue } from "../src/vars";

const marker = "__OCODE_VARS__=";

function runJavascript(
  previousBlocks: string[],
  currentBlock: string,
  preSeeds: Record<string, VarValue> = {},
  postSeeds: Record<string, VarValue> = {},
) {
  const source = buildJavascriptContextCode(
    previousBlocks,
    currentBlock,
    preSeeds,
    postSeeds,
  ) + JAVASCRIPT_VAR_POSTAMBLE;
  const result = spawnSync(process.execPath, ["-e", source], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const snapshotLine = result.stdout.split("\n").find((line) => line.startsWith(marker));
  assert.ok(snapshotLine, `Missing JavaScript variable snapshot in: ${result.stdout}`);
  return {
    output: result.stdout.split("\n").filter((line) => line && !line.startsWith(marker)),
    snapshot: JSON.parse(snapshotLine.slice(marker.length)) as Record<string, unknown>,
  };
}

test("JavaScript consumes declared and cross-language variables", () => {
  const result = runJavascript(
    [],
    "console.log(vars_block_name, frontmatter_name, python_name);",
    {
      vars_block_name: { kind: "string", value: "Jim" },
      frontmatter_name: { kind: "string", value: "I'm in the Front" },
    },
    { python_name: { kind: "string", value: "from Python" } },
  );

  assert.deepEqual(result.output, ["Jim I'm in the Front from Python"]);
});

test("JavaScript publishes top-level declarations and mutations", () => {
  const result = runJavascript(
    [],
    `count += 1;
const label = "ready";
let values = [count, 3];
var enabled = true;
const { nested, renamed: alias } = { nested: { ok: true }, renamed: 7 };
function helper() { return label; }`,
    { count: { kind: "int", raw: "1" } },
  );

  assert.deepEqual(result.snapshot, {
    count: 2,
    label: "ready",
    values: [2, 3],
    enabled: true,
    nested: { ok: true },
    alias: 7,
  });
});

test("JavaScript replay preserves rich same-language state without repeating output", () => {
  const result = runJavascript(
    [
      `console.log("hidden replay output");
const factor = scale;
function multiply(value) { return value * factor; }
scale = 999;`,
    ],
    `const answer = multiply(14);
console.log(answer);`,
    {},
    { scale: { kind: "int", raw: "3" } },
  );

  assert.deepEqual(result.output, ["42"]);
  assert.deepEqual(result.snapshot, { scale: 3, factor: 3, answer: 42 });
  assert.equal("multiply" in result.snapshot, false);
});

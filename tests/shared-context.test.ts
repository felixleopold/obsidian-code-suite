import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  JAVASCRIPT_VAR_POSTAMBLE,
  buildJavascriptContextCode,
  buildHistoricalReplay,
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

test("historical cross-language inputs survive later Python replay", (t) => {
  const first = "total = 7 + 11";
  const bridge = "assert total == 36";
  const replay = buildHistoricalReplay("python", [first, bridge], new Map<string, Record<string, VarValue>>([
    [first, {}],
    [bridge, { total: { kind: "int", raw: "36" } }],
  ]));
  const result = spawnSync(process.env.CODE_SUITE_PYTHON || (process.platform === "win32" ? "python" : "python3"), ["-c", `${replay}\nprint(total)`], { encoding: "utf8" });
  if (result.error && !process.env.CODE_SUITE_PYTHON) {
    t.skip("Default Python interpreter is unavailable");
    return;
  }
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "36");
});

test("JavaScript replay restores each block's consumed input before applying current seeds", () => {
  const first = "if (total !== 18) throw Error('first input'); total *= 2;";
  const second = "if (total !== 72) throw Error('second input'); total += 1;";
  const source = buildJavascriptContextCode(
    [first, second], "console.log(total);", {},
    { total: { kind: "int", raw: "99" } },
    new Map([
      [first, { total: { kind: "int", raw: "18" } }],
      [second, { total: { kind: "int", raw: "72" } }],
    ]),
  );
  const result = spawnSync(process.execPath, ["-e", source], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "99");
});

test("shell replay restores cross-language inputs at the consuming block", { skip: process.platform === "win32" }, () => {
  const first = "total=18";
  const second = '[ "$total" = 36 ] || exit 1';
  const replay = buildHistoricalReplay("shell", [first, second], new Map([
    [second, { total: { kind: "int", raw: "36" } }],
  ]));
  const result = spawnSync("/bin/sh", ["-c", `${replay}\nprintf '%s' "$total"`], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "36");
});

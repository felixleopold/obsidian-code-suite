import assert from "node:assert/strict";
import test from "node:test";
import type { ExecutionResult } from "../src/executor";
import { createOutputRecorder, outputKey } from "../src/output-record";

const meta = { key: "k", ranAt: 1000, durationMs: 42 };

function result(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return { stdout: "", stderr: "", exitCode: 0, killed: false, cancelled: false, figures: [], ...overrides };
}

test("keeps stdout, stderr and figures in display order", () => {
  const r = createOutputRecorder();
  r.stdout("before\n");
  r.figure(1);
  r.stderr("warning\n");
  r.stdout("after\n");
  r.figure(2);
  const record = r.finish(result({
    figures: [
      { kind: "image", data: "iVBORw0K", figureIndex: 1 },
      { kind: "widget", html: "<div>plot</div>", figureIndex: 2 },
    ],
  }), meta);
  assert.deepEqual(record, {
    v: 1, key: "k", exit: 0, killed: false, ranAt: 1000, durationMs: 42,
    items: [
      { kind: "stdout", text: "before\n" },
      { kind: "image", data: "iVBORw0K" },
      { kind: "stderr", text: "warning\n" },
      { kind: "stdout", text: "after\n" },
      { kind: "widget", html: "<div>plot</div>" },
    ],
  });
});

test("merges adjacent text of the same stream and drops empty text", () => {
  const r = createOutputRecorder();
  r.stdout("a");
  r.stdout("");
  r.stdout("b\n");
  r.stderr("x");
  r.stderr("y\n");
  r.stdout("c\n");
  assert.deepEqual(r.finish(result(), meta)?.items, [
    { kind: "stdout", text: "ab\n" },
    { kind: "stderr", text: "xy\n" },
    { kind: "stdout", text: "c\n" },
  ]);
});

test("drops markers without a figure and appends unmarked figures by index", () => {
  // Persistent executors (MATLAB) return figures without streaming markers;
  // the live panel appends those after the text, so the record does too.
  const r = createOutputRecorder();
  r.stdout("text\n");
  r.figure(7);
  const record = r.finish(result({
    figures: [
      { kind: "image", data: "B", figureIndex: 3 },
      { kind: "image", data: "A", figureIndex: 2 },
    ],
  }), meta);
  assert.deepEqual(record?.items, [
    { kind: "stdout", text: "text\n" },
    { kind: "image", data: "A" },
    { kind: "image", data: "B" },
  ]);
});

test("a cancelled run produces no record", () => {
  const r = createOutputRecorder();
  r.stdout("partial\n");
  assert.equal(r.finish(result({ cancelled: true, exitCode: null }), meta), null);
});

test("failed and timed-out runs keep their exit state and output", () => {
  const failed = createOutputRecorder();
  failed.stderr("Traceback: boom\n");
  assert.deepEqual(failed.finish(result({ exitCode: 1 }), meta), {
    v: 1, key: "k", exit: 1, killed: false, ranAt: 1000, durationMs: 42,
    items: [{ kind: "stderr", text: "Traceback: boom\n" }],
  });

  const timedOut = createOutputRecorder();
  timedOut.stdout("tick\n");
  const record = timedOut.finish(result({ exitCode: null, killed: true }), meta);
  assert.equal(record?.killed, true);
  assert.equal(record?.exit, null);
  assert.deepEqual(record?.items, [{ kind: "stdout", text: "tick\n" }]);
});

test("a run with no output records an empty item list", () => {
  assert.deepEqual(createOutputRecorder().finish(result(), meta)?.items, []);
});

test("outputKey is a stable SHA-256 over language, folder and trimmed code", async () => {
  const base = { lang: "python", folder: "notes", code: "print(1)" };
  const key = await outputKey(base);
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.equal(await outputKey({ ...base, code: "\n  print(1)\n\n" }), key);
  assert.notEqual(await outputKey({ ...base, code: "print(2)" }), key);
  assert.notEqual(await outputKey({ ...base, code: "#| fig-width: 4\nprint(1)" }), key);
  assert.notEqual(await outputKey({ ...base, lang: "r" }), key);
  assert.notEqual(await outputKey({ ...base, folder: "" }), key);
  // Field boundaries are unambiguous: moving text between fields changes the key.
  assert.notEqual(
    await outputKey({ lang: "python", folder: "a", code: "b" }),
    await outputKey({ lang: "python", folder: "", code: "a\nb" }),
  );
});

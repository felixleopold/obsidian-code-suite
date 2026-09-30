import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startExecution } from "../src/executor";
import { DEFAULT_SETTINGS } from "../src/settings";

// Exclude the host's Homebrew paths to model a GUI session with no system Node.
Object.assign(globalThis, {
  window: {
    require: (id: string): unknown => id === "os" ? { ...os, platform: () => "linux" } : require(id),
    setTimeout,
    clearTimeout,
  },
});

test("TypeScript finds npx and its Node interpreter beside the configured nodePath", {
  skip: process.platform === "win32",
}, async () => {
  const bin = mkdtempSync(join(os.tmpdir(), "code-suite-node-"));
  try {
    symlinkSync(process.execPath, join(bin, "node"));
    // A local launcher verifies both npx lookup and its /usr/bin/env node shebang.
    writeFileSync(join(bin, "npx"), `#!/usr/bin/env node
if (process.argv[2] !== "tsx" || !process.argv[3].endsWith(".ts")) process.exit(2);
console.log("configured Node installation");
`, { mode: 0o755 });
    const result = await startExecution("const x: number = 42\nconsole.log(x)", "typescript", {
      ...DEFAULT_SETTINGS,
      nodePath: join(bin, "node"),
      extraEnv: "PATH=/usr/bin:/bin",
    }).promise;
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "configured Node installation\n");
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
});

test("process launch failures reach the output callback", async () => {
  const dir = mkdtempSync(join(os.tmpdir(), "code-suite-missing-node-"));
  try {
    let displayedError = "";
    const result = await startExecution("console.log(42)", "javascript", {
      ...DEFAULT_SETTINGS,
      nodePath: join(dir, "missing-node"),
    }, { onStderr: (data) => { displayedError += data; } }).promise;
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /Failed to run .*missing-node/);
    assert.equal(displayedError, result.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("R plots are captured from the default graphics device", {
  skip: spawnSync("Rscript", ["--version"]).status !== 0,
}, async () => {
  const result = await startExecution("plot(1:3)\ndev.off()\nhist(1:3)\ncat('done\\n')", "r", DEFAULT_SETTINGS).promise;
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.figures.map((figure) => [figure.kind, figure.figureIndex]), [["image", 1001], ["image", 2001]]);
});

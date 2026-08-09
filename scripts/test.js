const { spawnSync } = require("child_process");
const { mkdtempSync, rmSync } = require("fs");
const { tmpdir } = require("os");
const { join } = require("path");
const esbuild = require("esbuild");

const testDir = mkdtempSync(join(tmpdir(), "code-suite-tests-"));
const testBundle = join(testDir, "python-graphs.test.cjs");
let exitCode = 1;

try {
  esbuild.buildSync({
    entryPoints: ["tests/python-graphs.test.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    outfile: testBundle,
    logLevel: "silent",
  });

  const result = spawnSync(process.execPath, ["--test", testBundle], {
    env: process.env,
    stdio: "inherit",
  });
  exitCode = result.status ?? 1;
} finally {
  rmSync(testDir, { recursive: true, force: true });
}

process.exit(exitCode);

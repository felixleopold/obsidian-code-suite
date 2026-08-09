const { spawnSync } = require("child_process");
const { mkdtempSync, rmSync } = require("fs");
const { tmpdir } = require("os");
const { join } = require("path");
const esbuild = require("esbuild");

const testDir = mkdtempSync(join(tmpdir(), "code-suite-tests-"));
const testBundles = [
  join(testDir, "python-graphs.test.cjs"),
  join(testDir, "matlab-session.test.cjs"),
];
let exitCode = 1;

try {
  esbuild.buildSync({
    entryPoints: ["tests/python-graphs.test.ts", "tests/matlab-session.test.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    outdir: testDir,
    outExtension: { ".js": ".cjs" },
    loader: { ".py": "text" },
    alias: { obsidian: "./tests/obsidian-stub.ts" },
    logLevel: "silent",
  });

  const result = spawnSync(process.execPath, ["--test", ...testBundles], {
    env: process.env,
    stdio: "inherit",
  });
  exitCode = result.status ?? 1;
  if (exitCode === 0) {
    const configuredPython = process.env.CODE_SUITE_PYTHON;
    const python = configuredPython || (process.platform === "win32" ? "python" : "python3");
    const pythonResult = spawnSync(
      python,
      ["-m", "unittest", "discover", "-s", "tests", "-p", "test_matlab_worker.py"],
      { env: process.env, stdio: "inherit" },
    );
    if (pythonResult.error) {
      if (!configuredPython && pythonResult.error.code === "ENOENT") {
        console.warn(`Skipping MATLAB worker tests: ${python} was not found. Set CODE_SUITE_PYTHON to require a specific interpreter.`);
        exitCode = 0;
      } else {
        throw pythonResult.error;
      }
    } else {
      exitCode = pythonResult.status ?? 1;
    }
  }
} finally {
  rmSync(testDir, { recursive: true, force: true });
}

process.exit(exitCode);

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
    require: (id: string): unknown => id === "os"
      ? { ...os, platform: () => process.platform === "darwin" ? "linux" : process.platform }
      : require(id),
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

test("C# runs the code file even when the working directory contains a project", {
  skip: !/^10\.|^[1-9]\d+\./.test(spawnSync("dotnet", ["--version"], { encoding: "utf8" }).stdout ?? ""),
}, async () => {
  const dir = mkdtempSync(join(os.tmpdir(), "code-suite-dotnet-"));
  try {
    writeFileSync(join(dir, "WrongProject.csproj"), '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>');
    writeFileSync(join(dir, "Program.cs"), 'System.Console.WriteLine("WRONG_PROJECT");');
    const result = await startExecution('System.Console.WriteLine("EXPECTED_BLOCK");', "csharp", {
      ...DEFAULT_SETTINGS,
      executionCwd: "custom",
      executionCwdCustom: dir,
      // Cold SDK compilation on hosted Windows runners can exceed 30 seconds.
      executionTimeout: 120_000,
    }).promise;
    const diagnostics = JSON.stringify({
      exitCode: result.exitCode,
      killed: result.killed,
      cancelled: result.cancelled,
      stdout: result.stdout,
      stderr: result.stderr,
    });
    assert.equal(result.killed, false, diagnostics);
    assert.equal(result.cancelled, false, diagnostics);
    assert.equal(result.exitCode, 0, diagnostics);
    assert.match(result.stdout, /EXPECTED_BLOCK/, diagnostics);
    assert.doesNotMatch(result.stdout, /WRONG_PROJECT/, diagnostics);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const reason of ["cancel", "timeout"] as const) {
  test(`${reason} terminates a launcher's child before it can produce later output`, async () => {
    const childCode = 'console.log("CHILD_READY"); setTimeout(() => { console.log("CHILD_SURVIVED"); }, 4000);';
    const code = `require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(childCode)}], { stdio: ["ignore", "inherit", "inherit"] }); setInterval(() => {}, 1000);`;
    let childReady = false;
    const started = Date.now();
    const running = startExecution(code, "javascript", {
      ...DEFAULT_SETTINGS,
      nodePath: process.execPath,
      executionTimeout: reason === "timeout" ? 1500 : 10_000,
    }, {
      onStdout: (data) => {
        if (data.includes("CHILD_READY")) {
          childReady = true;
          if (reason === "cancel") running.cancel();
        }
      },
    });
    try {
      const result = await running.promise;
      assert.equal(childReady, true, result.stderr);
      assert.equal(result.cancelled, reason === "cancel");
      assert.equal(result.killed, reason === "timeout");
      assert.doesNotMatch(result.stdout, /CHILD_SURVIVED/);
      assert.ok(Date.now() - started < 3000, "execution must settle before the child finishes naturally");
    } finally {
      running.cancel();
    }
  });
}

test("R plots are captured from the default graphics device", {
  skip: spawnSync("Rscript", ["--version"]).status !== 0,
}, async () => {
  const result = await startExecution("plot(1:3)\ndev.off()\nhist(1:3)\ncat('done\\n')", "r", DEFAULT_SETTINGS).promise;
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.figures.map((figure) => [figure.kind, figure.figureIndex]), [["image", 1001], ["image", 2001]]);
});

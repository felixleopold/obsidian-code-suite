import assert from "node:assert/strict";
import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import process from "node:process";
import test from "node:test";
import { MatlabSessionManager, type MatlabExecutionStatus } from "../src/matlab-session";
import { DEFAULT_SETTINGS } from "../src/settings";

type DataListener = (chunk: { toString(): string }) => void;

class FakeReadable {
  private dataListener?: DataListener;

  setEncoding(_encoding: string): void {}

  on(_event: "data", listener: DataListener): void {
    this.dataListener = listener;
  }

  emit(line: string): void {
    this.dataListener?.({ toString: () => line });
  }
}

class FakeMatlabProcess {
  readonly pid = 12345;
  readonly stdout = new FakeReadable();
  readonly stderr = new FakeReadable();
  readonly messages: object[] = [];
  private closeListener?: (code: number | null) => void;
  private errorListener?: (error: Error) => void;

  constructor(private readonly behavior: "success" | "crash" | "invalid" = "success") {}

  readonly stdin = {
    write: (chunk: string): void => {
      const message = JSON.parse(chunk) as { type?: string; id?: string };
      this.messages.push(message);
      if (message.type === "run") {
        queueMicrotask(() => {
          if (this.behavior === "crash") {
            this.closeListener?.(1);
            return;
          }
          if (this.behavior === "invalid") {
            this.stdout.emit('{"type":"done"}\n');
            return;
          }
          this.stdout.emit(JSON.stringify({
            type: "stdout",
            id: message.id,
            data: "finished\n",
            executionDone: true,
          }) + "\n");
          this.stdout.emit(JSON.stringify({
            type: "done",
            id: message.id,
            exitCode: 0,
            killed: false,
            cancelled: false,
            figures: [],
          }) + "\n");
        });
      } else if (message.type === "shutdown") {
        queueMicrotask(() => this.closeListener?.(0));
      }
    },
    end: (): void => {},
  };

  on(event: "close" | "error", listener: ((code: number | null) => void) | ((error: Error) => void)): void {
    if (event === "close") this.closeListener = listener as (code: number | null) => void;
    else this.errorListener = listener as (error: Error) => void;
  }

  kill(_signal?: string): void {
    queueMicrotask(() => this.closeListener?.(null));
  }

  start(): void {
    queueMicrotask(() => {
      this.stdout.emit(JSON.stringify({ type: "ready", release: "test" }) + "\n");
    });
  }
}

function installElectronBridge(
  spawned: FakeMatlabProcess[],
  behaviors: Array<"success" | "crash" | "invalid"> = [],
): void {
  const fakeChildProcess = {
    ...childProcess,
    spawn: (): FakeMatlabProcess => {
      const proc = new FakeMatlabProcess(behaviors.shift());
      spawned.push(proc);
      proc.start();
      return proc;
    },
    spawnSync: (): { status: number } => ({ status: 0 }),
  };
  const modules: Record<string, unknown> = {
    child_process: fakeChildProcess,
    fs,
    os,
    path,
    process: {
      env: process.env,
      platform: process.platform,
      kill: (): boolean => false,
    },
  };
  Object.assign(globalThis, {
    window: Object.assign(globalThis, {
      require: (id: string): unknown => modules[id],
    }),
  });
}

test("starts a worker and discloses an idle workspace reset on the next run", async () => {
  const spawned: FakeMatlabProcess[] = [];
  installElectronBridge(spawned);
  const manager = new MatlabSessionManager();
  const statuses: MatlabExecutionStatus[] = [];
  const stdout: string[] = [];
  const settings = {
    ...DEFAULT_SETTINGS,
    matlabPythonPath: "/fake/python",
    matlabSessionIdleTimeout: 10,
  };

  const result = await manager.run(
    "note.md",
    "value = 1;",
    settings,
    {
      onStatus: (status) => statuses.push(status),
      onStdout: (data) => stdout.push(data),
    },
    "/vault",
  ).promise;

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "finished\n");
  assert.deepEqual(statuses, ["starting", "running"]);
  assert.deepEqual(stdout, ["finished\n"]);
  assert.equal(spawned.length, 1);
  assert.equal(manager.notePaths().length, 1);

  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.deepEqual(manager.notePaths(), ["note.md"]);
  assert.ok(spawned[0].messages.some((message) => (
    message as { type?: string }
  ).type === "shutdown"));

  const restartStatuses: MatlabExecutionStatus[] = [];
  const restartStderr: string[] = [];
  const restarted = await manager.run(
    "note.md",
    "value = 2;",
    { ...settings, matlabSessionIdleTimeout: 1_000 },
    {
      onStatus: (status) => restartStatuses.push(status),
      onStderr: (data) => restartStderr.push(data),
    },
    "/vault",
  ).promise;

  assert.equal(restarted.exitCode, 0);
  assert.deepEqual(restartStatuses, ["restarting", "running"]);
  assert.match(restarted.stderr, /previous workspace was cleared/);
  assert.match(restartStderr.join(""), /previous workspace was cleared/);
  assert.equal(spawned.length, 2);
  await manager.clear("note.md");
  manager.disposeAll();
});

test("fails immediately when no MATLAB Python interpreter is configured", async () => {
  const manager = new MatlabSessionManager();
  const stderr: string[] = [];
  const result = await manager.run(
    "note.md",
    "value = 1;",
    { ...DEFAULT_SETTINGS, matlabPythonPath: "" },
    { onStderr: (data) => stderr.push(data) },
  ).promise;

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /Python interpreter with MATLAB Engine/);
  assert.deepEqual(stderr, [result.stderr]);
  assert.deepEqual(manager.notePaths(), []);
  manager.disposeAll();
});

test("reports a cleared workspace when a crashed Engine restarts", async () => {
  const spawned: FakeMatlabProcess[] = [];
  installElectronBridge(spawned, ["crash", "success"]);
  const manager = new MatlabSessionManager();
  const settings = {
    ...DEFAULT_SETTINGS,
    matlabPythonPath: "/fake/python",
    matlabSessionIdleTimeout: 1_000,
  };

  const first = await manager.run("note.md", "crash", settings).promise;
  assert.equal(first.exitCode, 1);
  assert.match(first.stderr, /exited unexpectedly/);

  const statuses: MatlabExecutionStatus[] = [];
  const stderr: string[] = [];
  const second = await manager.run(
    "note.md",
    "value = 2;",
    settings,
    {
      onStatus: (status) => statuses.push(status),
      onStderr: (data) => stderr.push(data),
    },
  ).promise;

  assert.equal(second.exitCode, 0);
  assert.deepEqual(statuses, ["restarting", "running"]);
  assert.match(second.stderr, /previous workspace was cleared/);
  assert.match(stderr.join(""), /previous workspace was cleared/);
  assert.equal(spawned.length, 2);
  await manager.clear("note.md");
  manager.disposeAll();
});

test("fails immediately on a malformed worker protocol message", async () => {
  const spawned: FakeMatlabProcess[] = [];
  installElectronBridge(spawned, ["invalid"]);
  const manager = new MatlabSessionManager();
  const result = await manager.run(
    "note.md",
    "value = 1;",
    {
      ...DEFAULT_SETTINGS,
      matlabPythonPath: "/fake/python",
      matlabSessionIdleTimeout: 1_000,
    },
  ).promise;

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /invalid protocol message/);
  await manager.clear("note.md");
  manager.disposeAll();
});

/** Persistent, per-note MATLAB Engine sessions. */

import { Platform } from "obsidian";
import type { ExecutionResult, OutputFigure, RunningProcess } from "./executor";
import matlabWorkerSource from "./matlab-worker.py";
import {
  getChildProcess,
  getFs,
  getOs,
  getPath,
  getProcess,
  type NodeBuffer,
  type NodeChildProcessHandle,
  type NodeOS,
} from "./node-builtins";
import { parseDotEnvFile, parseExtraEnv, type CodePluginSettings } from "./settings";

const STARTUP_TIMEOUT_MS = 120_000;
const CANCEL_GRACE_MS = 5_000;
const FIGURE_TIMEOUT_MS = 60_000;
const STDOUT_LIMIT = 200_000;
const STDERR_LIMIT = 100_000;

export interface MatlabExecutionCallbacks {
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
}

type StopReason = "user" | "timeout" | "limit";

interface MatlabRequest {
  id: string;
  code: string;
  settings: CodePluginSettings;
  vaultPath?: string;
  callbacks?: MatlabExecutionCallbacks;
  resolve: (result: ExecutionResult) => void;
  settled: boolean;
  sent: boolean;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  imageDir?: string;
  runDir?: string;
  runTimer?: number;
  cancelTimer?: number;
  stopReason?: StopReason;
}

interface NoteSession {
  readonly queue: MatlabRequest[];
  active?: MatlabRequest;
  worker?: MatlabWorker;
  generation: number;
  disposed: boolean;
}

interface MatlabWorker {
  readonly generation: number;
  readonly proc: NodeChildProcessHandle;
  readonly tempDir: string;
  readonly closed: Promise<void>;
  resolveClosed: () => void;
  ready: boolean;
  didClose: boolean;
  lineBuffer: string;
  startupTimer?: number;
}

interface WorkerFigure {
  path: string;
  figureIndex: number;
}

type WorkerMessage =
  | { type: "ready"; release: string }
  | { type: "stdout"; id: string; data: string; executionDone?: boolean }
  | { type: "stderr"; id: string; data: string }
  | {
      type: "done";
      id: string;
      exitCode: number | null;
      killed: boolean;
      cancelled: boolean;
      figures: WorkerFigure[];
    }
  | { type: "fatal"; message: string; id?: string };

function emptyResult(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    stdout: "",
    stderr: "",
    exitCode: null,
    killed: false,
    cancelled: false,
    figures: [],
    ...overrides,
  };
}

function resolveExecutionCwd(
  settings: CodePluginSettings,
  vaultPath: string | undefined,
  os: NodeOS,
): string {
  switch (settings.executionCwd) {
    case "vault":
      return vaultPath || os.homedir();
    case "custom":
      return settings.executionCwdCustom || os.homedir();
    case "home":
    default:
      return os.homedir();
  }
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Owns one Python worker (and therefore one MATLAB Engine) per Markdown note.
 * Runs are serialized here as a final guard even though the UI also queues them.
 */
export class MatlabSessionManager {
  private readonly sessions = new Map<string, NoteSession>();
  private readonly workers = new Set<MatlabWorker>();
  private disposed = false;

  run(
    notePath: string,
    code: string,
    settings: CodePluginSettings,
    callbacks?: MatlabExecutionCallbacks,
    vaultPath?: string,
  ): RunningProcess {
    if (this.disposed) {
      return this.immediateFailure("MATLAB session manager is shutting down.", callbacks);
    }
    if (!Platform.isDesktop) {
      return this.immediateFailure("MATLAB execution is only available on desktop.", callbacks);
    }
    if (!settings.matlabPythonPath.trim()) {
      return this.immediateFailure(
        "Set a Python 3.13 interpreter with MATLAB Engine installed in Code Suite settings.",
        callbacks,
      );
    }

    let resolveRequest!: (result: ExecutionResult) => void;
    const promise = new Promise<ExecutionResult>((resolve) => {
      resolveRequest = resolve;
    });
    const request: MatlabRequest = {
      id: makeId("run"),
      code,
      settings,
      vaultPath,
      callbacks,
      resolve: resolveRequest,
      settled: false,
      sent: false,
      stdout: "",
      stderr: "",
      stdoutTruncated: false,
      stderrTruncated: false,
    };

    let session = this.sessions.get(notePath);
    if (!session) {
      session = { queue: [], generation: 0, disposed: false };
      this.sessions.set(notePath, session);
    }
    session.queue.push(request);
    this.pump(session);

    return {
      promise,
      cancel: () => this.cancelRequest(session, request),
      writeStdin: () => {},
      closeStdin: () => {},
    };
  }

  async clear(notePath: string): Promise<void> {
    const session = this.sessions.get(notePath);
    if (!session) return;
    if (this.sessions.get(notePath) === session) this.sessions.delete(notePath);
    const worker = this.disposeSession(session, true);
    if (worker) await this.shutdownWorker(worker);
  }

  rename(oldPath: string, _newPath: string): Promise<void> {
    return this.clear(oldPath);
  }

  async shutdownAll(): Promise<void> {
    await Promise.all(Array.from(this.sessions.keys(), (notePath) => this.clear(notePath)));
  }

  /** Note paths with a live or idle Engine session. */
  notePaths(): string[] {
    return Array.from(this.sessions.keys());
  }

  /** Synchronous unload path: prevent new work and terminate every process tree now. */
  disposeAll(): void {
    this.disposed = true;
    const sessions = Array.from(this.sessions.values());
    const workers = new Set(this.workers);
    this.sessions.clear();
    for (const session of sessions) {
      const worker = this.disposeSession(session, false);
      if (worker) workers.add(worker);
    }
    this.workers.clear();
    for (const worker of workers) {
      if (worker.startupTimer !== undefined) window.clearTimeout(worker.startupTimer);
      this.killWorkerTree(worker, true);
      this.cleanupWorker(worker);
    }
  }

  private disposeSession(session: NoteSession, requestGracefulCancel: boolean): MatlabWorker | undefined {
    session.disposed = true;
    const worker = session.worker;
    const active = session.active;
    if (active) {
      if (requestGracefulCancel && active.sent && worker) {
        this.send(worker, { type: "cancel", id: active.id, reason: "user" });
      }
      this.settle(active, emptyResult({
        stdout: active.stdout,
        stderr: active.stderr,
        cancelled: true,
      }));
      this.cleanupRun(active);
      session.active = undefined;
    }
    for (const request of session.queue.splice(0)) {
      this.settle(request, emptyResult({ cancelled: true }));
    }
    session.worker = undefined;
    return worker;
  }

  private immediateFailure(message: string, callbacks?: MatlabExecutionCallbacks): RunningProcess {
    try { callbacks?.onStderr?.(message); } catch { /* UI callbacks must not break execution */ }
    return {
      promise: Promise.resolve(emptyResult({ stderr: message, exitCode: 1 })),
      cancel: () => {},
      writeStdin: () => {},
      closeStdin: () => {},
    };
  }

  private pump(session: NoteSession): void {
    if (session.disposed || session.active) return;
    const request = session.queue.shift();
    if (!request) return;
    session.active = request;

    if (!session.worker) {
      this.startWorker(session, request.settings, request.vaultPath);
      return;
    }
    if (session.worker.ready) this.sendRun(session, session.worker, request);
  }

  private startWorker(
    session: NoteSession,
    settings: CodePluginSettings,
    vaultPath?: string,
  ): void {
    const fs = getFs();
    const os = getOs();
    const path = getPath();
    const tempDir = path.join(os.tmpdir(), makeId("ocode-matlab"));
    const workerPath = path.join(tempDir, "matlab-worker.py");
    const cwd = resolveExecutionCwd(settings, vaultPath, os);
    try {
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(workerPath, matlabWorkerSource, "utf-8");
    } catch (error) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* best-effort */ }
      const message = error instanceof Error ? error.message : String(error);
      this.failActive(session, `Failed to prepare the MATLAB worker: ${message}`, false);
      return;
    }

    let proc: NodeChildProcessHandle;
    try {
      const env = this.buildEnv(settings);
      proc = getChildProcess().spawn(
        settings.matlabPythonPath.trim(),
        ["-u", workerPath, "--session-dir", tempDir, "--cwd", cwd],
        {
          cwd,
          env,
          detached: os.platform() !== "win32",
          shell: false,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
    } catch (error) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* best-effort */ }
      const message = error instanceof Error ? error.message : String(error);
      this.failActive(session, `Failed to start the MATLAB worker: ${message}`, false);
      return;
    }

    let resolveClosed!: () => void;
    const worker: MatlabWorker = {
      generation: ++session.generation,
      proc,
      tempDir,
      closed: new Promise<void>((resolve) => { resolveClosed = resolve; }),
      resolveClosed,
      ready: false,
      didClose: false,
      lineBuffer: "",
    };
    session.worker = worker;
    this.workers.add(worker);

    proc.stdout?.setEncoding("utf8");
    proc.stderr?.setEncoding("utf8");

    worker.startupTimer = window.setTimeout(() => {
      if (session.worker !== worker || worker.ready) return;
      this.failWorker(session, worker, "MATLAB Engine did not start within 120 seconds.", true);
    }, STARTUP_TIMEOUT_MS);

    proc.stdout?.on("data", (chunk: NodeBuffer) => {
      if (session.worker !== worker || worker.generation !== session.generation) return;
      this.consumeProtocol(session, worker, chunk.toString());
    });
    proc.stderr?.on("data", (chunk: NodeBuffer) => {
      if (session.worker !== worker || worker.generation !== session.generation) return;
      const active = session.active;
      if (active) this.appendOutput(session, active, "stderr", chunk.toString());
    });
    proc.on("error", (error: Error) => {
      if (session.worker !== worker || worker.generation !== session.generation) return;
      this.failWorker(session, worker, `MATLAB worker failed: ${error.message}`, false);
    });
    proc.on("close", (exitCode: number | null) => {
      this.workers.delete(worker);
      if (!worker.didClose) {
        worker.didClose = true;
        worker.resolveClosed();
      }
      this.cleanupWorker(worker);
      if (session.worker !== worker || worker.generation !== session.generation) return;
      session.worker = undefined;
      if (worker.startupTimer !== undefined) window.clearTimeout(worker.startupTimer);
      if (!session.disposed && session.active) {
        const request = session.active;
        const suffix = request.stderr ? "" : `MATLAB worker exited unexpectedly (exit ${exitCode ?? "unknown"}).`;
        if (suffix) this.appendOutput(session, request, "stderr", suffix);
        this.finishActive(session, emptyResult({
          stdout: request.stdout,
          stderr: request.stderr,
          exitCode: request.stopReason ? null : (exitCode ?? 1),
          killed: request.stopReason === "timeout" || request.stopReason === "limit",
          cancelled: request.stopReason === "user",
        }));
      }
    });
  }

  private buildEnv(settings: CodePluginSettings): Record<string, string | undefined> {
    const fs = getFs();
    const os = getOs();
    const path = getPath();
    const env: Record<string, string | undefined> = {
      ...getProcess().env,
      ...parseDotEnvFile(settings.envFilePath),
      ...parseExtraEnv(settings.extraEnv),
    };

    if (os.platform() === "darwin") {
      const common = ["/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin", "/usr/local/sbin"];
      const existing = new Set((env["PATH"] || "").split(path.delimiter));
      const missing = common.filter((entry) => !existing.has(entry));
      if (missing.length > 0) {
        env["PATH"] = missing.join(path.delimiter) + path.delimiter + (env["PATH"] || "");
      }
    }

    const pythonPath = settings.matlabPythonPath.trim();
    const venvBin = path.dirname(pythonPath);
    const venvDir = path.dirname(venvBin);
    if (fs.existsSync(path.join(venvDir, "pyvenv.cfg"))) {
      env["VIRTUAL_ENV"] = venvDir;
      env["PATH"] = venvBin + path.delimiter + (env["PATH"] || "");
    }
    return env;
  }

  private consumeProtocol(session: NoteSession, worker: MatlabWorker, data: string): void {
    worker.lineBuffer += data;
    const lines = worker.lineBuffer.split("\n");
    worker.lineBuffer = lines.pop() ?? "";
    for (const rawLine of lines) {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      if (!line) continue;
      let message: WorkerMessage;
      try {
        message = JSON.parse(line) as WorkerMessage;
      } catch {
        this.failWorker(session, worker, "MATLAB worker returned an invalid protocol message.", false);
        return;
      }
      this.handleMessage(session, worker, message);
      if (session.worker !== worker) return;
    }
  }

  private handleMessage(session: NoteSession, worker: MatlabWorker, message: WorkerMessage): void {
    if (message.type === "ready") {
      if (worker.ready) return;
      worker.ready = true;
      if (worker.startupTimer !== undefined) window.clearTimeout(worker.startupTimer);
      const active = session.active;
      if (active) this.sendRun(session, worker, active);
      return;
    }

    const active = session.active;
    if (message.type === "fatal") {
      if (message.id !== undefined && message.id !== active?.id) return;
      this.failWorker(session, worker, message.message, false);
      return;
    }
    if (!active || message.id !== active.id) return;

    if (message.type === "stdout" || message.type === "stderr") {
      if (message.type === "stdout" && message.executionDone) {
        if (active.runTimer !== undefined) window.clearTimeout(active.runTimer);
        active.runTimer = undefined;
        if (!active.stopReason) {
          active.runTimer = window.setTimeout(() => {
            if (session.active === active && !active.settled) {
              this.requestStop(session, active, "timeout");
            }
          }, FIGURE_TIMEOUT_MS);
        }
      }
      if (message.data) this.appendOutput(session, active, message.type, message.data);
      return;
    }
    if (message.type !== "done") return;

    if (active.runTimer !== undefined) window.clearTimeout(active.runTimer);
    if (active.cancelTimer !== undefined) window.clearTimeout(active.cancelTimer);
    const figures = this.collectFigures(message.figures);
    if (figures.length > 0 && active.stdout && !active.stdout.endsWith("\n")) {
      active.stdout += "\n";
      try { active.callbacks?.onStdout?.("\n"); } catch { /* UI callbacks must not break the session */ }
    }
    for (const figure of figures) {
      const sentinel = `OCODE_FIG_${figure.figureIndex}\n`;
      active.stdout += sentinel;
      try { active.callbacks?.onStdout?.(sentinel); } catch { /* UI callbacks must not break the session */ }
    }
    this.finishActive(session, {
      stdout: active.stdout,
      stderr: active.stderr,
      exitCode: message.exitCode,
      killed: message.killed || active.stopReason === "timeout" || active.stopReason === "limit",
      cancelled: message.cancelled || active.stopReason === "user",
      figures,
    });
  }

  private sendRun(session: NoteSession, worker: MatlabWorker, request: MatlabRequest): void {
    if (request.settled || request.sent || session.active !== request) return;
    try {
      const fs = getFs();
      const path = getPath();
      request.runDir = path.join(worker.tempDir, "runs", request.id);
      request.imageDir = path.join(request.runDir, "images");
      fs.mkdirSync(request.imageDir, { recursive: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.failActive(session, `Failed to prepare the MATLAB run: ${message}`, false);
      return;
    }
    request.sent = true;
    if (!this.send(worker, {
      type: "run",
      id: request.id,
      code: request.code,
      imageDir: request.imageDir,
    })) {
      this.failWorker(session, worker, "MATLAB worker input is unavailable.", false);
      return;
    }
    request.runTimer = window.setTimeout(() => {
      if (session.active !== request || request.settled) return;
      this.requestStop(session, request, "timeout");
    }, request.settings.executionTimeout);
  }

  private appendOutput(
    session: NoteSession,
    request: MatlabRequest,
    stream: "stdout" | "stderr",
    data: string,
  ): void {
    const isStdout = stream === "stdout";
    const limit = isStdout ? STDOUT_LIMIT : STDERR_LIMIT;
    const current = isStdout ? request.stdout : request.stderr;
    const alreadyTruncated = isStdout ? request.stdoutTruncated : request.stderrTruncated;
    if (alreadyTruncated) return;

    const remaining = Math.max(0, limit - current.length);
    const accepted = data.slice(0, remaining);
    if (accepted) {
      if (isStdout) request.stdout += accepted;
      else request.stderr += accepted;
      try {
        if (isStdout) request.callbacks?.onStdout?.(accepted);
        else request.callbacks?.onStderr?.(accepted);
      } catch { /* UI callbacks must not break the session */ }
    }

    if (data.length <= remaining) return;
    const suffix = isStdout ? "\n... (output truncated)" : "\n... (stderr truncated)";
    if (isStdout) {
      request.stdout += suffix;
      request.stdoutTruncated = true;
    } else {
      request.stderr += suffix;
      request.stderrTruncated = true;
    }
    try {
      if (isStdout) request.callbacks?.onStdout?.(suffix);
      else request.callbacks?.onStderr?.(suffix);
    } catch { /* UI callbacks must not break the session */ }
    if (isStdout) this.requestStop(session, request, "limit");
  }

  private requestStop(session: NoteSession, request: MatlabRequest, reason: StopReason): void {
    if (request.settled || request.stopReason) return;
    request.stopReason = reason;
    if (request.runTimer !== undefined) window.clearTimeout(request.runTimer);
    const worker = session.worker;
    if (!worker || !request.sent) {
      this.invalidateWorker(session, worker);
      this.finishActive(session, emptyResult({
        stdout: request.stdout,
        stderr: request.stderr,
        killed: reason !== "user",
        cancelled: reason === "user",
      }));
      return;
    }

    const protocolReason = reason === "user" ? "user" : "timeout";
    if (!this.send(worker, { type: "cancel", id: request.id, reason: protocolReason })) {
      this.forceStop(session, worker, request);
      return;
    }
    request.cancelTimer = window.setTimeout(() => {
      if (session.active === request && !request.settled) this.forceStop(session, worker, request);
    }, CANCEL_GRACE_MS);
  }

  private cancelRequest(session: NoteSession, request: MatlabRequest): void {
    if (request.settled) return;
    if (session.active === request) {
      this.requestStop(session, request, "user");
      return;
    }
    const index = session.queue.indexOf(request);
    if (index >= 0) session.queue.splice(index, 1);
    this.settle(request, emptyResult({ cancelled: true }));
  }

  private forceStop(session: NoteSession, worker: MatlabWorker, request: MatlabRequest): void {
    this.invalidateWorker(session, worker);
    this.finishActive(session, emptyResult({
      stdout: request.stdout,
      stderr: request.stderr,
      killed: request.stopReason !== "user",
      cancelled: request.stopReason === "user",
    }));
  }

  private failWorker(
    session: NoteSession,
    worker: MatlabWorker,
    message: string,
    killed: boolean,
  ): void {
    if (session.worker !== worker) return;
    const active = session.active;
    if (active) this.appendOutput(session, active, "stderr", message);
    this.invalidateWorker(session, worker);
    if (active) {
      const stoppedByLimit = active.stopReason === "timeout" || active.stopReason === "limit";
      this.finishActive(session, emptyResult({
        stdout: active.stdout,
        stderr: active.stderr,
        exitCode: killed || stoppedByLimit ? null : 1,
        killed: killed || stoppedByLimit,
        cancelled: active.stopReason === "user",
      }));
    }
  }

  private failActive(session: NoteSession, message: string, killed: boolean): void {
    const active = session.active;
    if (!active) return;
    this.appendOutput(session, active, "stderr", message);
    this.finishActive(session, emptyResult({
      stdout: active.stdout,
      stderr: active.stderr,
      exitCode: killed ? null : 1,
      killed,
    }));
  }

  private finishActive(session: NoteSession, result: ExecutionResult): void {
    const request = session.active;
    if (!request) return;
    if (request.runTimer !== undefined) window.clearTimeout(request.runTimer);
    if (request.cancelTimer !== undefined) window.clearTimeout(request.cancelTimer);
    session.active = undefined;
    this.cleanupRun(request);
    this.settle(request, result);
    if (!session.disposed) this.pump(session);
  }

  private settle(request: MatlabRequest, result: ExecutionResult): void {
    if (request.settled) return;
    if (request.runTimer !== undefined) window.clearTimeout(request.runTimer);
    if (request.cancelTimer !== undefined) window.clearTimeout(request.cancelTimer);
    request.settled = true;
    request.resolve(result);
  }

  private collectFigures(figures: WorkerFigure[]): OutputFigure[] {
    const fs = getFs();
    const collected: OutputFigure[] = [];
    for (const figure of figures) {
      try {
        if (!fs.existsSync(figure.path)) continue;
        collected.push({
          kind: "image",
          data: fs.readFileSync(figure.path).toString("base64"),
          figureIndex: figure.figureIndex,
        });
      } catch { /* figure collection is best-effort */ }
    }
    return collected.sort((a, b) => a.figureIndex - b.figureIndex);
  }

  private cleanupRun(request: MatlabRequest): void {
    if (!request.runDir) return;
    try { getFs().rmSync(request.runDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }

  private invalidateWorker(session: NoteSession, worker?: MatlabWorker): void {
    if (!worker || session.worker !== worker) return;
    session.worker = undefined;
    if (worker.startupTimer !== undefined) window.clearTimeout(worker.startupTimer);
    this.killWorkerTree(worker);
  }

  /** Force-stop the worker and its MATLAB child after graceful cancellation failed. */
  private killWorkerTree(worker: MatlabWorker, synchronous = false): void {
    const pid = worker.proc.pid;
    if (pid !== undefined && getOs().platform() === "win32") {
      if (synchronous) {
        try {
          const result = getChildProcess().spawnSync(
            "taskkill.exe",
            ["/PID", String(pid), "/T", "/F"],
            { shell: false, stdio: ["ignore", "ignore", "ignore"] },
          );
          if (!result.error && result.status === 0) return;
        } catch { /* fall through to the direct worker kill */ }
      }
      if (!synchronous) {
        try {
          const killer = getChildProcess().spawn(
            "taskkill.exe",
            ["/PID", String(pid), "/T", "/F"],
            { shell: false, stdio: ["ignore", "ignore", "ignore"] },
          );
          const fallback = () => {
            try { worker.proc.kill("SIGKILL"); } catch { /* process may already be gone */ }
          };
          killer.on("error", fallback);
          killer.on("close", (exitCode) => { if (exitCode !== 0) fallback(); });
          return;
        } catch { /* fall through to the direct worker kill */ }
      }
    } else if (pid !== undefined) {
      try {
        getProcess().kill(-pid, "SIGKILL");
        return;
      } catch { /* fall through to the direct worker kill */ }
    }
    try { worker.proc.kill("SIGKILL"); } catch { /* process may already be gone */ }
  }

  private send(worker: MatlabWorker, message: object): boolean {
    try {
      if (!worker.proc.stdin) return false;
      worker.proc.stdin.write(JSON.stringify(message) + "\n");
      return true;
    } catch {
      return false;
    }
  }

  private async shutdownWorker(worker: MatlabWorker): Promise<void> {
    if (worker.startupTimer !== undefined) window.clearTimeout(worker.startupTimer);
    this.send(worker, { type: "shutdown" });
    const closedGracefully = await Promise.race([
      worker.closed.then(() => true),
      this.delay(CANCEL_GRACE_MS).then(() => false),
    ]);
    if (!closedGracefully) {
      this.killWorkerTree(worker);
      await Promise.race([worker.closed, this.delay(1_000)]);
    }
    this.cleanupWorker(worker);
  }

  private cleanupWorker(worker: MatlabWorker): void {
    try { getFs().rmSync(worker.tempDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }
}

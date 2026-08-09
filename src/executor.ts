/**
 * Code execution engine — runs code, captures stdout/stderr/images,
 * supports cancel, stdin, and custom environments.
 */

import { Platform } from "obsidian";
import { parseExtraEnv, parseDotEnvFile, parseShellSourceFiles, type CodePluginSettings } from "./settings";
import { getChildProcess, getFs, getOs, getPath, getProcess, type NodeBuffer, type NodeChildProcessHandle, type NodeOS } from "./node-builtins";
import { executionScriptName, wrapPythonForGraphs } from "./python-graphs";

/** Runtime definitions */
const RUNTIMES: Record<string, { cmd: string; args: string[]; ext: string }> = {
  python:     { cmd: "python3",  args: ["-u"],      ext: ".py" },
  javascript: { cmd: "node",     args: [],           ext: ".js" },
  typescript: { cmd: "npx",      args: ["tsx"],      ext: ".ts" },
  bash:       { cmd: "bash",     args: [],           ext: ".sh" },
  zsh:        { cmd: "zsh",      args: [],           ext: ".sh" },
  shell:      { cmd: "sh",       args: [],           ext: ".sh" },
  powershell: { cmd: "pwsh",     args: ["-NoLogo", "-NoProfile", "-File"], ext: ".ps1" },
  ruby:       { cmd: "ruby",     args: [],           ext: ".rb" },
  lua:        { cmd: "lua",      args: [],           ext: ".lua" },
  perl:       { cmd: "perl",     args: [],           ext: ".pl" },
  r:          { cmd: "Rscript",  args: [],           ext: ".r" },
  go:         { cmd: "go",       args: ["run"],      ext: ".go" },
  php:        { cmd: "php",      args: [],           ext: ".php" },
  swift:      { cmd: "swift",    args: [],           ext: ".swift" },
};

export function isExecutable(lang: string): boolean {
  return lang in RUNTIMES;
}

function isPosixShell(lang: string): boolean {
  return lang === "bash" || lang === "zsh" || lang === "shell";
}

/**
 * Convert a Windows path (`C:\Users\me\x`) to the WSL mount path
 * (`/mnt/c/Users/me/x`) that a WSL shell can resolve. Paths that aren't
 * drive-letter absolute are returned with backslashes normalized to slashes.
 */
function toWslPath(winPath: string): string {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(winPath);
  if (!m) return winPath.replace(/\\/g, "/");
  return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, "/")}`;
}

/**
 * Heuristic: does this POSIX-shell interpreter look like WSL on Windows?
 * A bare command name (no path separator) resolves via PATH, where the default
 * `bash` on Windows is the System32 WSL launcher; explicit `wsl.exe` or
 * `System32\bash.exe` paths are WSL too.
 */
function isWslInterpreter(cmd: string): boolean {
  if (!/[\\/]/.test(cmd)) return true;
  return /(?:^|[\\/])wsl(?:\.exe)?$/i.test(cmd) || /system32[\\/]bash\.exe$/i.test(cmd);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function buildShellSourcePreamble(sourceFiles: string[]): string {
  if (sourceFiles.length === 0) return "";
  return sourceFiles.map((filePath) => {
    const quotedPath = shellQuote(filePath);
    const quotedError = shellQuote(`CodeSuite: source file not readable: ${filePath}`);
    return [
      `if [ -r ${quotedPath} ]; then`,
      `  . ${quotedPath}`,
      "else",
      `  printf '%s\n' ${quotedError} >&2`,
      "  exit 1",
      "fi",
    ].join("\n");
  }).join("\n") + "\n";
}

function prependPhpOpenTag(code: string): string {
  const shebang = code.match(/^(#![^\n]*(?:\n|$))/);
  const bodyStart = shebang ? shebang[0].length : 0;
  const body = code.slice(bodyStart);
  if (/^\s*<\?/i.test(body)) return code;
  return code.slice(0, bodyStart) + "<?php\n" + body;
}

export type OutputFigure =
  | { kind: "image"; data: string; figureIndex: number }
  | { kind: "widget"; html: string; figureIndex: number };

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  /** Killed by the execution timeout (or output-size cap), not the user. */
  killed: boolean;
  /** Killed because the user clicked Stop. */
  cancelled: boolean;
  /** Captured figures in creation order (matplotlib PNGs and Plotly HTML widgets). */
  figures: OutputFigure[];
}

/** Handle to a running process — allows cancel + stdin */
export interface RunningProcess {
  /** Promise that resolves when the process completes */
  promise: Promise<ExecutionResult>;
  /** Kill the running process */
  cancel: () => void;
  /** Write to stdin */
  writeStdin: (text: string) => void;
  /** Close stdin */
  closeStdin: () => void;
}

/**
 * Resolve the working directory for code execution.
 */
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

/**
 * Start code execution. Returns a RunningProcess handle.
 */
export function startExecution(
  code: string,
  lang: string,
  settings: CodePluginSettings,
  callbacks?: {
    onStdout?: (data: string) => void;
    onStderr?: (data: string) => void;
  },
  vaultPath?: string,
): RunningProcess {
  if (!Platform.isDesktop) {
    const result: ExecutionResult = {
      stdout: "", stderr: "Code execution is only available on desktop.",
      exitCode: 1, killed: false, cancelled: false, figures: [],
    };
    return {
      promise: Promise.resolve(result),
      cancel: () => {},
      writeStdin: () => {},
      closeStdin: () => {},
    };
  }

  const runtime = RUNTIMES[lang];
  if (!runtime) {
    const result: ExecutionResult = {
      stdout: "", stderr: `No runtime for: ${lang}`,
      exitCode: 1, killed: false, cancelled: false, figures: [],
    };
    return {
      promise: Promise.resolve(result),
      cancel: () => {},
      writeStdin: () => {},
      closeStdin: () => {},
    };
  }

  // Node.js builtins are required for code execution (desktop only, guarded by Platform.isDesktop above).
  // Reached via window.require (Electron's Node bridge) through typed accessors.
  const { spawn } = getChildProcess();
  const fs = getFs();
  const os = getOs();
  const path = getPath();

  // Temp dir for this execution
  const execId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const tmpDir = path.join(os.tmpdir(), `ocode-${execId}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const imgDir = path.join(tmpDir, "images");
  const tmpFile = path.join(tmpDir, executionScriptName(lang, runtime.ext));

  // For Python: wrap code to capture graphs
  let execCode = code;
  if (lang === "python") {
    execCode = wrapPythonForGraphs(code, imgDir, settings.interactivePlots, settings.embedPlotlyJs, settings.matplotlibStyle);
  }

  if (lang === "php" && settings.autoPrependPhpOpenTag) {
    execCode = prependPhpOpenTag(execCode);
  }

  if (isPosixShell(lang)) {
    const sourcePreamble = buildShellSourcePreamble(parseShellSourceFiles(settings.shellSourceFiles));
    if (sourcePreamble) {
      execCode = sourcePreamble + execCode;
    }
  }

  // For bash/shell: wrap sudo to use -S flag so passwords can be entered via stdin input bar
  if (isPosixShell(lang) && /\bsudo\b/.test(execCode)) {
    execCode = "sudo() { command sudo -S \"$@\"; }\n" + execCode;
  }

  fs.writeFileSync(tmpFile, execCode, "utf-8");

  // Determine command
  let cmd = runtime.cmd;
  if (lang === "python" && settings.pythonPath) {
    cmd = settings.pythonPath;
  } else if ((lang === "javascript" || lang === "typescript") && settings.nodePath) {
    cmd = lang === "javascript" ? settings.nodePath : runtime.cmd;
  } else if (lang === "bash" && settings.bashPath) {
    cmd = settings.bashPath;
  } else if (lang === "zsh" && settings.zshPath) {
    cmd = settings.zshPath;
  } else if (lang === "shell" && settings.shPath) {
    cmd = settings.shPath;
  }

  // Build env. Order of precedence (later overrides earlier):
  //   process.env  <  .env file (shared)  <  extraEnv (settings)
  // .env values are loaded first so users can keep shared secrets in a file
  // and override or add note-specific values via the settings UI.
  const dotEnv = parseDotEnvFile(settings.envFilePath);
  const extraEnv = parseExtraEnv(settings.extraEnv);
  const env: Record<string, string | undefined> = { ...getProcess().env, ...dotEnv, ...extraEnv };

  // On macOS, GUI apps (like Obsidian) don't inherit the user's shell PATH,
  // so Homebrew tools (/opt/homebrew/bin on Apple Silicon, /usr/local/bin on Intel)
  // are not found. Prepend the common locations so brew/node/python etc. work.
  if (os.platform() === "darwin") {
    const brewPaths = ["/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin", "/usr/local/sbin"];
    const existing = new Set((env["PATH"] || "").split(path.delimiter));
    const missing = brewPaths.filter((p) => !existing.has(p));
    if (missing.length > 0) {
      env["PATH"] = missing.join(path.delimiter) + path.delimiter + (env["PATH"] || "");
    }
  }

  // If pythonPath is a venv python, set VIRTUAL_ENV and prepend bin to PATH
  // (applies to all languages so bash/shell blocks can call pip, etc.)
  if (settings.pythonPath) {
    const venvBin = path.dirname(settings.pythonPath);
    const venvDir = path.dirname(venvBin);
    if (fs.existsSync(path.join(venvDir, "pyvenv.cfg"))) {
      env["VIRTUAL_ENV"] = venvDir;
      env["PATH"] = venvBin + path.delimiter + (env["PATH"] || "");
    }
  }

  // On Windows, WSL shells can't resolve the Windows temp path we just wrote
  // (backslashes are mangled crossing into WSL, and the file lives at
  // /mnt/c/… in WSL's filesystem). Translate the script path for them. The
  // cwd we pass to spawn is auto-translated by WSL, so only the arg needs it.
  let scriptArg = tmpFile;
  if (os.platform() === "win32" && isPosixShell(lang)) {
    const useWsl = settings.wslMode === "on" ? true
      : settings.wslMode === "off" ? false
      : isWslInterpreter(cmd);
    if (useWsl) scriptArg = toWslPath(tmpFile);
  }

  const args = [...runtime.args];
  if (settings.shellLogin && (lang === "bash" || lang === "zsh")) {
    args.unshift(lang === "zsh" ? "-l" : "--login");
  }
  args.push(scriptArg);
  let proc: NodeChildProcessHandle;
  let killed = false;
  let cancelled = false;
  let stdout = "";
  let stderr = "";

  const cwd = resolveExecutionCwd(settings, vaultPath, os);
  proc = spawn(cmd, args, {
    cwd,
    env,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const timer = window.setTimeout(() => {
    killed = true;
    proc.kill("SIGKILL");
  }, settings.executionTimeout);

  proc.stdout?.on("data", (data: NodeBuffer) => {
    const text = data.toString();
    stdout += text;
    callbacks?.onStdout?.(text);
    if (stdout.length > 200_000) {
      stdout = stdout.slice(0, 200_000) + "\n... (output truncated)";
      killed = true;
      proc.kill("SIGKILL");
    }
  });

  proc.stderr?.on("data", (data: NodeBuffer) => {
    const text = data.toString();
    stderr += text;
    callbacks?.onStderr?.(text);
    if (stderr.length > 100_000) {
      stderr = stderr.slice(0, 100_000) + "\n... (stderr truncated)";
    }
  });

  const promise = new Promise<ExecutionResult>((resolve) => {
    proc.on("close", (exitCode: number | null) => {
      window.clearTimeout(timer);

      // Collect figures keyed by counter index so sentinels in stdout can be
      // matched to the right file even if some saves failed.
      const figureMap = new Map<number, OutputFigure>();
      try {
        if (fs.existsSync(imgDir)) {
          for (const f of fs.readdirSync(imgDir)) {
            const m = /^fig_(\d+)\.(png|html)$/.exec(f);
            if (!m) continue;
            const figureIndex = parseInt(m[1], 10);
            if (m[2] === "png") {
              const data = fs.readFileSync(path.join(imgDir, f)).toString("base64");
              figureMap.set(figureIndex, { kind: "image", data, figureIndex });
            } else {
              const html = fs.readFileSync(path.join(imgDir, f), "utf-8");
              figureMap.set(figureIndex, { kind: "widget", html, figureIndex });
            }
          }
        }
      } catch { /* figure collection is best-effort */ }
      const figures = Array.from(figureMap.entries())
        .sort(([a], [b]) => a - b)
        .map(([, fig]) => fig);

      // Cleanup
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* cleanup is best-effort */ }

      resolve({ stdout, stderr, exitCode, killed, cancelled, figures });
    });

    proc.on("error", (err: Error) => {
      window.clearTimeout(timer);
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* cleanup is best-effort */ }
      resolve({
        stdout: "",
        stderr: `Failed to run ${cmd}: ${err.message}\nMake sure ${cmd} is installed and in your PATH.`,
        exitCode: 1, killed: false, cancelled: false, figures: [],
      });
    });
  });

  return {
    promise,
    cancel: () => {
      cancelled = true;
      proc.kill("SIGKILL");
    },
    writeStdin: (text: string) => {
      try { proc.stdin?.write(text); } catch { /* stdin may already be closed */ }
    },
    closeStdin: () => {
      try { proc.stdin?.end(); } catch { /* stdin may already be closed */ }
    },
  };
}

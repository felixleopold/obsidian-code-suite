/**
 * Code execution engine — runs code, captures stdout/stderr/images,
 * supports cancel, stdin, and custom environments.
 */

import { Platform } from "obsidian";
import { parseExtraEnv, parseDotEnvFile, parseShellSourceFiles, type CodePluginSettings } from "./settings";

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
 * For Python: wrap code to save matplotlib/plotly figures to temp files
 * so we can capture them as images.
 */
function wrapPythonForGraphs(
  code: string,
  imgDir: string,
  interactivePlots: boolean,
  embedPlotlyJs: boolean,
  matplotlibStyle: string,
): string {
  const styleLines = matplotlibStyle
    ? `    try:\n        __plt.style.use(${JSON.stringify(matplotlibStyle)})\n    except Exception:\n        pass\n`
    : "";
  // Inject at the top: override plt.show() and fig.show() to save to files
  const preamble = `
import sys as __sys
import os as __os
__ocode_img_dir = ${JSON.stringify(imgDir)}
__os.makedirs(__ocode_img_dir, exist_ok=True)
__ocode_img_counter = [0]
__ocode_plotly_interactive = ${interactivePlots ? "True" : "False"}
__ocode_plotly_embed = ${embedPlotlyJs ? "True" : "False"}

# Patch matplotlib
try:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as __plt
${styleLines}    __orig_show = __plt.show
    def __patched_show(*a, **kw):
        __ocode_img_counter[0] += 1
        __idx = __ocode_img_counter[0]
        __fname = __os.path.join(__ocode_img_dir, f"fig_{__idx}.png")
        __plt.savefig(__fname, dpi=150, bbox_inches='tight')
        __plt.close('all')
        print(f"OCODE_FIG_{__idx}", flush=True)
    __plt.show = __patched_show
except ImportError:
    pass

# Patch plotly — capture as interactive HTML (preserves zoom/pan/hover) or
# fall back to a static PNG when interactive plots are disabled.
def __ocode_save_plotly(fig):
    __ocode_img_counter[0] += 1
    __idx = __ocode_img_counter[0]
    if __ocode_plotly_interactive:
        __fname = __os.path.join(__ocode_img_dir, f"fig_{__idx}.html")
        import plotly.io as __pio_w
        __jsmode = True if __ocode_plotly_embed else 'cdn'
        __pio_w.write_html(fig, __fname, include_plotlyjs=__jsmode, full_html=True, config={'responsive': True})
    else:
        __fname = __os.path.join(__ocode_img_dir, f"fig_{__idx}.png")
        fig.write_image(__fname, width=800, height=500)
    print(f"OCODE_FIG_{__idx}", flush=True)
try:
    import plotly.io as __pio
    __orig_pio_show = __pio.show
    def __patched_pio_show(fig, *a, **kw):
        __ocode_save_plotly(fig)
    __pio.show = __patched_pio_show
    import plotly.graph_objects as __pgo
    __orig_pgo_show = __pgo.Figure.show
    def __patched_pgo_show(self, *a, **kw):
        __ocode_save_plotly(self)
    __pgo.Figure.show = __patched_pgo_show
except ImportError:
    pass

try:
    import plotly.express as __px
    __orig_px_show = None
    # plotly express figures are go.Figure instances, already patched above
except ImportError:
    pass

`;
  return preamble + code;
}

/**
 * Resolve the working directory for code execution.
 */
function resolveExecutionCwd(
  settings: CodePluginSettings,
  vaultPath: string | undefined,
  os: typeof import("os"),
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
      exitCode: 1, killed: false, figures: [],
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
      exitCode: 1, killed: false, figures: [],
    };
    return {
      promise: Promise.resolve(result),
      cancel: () => {},
      writeStdin: () => {},
      closeStdin: () => {},
    };
  }

  // Node.js builtins are required for code execution (desktop only, guarded by Platform.isDesktop above).
  // Access via window.require (Electron's Node bridge) to avoid static-analysis restrictions on direct require() calls.
  const nodeRequire = (window as unknown as { require: (id: string) => unknown }).require;
  const { spawn } = nodeRequire("child_process") as typeof import("child_process");
  const fs = nodeRequire("fs") as typeof import("fs");
  const os = nodeRequire("os") as typeof import("os");
  const path = nodeRequire("path") as typeof import("path");

  // Temp dir for this execution
  const execId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const tmpDir = path.join(os.tmpdir(), `ocode-${execId}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const imgDir = path.join(tmpDir, "images");
  const tmpFile = path.join(tmpDir, `code${runtime.ext}`);

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
  const env = { ...process.env, ...dotEnv, ...extraEnv };

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

  const args = [...runtime.args];
  if (settings.shellLogin && (lang === "bash" || lang === "zsh")) {
    args.unshift(lang === "zsh" ? "-l" : "--login");
  }
  args.push(tmpFile);
  let proc: ReturnType<typeof spawn>;
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

  proc.stdout?.on("data", (data: Buffer) => {
    const text = data.toString();
    stdout += text;
    callbacks?.onStdout?.(text);
    if (stdout.length > 200_000) {
      stdout = stdout.slice(0, 200_000) + "\n... (output truncated)";
      killed = true;
      proc.kill("SIGKILL");
    }
  });

  proc.stderr?.on("data", (data: Buffer) => {
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

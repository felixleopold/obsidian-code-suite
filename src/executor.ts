/**
 * Code execution engine — runs code, captures stdout/stderr/images,
 * supports cancel, stdin, and custom environments.
 */

import { Platform } from "obsidian";
import { parseExtraEnv, type CodePluginSettings } from "./settings";
import type { ChildProcess } from "child_process";

/** Runtime definitions */
const RUNTIMES: Record<string, { cmd: string; args: string[]; ext: string }> = {
  python:     { cmd: "python3",  args: ["-u"],      ext: ".py" },
  javascript: { cmd: "node",     args: [],           ext: ".js" },
  typescript: { cmd: "npx",      args: ["tsx"],      ext: ".ts" },
  bash:       { cmd: "bash",     args: [],           ext: ".sh" },
  shell:      { cmd: "sh",       args: [],           ext: ".sh" },
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

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  killed: boolean;
  /** Base64-encoded PNG images (from matplotlib savefig, etc.) */
  images: string[];
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
function wrapPythonForGraphs(code: string, imgDir: string): string {
  // Inject at the top: override plt.show() and fig.show() to save to files
  const preamble = `
import sys as __sys
import os as __os
__ocode_img_dir = ${JSON.stringify(imgDir)}
__os.makedirs(__ocode_img_dir, exist_ok=True)
__ocode_img_counter = [0]

# Patch matplotlib
try:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as __plt
    __orig_show = __plt.show
    def __patched_show(*a, **kw):
        __ocode_img_counter[0] += 1
        __fname = __os.path.join(__ocode_img_dir, f"fig_{__ocode_img_counter[0]}.png")
        __plt.savefig(__fname, dpi=150, bbox_inches='tight', facecolor='#1d2021', edgecolor='none')
        __plt.close('all')
    __plt.show = __patched_show
except ImportError:
    pass

# Patch plotly
try:
    import plotly.io as __pio
    __orig_pio_show = __pio.show
    def __patched_pio_show(fig, *a, **kw):
        __ocode_img_counter[0] += 1
        __fname = __os.path.join(__ocode_img_dir, f"fig_{__ocode_img_counter[0]}.png")
        fig.write_image(__fname, width=800, height=500)
    __pio.show = __patched_pio_show
    import plotly.graph_objects as __pgo
    __orig_pgo_show = __pgo.Figure.show
    def __patched_pgo_show(self, *a, **kw):
        __ocode_img_counter[0] += 1
        __fname = __os.path.join(__ocode_img_dir, f"fig_{__ocode_img_counter[0]}.png")
        self.write_image(__fname, width=800, height=500)
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
 * Start code execution. Returns a RunningProcess handle.
 */
export function startExecution(
  code: string,
  lang: string,
  settings: CodePluginSettings,
  callbacks?: {
    onStdout?: (data: string) => void;
    onStderr?: (data: string) => void;
  }
): RunningProcess {
  if (!Platform.isDesktop) {
    const result: ExecutionResult = {
      stdout: "", stderr: "Code execution is only available on desktop.",
      exitCode: 1, killed: false, images: [],
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
      exitCode: 1, killed: false, images: [],
    };
    return {
      promise: Promise.resolve(result),
      cancel: () => {},
      writeStdin: () => {},
      closeStdin: () => {},
    };
  }

  const { spawn } = require("child_process") as typeof import("child_process");
  const fs = require("fs") as typeof import("fs");
  const os = require("os") as typeof import("os");
  const path = require("path") as typeof import("path");

  // Temp dir for this execution
  const execId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const tmpDir = path.join(os.tmpdir(), `ocode-${execId}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const imgDir = path.join(tmpDir, "images");
  const tmpFile = path.join(tmpDir, `code${runtime.ext}`);

  // For Python: wrap code to capture graphs
  let execCode = code;
  if (lang === "python") {
    execCode = wrapPythonForGraphs(code, imgDir);
  }
  fs.writeFileSync(tmpFile, execCode, "utf-8");

  // Determine command
  let cmd = runtime.cmd;
  if (lang === "python" && settings.pythonPath) {
    cmd = settings.pythonPath;
  } else if ((lang === "javascript" || lang === "typescript") && settings.nodePath) {
    cmd = lang === "javascript" ? settings.nodePath : runtime.cmd;
  }

  // Build env
  const extraEnv = parseExtraEnv(settings.extraEnv);
  const env = { ...process.env, ...extraEnv };

  // If pythonPath is a venv python, also set VIRTUAL_ENV
  if (lang === "python" && settings.pythonPath) {
    const venvBin = path.dirname(settings.pythonPath);
    const venvDir = path.dirname(venvBin);
    if (fs.existsSync(path.join(venvDir, "pyvenv.cfg"))) {
      env["VIRTUAL_ENV"] = venvDir;
      env["PATH"] = venvBin + path.delimiter + (env["PATH"] || "");
    }
  }

  const args = [...runtime.args, tmpFile];
  let proc: ChildProcess;
  let killed = false;
  let stdout = "";
  let stderr = "";

  proc = spawn(cmd, args, {
    cwd: os.homedir(),
    env,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const timer = setTimeout(() => {
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
      clearTimeout(timer);

      // Collect generated images
      const images: string[] = [];
      try {
        if (fs.existsSync(imgDir)) {
          const files = fs.readdirSync(imgDir).sort();
          for (const f of files) {
            if (f.endsWith(".png")) {
              const data = fs.readFileSync(path.join(imgDir, f));
              images.push(data.toString("base64"));
            }
          }
        }
      } catch {}

      // Cleanup
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

      resolve({ stdout, stderr, exitCode, killed, images });
    });

    proc.on("error", (err: Error) => {
      clearTimeout(timer);
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      resolve({
        stdout: "",
        stderr: `Failed to run ${cmd}: ${err.message}\nMake sure ${cmd} is installed and in your PATH.`,
        exitCode: 1, killed: false, images: [],
      });
    });
  });

  return {
    promise,
    cancel: () => {
      killed = true;
      proc.kill("SIGKILL");
    },
    writeStdin: (text: string) => {
      try { proc.stdin?.write(text); } catch {}
    },
    closeStdin: () => {
      try { proc.stdin?.end(); } catch {}
    },
  };
}

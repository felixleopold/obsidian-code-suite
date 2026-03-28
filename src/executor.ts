/** Code execution engine — runs code blocks and captures output */

import { Platform, Notice } from "obsidian";

/** Languages that support execution and their runtime commands */
export const EXECUTABLE_LANGUAGES: Record<string, { cmd: string; args: string[]; fileExt: string }> = {
  python:     { cmd: "python3", args: [],         fileExt: ".py" },
  javascript: { cmd: "node",    args: [],         fileExt: ".js" },
  typescript: { cmd: "npx",     args: ["tsx"],     fileExt: ".ts" },
  bash:       { cmd: "bash",    args: [],         fileExt: ".sh" },
  shell:      { cmd: "sh",      args: [],         fileExt: ".sh" },
  ruby:       { cmd: "ruby",    args: [],         fileExt: ".rb" },
  lua:        { cmd: "lua",     args: [],         fileExt: ".lua" },
  perl:       { cmd: "perl",    args: [],         fileExt: ".pl" },
  r:          { cmd: "Rscript", args: [],         fileExt: ".r" },
  go:         { cmd: "go",      args: ["run"],    fileExt: ".go" },
  rust:       { cmd: "rustc",   args: [],         fileExt: ".rs" }, // special handling
  php:        { cmd: "php",     args: [],         fileExt: ".php" },
  swift:      { cmd: "swift",   args: [],         fileExt: ".swift" },
};

/** Check if a language is executable */
export function isExecutable(lang: string): boolean {
  return lang in EXECUTABLE_LANGUAGES;
}

/** Result of code execution */
export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  killed: boolean;
}

/**
 * Execute code and return the result.
 * Uses child_process.spawn through Electron's Node.js integration.
 */
export async function executeCode(
  code: string,
  lang: string,
  timeout: number
): Promise<ExecutionResult> {
  if (!Platform.isDesktop) {
    return { stdout: "", stderr: "Code execution is only available on desktop.", exitCode: 1, killed: false };
  }

  const runtime = EXECUTABLE_LANGUAGES[lang];
  if (!runtime) {
    return { stdout: "", stderr: `No runtime configured for language: ${lang}`, exitCode: 1, killed: false };
  }

  // Use Electron's require to access Node.js APIs
  const { spawn } = require("child_process") as typeof import("child_process");
  const fs = require("fs") as typeof import("fs");
  const os = require("os") as typeof import("os");
  const path = require("path") as typeof import("path");

  // Write code to a temp file
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `obsidian-code-exec${runtime.fileExt}`);
  fs.writeFileSync(tmpFile, code, "utf-8");

  return new Promise<ExecutionResult>((resolve) => {
    const args = [...runtime.args, tmpFile];
    let stdout = "";
    let stderr = "";
    let killed = false;

    const proc = spawn(runtime.cmd, args, {
      cwd: os.homedir(),
      env: { ...process.env },
      shell: false,
      timeout: 0, // We handle timeout ourselves
    });

    const timer = setTimeout(() => {
      killed = true;
      proc.kill("SIGKILL");
    }, timeout);

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
      // Limit output size to prevent OOM
      if (stdout.length > 100_000) {
        stdout = stdout.slice(0, 100_000) + "\n... (output truncated)";
        killed = true;
        proc.kill("SIGKILL");
      }
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
      if (stderr.length > 50_000) {
        stderr = stderr.slice(0, 50_000) + "\n... (stderr truncated)";
      }
    });

    proc.on("close", (exitCode: number | null) => {
      clearTimeout(timer);
      // Clean up temp file
      try { fs.unlinkSync(tmpFile); } catch {}
      resolve({ stdout, stderr, exitCode, killed });
    });

    proc.on("error", (err: Error) => {
      clearTimeout(timer);
      try { fs.unlinkSync(tmpFile); } catch {}
      resolve({
        stdout: "",
        stderr: `Failed to run ${runtime.cmd}: ${err.message}\nMake sure ${runtime.cmd} is installed and in your PATH.`,
        exitCode: 1,
        killed: false,
      });
    });
  });
}

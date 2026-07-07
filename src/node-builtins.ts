/**
 * Typed access to the Node.js built-ins CodeSuite uses at runtime.
 *
 * Node modules are reached through Electron's `window.require` bridge (never a
 * static top-level import, per the Obsidian plugin rules). The bridge returns
 * `unknown`, so every call site used to cast with `as typeof import("fs")`.
 * That cast resolves to `any` in any environment without `@types/node`
 * installed — including the Obsidian plugin reviewer — which cascades into
 * ~200 `@typescript-eslint/no-unsafe-*` warnings.
 *
 * These hand-written interfaces cover exactly the surface we use, so the code
 * stays fully typed regardless of whether `@types/node` is present.
 */

export interface NodeBuffer {
  toString(encoding?: string): string;
}

interface NodeReadableStream {
  on(event: "data", listener: (chunk: NodeBuffer) => void): void;
}

interface NodeWritableStream {
  write(chunk: string): void;
  end(): void;
}

export interface NodeChildProcessHandle {
  stdout: NodeReadableStream | null;
  stderr: NodeReadableStream | null;
  stdin: NodeWritableStream | null;
  on(event: "close", listener: (code: number | null) => void): void;
  on(event: "error", listener: (err: Error) => void): void;
  kill(signal?: string): void;
}

interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  shell?: boolean;
  stdio?: Array<"pipe" | "ignore" | "inherit">;
}

interface NodeChildProcess {
  // Declared as a property (not a method) so destructuring `spawn` doesn't trip
  // @typescript-eslint/unbound-method.
  spawn: (command: string, args: string[], options: SpawnOptions) => NodeChildProcessHandle;
}

export interface NodeFS {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: string): string;
  readFileSync(path: string): NodeBuffer;
  writeFileSync(path: string, data: string | Uint8Array, encoding?: string): void;
  mkdirSync(path: string, options?: { recursive?: boolean }): void;
  rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
  readdirSync(path: string): string[];
  unlinkSync(path: string): void;
  symlinkSync(target: string, path: string): void;
}

export interface NodePath {
  join(...parts: string[]): string;
  dirname(p: string): string;
  basename(p: string, ext?: string): string;
  extname(p: string): string;
  delimiter: string;
}

export interface NodeOS {
  homedir(): string;
  tmpdir(): string;
  platform(): string;
}

interface NodeProcess {
  env: Record<string, string | undefined>;
  platform: string;
}

/** Require a Node built-in through Electron's bridge, typed to `T`. */
function requireNode<T>(id: string): T {
  const nodeRequire = (window as unknown as { require: (id: string) => unknown }).require;
  return nodeRequire(id) as T;
}

export const getFs = (): NodeFS => requireNode<NodeFS>("fs");
export const getPath = (): NodePath => requireNode<NodePath>("path");
export const getOs = (): NodeOS => requireNode<NodeOS>("os");
export const getChildProcess = (): NodeChildProcess => requireNode<NodeChildProcess>("child_process");
export const getProcess = (): NodeProcess => requireNode<NodeProcess>("process");

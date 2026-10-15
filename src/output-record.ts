/**
 * Language-neutral record of one code block run (#70 part 1, #49).
 *
 * A run's visible output is an ordered sequence of stdout text, stderr text and
 * figures, exactly as the live output panel shows it. The record keeps that
 * order so a restored, baked or exported output reads the same as the live one.
 * Records are persisted by {@link ./output-store} and looked up by
 * {@link outputKey}, so output survives closing a note without being written
 * into it.
 */
import type { ExecutionResult } from "./executor";

export type OutputItem =
  | { kind: "stdout"; text: string }
  | { kind: "stderr"; text: string }
  /** Base64 PNG. */
  | { kind: "image"; data: string }
  | { kind: "widget"; html: string };

export interface OutputRecord {
  v: 1;
  /** Cache key of the block that produced this output (see {@link outputKey}). */
  key: string;
  exit: number | null;
  /** Stopped by the execution timeout or output cap, not by the user. */
  killed: boolean;
  items: OutputItem[];
  /** Epoch ms when the run finished. */
  ranAt: number;
  durationMs: number;
}

/** Collects one run's output in the order the live panel displays it. */
export interface OutputRecorder {
  stdout(text: string): void;
  stderr(text: string): void;
  /** A figure marker (`OCODE_FIG_<index>`) at this point in the output. */
  figure(index: number): void;
  /**
   * Build the record, resolving figure markers against `result.figures` by
   * `figureIndex`. Returns null for a cancelled run: a stopped run never
   * replaces a completed one.
   */
  finish(result: ExecutionResult, meta: { key: string; ranAt: number; durationMs: number }): OutputRecord | null;
}

export function createOutputRecorder(): OutputRecorder {
  throw new Error("not implemented");
}

/**
 * Cache key for a block: SHA-256 (lowercase hex) over the canonical language,
 * the note's vault path and the trimmed source. The note is part of the key
 * because a block's output can depend on its note (shared variables, earlier
 * blocks), so identical code in two notes must not share output. Quarto `#|`
 * option lines are part of the source, so they are covered too.
 */
export function outputKey(input: { lang: string; note: string; code: string }): Promise<string> {
  void input;
  throw new Error("not implemented");
}

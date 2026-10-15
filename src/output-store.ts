/**
 * Persistent store of {@link OutputRecord}s, one entry per cache key, in a
 * folder outside the vault's notes (by default the plugin's own folder).
 *
 * Layout, written through the vault adapter:
 *
 *   <dir>/<key>.json     the record, with image items as { kind: "image", file: "<key>-<n>.png" }
 *   <dir>/<key>-<n>.png  image n (1-based, in item order)
 *
 * The JSON file is written last and is the commit point: an entry exists iff
 * its JSON exists. Operations run one at a time in call order.
 */
import type { OutputRecord } from "./output-record";

/** The subset of Obsidian's `DataAdapter` the store uses. */
export interface StoreAdapter {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  readBinary(path: string): Promise<ArrayBuffer>;
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
  remove(path: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  stat(path: string): Promise<{ size: number; mtime: number } | null>;
}

/** Default size cap for the whole store. */
export const DEFAULT_MAX_STORE_BYTES = 200 * 1024 * 1024;

export class OutputStore {
  constructor(
    private readonly adapter: StoreAdapter,
    private readonly dir: string,
    private readonly maxBytes = DEFAULT_MAX_STORE_BYTES,
  ) {}

  /** Index existing entries. Call once before {@link has}; a missing folder is an empty store. */
  load(): Promise<void> {
    throw new Error("not implemented");
  }

  /** Whether an entry exists for `key` (from the index; no I/O). */
  has(key: string): boolean {
    void key;
    throw new Error("not implemented");
  }

  /** The stored record, or null when absent, unreadable, incomplete or of another version. */
  get(key: string): Promise<OutputRecord | null> {
    void key;
    throw new Error("not implemented");
  }

  /**
   * Store `record` under `record.key`, replacing any previous entry and its
   * images. Afterwards, while the store exceeds its size cap, delete the
   * least recently written entries other than this one.
   */
  put(record: OutputRecord): Promise<void> {
    void record;
    throw new Error("not implemented");
  }

  delete(key: string): Promise<void> {
    void key;
    throw new Error("not implemented");
  }

  /** Delete every entry. */
  clear(): Promise<void> {
    throw new Error("not implemented");
  }
}

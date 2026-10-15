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
import { arrayBufferToBase64, base64ToArrayBuffer } from "obsidian";
import type { OutputItem, OutputRecord } from "./output-record";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
  private readonly index = new Map<string, { bytes: number; mtime: number }>();
  private pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly adapter: StoreAdapter,
    private readonly dir: string,
    private readonly maxBytes = DEFAULT_MAX_STORE_BYTES,
  ) {}

  /** Index existing entries. Call once before {@link has}; a missing folder is an empty store. */
  load(): Promise<void> {
    return this.enqueue(async () => {
      const files = await this.files();
      this.index.clear();
      for (const file of files) {
        if (file.endsWith(".json")) {
          const key = file.slice(`${this.dir}/`.length, -5);
          await this.indexEntry(key, files);
        }
      }
    });
  }

  /** Whether an entry exists for `key` (from the index; no I/O). */
  has(key: string): boolean {
    return this.index.has(key);
  }

  /** The stored record, or null when absent, unreadable, incomplete or of another version. */
  get(key: string): Promise<OutputRecord | null> {
    return this.enqueue(async () => {
      try {
        const value: unknown = JSON.parse(await this.adapter.read(`${this.dir}/${key}.json`));
        if (!isObject(value) || value.v !== 1 || value.key !== key
          || !(value.exit === null || (typeof value.exit === "number" && Number.isInteger(value.exit)))
          || typeof value.killed !== "boolean" || !Array.isArray(value.items)
          || typeof value.ranAt !== "number" || !Number.isFinite(value.ranAt)
          || typeof value.durationMs !== "number" || !Number.isFinite(value.durationMs)
          || value.durationMs < 0) return null;

        const items: OutputItem[] = [];
        let image = 0;
        for (const item of value.items as unknown[]) {
          if (!isObject(item)) return null;
          if ((item.kind === "stdout" || item.kind === "stderr") && typeof item.text === "string") {
            items.push({ kind: item.kind, text: item.text });
          } else if (item.kind === "widget" && typeof item.html === "string") {
            items.push({ kind: "widget", html: item.html });
          } else if (item.kind === "image" && item.file === `${key}-${++image}.png`) {
            const data = await this.adapter.readBinary(`${this.dir}/${item.file}`);
            items.push({ kind: "image", data: arrayBufferToBase64(data) });
          } else return null;
        }
        return {
          v: 1, key, exit: value.exit, killed: value.killed, items,
          ranAt: value.ranAt, durationMs: value.durationMs,
        };
      } catch {
        /* Absent, unreadable or corrupt entries are cache misses. */
        return null;
      }
    });
  }

  /**
   * Store `record` under `record.key`, replacing any previous entry and its
   * images. Afterwards, while the store exceeds its size cap, delete the
   * least recently written entries other than this one.
   */
  put(record: OutputRecord): Promise<void> {
    return this.enqueue(async () => {
      if (!await this.adapter.exists(this.dir)) await this.adapter.mkdir(this.dir);
      const files = await this.files();
      const images = new Set<string>();
      const items: (OutputItem | { kind: "image"; file: string })[] = [];
      try {
        for (const item of record.items) {
          if (item.kind === "image") {
            const file = `${record.key}-${images.size + 1}.png`;
            const path = `${this.dir}/${file}`;
            images.add(path);
            await this.adapter.writeBinary(path, base64ToArrayBuffer(item.data));
            items.push({ kind: "image", file });
          } else items.push(item);
        }
        await this.adapter.write(`${this.dir}/${record.key}.json`, JSON.stringify({ ...record, items }));
        for (const file of files) {
          if (this.isImage(file, record.key) && !images.has(file)) await this.remove(file);
        }
      } finally {
        // A failed replacement may still have changed existing image sizes.
        await this.indexEntry(record.key, await this.files());
      }

      let bytes = [...this.index.values()].reduce((total, entry) => total + entry.bytes, 0);
      const oldest = [...this.index.entries()].sort((a, b) => a[1].mtime - b[1].mtime);
      for (const [key, entry] of oldest) {
        if (bytes <= this.maxBytes) break;
        if (key === record.key) continue;
        await this.deleteEntry(key);
        bytes -= entry.bytes;
      }
    });
  }

  delete(key: string): Promise<void> {
    return this.enqueue(() => this.deleteEntry(key));
  }

  /** Delete every entry. */
  clear(): Promise<void> {
    return this.enqueue(async () => {
      const files = await this.files();
      const keys = new Set(this.index.keys());
      for (const file of files) {
        if (file.endsWith(".json")) keys.add(file.slice(`${this.dir}/`.length, -5));
      }
      for (const key of keys) await this.deleteEntry(key);
      // Remove orphan images left by an interrupted first write as well.
      for (const file of files) {
        if (/-[1-9]\d*\.png$/.test(file)) await this.remove(file);
      }
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation);
    this.pending = result.then(() => undefined, () => undefined);
    return result;
  }

  private async files(): Promise<string[]> {
    try {
      return (await this.adapter.list(this.dir)).files;
    } catch (error) {
      if (!await this.adapter.exists(this.dir)) return [];
      throw error;
    }
  }

  private isImage(path: string, key: string): boolean {
    const prefix = `${this.dir}/${key}-`;
    return path.startsWith(prefix) && /^[1-9]\d*\.png$/.test(path.slice(prefix.length));
  }

  private async indexEntry(key: string, files: string[]): Promise<void> {
    const json = await this.adapter.stat(`${this.dir}/${key}.json`);
    if (!json) {
      this.index.delete(key);
      return;
    }
    let bytes = json.size;
    for (const file of files) {
      if (this.isImage(file, key)) bytes += (await this.adapter.stat(file))?.size ?? 0;
    }
    this.index.set(key, { bytes, mtime: json.mtime });
  }

  private async remove(path: string): Promise<void> {
    try {
      await this.adapter.remove(path);
    } catch (error) {
      if (await this.adapter.exists(path)) throw error;
    }
  }

  private async deleteEntry(key: string): Promise<void> {
    await this.remove(`${this.dir}/${key}.json`);
    this.index.delete(key);
    for (const file of await this.files()) {
      if (this.isImage(file, key)) await this.remove(file);
    }
  }
}

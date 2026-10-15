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
 * its JSON exists. Replacement removes the old JSON before writing images.
 * Only SHA-256 filenames in this layout belong to the store. Operations run
 * one at a time in call order.
 */
import { arrayBufferToBase64, base64ToArrayBuffer } from "obsidian";
import type { OutputItem, OutputRecord } from "./output-record";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface EntryFiles {
  json?: string;
  images: string[];
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
      for (const [key, entry] of files) {
        if (!await this.indexEntry(key, entry)) {
          for (const image of entry.images) await this.remove(image);
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
      if (!/^[0-9a-f]{64}$/.test(key)) return null;
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
      if (!/^[0-9a-f]{64}$/.test(record.key)) throw new Error("Invalid output cache key");
      if (!await this.adapter.exists(this.dir)) await this.adapter.mkdir(this.dir);
      const files = await this.files();
      const json = `${this.dir}/${record.key}.json`;
      const previous = files.get(record.key)?.images ?? [];
      await this.remove(json);
      this.index.delete(record.key);
      const images = new Set<string>();
      const items: (OutputItem | { kind: "image"; file: string })[] = [];
      let committed = false;
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
        await this.adapter.write(json, JSON.stringify({ ...record, items }));
        committed = true;
        for (const file of previous) {
          if (!images.has(file)) await this.remove(file);
        }
      } catch (error) {
        if (!committed) {
          for (const path of [json, ...new Set([...previous, ...images])]) {
            try {
              await this.remove(path);
            } catch {
              /* Best effort: load removes any remaining orphan images. */
            }
          }
        }
        throw error;
      } finally {
        if (committed) {
          const entry = { json, images: [...new Set([...previous, ...images])] };
          await this.indexEntry(record.key, entry);
          files.set(record.key, entry);
        }
      }

      let bytes = [...this.index.values()].reduce((total, entry) => total + entry.bytes, 0);
      const oldest = [...this.index.entries()].sort((a, b) => a[1].mtime - b[1].mtime);
      for (const [key, entry] of oldest) {
        if (bytes <= this.maxBytes) break;
        if (key === record.key) continue;
        await this.deleteEntry(key, files.get(key));
        bytes -= entry.bytes;
      }
    });
  }

  delete(key: string): Promise<void> {
    return this.enqueue(async () => {
      if (!/^[0-9a-f]{64}$/.test(key)) return;
      const files = await this.files();
      await this.deleteEntry(key, files.get(key));
    });
  }

  /** Delete every entry. */
  clear(): Promise<void> {
    return this.enqueue(async () => {
      const files = await this.files();
      const keys = new Set([...this.index.keys(), ...files.keys()]);
      for (const key of keys) await this.deleteEntry(key, files.get(key));
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation);
    this.pending = result.then(() => undefined, () => undefined);
    return result;
  }

  private async files(): Promise<Map<string, EntryFiles>> {
    let paths: string[];
    try {
      paths = (await this.adapter.list(this.dir)).files;
    } catch (error) {
      if (!await this.adapter.exists(this.dir)) return new Map();
      throw error;
    }
    const files = new Map<string, EntryFiles>();
    const prefix = `${this.dir}/`;
    for (const path of paths) {
      if (!path.startsWith(prefix)) continue;
      const match = /^([0-9a-f]{64})(\.json|-[1-9]\d*\.png)$/.exec(path.slice(prefix.length));
      if (!match) continue;
      const key = match[1];
      const entry = files.get(key) ?? { images: [] };
      if (match[2] === ".json") entry.json = path;
      else entry.images.push(path);
      files.set(key, entry);
    }
    return files;
  }

  private async indexEntry(key: string, files: EntryFiles): Promise<boolean> {
    const json = files.json ? await this.adapter.stat(files.json) : null;
    this.index.delete(key);
    if (!json) {
      return false;
    }
    let bytes = json.size;
    for (const file of files.images) {
      bytes += (await this.adapter.stat(file))?.size ?? 0;
    }
    this.index.set(key, { bytes, mtime: json.mtime });
    return true;
  }

  private async remove(path: string): Promise<void> {
    try {
      await this.adapter.remove(path);
    } catch (error) {
      if (await this.adapter.exists(path)) throw error;
    }
  }

  private async deleteEntry(key: string, files: EntryFiles | undefined): Promise<void> {
    await this.remove(`${this.dir}/${key}.json`);
    this.index.delete(key);
    for (const file of files?.images ?? []) await this.remove(file);
  }
}

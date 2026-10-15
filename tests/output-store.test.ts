import assert from "node:assert/strict";
import test from "node:test";
import type { OutputRecord } from "../src/output-record";
import { OutputStore, type StoreAdapter } from "../src/output-store";

/**
 * In-memory stand-in for Obsidian's DataAdapter. Like the real adapter, paths
 * are vault-relative, `list` returns full paths, and reading, listing or
 * removing a missing path throws.
 */
class MemoryAdapter implements StoreAdapter {
  files = new Map<string, { data: string | ArrayBuffer; mtime: number }>();
  folders = new Set<string>();
  private clock = 0;

  private parent(path: string): string {
    return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  }
  private requireFile(path: string) {
    const file = this.files.get(path);
    if (!file) throw new Error(`ENOENT: ${path}`);
    return file;
  }
  private put(path: string, data: string | ArrayBuffer): void {
    if (this.parent(path) && !this.folders.has(this.parent(path))) throw new Error(`ENOENT: ${this.parent(path)}`);
    this.files.set(path, { data, mtime: ++this.clock });
  }

  exists(path: string) { return Promise.resolve(this.files.has(path) || this.folders.has(path)); }
  read(path: string) {
    const { data } = this.requireFile(path);
    if (typeof data !== "string") throw new Error(`binary file: ${path}`);
    return Promise.resolve(data);
  }
  write(path: string, data: string) { this.put(path, data); return Promise.resolve(); }
  readBinary(path: string) {
    const { data } = this.requireFile(path);
    if (typeof data === "string") throw new Error(`text file: ${path}`);
    return Promise.resolve(data.slice(0));
  }
  writeBinary(path: string, data: ArrayBuffer) { this.put(path, data.slice(0)); return Promise.resolve(); }
  remove(path: string) {
    this.requireFile(path);
    this.files.delete(path);
    return Promise.resolve();
  }
  mkdir(path: string) {
    let current = "";
    for (const part of path.split("/")) {
      current = current ? `${current}/${part}` : part;
      this.folders.add(current);
    }
    return Promise.resolve();
  }
  list(path: string) {
    if (!this.folders.has(path)) throw new Error(`ENOENT: ${path}`);
    const files = [...this.files.keys()].filter((p) => this.parent(p) === path);
    const folders = [...this.folders].filter((p) => this.parent(p) === path);
    return Promise.resolve({ files, folders });
  }
  stat(path: string) {
    const file = this.files.get(path);
    if (!file) return Promise.resolve(null);
    const size = typeof file.data === "string" ? Buffer.byteLength(file.data) : file.data.byteLength;
    return Promise.resolve({ size, mtime: file.mtime });
  }
}

const DIR = ".obsidian/plugins/code-suite/outputs";
const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);
const KEY_C = "c".repeat(64);
// 1×1 transparent PNG.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function record(key: string, overrides: Partial<OutputRecord> = {}): OutputRecord {
  return {
    v: 1, key, exit: 0, killed: false, ranAt: 1_700_000_000_000, durationMs: 12,
    items: [
      { kind: "stdout", text: "before\n" },
      { kind: "image", data: PNG },
      { kind: "stderr", text: "careful\n" },
      { kind: "widget", html: "<div id=\"plot\"></div>" },
      { kind: "image", data: PNG.replace("AAAAC0", "AAAAD0") },
      { kind: "stdout", text: "after\n" },
    ],
    ...overrides,
  };
}

async function freshStore(adapter = new MemoryAdapter(), maxBytes?: number) {
  const store = new OutputStore(adapter, DIR, maxBytes);
  await store.load();
  return { adapter, store };
}

test("an empty or missing folder is an empty store", async () => {
  const { store } = await freshStore();
  assert.equal(store.has(KEY_A), false);
  assert.equal(await store.get(KEY_A), null);
});

test("a stored record round-trips with its order and figures intact", async () => {
  const { store } = await freshStore();
  const original = record(KEY_A);
  await store.put(original);
  assert.equal(store.has(KEY_A), true);
  assert.deepEqual(await store.get(KEY_A), original);
});

test("images are stored as files beside the JSON, not inline", async () => {
  const { adapter, store } = await freshStore();
  await store.put(record(KEY_A));
  const json = await adapter.read(`${DIR}/${KEY_A}.json`);
  assert.equal(json.includes(PNG), false);
  assert.equal(await adapter.exists(`${DIR}/${KEY_A}-1.png`), true);
  assert.equal(await adapter.exists(`${DIR}/${KEY_A}-2.png`), true);
});

test("a record survives a new store instance (note closed and reopened)", async () => {
  const { adapter, store } = await freshStore();
  await store.put(record(KEY_A));
  const { store: reopened } = await freshStore(adapter);
  assert.equal(reopened.has(KEY_A), true);
  assert.deepEqual(await reopened.get(KEY_A), record(KEY_A));
});

test("replacing an entry removes images the new record no longer has", async () => {
  const { adapter, store } = await freshStore();
  await store.put(record(KEY_A));
  const replacement = record(KEY_A, { exit: 1, items: [{ kind: "stderr", text: "boom\n" }] });
  await store.put(replacement);
  assert.deepEqual(await store.get(KEY_A), replacement);
  assert.equal(await adapter.exists(`${DIR}/${KEY_A}-1.png`), false);
  assert.equal(await adapter.exists(`${DIR}/${KEY_A}-2.png`), false);
});

test("delete removes one entry and its images; clear removes all", async () => {
  const { adapter, store } = await freshStore();
  await store.put(record(KEY_A));
  await store.put(record(KEY_B));
  await store.delete(KEY_A);
  assert.equal(store.has(KEY_A), false);
  assert.equal(await store.get(KEY_A), null);
  assert.equal([...adapter.files.keys()].some((p) => p.includes(KEY_A)), false);
  assert.equal(store.has(KEY_B), true);
  await store.delete(KEY_C); // absent: no error

  await store.clear();
  assert.equal(store.has(KEY_B), false);
  assert.equal([...adapter.files.keys()].some((p) => p.startsWith(`${DIR}/`)), false);
  const { store: reopened } = await freshStore(adapter);
  assert.equal(reopened.has(KEY_A) || reopened.has(KEY_B), false);
});

test("unreadable, incomplete or foreign-version entries read as absent", async () => {
  const { adapter, store } = await freshStore();
  await store.put(record(KEY_A));
  await store.put(record(KEY_B));
  await store.put(record(KEY_C));

  await adapter.write(`${DIR}/${KEY_A}.json`, "{not json");
  await adapter.remove(`${DIR}/${KEY_B}-2.png`);
  const foreign = JSON.parse(await adapter.read(`${DIR}/${KEY_C}.json`)) as Record<string, unknown>;
  await adapter.write(`${DIR}/${KEY_C}.json`, JSON.stringify({ ...foreign, v: 2 }));

  assert.equal(await store.get(KEY_A), null);
  assert.equal(await store.get(KEY_B), null);
  assert.equal(await store.get(KEY_C), null);
});

test("a JSON file whose key does not match its name reads as absent", async () => {
  const { adapter, store } = await freshStore();
  await store.put(record(KEY_A, { items: [{ kind: "stdout", text: "x\n" }] }));
  await adapter.write(`${DIR}/${KEY_B}.json`, await adapter.read(`${DIR}/${KEY_A}.json`));
  const { store: reopened } = await freshStore(adapter);
  assert.equal(await reopened.get(KEY_B), null);
});

test("operations apply in call order even when not awaited", async () => {
  const { store } = await freshStore();
  const first = record(KEY_A, { items: [{ kind: "stdout", text: "first\n" }] });
  const second = record(KEY_A, { items: [{ kind: "stdout", text: "second\n" }] });
  const writes = [store.put(first), store.put(second), store.delete(KEY_B)];
  await Promise.all(writes);
  assert.deepEqual(await store.get(KEY_A), second);
});

test("over the size cap, the least recently written entries are removed first", async () => {
  const adapter = new MemoryAdapter();
  const { store: probe } = await freshStore(adapter);
  await probe.put(record(KEY_A));
  const entryBytes = [...adapter.files.entries()]
    .filter(([path]) => path.includes(KEY_A))
    .reduce((sum, [, file]) => sum + (typeof file.data === "string" ? Buffer.byteLength(file.data) : file.data.byteLength), 0);
  await probe.clear();

  // Room for two entries but not three.
  const { store } = await freshStore(adapter, Math.floor(entryBytes * 2.5));
  await store.put(record(KEY_A));
  await store.put(record(KEY_B));
  await store.put(record(KEY_C));
  assert.equal(store.has(KEY_A), false);
  assert.equal(store.has(KEY_B), true);
  assert.equal(store.has(KEY_C), true);
  assert.equal([...adapter.files.keys()].some((p) => p.includes(KEY_A)), false);

  // The cap also applies to entries indexed by load().
  const { store: reopened } = await freshStore(adapter, Math.floor(entryBytes * 1.5));
  await reopened.put(record(KEY_A));
  assert.equal(reopened.has(KEY_B), false);
  assert.equal(reopened.has(KEY_C), false);
  assert.equal(reopened.has(KEY_A), true);
});

test("an entry larger than the cap is still kept as the newest entry", async () => {
  const { store } = await freshStore(new MemoryAdapter(), 10);
  await store.put(record(KEY_A));
  assert.deepEqual(await store.get(KEY_A), record(KEY_A));
});

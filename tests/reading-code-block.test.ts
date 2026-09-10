import assert from "node:assert/strict";
import test from "node:test";
import type { MarkdownPostProcessorContext } from "obsidian";
import { fencedBlockInfos } from "../src/block-options";
import { ReadingCodeBlock } from "../src/reading-code-block";

test("reused Reading blocks refresh their own options using current section positions", () => {
  const source = "```python\nprint(1)\n```\n\n```python\nprint(1)\n```";
  let section = { text: source, lineStart: 0, lineEnd: 6 };
  const replacements: HTMLElement[] = [];
  const wrapper = {
    isConnected: true,
    replaceWith(next: HTMLElement) { replacements.push(next); },
  } as unknown as HTMLElement;
  const next = { ...wrapper } as HTMLElement;
  const infos: string[] = [];
  const mounted = new Set<ReadingCodeBlock>();
  let running = false;
  const child = new ReadingCodeBlock(wrapper, {
    getSectionInfo: () => section,
  } as unknown as MarkdownPostProcessorContext, 1, fencedBlockInfos(source)[1], (info) => {
    if (running) return null;
    infos.push(info);
    return next;
  }, mounted);
  child.onload();
  child.sync();
  assert.equal(infos.length, 0);

  // The section moved and only its second, otherwise identical fence changed.
  section = { text: "New paragraph\n\n" + source.replace(/```python(?=\nprint\(1\)\n```$)/, "```python static"), lineStart: 2, lineEnd: 8 };
  running = true;
  child.sync();
  assert.equal(replacements.length, 0);
  running = false;
  child.sync();
  child.sync();
  assert.deepEqual(infos, ["python static"]);
  assert.deepEqual(replacements, [next]);
  assert.equal(child.containerEl, next);

  // Native rendering owns source changes; stale components must not replace it.
  section.text = section.text.replace(/print\(1\)(?=\n```$)/, "print(2)");
  child.sync();
  assert.equal(replacements.length, 1);
  child.unload();
  assert.equal(mounted.size, 0);
});

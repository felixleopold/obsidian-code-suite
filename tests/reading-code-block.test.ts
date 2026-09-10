import assert from "node:assert/strict";
import test from "node:test";
import type { MarkdownPostProcessorContext } from "obsidian";
import { fencedBlockInfos } from "../src/block-options";
import { ReadingCodeBlock } from "../src/reading-code-block";

test("reused Reading blocks refresh their own options and report height changes", (t) => {
  const observed = new Set<Element>();
  let notify: (target: Element, height: number) => void = () => assert.fail("Observer not created");
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, "ResizeObserver", descriptor);
    else Reflect.deleteProperty(globalThis, "ResizeObserver");
  });
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class {
      constructor(callback: (entries: ResizeObserverEntry[]) => void) {
        notify = (target, height) => callback([
          { target, borderBoxSize: [{ blockSize: height, inlineSize: 100 }] } as unknown as ResizeObserverEntry,
        ]);
      }
      observe(target: Element) { observed.add(target); }
      unobserve(target: Element) { observed.delete(target); }
      disconnect() { observed.clear(); }
    },
  });
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
  const resized: HTMLElement[] = [];
  let running = false;
  const child = new ReadingCodeBlock(wrapper, {
    getSectionInfo: () => section,
  } as unknown as MarkdownPostProcessorContext, 1, fencedBlockInfos(source)[1], (info) => {
    if (running) return null;
    infos.push(info);
    return next;
  }, mounted, (element) => resized.push(element));
  child.onload();
  notify(wrapper, 11000);
  assert.equal(resized.length, 0);
  notify(wrapper, 41);
  notify(wrapper, 41);
  assert.deepEqual(resized, [wrapper]);
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
  assert.deepEqual([...observed], [next]);
  notify(next, 80);
  assert.deepEqual(resized, [wrapper, next]);

  // Native rendering owns source changes; stale components must not replace it.
  section.text = section.text.replace(/print\(1\)(?=\n```$)/, "print(2)");
  child.sync();
  assert.equal(replacements.length, 1);
  child.unload();
  assert.equal(mounted.size, 0);
  assert.equal(observed.size, 0);
});

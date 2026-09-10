import assert from "node:assert/strict";
import test from "node:test";
import type { EditorView } from "@codemirror/view";
import { CodeBlockWidget } from "../src/code-block-widget";

test("equal widget replacement cleans up the mounted DOM before it is reused", (t) => {
  const observers: { notify: () => void; disconnected: boolean }[] = [];
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, "ResizeObserver", descriptor);
    else Reflect.deleteProperty(globalThis, "ResizeObserver");
  });
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class {
      disconnected = false;
      constructor(readonly notify: () => void) { observers.push(this); }
      observe() {}
      disconnect() { this.disconnected = true; }
    },
  });
  const codeArea = new EventTarget();
  const wrapper = {
    isConnected: true,
    querySelector: () => codeArea,
  } as unknown as HTMLElement;
  const first = { measures: 0, reveals: 0, focuses: 0 };
  const second = { measures: 0, reveals: 0, focuses: 0 };
  const editor = (counts: typeof first) => ({
    requestMeasure: () => { counts.measures++; },
    posAtDOM: () => 42,
    dispatch: () => { counts.reveals++; },
    focus: () => { counts.focuses++; },
  }) as unknown as EditorView;
  const clickCode = () => {
    const event = new Event("mousedown", { cancelable: true });
    Object.defineProperty(event, "button", { value: 0 });
    codeArea.dispatchEvent(event);
  };
  const owner = {};
  const mounted = new CodeBlockWidget(owner, "block", () => wrapper);
  const replacement = new CodeBlockWidget(owner, "block", () => wrapper);
  assert.equal(mounted.eq(replacement), true);
  mounted.toDOM(editor(first));
  observers[0].notify();
  clickCode();
  assert.deepEqual(first, { measures: 1, reveals: 1, focuses: 1 });

  // CodeMirror destroys the equal replacement, which never received toDOM.
  replacement.destroy(wrapper);
  assert.equal(observers[0].disconnected, true);
  clickCode();
  assert.equal(first.reveals, 1);

  const remounted = new CodeBlockWidget({}, "block", () => wrapper);
  assert.equal(mounted.eq(remounted), false);
  remounted.toDOM(editor(second));
  observers[1].notify();
  clickCode();
  assert.deepEqual(first, { measures: 1, reveals: 1, focuses: 1 });
  assert.deepEqual(second, { measures: 1, reveals: 1, focuses: 1 });
  remounted.destroy(wrapper);
  assert.equal(observers[1].disconnected, true);
});

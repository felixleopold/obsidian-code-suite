import { EditorView, WidgetType } from "@codemirror/view";

// CodeMirror can replace an equal WidgetType without calling toDOM again.
// Mount cleanup therefore belongs to the DOM, not the transient widget object.
const mountedWrappers = new WeakMap<HTMLElement, () => void>();

/** CodeMirror block widget with editor-owned DOM and measured dynamic height. */
export class CodeBlockWidget extends WidgetType {
  constructor(
    private readonly owner: object,
    private readonly key: string,
    private readonly resolve: () => HTMLElement | null,
  ) {
    super();
  }

  eq(other: CodeBlockWidget): boolean {
    return other.owner === this.owner && other.key === this.key;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = this.resolve() ?? createDiv({ cls: "ocode-wrapper ocode-lp-empty" });
    mountedWrappers.get(wrapper)?.();

    const observer = new ResizeObserver(() => {
      if (wrapper.isConnected) view.requestMeasure();
    });
    observer.observe(wrapper);

    const codeArea = wrapper.querySelector<HTMLElement>("pre.shiki");
    const reveal = (event: MouseEvent) => {
      // Preserve modified gestures; ordinary clicks reveal the editable source.
      if (event.button !== 0 || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
      const pos = view.posAtDOM(wrapper);
      event.preventDefault();
      view.dispatch({ selection: { anchor: pos } });
      view.focus();
    };
    codeArea?.addEventListener("mousedown", reveal);
    mountedWrappers.set(wrapper, () => {
      observer.disconnect();
      codeArea?.removeEventListener("mousedown", reveal);
    });
    return wrapper;
  }

  destroy(dom: HTMLElement): void {
    mountedWrappers.get(dom)?.();
    mountedWrappers.delete(dom);
  }

  /** Chrome handles its own events; code-body clicks explicitly reveal source. */
  ignoreEvent(): boolean {
    return true;
  }

  /** Let CodeMirror measure the mounted DOM height. */
  get estimatedHeight(): number {
    return -1;
  }
}

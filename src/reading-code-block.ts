import { MarkdownRenderChild, type MarkdownPostProcessorContext } from "obsidian";
import { fencedBlockInfos } from "./block-options";

/** Refresh only reused fence chrome; Obsidian owns source rendering and scrolling. */
export class ReadingCodeBlock extends MarkdownRenderChild {
  private observer: ResizeObserver | null = null;

  constructor(
    wrapper: HTMLElement,
    private readonly ctx: MarkdownPostProcessorContext,
    private readonly fenceIndex: number,
    private fence: ReturnType<typeof fencedBlockInfos>[number],
    private readonly render: (info: string, current: HTMLElement) => HTMLElement | null,
    private readonly mounted: Set<ReadingCodeBlock>,
    private readonly resized: (wrapper: HTMLElement) => void,
  ) {
    super(wrapper);
  }

  onload(): void {
    this.mounted.add(this);
    this.register(() => this.mounted.delete(this));
    let height: number | null = null;
    this.observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target !== this.containerEl || !this.containerEl.isConnected) continue;
        const nextHeight = entry.borderBoxSize[0].blockSize;
        // Native rendering measures the initial mount. Later height changes
        // must invalidate Reading view's cached section layout explicitly.
        if (height !== null && height !== nextHeight) this.resized(this.containerEl);
        height = nextHeight;
      }
    });
    this.observer.observe(this.containerEl, { box: "border-box" });
    this.register(() => {
      this.observer?.disconnect();
      this.observer = null;
    });
  }

  sync(): void {
    if (!this.containerEl.isConnected) return;
    const section = this.ctx.getSectionInfo(this.containerEl);
    if (!section) return;
    const fence = fencedBlockInfos(section.text.split("\n")
      .slice(section.lineStart, section.lineEnd + 1).join("\n"))[this.fenceIndex];
    // Source/language edits belong to the native renderer. Only info-string
    // edits can leave its HTML unchanged and require an in-place chrome update.
    if (!fence || fence.code !== this.fence.code ||
      fence.info.split(/\s+/)[0] !== this.fence.info.split(/\s+/)[0] ||
      fence.info === this.fence.info) return;
    const next = this.render(fence.info, this.containerEl);
    if (!next) return;
    this.observer?.unobserve(this.containerEl);
    this.containerEl.replaceWith(next);
    this.containerEl = next;
    this.observer?.observe(next, { box: "border-box" });
    this.fence = fence;
  }
}

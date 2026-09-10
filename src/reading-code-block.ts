import { MarkdownRenderChild, type MarkdownPostProcessorContext } from "obsidian";
import { fencedBlockInfos } from "./block-options";

/** Refresh only reused fence chrome; Obsidian owns source rendering and scrolling. */
export class ReadingCodeBlock extends MarkdownRenderChild {
  constructor(
    wrapper: HTMLElement,
    private readonly ctx: MarkdownPostProcessorContext,
    private readonly fenceIndex: number,
    private fence: ReturnType<typeof fencedBlockInfos>[number],
    private readonly render: (info: string, current: HTMLElement) => HTMLElement | null,
    private readonly mounted: Set<ReadingCodeBlock>,
  ) {
    super(wrapper);
  }

  onload(): void {
    this.mounted.add(this);
    this.register(() => this.mounted.delete(this));
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
    this.containerEl.replaceWith(next);
    this.containerEl = next;
    this.fence = fence;
  }
}

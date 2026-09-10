export const Platform = { isDesktop: true };

export class MarkdownRenderChild {
  private cleanups: (() => void)[] = [];
  constructor(public containerEl: HTMLElement) {}
  register(cleanup: () => void): void { this.cleanups.push(cleanup); }
  unload(): void { this.cleanups.splice(0).forEach((cleanup) => cleanup()); }
}

export const Platform = { isDesktop: true };

export class MarkdownRenderChild {
  private cleanups: (() => void)[] = [];
  constructor(public containerEl: HTMLElement) {}
  register(cleanup: () => void): void { this.cleanups.push(cleanup); }
  unload(): void { this.cleanups.splice(0).forEach((cleanup) => cleanup()); }
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return Buffer.from(buffer).toString("base64");
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const bytes = Buffer.from(base64, "base64");
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

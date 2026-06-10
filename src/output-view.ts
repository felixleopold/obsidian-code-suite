/**
 * Shared rendering for code execution outputs: static images (matplotlib PNGs)
 * and interactive HTML widgets (Plotly figures). Provides per-item toolbars
 * (copy / download / full-screen) and a full-screen modal.
 */

import { App, Modal } from "obsidian";
import type { OutputFigure } from "./executor";

const OUTPUT_ICON = {
  copy: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  check: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`,
  download: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
  expand: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`,
};

function parseSvg(svgString: string): Node {
  const doc = new DOMParser().parseFromString(svgString, "text/html");
  return activeDocument.adoptNode(doc.body.firstChild!);
}

function setSvgContent(el: Element, svgString: string): void {
  el.textContent = "";
  el.appendChild(parseSvg(svgString));
}

function pngDataUrl(base64: string): string {
  return `data:image/png;base64,${base64}`;
}

function makeToolButton(
  parent: HTMLElement,
  icon: string,
  title: string,
  onClick: () => void,
): HTMLButtonElement {
  const btn = parent.createEl("button", { cls: "ocode-output-tool", attr: { title, "aria-label": title } });
  btn.appendChild(parseSvg(icon));
  btn.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
  return btn;
}

function flashConfirm(btn: HTMLButtonElement): void {
  setSvgContent(btn, OUTPUT_ICON.check);
  window.setTimeout(() => setSvgContent(btn, OUTPUT_ICON.copy), 2000);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function copyImageToClipboard(base64: string): Promise<void> {
  const blob = new Blob([base64ToBytes(base64) as BlobPart], { type: "image/png" });
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

function downloadImage(base64: string, index: number): void {
  const a = createEl("a", { attr: { href: pngDataUrl(base64), download: `plot-${index}.png` } });
  a.click();
}

class FullscreenOutputModal extends Modal {
  private readonly buildBody: (container: HTMLElement) => void;

  constructor(app: App, buildBody: (container: HTMLElement) => void) {
    super(app);
    this.buildBody = buildBody;
  }

  onOpen(): void {
    this.modalEl.addClass("ocode-fullscreen-modal");
    this.contentEl.addClass("ocode-fullscreen-body");
    this.buildBody(this.contentEl);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Build the DOM element for a single figure (image or interactive widget). */
export function buildFigureEl(fig: OutputFigure, app: App): HTMLElement {
  const item = createDiv({ cls: "ocode-output-item" });
  const toolbar = item.createDiv({ cls: "ocode-output-toolbar" });

  if (fig.kind === "image") {
    const copyBtn = makeToolButton(toolbar, OUTPUT_ICON.copy, "Copy image", () => {
      void copyImageToClipboard(fig.data).then(() => flashConfirm(copyBtn));
    });
    makeToolButton(toolbar, OUTPUT_ICON.download, "Download image", () => downloadImage(fig.data, fig.figureIndex));
    makeToolButton(toolbar, OUTPUT_ICON.expand, "View full screen", () => {
      new FullscreenOutputModal(app, (c) => {
        c.createEl("img", { cls: "ocode-fullscreen-img", attr: { src: pngDataUrl(fig.data) } });
      }).open();
    });
    const img = item.createEl("img", { cls: "ocode-output-img", attr: { src: pngDataUrl(fig.data) } });
    img.addEventListener("click", () => {
      new FullscreenOutputModal(app, (c) => {
        c.createEl("img", { cls: "ocode-fullscreen-img", attr: { src: pngDataUrl(fig.data) } });
      }).open();
    });
  } else {
    makeToolButton(toolbar, OUTPUT_ICON.expand, "View full screen", () => {
      new FullscreenOutputModal(app, (c) => {
        const frame = c.createEl("iframe", { cls: "ocode-fullscreen-widget" });
        frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups");
        frame.srcdoc = fig.html;
      }).open();
    });
    const frame = item.createEl("iframe", { cls: "ocode-output-widget" });
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups");
    frame.srcdoc = fig.html;
  }

  return item;
}

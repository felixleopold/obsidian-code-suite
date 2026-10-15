// Records assets/hero.gif from the real plugin running in a real Obsidian (macOS).
//
// Obsidian starts as a separate instance with its own profile and a throwaway
// vault, so your own Obsidian and vaults are untouched. It is driven over the
// Chrome DevTools Protocol, and its windows are never shown or focused, so
// recording runs in the background. The story is in scene.mjs.
import * as asar from "@electron/asar";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import scene from "./scene.mjs";

const here = import.meta.dirname;
const root = path.resolve(here, "../..");
const output = path.join(root, "assets/hero.gif");
const obsidianApp = "/Applications/Obsidian.app";
const obsidianData = path.join(os.homedir(), "Library/Application Support/obsidian");
const work = path.join(os.homedir(), "Library/Caches/code-suite-hero");
const profile = path.join(work, "profile");
const vault = path.join(work, "vault");
const framesDir = path.join(work, "frames");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (process.platform !== "darwin" || !fs.existsSync(obsidianApp)) {
  throw Error(`Recording needs macOS with ${obsidianApp}`);
}

execFileSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });

// Python for the demo blocks, cached between runs.
const python = path.join(work, "venv/bin/python");
if (!fs.existsSync(python)) {
  execFileSync("python3", ["-m", "venv", path.join(work, "venv")], { stdio: "inherit" });
  execFileSync(python, ["-m", "pip", "install", "-q", "requests", "matplotlib"], { stdio: "inherit" });
}

const write = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof data === "string" || Buffer.isBuffer(data) ? data : JSON.stringify(data));
};
const copy = (from, to) => write(to, fs.readFileSync(from));

for (const dir of [profile, vault, framesDir]) fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(framesDir, { recursive: true });

// Run the Obsidian version the installed app updated itself to, not the installer's.
const update = fs.readdirSync(obsidianData)
  .filter((file) => /^obsidian-[\d.]+\.asar$/.test(file))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  .at(-1);
const appAsar = path.join(work, "obsidian.asar");
copy(update ? path.join(obsidianData, update) : path.join(obsidianApp, "Contents/Resources/obsidian.asar"), appAsar);
// Obsidian's launcher runs the newest obsidian-<version>.asar in the profile. Give it
// a shim of the same version that keeps every window invisible, click-through and
// unfocused before it is ever shown (a shown window has already taken focus), then
// starts the real app. Hidden windows stop painting, so they are shown inactive.
const version = JSON.parse(asar.extractFile(appAsar, "package.json")).version;
const shim = path.join(work, "shim");
fs.rmSync(shim, { recursive: true, force: true });
write(path.join(shim, "main.js"), `const { app, BrowserWindow } = require("electron");
app.dock?.hide();
BrowserWindow.prototype.focus = () => {};
BrowserWindow.prototype.show = function () {
  this.setOpacity(0);
  this.setIgnoreMouseEvents(true);
  this.setFocusable(false);
  this.webContents.setBackgroundThrottling(false);
  this.showInactive();
};
module.exports = (_, updateEvents) => require(${JSON.stringify(appAsar)} + "/main.js")(${JSON.stringify(appAsar)}, updateEvents);
`);
await asar.createPackage(shim, path.join(profile, `obsidian-${version}.asar`));
write(path.join(profile, "obsidian.json"), { vaults: { c0de5c17e0000001: { path: vault, ts: Date.now(), open: true } } });

const config = path.join(vault, ".obsidian");
copy(path.join(here, scene.note), path.join(vault, scene.note));
copy(path.join(here, "hero.css"), path.join(config, "snippets/hero.css"));
write(path.join(config, "app.json"), { readableLineLength: false, showInlineTitle: false });
write(path.join(config, "appearance.json"), { theme: "obsidian", enabledCssSnippets: ["hero"] });
write(path.join(config, "community-plugins.json"), ["code-suite"]);
const pluginDir = path.join(config, "plugins/code-suite");
for (const file of ["dist/main.js", "manifest.json", "styles.css"]) {
  copy(path.join(root, file), path.join(pluginDir, path.basename(file)));
}
const { version: pluginVersion } = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
write(path.join(pluginDir, "data.json"), {
  lastNoticeVersion: pluginVersion,
  pythonPath: python,
  matplotlibStyle: path.join(here, "hero.mplstyle"),
  ...scene.plugin,
});

spawnSync("open", ["-n", "-g", "-a", obsidianApp, "--args", `--user-data-dir=${profile}`, "--remote-debugging-port=0"]);
let cdp;
try {
  cdp = await connect();
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: scene.width, height: scene.height, deviceScaleFactor: 2, mobile: false,
  });
  await cdp.evaluate(`(${setUpPage})(${JSON.stringify(scene.note)})`);
  const frames = await record();
  encode(frames);
  console.log(`Wrote ${path.relative(root, output)} (${frames.length} distinct frames)`);
} finally {
  // Quitting closes the socket before any reply arrives.
  cdp?.evaluate(`require("electron").remote.app.quit()`).catch(() => {});
  await sleep(1000);
  cdp?.close();
  spawnSync("pkill", ["-f", "--", `--user-data-dir=${profile}`]);
}

async function connect() {
  const portFile = path.join(profile, "DevToolsActivePort");
  let target;
  for (let i = 0; !target; i++) {
    if (i === 150) throw Error("Obsidian did not start with remote debugging");
    await sleep(200);
    if (!fs.existsSync(portFile)) continue;
    const port = fs.readFileSync(portFile, "utf8").split("\n")[0];
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).catch(() => []);
    target = targets.find((t) => t.type === "page" && t.url.startsWith("app://obsidian.md/index.html"));
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  ws.onclose = () => {
    for (const settle of pending.values()) settle({ error: { message: "Obsidian closed the connection" } });
    pending.clear();
  };
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    pending.set(++id, (m) => m.error ? reject(Error(`${method}: ${m.error.message}`)) : resolve(m.result));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  };
  return { send, evaluate, close: () => ws.close() };
}

// Runs inside Obsidian.
async function setUpPage(note) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  while (!window.app?.workspace) await sleep(100);
  await new Promise((resolve) => app.workspace.onLayoutReady(resolve));
  // A fresh vault with plugins first asks whether to trust its author.
  for (let i = 0; i < 30; i++, await sleep(100)) {
    const trust = [...document.querySelectorAll(".modal-container button")].find((b) => b.textContent.includes("Trust"));
    if (trust) { trust.click(); break; }
  }
  for (let i = 0; i < 50 && !app.plugins.plugins["code-suite"]?._loaded; i++) await sleep(100);
  if (!app.plugins.plugins["code-suite"]?._loaded) throw Error("CodeSuite did not load");
  app.customCss.setCssEnabledStatus("hero", true);
  const leaf = app.workspace.getLeaf();
  await leaf.openFile(app.vault.getAbstractFileByPath(note), { state: { mode: "preview" } });
  await sleep(1500);

  // Synthetic CDP input moves no visible pointer, so draw one, shaped by the CSS cursor under it.
  const cursors = {
    default: [5, 3, `<path d="M5 3v17l4.2-3.9 2.7 6.1 2.7-1.2-2.7-6h5.7z" fill="#000" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/>`],
    pointer: [9, 2, `<path d="M7.5 3.5a1.5 1.5 0 0 1 3 0V10a1.5 1.5 0 0 1 3 0v1a1.5 1.5 0 0 1 3 0v1a1.5 1.5 0 0 1 3 0v5c0 3-2 5.5-5 5.5h-3.5c-2 0-3-1-4-2.5l-3.7-6.2a1.4 1.4 0 0 1 2-2l2.2 2.2z" fill="#fff" stroke="#000" stroke-width="1.2" stroke-linejoin="round"/><path d="M10.5 10v4m3-3v3m3-2v2" stroke="#000" stroke-width="1"/>`],
    text: [12, 12, `<path d="M9 4h6m-3 0v16m-3 0h6" stroke="#fff" stroke-width="3.4"/><path d="M9 4h6m-3 0v16m-3 0h6" stroke="#000" stroke-width="1.4"/>`],
  };
  const pointer = document.body.appendChild(document.createElement("div"));
  pointer.style.cssText = "position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;";
  const scroller = () => document.querySelector(".workspace-leaf.mod-active .markdown-preview-view");
  const nextPaint = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  window.__hero = {
    cursor(x, y, pressed) {
      const hit = document.elementFromPoint(x, y);
      const style = hit ? getComputedStyle(hit).cursor : "default";
      const kind = style in cursors ? style : "default";
      const [hotX, hotY, svg] = cursors[kind];
      if (pointer.dataset.kind !== kind) {
        pointer.dataset.kind = kind;
        pointer.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none">${svg}</svg>`;
      }
      pointer.style.transformOrigin = `${hotX}px ${hotY}px`;
      pointer.style.transform = `translate(${x - hotX}px, ${y - hotY}px) scale(${pressed ? 0.85 : 1})`;
      return nextPaint();
    },
    rect(target) {
      const { selector = "h1, h2, h3, h4, h5, h6, p, li, code", text, index = 0 } =
        typeof target === "string" ? { selector: target } : target;
      const matches = [...scroller().querySelectorAll(selector)]
        .filter((el) => !text || el.textContent.includes(text));
      const rect = matches[index]?.getBoundingClientRect();
      if (!rect) throw Error(`Nothing matches ${JSON.stringify(target)}`);
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    },
    scrollBy(dy) { scroller().scrollTop += dy; },
    runFinished(index) {
      const block = scroller().querySelectorAll(".ocode-wrapper")[index];
      return !!block && !block.classList.contains("ocode-running") && !!block.querySelector(".ocode-output");
    },
  };
}

async function record() {
  const frameMs = 1000 / scene.fps;
  const frames = [];
  let cursor = { ...scene.cursor };
  let pressed = false;
  let previous;

  const frame = async () => {
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved", ...cursor, button: pressed ? "left" : "none", buttons: pressed ? 1 : 0,
    });
    await cdp.evaluate(`__hero.cursor(${cursor.x}, ${cursor.y}, ${pressed})`);
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
    if (data === previous) {
      frames.at(-1).ms += frameMs;
      return;
    }
    const file = path.join(framesDir, `${String(frames.length).padStart(5, "0")}.png`);
    fs.writeFileSync(file, data, "base64");
    frames.push({ file, ms: frameMs });
    previous = data;
  };
  const steps = (ms) => Math.max(1, Math.round(ms / frameMs));
  const ease = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
  const rect = (target) => cdp.evaluate(`__hero.rect(${JSON.stringify(target)})`);
  const mouse = (type) => cdp.send("Input.dispatchMouseEvent", {
    type, ...cursor, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1,
  });
  const waitFor = async (expression, timeout = 30_000) => {
    for (const start = Date.now(); !(await cdp.evaluate(expression)); await sleep(100)) {
      if (Date.now() - start > timeout) throw Error(`Timed out waiting for ${expression}`);
    }
  };

  await scene.play({
    async hold(ms) {
      for (let i = 0; i < steps(ms); i++) await frame();
    },
    async moveTo(target, { dx = 0, dy = 0, duration = 700 } = {}) {
      const r = await rect(target);
      const from = cursor;
      const to = { x: r.x + r.width / 2 + dx, y: r.y + r.height / 2 + dy };
      // A slight arc reads as a hand on a mouse rather than a straight tween.
      const bend = { x: (to.y - from.y) * 0.1, y: (from.x - to.x) * 0.1 };
      for (let i = 1, n = steps(duration); i <= n; i++) {
        const t = ease(i / n), arc = 4 * t * (1 - t);
        cursor = {
          x: Math.round(from.x + (to.x - from.x) * t + bend.x * arc),
          y: Math.round(from.y + (to.y - from.y) * t + bend.y * arc),
        };
        await frame();
      }
    },
    async click() {
      pressed = true;
      await mouse("mousePressed");
      await frame();
      await frame();
      pressed = false;
      await mouse("mouseReleased");
      await frame();
    },
    async scrollTo(target, { top = 24, duration = 800 } = {}) {
      const distance = (await rect(target)).y - top;
      let scrolled = 0;
      for (let i = 1, n = steps(duration); i <= n; i++) {
        const next = Math.round(distance * ease(i / n));
        await cdp.evaluate(`__hero.scrollBy(${next - scrolled})`);
        scrolled = next;
        await frame();
      }
    },
    waitForRun: (index) => waitFor(`__hero.runFinished(${index})`),
    command: (id) => cdp.evaluate(`app.commands.executeCommandById(${JSON.stringify(id)})`),
  });
  return frames;
}

function encode(frames) {
  // Frames are deduplicated, so each keeps its own duration (GIF delays are in 10 ms steps).
  const list = path.join(work, "frames.txt");
  write(list, frames.map((f) => `file '${f.file}'\nduration ${(f.ms / 1000).toFixed(2)}\n`).join("")
    + `file '${frames.at(-1).file}'\n`);
  const input = ["-f", "concat", "-safe", "0", "-i", list];
  const palette = path.join(work, "palette.png");
  const ffmpeg = (...args) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args], { stdio: "inherit" });
  // One palette for the whole clip and no dithering: flat UI colours stay flat.
  ffmpeg(...input, "-vf", "palettegen=max_colors=256:stats_mode=full", palette);
  ffmpeg(...input, "-i", palette, "-lavfi", "paletteuse=dither=none:diff_mode=rectangle", "-fps_mode", "vfr", "-loop", "0", output);
}

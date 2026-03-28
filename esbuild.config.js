const esbuild = require("esbuild");
const fs = require("fs");

const prod = process.argv[2] === "production";

// Obsidian vault plugin path for dev
const VAULT_PLUGIN_DIR = process.env.VAULT_PLUGIN_DIR;

const buildOptions = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "dist/main.js",
  minify: prod,
};

async function build() {
  await esbuild.build(buildOptions);

  // Copy artifacts to vault plugin dir if set
  if (VAULT_PLUGIN_DIR) {
    fs.mkdirSync(VAULT_PLUGIN_DIR, { recursive: true });
    fs.copyFileSync("dist/main.js", `${VAULT_PLUGIN_DIR}/main.js`);
    fs.copyFileSync("manifest.json", `${VAULT_PLUGIN_DIR}/manifest.json`);
    fs.copyFileSync("styles.css", `${VAULT_PLUGIN_DIR}/styles.css`);
    console.log(`Copied to ${VAULT_PLUGIN_DIR}`);
  }
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});

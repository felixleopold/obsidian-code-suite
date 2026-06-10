# [CodeSuite](https://community.obsidian.md/plugins/code-suite)

**Think Jupyter Notebook, but inside your Obsidian vault. VS Code–quality syntax highlighting, live code execution with streaming I/O, shared variables across blocks, and inline graph rendering — with zero extra infrastructure.**

---

## Features

- **Shiki syntax highlighting** — 65+ built-in themes, import any VS Code `.json` theme, auto light/dark switching, full color in Reading view *and* the editor
- **Live code execution** — Python, JS/TS, Bash, PowerShell, PHP, Go, Ruby, and more; output streams character-by-character; interactive stdin, password masking, cancel mid-run
- **Inline graphs** — `plt.show()` and `fig.show()` are intercepted; Matplotlib renders as a static image and Plotly renders as a fully interactive widget (zoom, pan, hover), all below the block without a display server. Click any plot to open it full screen, or copy/download images from the hover toolbar
- **Notebook mode** — shared execution context across blocks, `vars` blocks, `code_vars:` frontmatter, inline `` `$varname` `` substitution, **Run All** (with `skip` fence-tag opt-out) and **Clear Session**
- **Embedded code files** — `![[script.py]]` renders as a collapsible, syntax-highlighted, executable block
- **Code files in the file explorer** — open `.py`, `.js`, `.sh`, … straight from the vault in a lightweight editor with Run + live output, or symlink an external file into your vault with **Import code file as alias…**
- **Environment management** — combine a shared `.env` file with per-vault overrides, source shell startup files, run Bash/Zsh as a login shell, or pin exact interpreter paths for bash, zsh, and sh

---

## Syntax Highlighting

<!-- PLAN: Switch between several themes (Catppuccin, Gruvbox, Nord, Tokyo Night) in the theme picker — show code updating in reading view in real time. ~8 s. -->
<!-- ![Theme switching](assets/demo-highlighting.gif) -->

Powered by [Shiki](https://shiki.style/) — the exact same engine VS Code uses internally.

- **65+ built-in themes** — Gruvbox, Catppuccin, Dracula, Nord, Tokyo Night, One Dark Pro, Rosé Pine, Kanagawa, Everforest, Solarized, Night Owl, Synthwave '84, and many more
- **Import any VS Code theme** — load a `.json` file from [vscodethemes.com](https://vscodethemes.com) or exported directly from VS Code
- **Auto light/dark switching** — set a separate theme for each mode; CodeSuite switches when Obsidian's appearance changes
- **36+ languages** with common aliases (`py`, `js`, `ts`, `rb`, …)
- **Editor highlighting** — full token colors in Live Preview and Source mode via a CodeMirror 6 ViewPlugin, not just in Reading view
- **Full chrome in Live Preview** — code blocks and `![[file.py]]` embeds render with the same header, Run/Copy buttons, live output, line numbers, and collapse as Reading view. The block your cursor is in reveals its raw source for editing; every other block shows the rendered chrome, with running output preserved as you move around

---

## Code Execution

<!-- PLAN: Run a short Python script; show output streaming live line-by-line, then a second block reading a variable defined in the first. ~12 s. -->
<!-- ![Live code execution](assets/demo-execution.gif) -->

Run code directly from a code block — no terminal, no switching apps.

**Supported runtimes:**

| Language | Command | Notes |
|---|---|---|
| Python | `python3` | Matplotlib & Plotly graph capture, venv support |
| JavaScript | `node` | |
| TypeScript | `npx tsx` | |
| Bash | `bash` | Shared variable state across blocks |
| Zsh | `zsh` | Shared variable state across blocks |
| Shell | `sh` (POSIX) | `shell` and `sh` fences both run POSIX sh; source-file startup support |
| PowerShell | `pwsh` | macOS/Linux/Windows when PowerShell 7+ is installed |
| Go | `go run` | |
| Ruby | `ruby` | |
| Lua | `lua` | |
| Perl | `perl` | |
| R | `Rscript` | |
| PHP | `php` | Automatically prepends `<?php` for snippets that omit the opening tag |
| Swift | `swift` | |

- **Live streaming** — stdout and stderr appear as the process runs, not after it finishes
- **Interactive stdin** — an input bar appears automatically when your code calls `input()` or reads from stdin
- **Password masking** — `sudo` is detected automatically; the input bar masks characters for sensitive prompts
- **Inline graphs** — `plt.show()` and `fig.show()` are intercepted without a display server. Matplotlib figures render as static images; Plotly figures render as interactive HTML widgets (zoom, pan, hover, legend toggles). Click a plot for full-screen view; hover an image for copy/download buttons. Toggle interactivity and offline Plotly.js embedding in settings
- **Virtual environment support** — point the Python path to a venv binary; CodeSuite sets `VIRTUAL_ENV` and prepends `bin/` to `PATH` so all venv packages are available across every language block
- **PHP snippet mode** — PHP blocks can omit the opening `<?php` tag; CodeSuite adds it only to the temporary execution file
- **Shell startup support** — Bash/Zsh can run as login shells, and Bash/Zsh/Shell blocks can source one or more startup files before your snippet runs
- **Explicit interpreter paths** — pin exact binaries for bash, zsh, and sh/shell under Settings → Environment; useful if Obsidian's PATH differs from your terminal's, or to point `shell` blocks at a modern bash

---

## Notebook Mode: Shared Variables & Run All

<!-- PLAN: Define a variable in a vars block, run two Python blocks that reference it, show `$varname` updating inline in the note text, then click Run All. ~15 s. -->
<!-- ![Shared variables and Run All](assets/demo-notebook.gif) -->

Each note maintains an in-memory execution session — the closest thing to a Jupyter notebook inside Obsidian, without a kernel daemon or `.ipynb` file.

- **Shared state across blocks** — variables, imports, and function definitions carry over between runs (Python, Bash, and Zsh)
- **Live cross-language variables** — a shared variable changed by one block is visible to later blocks in *any* language, in execution order. Set `count = 42` in Python and a later Bash block sees `42`; change it in Bash and the next Python block sees the new value (re-typed). Scalars and JSON structures cross languages; rich objects (functions, DataFrames) stay within their language. See [Variable typing & the execution model](docs/configuration.md#variable-typing).
- **`vars` blocks** — declare note-scoped variables once; they are injected into every run as **native, correctly-typed literals**:
  ````
  ```vars
  threshold = 0.85          # float
  crawl_depth = 5           # int
  download_assets = True    # bool
  base_url = "https://x"    # string (one layer of quotes stripped)
  dataset = sales_q4.csv    # bare text is a string too
  ```
  ````
  Types are inferred from how each value is written, so in Python `crawl_depth` is an `int`, `download_assets` is a `bool`, and `base_url` is a clean string (no double-quoting). See [Typed variables](#typed-variables) below for the full rules, `:type` hints, and multiline strings.
- **Inline `$varname` substitution** — write `` `$result` `` anywhere in your note; it updates live in Reading view after each run
- **`code_vars:` frontmatter** — declare the same variables in YAML frontmatter when you prefer note metadata over a fenced block:
  ```yaml
  ---
  code_vars:
    threshold: 0.85
    dataset: sales_q4.csv
  ---
  ```
  A `vars` block in the body still wins if both define the same key.
- **Run All** — runs every executable block top-to-bottom in sequence, stopping on the first error. Mark a block to keep it out of Run All by adding `skip` to its fence header (e.g. ` ```python skip ` — recommended, keeps the code clean), or by putting a `codesuite:skip` marker on its first line in any comment style (`# codesuite:skip`, `// codesuite:skip`, `-- codesuite:skip`, `/* codesuite:skip */`, …). Skipped blocks display a small **skip** badge in their toolbar.
- **Clear Session** — reset all accumulated state from the note header button
- **Copy output** — every successful run gets a **Copy output** pill next to the Clear button

State is per-note, lives only in memory, and resets when Obsidian is closed.

For the full details on variable types, `:type` hints, multiline strings, cross-language propagation, data tables, and the execution model, see **[docs/variables-and-execution.md](docs/variables-and-execution.md)**.

---

## Embedded Code Files

<!-- PLAN: Type ![[script.py]] in a note, switch to Reading view, show the collapsible block appearing with filename + line count, then expand it. ~8 s. -->
<!-- ![Embedded code files](assets/demo-embedded.gif) -->

Embed any code file from your vault with `![[file.py]]` and get a full syntax-highlighted, interactive block instead of plain text.

- **Collapsible by default** — header shows the filename and line count; click to expand
- Supports Run, Copy, and all execution features just like inline blocks
- **Inline blocks** can also be made collapsible from settings — useful for long preludes you only want to skim.

---

## Vault Code Files & External Aliases

Enable **Settings → CodeSuite → Show code files in the file explorer** (on by default) and Obsidian will surface every supported code extension (`.py`, `.js`, `.ts`, `.sh`, `.go`, `.rb`, `.lua`, `.rs`, `.cpp`, `.swift`, …) in the file explorer. Opening one gives you:

- Syntax-highlighted **preview** mode (Shiki, same theme as your code blocks)
- Switch to **edit** mode for a lightweight in-vault editor (2-space tab insertion, autosave)
- A **Run** button for any executable language with live streaming output and Cancel support

### Import code file as alias…

Command palette → **Import code file as alias…** opens a native file picker and symlinks the chosen file into your vault under **Imports folder** (default: `CodeSuiteImports/`). The alias behaves like any other vault file — open, edit, and run it without copying its contents. Edits write through to the real file on disk.

---

## Installation

### Community Plugins *(recommended)*

1. Open **Settings → Community Plugins → Browse**
2. Search for **CodeSuite**
3. Click **Install**, then **Enable**

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/felixleopold/obsidian-code-suite/releases)
2. Create `<vault>/.obsidian/plugins/code-suite/`
3. Place the three files inside it
4. Reload Obsidian and enable **CodeSuite** in **Settings → Community Plugins**

---

## Configuration

Open **Settings → CodeSuite** to configure themes, code execution, environment variables, and embedded file behaviour.

| | |
|---|---|
| [Variables & Execution](docs/variables-and-execution.md) | How to run code, declare variables, use `$varname`, cross-language propagation, practical patterns |
| [Configuration Reference](docs/configuration.md) | Every setting, option, and environment knob |

---

## Known Limitations

### Active-line highlight bleeds into code blocks (editor mode)

When the cursor is inside a code block in Live Preview or Source mode, Obsidian's active-line highlight shows through the block background. This is inherent to how Obsidian's active-line extension works.

**Workaround:** Enable **Auto-switch theme** and choose a theme whose background matches Obsidian's active-line color — the bleed becomes invisible.

---

## Planned Upgrades

The following features are on the roadmap. Track progress or vote on the linked GitHub issues.

| # | Feature | Issue |
|---|---------|-------|
| 1 | **Import / export** — round-trip conversion to/from `.ipynb`; export notes as styled HTML and PDF (including outputs) | [#5](https://github.com/felixleopold/obsidian-code-suite/issues/5) |
| 2 | **Per-block code formatting** — line highlighting `{1,5-10}`, diff highlighting `ins`/`del`, per-block titles, `showLineNumbers` override, and inline code syntax highlighting | [#13](https://github.com/felixleopold/obsidian-code-suite/issues/13) |

> Shipped in 1.8.0: better plot support ([#12](https://github.com/felixleopold/obsidian-code-suite/issues/12)) — interactive Plotly widgets (zoom, pan, hover, legend toggles) instead of static images, click-to-expand full-screen view for every plot and image, and a per-image hover toolbar with copy and download. New settings: **Interactive plots** and **Embed Plotly.js offline**.

> Shipped in 1.7.0: full code-block chrome in Live Preview — header, Run/Copy, live output, line numbers, collapse, and `![[file.py]]` embeds now render in Live Preview (not just Reading view); the cursor's block reveals raw source for editing, and a per-block DOM cache keeps streaming output alive as you move the cursor.

> Shipped in 1.6.0: typed `vars`/`code_vars` injection with `:type` hints and triple-quoted multiline strings ([#16](https://github.com/felixleopold/obsidian-code-suite/issues/16)), live cross-language variable propagation, experimental data tables (`%% codesuite: … %%`).

> Shipped in 1.5.2: soft-wrap long lines in reading view ([#22](https://github.com/felixleopold/obsidian-code-suite/issues/22)), optional/mobile-hidden clear-session button ([#23](https://github.com/felixleopold/obsidian-code-suite/issues/23)), removed the extra blank line at the end of every block ([#24](https://github.com/felixleopold/obsidian-code-suite/issues/24)).

> Shipped in 1.5.0: explicit interpreter paths for bash/zsh/sh ([#20](https://github.com/felixleopold/obsidian-code-suite/issues/20)), line-count off-by-one fix ([#21](https://github.com/felixleopold/obsidian-code-suite/issues/21)), `sh` fence now runs POSIX sh (matching `shell`).

> Shipped in 1.4.0: PHP support, PowerShell support, shell startup files, login-shell mode, Zsh-native variable snapshotter.

> Shipped in 1.3.0: code files in the file explorer ([#4](https://github.com/felixleopold/obsidian-code-suite/issues/4)), copy-output button ([#6](https://github.com/felixleopold/obsidian-code-suite/issues/6)), collapsible inline blocks ([#7](https://github.com/felixleopold/obsidian-code-suite/issues/7)), `.env` file support ([#8](https://github.com/felixleopold/obsidian-code-suite/issues/8)), `codesuite:skip` for Run All ([#9](https://github.com/felixleopold/obsidian-code-suite/issues/9)), `code_vars:` frontmatter ([#10](https://github.com/felixleopold/obsidian-code-suite/issues/10)), in-vault code editor ([#11](https://github.com/felixleopold/obsidian-code-suite/issues/11)), import-as-alias command ([#14](https://github.com/felixleopold/obsidian-code-suite/issues/14)).

---

## Contributing

Found a bug or have a feature request? [Open an issue on GitHub](https://github.com/felixleopold/obsidian-code-suite/issues).

Want to contribute code? See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions and conventions.

---

## Credits

- [Shiki](https://shiki.style/) — syntax highlighting engine (MIT)
- [Obsidian](https://obsidian.md/) — the app this plugin is built for
- [CodeMirror 6](https://codemirror.net/) — editor framework used by Obsidian

## License

[Apache 2.0](LICENSE) © Felix Leopold

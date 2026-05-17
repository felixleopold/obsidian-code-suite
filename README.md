# [CodeSuite](https://community.obsidian.md/plugins/code-suite)

**Shiki syntax highlighting, live code execution with stdin/stdout streaming, shared variables across blocks, inline `$var` substitution, Matplotlib/Plotly inline graphs, and embedded file rendering: all inside your Obsidian notes.**

Render VS Code–quality syntax highlighting in all render modes (Reading, Source mode, Live Preview) using Shiki, with 65+ built-in themes, importable VS Code `.json` themes, and support for 36+ languages. Execute code directly from your notes *Python, JS/TS, Bash, Go, Ruby, and more* with live stdout/stderr streaming, smart stdin detection, Matplotlib/Plotly inline graphs, and Copy & Run controls. Define shared variables once, reference them across every block in the note; write `` `$varname` `` anywhere and the value updates live after each run. Embedded files (e.g. `![[script.py]]`) render as collapsible, fully highlighted blocks. Think Jupyter Notebook, but inside your vault, with zero other infrastructure required.

---

## Syntax Highlighting

Powered by [Shiki](https://shiki.style/) — the exact same engine VS Code uses internally. Every token, every color, pixel-perfect.

- **65+ built-in themes** — Gruvbox, Catppuccin, Dracula, Nord, Tokyo Night, One Dark Pro, GitHub, Material, Rosé Pine, Kanagawa, Everforest, Solarized, Night Owl, Vitesse, Ayu, Monokai, Synthwave '84, and many more
- **Import any VS Code theme** — load any `.json` color theme file directly from [vscodethemes.com](https://vscodethemes.com) or exported from your own VS Code install
- **Auto light/dark switching** — set a separate dark and light theme; [CodeSuite](https://community.obsidian.md/plugins/code-suite) switches automatically when Obsidian's appearance changes
- **36+ languages** with common aliases (`py`, `js`, `ts`, `sh`, `rb`, …)
- **Editor highlighting** — full Shiki token colors applied in live preview and source mode via a CodeMirror 6 ViewPlugin, not just in reading view

---

## Code Execution

Run code directly from a code block: no terminal, no external notebook, no switching apps. Output streams live into a panel below the block, the moment it appears.

**Supported runtimes:**

| Language | Command | Notes |
|---|---|---|
| Python | `python3` | Matplotlib & Plotly graph capture, venv support |
| JavaScript | `node` | |
| TypeScript | `npx tsx` | |
| Bash | `bash` | Shared variable state across blocks |
| Zsh | `zsh` | Shared variable state across blocks |
| Shell | `sh` | |
| Go | `go run` | |
| Ruby | `ruby` | |
| Lua | `lua` | |
| Perl | `perl` | |
| R | `Rscript` | |
| PHP | `php` | |
| Swift | `swift` | |

**What makes it smooth:**

- **Live streaming** — stdout and stderr appear character-by-character as the process runs, not after it finishes
- **Interactive stdin** — when your code calls `input()`, `readline()`, or reads from stdin, an input bar appears automatically; type and press Enter to send
- **Password masking** — `sudo` is detected and piped through `-S`; the input bar masks characters automatically for sensitive prompts
- **Cancel mid-run** — kill any running block instantly with the Cancel button
- **Matplotlib & Plotly inline** — `plt.show()` and `fig.show()` are intercepted; graphs render as inline images below the output without needing a display server
- **Configurable timeout** — auto-kill runaway processes after a set number of seconds (5–300 s)
- **Virtual environment support** — point Python path to a venv binary; [CodeSuite](https://community.obsidian.md/plugins/code-suite) sets `VIRTUAL_ENV` and prepends the bin directory to `PATH` so all venv packages and tools (pip, playwright, etc.) are available across every language block
- **Extra environment variables** — inject `KEY=VALUE` pairs into every execution; useful for `PYTHONPATH`, API keys, and similar secrets

---

## Shared Execution Context & Live Variables

The closest thing to a Jupyter Notebook inside Obsidian, all without a kernel daemon, without a `.ipynb` file, and without any setup.

Each note maintains an in-memory execution session. When **Shared execution context** is enabled:

- **Shared state across blocks** — run a Python block that defines `result = 42`, then reference `result` in the next Python block. Same for Bash. Variables, imports, and function definitions all carry over.
- **`vars` blocks** — declare note-scoped variables once in a dedicated `vars` block; they are injected into every code run automatically:
  ````
  ```vars
  threshold = 0.85
  dataset = "sales_q4.csv"
  ```
  ````
- **Inline `$varname` substitution** — write `` `$result` `` anywhere in your note text; after a run, the rendered value updates live in reading view. Useful for surfacing key outputs directly in prose.
- **Run All** — a single button runs every executable block in the note top-to-bottom in sequence, stopping on the first error so session state stays consistent
- **Clear Session** — reset accumulated state at any time from the note header button

State is per-note, lives only in memory, and resets when Obsidian is closed. No files are written to disk.

---

## Embedded Code Files

Embed any code file from your vault with the standard `![[file.py]]` syntax and get a full syntax-highlighted, interactive block instead of Obsidian simply telling you its a code file.

- **Collapsible** by default — header shows filename and line count; click to expand
- The rest works exactly as on inline blocks

---

## Installation

### Community Plugins (recommended)

1. Open **Settings → [Community Plugins](https://community.obsidian.md/plugins/code-suite) → Browse**
2. Search for **[CodeSuite](https://community.obsidian.md/plugins/code-suite)**
3. Click **Install**, then **Enable**

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/felixleopold/obsidian-code-suite/releases)
2. Create the folder `<vault>/.obsidian/plugins/code-suite/`
3. Place the three files inside it
4. Reload Obsidian and enable **[CodeSuite](https://community.obsidian.md/plugins/code-suite)** in **Settings → Community Plugins**

---

## Setup & Configuration

Open **Settings → [CodeSuite](https://community.obsidian.md/plugins/code-suite)** to configure the plugin. Settings are grouped into four sections.

### Theme

**Auto-switch theme** *(toggle)*
Automatically swap between a dark and a light theme when Obsidian's appearance changes. When enabled, two separate theme pickers appear — one for dark mode, one for light mode.

**Syntax theme** *(dropdown)*
Shown when auto-switch is off. Choose from 65+ built-in themes. Dark themes are marked ☾, light themes ☀. Any custom imported themes appear at the bottom of the list.

**Import VS Code theme** *(button)*
Click **Import JSON file** to load a `.json` color theme. Sources:
- [vscodethemes.com](https://vscodethemes.com) — browse and download any published VS Code theme
- VS Code itself — open the Command Palette → *Generate Color Theme From Current Settings*

Imported themes are saved in plugin settings and appear in the theme picker immediately. Remove them at any time from the list that appears below the import button.

---

### Appearance

**Line numbers** *(toggle)*
Show or hide line numbers in reading view. Does not affect editor mode.

**Language label** *(toggle)*
Show or hide the language name in the header bar of each code block.

**Wide code blocks** *(toggle)*
Allow code blocks to extend beyond the normal note content width. Useful for wide tables, long output lines, or side-by-side comparisons.

---

### Code Execution

**Enable code execution** *(toggle)*
Show the Run button on supported language blocks. Disable to use [CodeSuite](https://community.obsidian.md/plugins/code-suite) as a syntax-highlighting-only plugin. Desktop only — the setting has no effect on mobile.

**Shared execution context** *(toggle, on by default)*
When enabled, each block run in a note accumulates into a per-note session. Later blocks can reference variables, functions, and imports from earlier blocks (Python and Bash). Also enables inline `` `$varname` `` substitution in note text. Disable this if you want each block to run in a completely fresh environment.

> **Tip:** blocks run in the order you click them. Run blocks top-to-bottom to build up state correctly. Use **Run All** to execute the entire note in sequence automatically.

**Execution timeout** *(slider, 5–300 s)*
Maximum time a single block can run before the process is automatically killed. Set higher for long-running scripts (data processing, ML training). Default is 30 s.

**Working directory** *(dropdown)*
Sets the current directory for the spawned process. Options:
- **Vault root** *(default)* — scripts can reference vault files with relative paths (`open("data.csv")` just works)
- **Home directory** — uses `~`
- **Custom path** — enter an absolute path in the field that appears below

---

### Environment

**Python path**
Absolute path to a Python binary or virtualenv. Examples:

```
/Users/you/.venv/bin/python3          # project venv
/opt/homebrew/bin/python3             # Homebrew Python
/usr/bin/python3                      # system Python
```

When pointing to a venv binary, [CodeSuite](https://community.obsidian.md/plugins/code-suite) automatically activates the environment (`VIRTUAL_ENV` is set, `bin/` is prepended to `PATH`) — so all venv packages are available not just in Python blocks but in Bash blocks too.

Leave empty to use the system default `python3`.

**Node.js path**
Absolute path to a Node.js binary. Leave empty to use the system `node`.

**Extra environment variables**
Additional `KEY=VALUE` pairs injected into every code execution, one per line. Lines starting with `#` are ignored. Useful for:

```
PYTHONPATH=/path/to/extra/libs
OPENAI_API_KEY=sk-...
MY_CONFIG=production
```

---

### Embedded Code Files

**Render embedded code files** *(toggle)*
Replace Obsidian's default plain-text rendering of `![[file.py]]` embeds with fully syntax-highlighted, interactive [CodeSuite](https://community.obsidian.md/plugins/code-suite) blocks.

**Collapse embedded files** *(toggle)*
Start all embedded file blocks in the collapsed state. The header shows the filename and line count; click it to expand. Useful when embedding large files that you only need to reference occasionally.

---

## How It Works

- **Reading view:** A Markdown post-processor replaces `<pre><code>` blocks with Shiki-highlighted HTML, wrapped in a styled container with a header bar and action buttons.
- **Editor (live preview / source):** A CodeMirror 6 ViewPlugin scans the document for code fences, tokenizes them with Shiki, and applies inline `Decoration.mark` styles per token — giving you full color in the editor without leaving it.
- **Code execution:** Spawns a child process via Node's `child_process.spawn`. No code is sent to any server — everything runs locally on your machine. Output streams over stdout/stderr pipes in real time.
- **Shared context:** For Python, accumulated session code is prepended to each run. For Bash, an `export` dump of the previous session's environment is sourced before each new block.

---

## Known Limitations

### Active-line highlight bleeds into code blocks (editor mode)

When the cursor is on a line inside a code block in live preview or source mode, Obsidian's active-line highlight color shows through the code block background. This is inherent to how Obsidian's active-line extension works.

**Workaround:** Enable **Auto-switch theme** and choose a theme whose background color is close to Obsidian's active-line color — the bleed becomes invisible.

---

## Contributing

Found a bug or have a feature request? [Open an issue on GitHub](https://github.com/felixleopold/obsidian-code-suite/issues).

---

## Credits

- [Shiki](https://shiki.style/) — syntax highlighting engine (MIT)
- [Obsidian](https://obsidian.md/) — the app this plugin is built for
- [CodeMirror 6](https://codemirror.net/) — editor framework used by Obsidian

## License

[Apache 2.0](LICENSE) © Felix Leopold

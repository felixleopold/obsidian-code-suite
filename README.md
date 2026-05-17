# CodeSuite

A VS Code-style coding environment for [Obsidian](https://obsidian.md): Shiki syntax highlighting, live code execution, shared variables across blocks, and embedded file rendering — all inside your notes.

Works in **both reading view and editor** (live preview / source mode).

## Features

### Syntax Highlighting
Powered by Shiki — the same engine VS Code uses.
- **65+ built-in themes** — Gruvbox, Catppuccin, Dracula, Nord, Tokyo Night, One Dark Pro, GitHub, Material, etc.
- **Import any VS Code theme** — load any `.json` color theme file
- **Auto light/dark switching** to follow your Obsidian theme
- **36+ languages** with common aliases (`py`, `js`, `sh`, …)
- **Editor highlighting** — full Shiki tokens in live preview and source mode via a CM6 ViewPlugin

### Code Execution
- **Run code from your notes** — Python, JavaScript, TypeScript, Bash, Ruby, Go, Lua, Perl, PHP, R, Swift
- **Live stdout/stderr streaming**
- **Interactive stdin** — input bar appears automatically when your code reads from stdin
- **Password masking** — detects `sudo` and masked prompts automatically
- **Cancel** any running block mid-execution
- **Matplotlib & Plotly** — graphs render inline as images
- **Configurable timeout, working directory, interpreter paths, and environment variables**

### Shared Execution Context & Variables
- **`vars` blocks** — define note-scoped variables in a dedicated block; injected automatically into every code run
- **Share state across code blocks** in the same note (Python and Bash) — define a variable in one block, use it in the next
- **Inline `$varname`** — write `` `$peak` `` anywhere in your note and the value updates live after each run
- **Run All** — single click runs every executable block top-to-bottom in sequence; stops on first error so context stays consistent
- **Clear Session** — reset accumulated state from the note header at any time
- Per-note, in-memory — zero setup, resets when Obsidian closes

### Embedded Code Files
- **Render `![[file.py]]` embeds** as fully highlighted code blocks
- **Collapsible** by default with line count; click to expand
- **Copy & Run** buttons on embedded files

### UI
- Header bar with language label, Copy, and Run buttons
- Line numbers with hover highlight
- Optional wide code blocks for more horizontal space
- Mobile-friendly responsive layout

## Installation

### From Obsidian Community Plugins

1. Open **Settings → Community Plugins → Browse**
2. Search for "CodeSuite"
3. Click **Install**, then **Enable**

### Manual
1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/felixleopold/obsidian-code-suite/releases)
2. Create a folder `code-suite` in your vault's `.obsidian/plugins/` directory
3. Place the three files inside it
4. Restart Obsidian and enable "CodeSuite" in Community Plugins

## Build from Source

```bash
git clone https://github.com/felixleopold/obsidian-code-suite.git
cd obsidian-code-suite
npm install
npm run build
```

Output: `dist/main.js`

## Configuration

All settings are in **Settings → CodeSuite**:

| Setting | Description |
|---|---|
| **Syntax theme** | Choose from 65+ built-in themes or import your own |
| **Import VS Code theme** | Load a `.json` color theme file |
| **Line numbers** | Show/hide line numbers |
| **Language label** | Show/hide the language name in the header |
| **Wide code blocks** | Extend code blocks beyond content width |
| **Enable code execution** | Show Run button on supported languages |
| **Execution timeout** | Auto-kill after N seconds (5–120) |
| **Working directory** | Where code runs: vault root (default), home dir, or custom path |
| **Python path** | Custom Python binary or virtualenv path |
| **Node.js path** | Custom Node.js binary path |
| **Extra env variables** | Additional KEY=VALUE pairs for execution |
| **Render embedded files** | Highlight `![[file.py]]` embeds |
| **Collapse embedded files** | Start embedded files collapsed |
| **Shared execution context** | Share variables across blocks of the same note & enable inline `$varname` (on by default) |

## How It Works

- **Reading view:** A Markdown post-processor replaces `<pre><code>` blocks with Shiki-highlighted HTML, wrapped in a styled container with header bar and buttons.
- **Editor (live preview / source):** A CodeMirror 6 ViewPlugin scans the document for code fences, tokenizes them with Shiki, and applies inline `Decoration.mark` styles for each token.
- **Code execution:** Runs locally on your machine via `child_process.spawn`. No code is sent to any server. Output streams live over stdout/stderr pipes.

## Known Limitations

### Active-line highlight in editor

When your cursor sits on a line inside a code block in live preview / source mode, Obsidian's active-line highlight shows through the code block background. This is a side-effect of how Obsidian's active-line extension injects its background color.

**Workaround:** enable **Auto-switch theme** in Settings → CodeSuite → Theme. When the Obsidian theme's active-line color closely matches the code block background, the highlight becomes invisible.

## Contributing

Found a bug or have a feature request? [Open an issue on GitHub](https://github.com/felixleopold/obsidian-code-suite/issues).

## Credits

- [Shiki](https://shiki.style/): syntax highlighting engine (MIT)
- [Obsidian](https://obsidian.md/): the app this plugin is built for
- [CodeMirror 6](https://codemirror.net/): editor framework used by Obsidian

## License

[Apache 2.0](LICENSE) © Felix Leopold

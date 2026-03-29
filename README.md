# CodeSuite

VS Code-quality code blocks for [Obsidian](https://obsidian.md), powered by [Shiki](https://shiki.style/), the same syntax highlighting engine used by VS Code.

Works in **both reading view and editor** (live preview / source mode).

## Features

### Syntax Highlighting
- **65+ built-in themes:** Gruvbox, Catppuccin, Dracula, Nord, Tokyo Night, One Dark Pro, GitHub, Material, and many more
- **Import VS Code themes:** load any `.json` color theme from VS Code
- **Editor highlighting:** full Shiki-powered tokens in live preview and source mode via a CM6 ViewPlugin
- **36 languages:** Python, JS/TS, Rust, Go, C/C++, Java, Ruby, and more with common aliases (`py`, `js`, `sh`, etc.)
- **Dynamic theme colors:** code block chrome (headers, borders, output panels) automatically adapts to match the selected theme

### Code Execution
- **Run code from Obsidian:** execute Python, JavaScript, TypeScript, Bash, Ruby, Go, Lua, Perl, PHP, R, and Swift directly from code blocks
- **Live streaming output:** stdout and stderr stream in real-time
- **Smart stdin:** input bar appears only when your code reads from stdin (detects `input()`, `process.stdin`, `read`, etc.)
- **Matplotlib & Plotly support:** graphs render inline as images
- **Execution timeout:** configurable auto-kill for runaway processes
- **Custom interpreter paths:** set Python virtualenvs, custom Node paths, extra environment variables

### Embedded Code Files
- **Render `![[file.py]]` embeds** as fully highlighted code blocks
- **Collapsible by default:** long files show collapsed with a line count; click to expand
- **Copy & Run** buttons on embedded files

### UI
- **Header bar** with language label, Copy, and Run buttons
- **Line numbers** with hover highlight
- **Wide code blocks** option for more horizontal space
- **Mobile-friendly** responsive layout

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
| **Python path** | Custom Python binary or virtualenv path |
| **Node.js path** | Custom Node.js binary path |
| **Extra env variables** | Additional KEY=VALUE pairs for execution |
| **Render embedded files** | Highlight `![[file.py]]` embeds |
| **Collapse embedded files** | Start embedded files collapsed |

## How It Works

- **Reading view:** A Markdown post-processor replaces `<pre><code>` blocks with Shiki-highlighted HTML, wrapped in a styled container with header bar and buttons.
- **Editor (live preview / source):** A CodeMirror 6 ViewPlugin scans the document for code fences, tokenizes them with Shiki, and applies inline `Decoration.mark` styles for each token.
- **Code execution:** Runs locally on your machine via `child_process.spawn`. No code is sent to any server. Output streams live over stdout/stderr pipes.

## Credits

- [Shiki](https://shiki.style/): syntax highlighting engine (MIT)
- [Obsidian](https://obsidian.md/): the app this plugin is built for
- [CodeMirror 6](https://codemirror.net/): editor framework used by Obsidian

## License

[MIT](LICENSE) © Felix Leopold

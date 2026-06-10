# Configuration Reference

> **Part of the CodeSuite docs** — [README](../README.md) · [Variables & Execution](variables-and-execution.md) · **Configuration Reference**

Full reference for all settings in **Settings → CodeSuite**.

---

## Theme

### Auto-switch theme
Automatically swaps between a dark and a light theme when Obsidian's appearance changes. When enabled, two separate theme pickers appear — one for dark mode, one for light mode.

### Syntax theme
Shown when auto-switch is off. Choose from 65+ built-in themes. Dark themes are marked ☾, light themes ☀. Any custom imported themes appear at the bottom of the list.

### Import VS Code theme
Click **Import JSON file** to load a `.json` color theme. Two sources:

- **[vscodethemes.com](https://vscodethemes.com)** — browse and download any published VS Code theme
- **VS Code itself** — open the Command Palette → *Generate Color Theme From Current Settings*

Imported themes are saved in plugin settings and appear in the theme picker immediately. Remove them at any time from the list below the import button.

---

## Appearance

| Setting | Description |
|---|---|
| **Line numbers** | Show or hide line numbers in reading view. Does not affect editor mode. |
| **Language label** | Show or hide the language name in the header bar of each code block. |
| **Wide code blocks** | Allow code blocks to extend beyond the normal note content width. Useful for wide tables or long output lines. |
| **Soft-wrap long lines** *(on by default)* | Wrap long lines in reading view instead of showing a horizontal scrollbar, matching the editor's behaviour. Turn off to restore horizontal scrolling. |
| **Render HTML blocks** *(off by default)* | Show `html` code blocks as a live preview (sandboxed iframe) by default instead of their source. Override per block with a `preview` or `source` flag on the fence (e.g. ` ```html preview `) or in an embed alias (`![[page.html\|preview]]`). Eligible blocks always get a Preview/Code toggle in the header. |

---

## Code Execution

### Enable code execution
Show the Run button on supported language blocks. Disable to use CodeSuite as a syntax-highlighting-only plugin. Desktop only — no effect on mobile.

### Show clear-session button *(on by default)*
Show the **Clear execution session** button in the note header bar. Turn it off to declutter the tab bar — the **Clear execution session for this note** command still works from the command palette. Desktop only; the button is never shown on mobile.

### Shared execution context *(on by default)*
When enabled, each block run in a note accumulates into a per-note in-memory session. Later blocks can reference variables, functions, and imports from earlier blocks (Python, Bash, and Zsh). Also enables inline `` `$varname` `` substitution.

> **Tip:** Run blocks top-to-bottom to build up state correctly. Use **Run All** to execute the entire note in sequence automatically.

### Execution timeout *(5–300 s, default 30 s)*
Maximum time a single block can run before the process is automatically killed. Raise this for long-running scripts (data processing, ML training).

### Interactive plots *(on by default)*
Render Plotly figures as interactive HTML widgets (zoom, pan, hover, legend toggles) instead of static images. The static fallback requires the `kaleido` Python package; the interactive path does not. Matplotlib figures are always static images.

### Embed Plotly.js offline *(off by default; shown when interactive plots are on)*
Bundle the Plotly.js library inline with each interactive plot so it renders without internet access. Produces larger output; when off, the library is loaded from a CDN.

### Matplotlib style *(default `dark_background`)*
Style applied to all Matplotlib plots before your code runs. Accepts any built-in style name (e.g. `dark_background`, `seaborn-v0_8-darkgrid`) or an absolute path to a `.mplstyle` file. Leave blank for Matplotlib defaults.

### Working directory
Sets the current directory (`cwd`) for the spawned process.

| Option | Behaviour |
|---|---|
| **Vault root** *(default)* | Scripts can reference vault files with relative paths (`open("data.csv")` just works) |
| **Home directory** | Uses `~` |
| **Custom path** | Enter an absolute path in the field below |

---

## Environment

### Python path
Absolute path to a Python binary or virtualenv. When pointing to a venv binary, CodeSuite automatically activates the environment (`VIRTUAL_ENV` is set, `bin/` is prepended to `PATH`) — so all venv packages are available not just in Python blocks but in Bash blocks too. Leave empty to use the system default `python3`.

```
/Users/you/.venv/bin/python3          # project venv
/opt/homebrew/bin/python3             # Homebrew Python
/usr/bin/python3                      # system Python
```

### Node.js path
Absolute path to a Node.js binary. Leave empty to use the system `node`.

### Bash path
Absolute path to the bash executable used by `bash` blocks. Leave empty to resolve `bash` via PATH (e.g. `/opt/homebrew/bin/bash` on Apple Silicon).

### Zsh path
Absolute path to the zsh executable used by `zsh` blocks. Leave empty to resolve `zsh` via PATH (typically `/bin/zsh` on macOS). Must point at a zsh-compatible binary — variable tracking emits zsh syntax, so pointing this at bash will fail.

### Shell (sh) path
Absolute path used by `shell` and `sh` blocks. Defaults to `/bin/sh` (POSIX sh). Point it at a modern bash if you want these blocks to run under bash.

### Auto-prepend PHP opening tag
When enabled, CodeSuite adds `<?php` to the temporary execution file for PHP blocks that do not already start with a PHP opening tag. Your note content is not modified.

This is useful for snippet-style PHP fences:

```php
echo "Hello from PHP\n";
```

Blocks that already start with `<?php`, `<?=`, or another PHP opening tag are left unchanged.

### Run Bash/Zsh as login shell
Runs Bash and Zsh blocks in login mode so shell startup files can initialize your PATH, functions, and other environment customizations before the snippet runs.

This is off by default because login shell startup files can have side effects or take extra time. It only applies to `bash` and `zsh` blocks; plain `shell` blocks keep using `sh` without login mode.

### Shell source files
Newline-separated absolute paths to files sourced before Bash, Zsh, and Shell blocks run. Blank lines and lines starting with `#` are ignored.

```
/Users/you/.bashrc
/Users/you/.config/codesuite/env.sh
```

If any configured source file is not readable, the block exits with a clear error before running your snippet.

### Extra environment variables
Additional `KEY=VALUE` pairs injected into every code execution, one per line. Lines starting with `#` are ignored.

```
PYTHONPATH=/path/to/extra/libs
OPENAI_API_KEY=sk-...
MY_CONFIG=production
```

### .env file path
Absolute path to a `.env` file on disk. Variables from this file are loaded into the process environment of every executed block. Useful for sharing the same credentials across many notes without pasting them into the settings UI.

- Empty/blank lines and lines starting with `#` are ignored.
- Both `KEY=value` and `export KEY=value` are accepted.
- The first `=` separates key and value; values may contain `=` characters.
- Values defined in **Extra environment variables** take precedence over `.env`, so per-vault overrides keep working.

---

## Embedded Code Files

| Setting | Description |
|---|---|
| **Render embedded code files** | Replace Obsidian's default plain-text rendering of `![[file.py]]` embeds with fully syntax-highlighted, interactive CodeSuite blocks. |
| **Collapse embedded files** | Start all embedded file blocks in the collapsed state. The header shows filename and line count; click to expand. |
| **Collapsible inline code blocks** | Adds a collapse toggle to inline code blocks in Reading view. Useful for hiding long preludes. |
| **Collapse inline blocks by default** | When the above is enabled, start every inline block collapsed. |

---

## Vault Code Files

| Setting | Description |
|---|---|
| **Show code files in the file explorer** | Register code extensions (`.py`, `.js`, `.sh`, `.go`, …) with Obsidian so the files appear in the sidebar and open in CodeSuite's lightweight editor. Restart Obsidian after toggling. Extensions already claimed by Obsidian or another plugin (e.g. `.md`, `.json`, `.css`, `.html`, `.xml`) are skipped automatically. |
| **Imports folder** | Vault-relative folder used by **Import code file as alias…**. Created on demand. Default: `CodeSuiteImports`. |

The companion command **Import code file as alias…** (command palette) opens a native file picker and symlinks the chosen file into the Imports folder. The new alias appears in the file explorer; opening it edits the original file on disk.

---

## Run All Skip Marker

Opt a block out of **Run All** in either of two ways:

**Fence tag (recommended)** — add `skip` after the language in the fence header, keeping the code itself clean:

````md
```python skip
print("Never executed by Run All")
```
````

**Comment marker** — add `codesuite:skip` to the **first line** of the block. Any common comment style works: `# …`, `// …`, `-- …`, `% …`, `/* … */`.

Skipped blocks display a small `skip` badge in their toolbar but can still be run individually.

---

## Import & Export

The four import/export commands (Jupyter `.ipynb` import/export, styled HTML and PDF export with outputs) live in the command palette, not the settings tab. The HTML/PDF exporters open a small per-export options dialog — content width, include title, keep code blocks together (PDF), single long page (PDF) — and your last choices are remembered automatically. See the [README](../README.md#import--export) for the full walkthrough.

---

## Variables, shared context & data tables

`vars` blocks, `code_vars:` frontmatter, inline `$varname` substitution, the type system, cross-language variable propagation, and data tables (experimental) are covered in the dedicated guide:

→ **[Variables & Code Execution](variables-and-execution.md)**

# Configuration Reference

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

---

## Code Execution

### Enable code execution
Show the Run button on supported language blocks. Disable to use CodeSuite as a syntax-highlighting-only plugin. Desktop only — no effect on mobile.

### Shared execution context *(on by default)*
When enabled, each block run in a note accumulates into a per-note in-memory session. Later blocks can reference variables, functions, and imports from earlier blocks (Python and Bash). Also enables inline `` `$varname` `` substitution.

> **Tip:** Run blocks top-to-bottom to build up state correctly. Use **Run All** to execute the entire note in sequence automatically.

### Execution timeout *(5–300 s, default 30 s)*
Maximum time a single block can run before the process is automatically killed. Raise this for long-running scripts (data processing, ML training).

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

### Extra environment variables
Additional `KEY=VALUE` pairs injected into every code execution, one per line. Lines starting with `#` are ignored.

```
PYTHONPATH=/path/to/extra/libs
OPENAI_API_KEY=sk-...
MY_CONFIG=production
```

---

## Embedded Code Files

| Setting | Description |
|---|---|
| **Render embedded code files** | Replace Obsidian's default plain-text rendering of `![[file.py]]` embeds with fully syntax-highlighted, interactive CodeSuite blocks. |
| **Collapse embedded files** | Start all embedded file blocks in the collapsed state. The header shows filename and line count; click to expand. |

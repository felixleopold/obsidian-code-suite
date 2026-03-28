# Obsidian Syntax Highlighting

VS Code-quality syntax highlighting for Obsidian code blocks using [Shiki](https://shiki.matsu.io/) with the **Gruvbox Dark Hard** theme.

## Features

- **Shiki-powered** — Same TextMate grammar engine as VS Code
- **Gruvbox Dark Hard** theme baked in
- **36 languages** out of the box (Python, JS, TS, Rust, Go, C/C++, Java, and more)
- **Line numbers** with hover highlight
- **Language labels** in the top-right corner
- **Lightweight** — Uses Shiki's JavaScript regex engine (no WASM)
- **Mobile-friendly** — Responsive font sizing and padding

## Build

```bash
npm install
npm run build
```

## Install to Vault

```bash
npm run install-plugin
```

Then restart Obsidian and enable "Syntax Highlighting" in Community Plugins.

## Supported Languages

Python, JavaScript, TypeScript, Java, C, C++, C#, Rust, Go, Bash, Shell,
HTML, CSS, JSON, YAML, TOML, SQL, Markdown, LaTeX, R, Ruby, Lua, Swift,
Kotlin, XML, Diff, Dockerfile, Makefile, PowerShell, GraphQL, Haskell,
Scala, PHP, Perl, TSX, JSX.

Common aliases are supported (e.g. `py`, `js`, `ts`, `sh`, `yml`, `rs`).

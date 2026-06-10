# Obsidian Community Plugin Listing

This file tracks the text used in the CodeSuite entry on the Obsidian community plugin marketplace.

---

## Short description (manifest.json `description` field — shown under the plugin name in search results)

> Execute code inside your notes: VS Code-quality Shiki highlighting with 65+ themes, live streaming output, inline Matplotlib and Plotly graphs, shared variables across blocks, Jupyter import and export, plus styled HTML and PDF export with outputs.

**Character count:** ~247 (limit: 250)

**Rules it satisfies** (per [submission requirements](https://docs.obsidian.md/Plugins/Releasing/Submission+requirements+for+plugins)): ≤250 chars, ends with a period, no emoji, starts with an action verb ("Run"), correct capitalization for proper nouns (Jupyter, Shiki, HTML, PDF).

---

## About (editable in community.obsidian.md plugin settings — 1000 char limit)

> Execute code inside your notes — a notebook that lives in plain Markdown. No kernel, no `.ipynb`, no server: your note stays a plain-text file you can version, diff, and edit anywhere.
>
> VS Code–quality syntax highlighting (Shiki, 65+ built-in themes, import any VS Code .json theme) in Reading view, Live Preview, and Source mode — every token, pixel-perfect.
>
> Run Python, JS/TS, Bash, PowerShell, PHP, Go, Ruby, and more with live stdout/stderr streaming, interactive stdin, and Matplotlib/Plotly graphs rendered inline.
>
> Share state across blocks: variables, imports, and functions carry over between runs, across languages. Reference any value inline in your prose with `$varname` — it updates live. Hit Run All to execute the whole note in one click.
>
> Embed vault code files with `![[script.py]]` as executable blocks. Import and export Jupyter `.ipynb` notebooks, and export any note to styled HTML or PDF with code outputs included.

**Character count:** ~835 (limit: 1000)

---

## Marketing & growth strategy

### What Obsidian allows
- **No rule** against naming or comparing to other plugins in the README or store description. The only ad restriction is "no static ads outside a plugin's own interface" — not relevant to us.
- The **community code of conduct** bans *exclusive self-promotion* (pure link-drops with no genuine participation). Forum/Reddit posts must add value, not just advertise.
- Description must follow the style guide: ≤250 chars, action verb, period, no emoji, correct proper-noun caps.

### Differentiators vs. the two main competitors
Both are barely maintained; none of their code was used here.

| Capability | CodeSuite | obsidian-execute-code | shiki-highlighter |
|---|---|---|---|
| Syntax highlighting (Shiki, 65+ themes) | ✅ Reading + Live Preview + Source | ⚠️ basic | ✅ highlighting only |
| Code execution | ✅ | ✅ (30+ langs) | ❌ none |
| Interactive stdin / password masking | ✅ | ❌ | — |
| Inline `$var` substitution in prose | ✅ | ❌ | — |
| Cross-language shared variables | ✅ | ⚠️ same-language only | — |
| Interactive Plotly graphs inline | ✅ | ❌ static only | — |
| Jupyter `.ipynb` import + export | ✅ | ❌ | — |
| Styled HTML / PDF export with outputs | ✅ | ❌ | — |
| Live-preview code-block chrome | ✅ | ❌ | ⚠️ partial |
| Actively maintained | ✅ | ⚠️ last release Mar 2025, 161 open issues | ⚠️ low activity |

> Tone rule: in the public README, present the comparison as **factual capability rows**, not "they are worse." Let the table speak. Naming competitors is allowed but disparaging language reads badly and risks community pushback.

### Channels to reach their users
1. **Obsidian forum → Share & Showcase** — post a genuine showcase with the hero gif; answer questions, stay active in the thread (avoids the link-drop ban).
2. **r/ObsidianMD** — feature demo post (gif/video performs far better than text).
3. **GitHub README SEO** — Google indexes the README. Weave high-intent phrases naturally: "run Python in Obsidian", "Jupyter notebook alternative", "execute code in Obsidian", "Matplotlib in Obsidian", "export Obsidian note to PDF with code output".
4. **Plugin update notes** — each release shows in the in-app "Updates" feed; lead the changelog with user-facing wins, not internal refactors.
5. **Reply helpfully** on existing forum/Reddit threads where users hit competitor limitations (no stdin, stale, no PDF export) — link only when it genuinely answers the question.

---

## Notes

- The About text is set separately from the README on the community plugin listing page.
- Keep it under 1000 characters (including spaces).
- Update this file whenever the About text is changed so it stays in sync.
- The manifest.json `description` is used in Obsidian's plugin search — keep it concise (250 chars max).

# Variables & Code Execution

> **Part of the CodeSuite docs** — [README](../README.md) · **Variables & Execution** · [Configuration Reference](configuration.md)

CodeSuite turns Obsidian notes into interactive notebooks. This page explains how code execution works, how to declare and share variables between blocks and across languages, and how to display live values inline in your prose.

---

## Contents

1. [How execution works](#how-execution-works)
2. [The shared session](#the-shared-session)
3. [Declaring variables](#declaring-variables)
   - [vars blocks](#1-vars-blocks)
   - [Frontmatter code_vars](#2-frontmatter-code_vars)
   - [Data tables (experimental)](#3-data-tables-experimental)
4. [Type system](#type-system)
5. [Inline $varname substitution](#inline-varname-substitution)
6. [Cross-language variables](#cross-language-variables)
7. [Run All & skipping blocks](#run-all--skipping-blocks)
8. [Resetting state](#resetting-state)
9. [Practical patterns](#practical-patterns)
10. [Quick reference](#quick-reference)

---

## How execution works

Any fenced code block in a supported language gets a **Run** button in Reading view. Click it to start the block as a subprocess. Output streams to a panel below the block in real time.

**Supported languages:**

| Language | Fence | Runtime |
|---|---|---|
| Python | `python` / `py` | `python3` |
| JavaScript | `javascript` / `js` / `node` | `node` |
| TypeScript | `typescript` / `ts` | `npx tsx` |
| Bash | `bash` | `bash` |
| Zsh | `zsh` | `zsh` |
| POSIX Shell | `sh` / `shell` | `/bin/sh` |
| PowerShell | `powershell` / `ps1` | `pwsh` |
| Go | `go` | `go run` |
| Ruby | `ruby` / `rb` | `ruby` |
| Lua | `lua` | `lua` |
| Perl | `perl` | `perl` |
| R | `r` | `Rscript` |
| PHP | `php` | `php` |
| Swift | `swift` | `swift` |

Each run spawns a **fresh process** — there is no long-lived kernel. All state (variables, imports, functions) is reconstructed on every run via the session mechanism described below.

**What the output panel shows:**
- Stdout and stderr stream in as the process runs, not after it finishes.
- When your code reads from `stdin` (e.g. Python's `input()`), an input bar appears below the output.
- `sudo` is detected automatically and the input bar masks characters.
- `plt.show()` and `fig.show()` are intercepted — Matplotlib and Plotly graphs render as inline images without a display server.
- When the run finishes, copy buttons appear in the output header, split by stream: **Copy output** (stdout) shows when there is stdout, and **Copy stderr** shows when there is stderr. stderr is always orange — it carries warnings *and* errors, which can't be told apart within one stream — and a non-zero exit is shown by a red **`Output (exit: N)`** badge in the header rather than by recolouring the text.

> Interpreter paths, timeout, working directory, and environment variables are configured under [Settings → CodeSuite → Code execution](configuration.md#code-execution).

---

## The shared session

When **Shared execution context** is on (default), each block you run accumulates into a **per-note in-memory session**. Later blocks see everything set by earlier ones — variables, imports, class and function definitions.

```python
# Block 1 — run first
import math
radius = 5
```

```python
# Block 2 — run after block 1; `radius` and `math` are already in scope
area = math.pi * radius ** 2
print(f"area = {area:.2f}")   # → 78.54
```

State is **per-note**, **in-memory only**, and lost when Obsidian closes. Use **Clear Session** to reset manually (see [Resetting state](#resetting-state)).

### Why every run spawns a fresh process

There is no persistent kernel. When you run block 2, CodeSuite:

1. Injects any declared variable seeds (from `vars` / `code_vars:` / tables).
2. Re-runs all of this language's previous blocks **silently** (output suppressed) to reconstruct their state.
3. Injects any values that another language changed at runtime.
4. Runs your block, which is the only one producing visible output.

This "replay" model means:
- **Re-running a block is always safe and idempotent.** A block is excluded from its own replay, so it sees its declared seed value again rather than a stale mutation from a prior run.
- **No background daemon.** Nothing persists on disk or in a background process.
- **Within one language**, all state carries over (functions, objects, DataFrames). Across languages, only scalars and JSON-serializable values cross — see [Cross-language variables](#cross-language-variables).
- **Replay is non-interactive, but your input is remembered.** No input bar is shown for silently-replayed blocks. Instead, the stdin you typed when a block last ran is recorded and fed back during replay, so an earlier block's `input()` (or `sys.stdin` / shell `read`) reproduces the value it produced — a *later* block sees the variable an interactive upstream block set (e.g. `name = input(...)` upstream, `print(name)` downstream). A read past the recorded input still hits EOF (a replayed `input()` raises `EOFError`, swallowed so it can't abort the block you actually ran), and passwords are never recorded. Stored input is cleared by **Clear Session**.

### Execution order matters

Blocks share state in the order you *run* them, not their visual order on the page. **Run All** always respects visual top-to-bottom order, which is almost always what you want for a notebook-style note.

---

## Declaring variables

Variables declared outside any code block are called **shared variables** or **seeds**. They are automatically available to every code block in the note — before you run anything — and are injected as native, correctly-typed literals (not strings).

There are three ways to declare them.

---

### 1. `vars` blocks

A `vars` fenced block is the primary way to declare note-scoped variables. Place one anywhere in the note — typically at the top.

````markdown
```vars
# Comments start with #
threshold   = 0.85
crawl_depth = 5
base_url    = "https://api.example.com/v1"
dataset     = sales_q4.csv
download    = True
optional    = null
```
````

The block renders with a `vars` label, a **Copy** button, and an **Apply** button. It looks like a code block but holds variable declarations, not runnable code.

**Syntax rules:**
- One assignment per line: `key = value` or `key: value`
- Keys must be valid identifiers (`letters`, `digits`, `_`; cannot start with a digit)
- Blank lines and lines beginning with `#` are ignored
- Value types are inferred automatically — see [Type system](#type-system) below

#### Forcing a type with `:type` hints

Append `:type` to a key to override inference (the `=` separator is required):

```vars
port:str    = 8080      # keep as string "8080", not integer 8080
zip:str     = 01234     # preserve leading zero
ids:json    = [1, 2, 3] # parse as a JSON list
ratio:float = 1         # 1.0, not 1
```

Recognised type hints: `str`, `int`, `float`, `bool`, `json`.

#### Multiline strings

Wrap values in triple quotes (`"""` or `'''`) to span multiple lines. One leading and one trailing newline are trimmed:

```vars
sql_query = """
SELECT id, name
FROM users
WHERE active = 1
ORDER BY name
"""

prompt = '''
You are a helpful assistant.
Answer concisely.
'''
```

---

### 2. Frontmatter `code_vars:`

Declare variables in YAML frontmatter when you prefer note metadata over a fenced block — useful if you query notes with Dataview:

```yaml
---
code_vars:
  threshold: 0.85
  crawl_depth: 5
  base_url: "https://api.example.com/v1"
  download: true
  optional: null
---
```

YAML already has types: `0.85` is a float, `true` is a bool, `null` is null. No inference needed. String values don't require quotes in YAML but you can add them for clarity.

**Display in reading view.** A nested mapping like the one above can't be shown in Obsidian's reading-view Properties panel — a nested object displays an orange "unsupported property type" warning and collapses. CodeSuite hides that broken row, so the warning never appears, and renders the values as a small read-only list just below the Properties widget. This **CodeSuite variables panel** is on by default; turn it off in settings if you'd rather just suppress the warning and show nothing. The panel lives inside the note's header (next to Properties), so it stays put as you scroll and refreshes whenever the frontmatter changes. Alternatively, write `code_vars` as a list of `key = value` strings — a plain list renders natively in the Properties panel:

```yaml
---
code_vars:
  - threshold = 0.85
  - crawl_depth = 5
  - base_url = "https://api.example.com/v1"
  - download = true
  - optional = null
---
```

Each item uses the same `key = value` (or `key: value`) grammar as a `vars` block, including `:type` hints (`port:int = 8080`). Obsidian renders a plain list of strings as a normal List property, so it shows up in reading view without a warning.

**Precedence:** a `vars` block in the note body overrides the frontmatter value for the same key.

---

### 3. Data tables *(experimental)*

> Enable **Settings → CodeSuite → Experimental features → Data tables** first. This feature is off by default and its syntax may change.

A markdown table can be declared as a data source for code. The table continues to render normally; a small badge above it identifies it as a code variable.

#### Auto-detected `var | value` tables

A table whose first header is `var` (or `variable`, `name`, `key`) and second header is `value` is treated as a variable source automatically — no directive needed:

| var | value |
|-----|-------|
| api_url | https://api.example.com |
| max_retries | 3 |
| verbose | true |

Each row defines one top-level variable. Values go through the same type inference as a `vars` block.

Add an optional `type` column to force types:

| var | value | type |
|-----|-------|------|
| port | 8080 | str |
| timeout | 30 | int |

#### Directive tables

Put `%% codesuite: <name> [as <shape>] %%` on the line directly above a table to expose it as a single structured variable named `<name>`.

> **Important:** a blank line between the directive and the table is required for Obsidian to render the table as HTML.

```
%% codesuite: prices as dict %%

| product | price |
|---------|-------|
| apple   | 1.20  |
| pear    | 0.95  |
```

Python receives: `prices = {"apple": 1.2, "pear": 0.95}`

**Available shapes:**

| Shape | Python type | What you get |
|---|---|---|
| `records` *(default)* | `list[dict]` | `[{"col": val, …}, …]` — ideal for `pd.DataFrame(name)` |
| `dict` | `dict` | `{key: value}` — first column as keys, second as values |
| `columns` | `dict[list]` | `{"col": [values…], …}` — column-major |
| `matrix` | `list[list]` | `[[row0…], [row1…], …]` — 2-D grid including the header row |
| `vars` | *(top-level)* | each row defines its own variable; omit `<name>` |

Cells are typed with the same inference as a `vars` block. Shells receive a JSON string for structured shapes (since shells are stringly typed); the `vars` shape works in all languages since each value is a scalar.

---

## Type system

All three variable sources go through the same type pipeline. A value is parsed into a typed representation and then rendered as the correct native literal for each target language.

### Inference rules

| Written | Inferred type | Python literal | Shell value |
|---|---|---|---|
| `5` | int | `5` | `5` |
| `0.85` | float | `0.85` | `0.85` |
| `True` / `true` | bool | `True` | `true` |
| `False` / `false` | bool | `False` | `false` |
| `None` / `null` / `nil` | null | `None` | *(empty string)* |
| `"text"` or `'text'` | string | `"text"` (quotes stripped) | `text` |
| `sales.csv` *(bare)* | string | `"sales.csv"` | `sales.csv` |
| `[1, 2, 3]` | JSON list | `[1, 2, 3]` | `[1,2,3]` *(JSON string)* |
| `{"a": 1}` | JSON dict | `{"a": 1}` | `{"a":1}` *(JSON string)* |

The inline `$varname` display always shows the human-readable form (numbers as numbers, strings without surrounding quotes).

### Why this matters

Before this type system, every `vars` value was injected as a Python string, so:
- `threshold = 0.85` arrived as `threshold = "0.85"` — multiplication or comparison would fail.
- `enabled = True` arrived as `"True"` — truthy but the wrong type for `isinstance` checks.
- `url = "https://x"` arrived as `'"https://x"'` — double-quoted, breaking URL parsing.

Now each value is injected as the right literal with no manual casting required.

### Cross-language type behaviour

Shells are stringly typed — they hold everything as a scalar string. When a shell block changes a variable and that value is later imported by Python or another typed language, it is **re-inferred** from the string representation back to its most specific type (`"42"` → int `42`, `"true"` → bool `True`). This means a round-trip through bash does not permanently degrade a value's type.

---

## Inline `$varname` substitution

Write `` `$varname` `` anywhere in a note's prose. In Reading view the backtick span is replaced by the variable's current value and updates live every time a block runs.

```markdown
The model achieved `$accuracy`% accuracy with a loss of `$loss`.

Crawling `$dataset` with depth `$crawl_depth` and threshold `$threshold`.
```

**When values resolve:**
- Variables from `vars` blocks, `code_vars:` frontmatter, and auto-detected `var | value` tables resolve **immediately on page open**, before any code runs.
- Variables set or changed by running code update **when the block finishes**.

**Appearance:** if a variable has no value yet, the span stays as `$varname` in a muted style. Once resolved, it shows the current value in a distinct colour.

**What you can reference:** any variable in the note's shared namespace — declared seeds, runtime values set by code, and cross-language values from other blocks.

---

## Cross-language variables

Shared variables propagate across languages in execution order. A value set in Python is visible to later Bash blocks; a value changed in Bash flows back into the next Python block — re-typed.

```vars
count = 10
```

```python
# Block A
count = count + 5
print(f"Python: count = {count}")   # → 15
```

```bash
# Block B — bash receives count=15 from Python
echo "Bash: count = $count"         # → 15
count=$((count * 2))
echo "Bash: doubled = $count"       # → 30
```

```python
# Block C — Python receives count=30 from bash, re-inferred as int
print(f"Python: count = {count}")   # → 30
print(type(count).__name__)          # → int
```

### How cross-language injection works

Because each run is a fresh process, cross-language values are passed through the **four-layer execution model** that runs before your block:

| Layer | What happens |
|---|---|
| 1. Declared seeds | `vars` / `code_vars:` / table values are injected as the initial values |
| 2. Replay | this language's own earlier blocks run silently, rebuilding its functions, imports, and variables |
| 3. Cross-language values | values *changed by other languages* are injected *after* replay — so they win over this language's own earlier assignments |
| 4. Your block | runs normally, producing visible output |

Layer 3 is what makes `count = 30` (set by bash) reach Python without Python's own earlier assignment of `count = 15` clobbering it.

### Rules and limits

| Situation | Behaviour |
|---|---|
| Var set by language A, read by language B | B gets A's latest value |
| Var changed by B, C runs next | C gets B's value, re-typed if needed |
| Re-running block A | A is excluded from its own replay — it sees the seed value again (no double-apply) |
| Var only read, never changed | ownership doesn't transfer; its type is preserved |
| Functions, class definitions, DataFrames | stay within their language via replay — they are not JSON-serializable |

**What crosses languages:** scalars (`int`, `float`, `bool`, `str`, `null`) and JSON-serializable structures (`list`, `dict` of the above). Everything else stays within its language.

---

## Run All & skipping blocks

The **Run All** button in the note header bar (or command palette → **Run all code blocks in this note**) executes every executable block in the note **top-to-bottom**, stopping on the first error.

**Skipping blocks:** mark any block to exclude it from Run All while keeping it runnable individually. There are two ways:

**1. Fence tag (recommended)** — add `skip` after the language in the fence header. This keeps your code clean, leaving no marker inside the block itself:

````md
```python skip
import heavy_module   # loaded individually, not on every Run All
```
````

**2. Comment marker** — add `codesuite:skip` as the first line of the block. Useful when you can't edit the fence header. Any comment style works:

```bash
# codesuite:skip
rm -rf build/        # destructive step — run deliberately, not automatically
```

The marker can also be written `// codesuite:skip`, `-- codesuite:skip`, `% codesuite:skip`, or `/* codesuite:skip */`.

Either way, skipped blocks show a small `skip` badge in their toolbar so you can see them at a glance.

---

## Resetting state

| Action | What it resets |
|---|---|
| **Apply** (on a `vars` block) | Re-asserts the declared values of the vars in that block across all languages. Runtime changes to those specific vars are discarded; everything else is unchanged. |
| **Clear Session** | Resets the entire note: replay accumulation cleared, all live cross-language values reset to declared seeds, inline `$varname` spans return to placeholder style. |

**Apply** is useful when you are iterating on parameters — change a `vars` block, click Apply, and the new values are in effect for the next run without clearing your Python session or re-importing libraries.

**Clear Session** is the full reset — equivalent to closing and reopening the note.

---

## Practical patterns

### Parameter notebook

Declare all tunable parameters at the top of the note. Change them and re-run without touching the code:

```vars
learning_rate  = 0.001
batch_size     = 32
epochs         = 10
train_csv      = "data/train.csv"
val_split      = 0.2
```

```python
import pandas as pd
df = pd.read_csv(train_csv)
split = int(len(df) * (1 - val_split))
train, val = df[:split], df[split:]
print(f"train={len(train)}  val={len(val)}")
```

### Live result display in prose

Embed results directly in your writing. They update whenever you run the block:

```markdown
The model achieved **`$accuracy`%** accuracy
with a cross-entropy loss of `$loss` after `$epochs` epochs.
```

```python
accuracy = 94.7
loss     = 0.183
```

### Shell → Python handoff

Capture shell output and process it in Python:

```bash
file_count=$(find . -name "*.py" | wc -l | tr -d ' ')
```

```python
# file_count arrives as an int (re-inferred from bash's string)
print(f"Found {file_count} Python files")
if file_count > 100:
    print("Large codebase — consider splitting into modules")
```

### Table-driven configuration

Let collaborators edit parameters in a readable table without touching code:

| var | value | type |
|-----|-------|------|
| api_endpoint | https://api.example.com/v1 | str |
| timeout_s | 30 | int |
| max_retries | 3 | int |
| debug | false | bool |

```python
import requests
resp = requests.get(api_endpoint, timeout=timeout_s)
print(f"{resp.status_code} after {max_retries} allowed retries, debug={debug}")
```

### Reusable config in frontmatter

Store connection strings and environment info in frontmatter. Dataview can query them; code blocks use them automatically:

```yaml
---
tags: [analysis, database]
code_vars:
  db_host: localhost
  db_port: 5432
  db_name: analytics
---
```

```python
import psycopg2
conn = psycopg2.connect(host=db_host, port=db_port, dbname=db_name)
```

### SQL query as a multiline var

Keep a query out of the code block so it can be tweaked without touching Python:

```vars
query = """
SELECT
    date_trunc('week', created_at) AS week,
    COUNT(*)                        AS signups
FROM users
WHERE created_at > NOW() - INTERVAL '90 days'
GROUP BY 1
ORDER BY 1
"""
```

```python
import pandas as pd, psycopg2
conn = psycopg2.connect(host=db_host, port=db_port, dbname=db_name)
df = pd.read_sql(query, conn)
print(df.to_string(index=False))
```

---

## Quick reference

| What | Syntax | Notes |
|---|---|---|
| Declare vars | ` ```vars ` block | Anywhere in the note; rendered block, not executable |
| Declare vars | `code_vars:` YAML frontmatter | YAML-typed; vars block overrides for same key |
| Declare vars from table | `var \| value` header — auto-detected | Requires **Data tables** setting |
| Declare structured var from table | `%% codesuite: name as shape %%` above table | Requires **Data tables** setting; blank line before table |
| Force a type | `name:type = value` in vars block | Types: `str` `int` `float` `bool` `json` |
| Multiline value | `"""…"""` or `'''…'''` in vars block | Leading/trailing newline trimmed |
| Show value in prose | `` `$varname` `` | Updates live after each run |
| Skip Run All | `skip` in fence header (e.g. ` ```python skip `) | Or `# codesuite:skip` first line (any comment style) |
| Re-assert declared vars | **Apply** on a vars block | Discards runtime changes to those vars |
| Full reset | **Clear Session** button / command | Clears replay + all live vars |

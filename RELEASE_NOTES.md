Typed variable injection (fixing #16), plus an experimental way to use markdown tables as code variables.

## What's New

- **Typed `vars` injection** ([#16](https://github.com/felixleopold/obsidian-code-suite/issues/16)): values in `vars` blocks and `code_vars:` frontmatter are now injected as native, correctly-typed literals. `5` is an `int`, `True` is a `bool`, `0.85` is a `float`, and a quoted `"https://x"` is a clean string — no more manual casting or double-quoting.
- **Live cross-language variables**: a shared variable changed by one block is now visible to later blocks in *any* language, in execution order. Set `count = 42` in Python and a later Bash block sees `42`; change it in Bash and the next Python block sees the new value (re-typed). Re-running a block no longer double-applies its own assignment. **Apply** on a `vars` block (or **Clear Session**) resets shared vars to their declared values.
- **`:type` hints**: force a type with `port:str = 8080`, `ratio:float = 1`, or `ids:json = [1, 2, 3]`. Hints: `str`, `int`, `float`, `bool`, `json`.
- **Multiline string vars**: triple-quoted (`"""` or `'''`) values can span multiple lines.
- **Data tables (experimental)** — Settings → Experimental features → Data tables (off by default): a `%% codesuite: <name> as <shape> %%` directive above a markdown table exposes it to code as `records`, `dict`, `columns`, `matrix`, or `vars`. A `var | value` header is recognised automatically.

## Bug Fixes

- `vars` string values are no longer wrapped in an extra layer of quotes (e.g. `BASE_URL` was becoming `'"https://…"'`, breaking URL navigation).
- Integers and booleans from `vars` blocks are no longer injected as strings, so comparisons like `if depth > CRAWL_DEPTH:` work without manual `int()`/`bool()` casting.

## Upgrade Notes

- Existing `vars` blocks keep working. If your code relied on every value being a string and you previously cast it (e.g. `int(MY_INT)`), those casts are now redundant but harmless. Add a `:str` hint if you specifically need a value kept as a string.
- Shared variables are now a live cross-language namespace updated in execution order. If you relied on a `vars` value always resetting to its declared value on every run regardless of prior runs, use **Apply** / **Clear Session** to reset, or keep that variable read-only.
- Data tables are experimental and off by default; their syntax may change in a future release.

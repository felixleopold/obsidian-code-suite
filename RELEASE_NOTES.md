This patch release fixes inline Matplotlib and Plotly graph rendering on Windows.

## Bug Fixes

- **Windows figure markers render correctly** — CodeSuite now recognizes Python's CRLF line endings instead of displaying internal `OCODE_FIG_*` markers as output ([#53](https://github.com/felixleopold/obsidian-code-suite/issues/53)).
- **Plotly no longer collides with Python's standard library** — temporary scripts no longer use the name `code.py`, preventing the Plotly/IPython circular-import error reported in [#53](https://github.com/felixleopold/obsidian-code-suite/issues/53).

## Upgrade Notes

- No action needed. Existing settings are preserved.

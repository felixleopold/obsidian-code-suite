# CodeSuite — output display demo

Run each block (▶ Run) and compare what you see against **What to expect**. This
demonstrates how CodeSuite presents `stdout`, `stderr`, and failures after the
[#29](https://github.com/felixleopold/obsidian-code-suite/issues/29) fix.

**The model in one line:** the only distinction CodeSuite can make is **stdout vs
stderr** — so stdout is neutral, **stderr is always orange** (warnings *and*
errors alike), and **failure is shown by a red `exit:` badge in the header**, not
by recolouring the text.

---

## 1 · stdout only — a clean run

```bash
echo "Build complete: 42 files compiled"
```

**What to expect:** neutral-coloured text. Header reads `Output`. One button:
**Copy output**.

---

## 2 · stderr only, success — warnings

```bash
echo "Warning: using default config" >&2
echo "Warning: cache disabled" >&2
```

**What to expect:** **orange** text. Header reads `Output` (exit 0 — *not* red,
these aren't errors). A single **orange** button: **Copy stderr**. No neutral
"Copy output" button, because there's no stdout to copy — that would just
duplicate this one (the original #29 bug).

---

## 3 · error only, no stdout — a failure

```bash
echo "fatal: not a git repository" >&2
exit 1
```

**What to expect:** **orange** text (still — stderr is never repainted red).
Header reads **`Output (exit: 1)` in red** — that's the failure signal. One
**orange Copy stderr** button.

---

## 4 · mixed, success — stdout + stderr

```bash
echo "Processed 100 records"
echo "Note: 3 records skipped" >&2
```

**What to expect:** stdout neutral, stderr orange. Header reads `Output`. **Two**
buttons: neutral **Copy output** (copies everything) + orange **Copy stderr**
(copies just the stderr line). They differ, so they're not a duplicate.

---

## 5 · mixed + failure — the #29 reporter's case

```bash
echo "✓ output: file processed"
echo "✗ error: config missing" >&2
exit 2
```

**What to expect:** `✓ output: file processed` neutral; `✗ error: config missing`
**orange** (no longer red just because the run failed). Header reads **`Output
(exit: 2)` in red**. Two buttons: neutral **Copy output** + orange **Copy
stderr**.

> **Note the unavoidable bit:** *Copy stderr* copies **all** stderr. If a run
> emits both a benign message and a real error on stderr, they come back
> together — there's no marker in the stream to separate a "warning" from an
> "error" (this block's `✗ error: config missing` is, byte-for-byte, just as
> much an "error" as a real one). stdout vs stderr is the only line we can draw.

---

## 6 · Python warnings (the exact report)

```bash
python3 -c "import warnings; warnings.warn('deprecated API'); print('done')"
```

**What to expect:** `done` (stdout) neutral; the `UserWarning` (stderr) orange;
header `Output` (Python warnings don't change the exit code). Two buttons.

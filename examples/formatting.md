# CodeSuite formatting test

Use this note in Obsidian to verify the formatting features added in CodeSuite 1.20.0. Test it in Source mode, Live Preview, and Reading View.

## Inline code

Ordinary inline code should have a stronger background, border, and spacing: `result` and `data_pipeline.py`.

Language-aware inline code uses a `{language}` prefix inside the backticks:

- Python: `{python} result = sum([1, 2, 3])`
- JavaScript: `{javascript} const ready = true`
- TypeScript alias: `{ts} const count: number = 3`
- Bash: `{bash} printf '%s\n' "$HOME"`
- JSON: `{json} {"enabled": true}`

In Reading View, each recognized prefix should disappear and the code after it should receive syntax colors. In Source mode and Live Preview, the prefix remains visible and the code is highlighted. Editor highlighting supports single-line inline spans.

Unknown languages remain unchanged: `{not-a-language} value`. Existing CodeSuite variable references also retain their behavior: `$result`.

Turn off **Settings → CodeSuite → Enhanced inline code styling** to remove the stronger visual treatment. Turn off **Inline syntax highlighting** to keep the `{language}` text visible without Shiki token colors.

## Static block, title, line numbers, and line backgrounds

Expected result: the title preserves its capitalization, the block has line numbers, lines 1, 2, and 3 use the ordinary, inserted, and deleted backgrounds, and there is no Run button.

```python title="Data Pipeline.py" static showLineNumbers {1} ins={2} del={3}
values = [1, 2, 3]
result = sum(values)
print("Old output")
print(result)
```

The aliases below produce the same kinds of overrides. This block starts collapsed and hides line numbers:

```javascript title="Folded example" fold=true ln=false static
const message = "Expand the header to see me";
console.log(message);
```

## Global static default override

Enable **Settings → CodeSuite → Static blocks by default**. The following block should still show a Run button because `static=false` overrides that setting:

```javascript title="Runnable example" static=false
console.log("Hello from CodeSuite");
```

With the global setting disabled, this block should be static because `static=true` explicitly opts out of execution:

```bash title="Static shell example" static=true
echo "This must not run"
```

## Diff shorthand

Expected result: the removed line is red, the added line is green, and the `---` and `+++` file headers are not colored as changed lines.

```diff title="Changes.diff"
--- a/example.py
+++ b/example.py
@@ -1,2 +1,2 @@
-print("Old output")
+print("New output")
 unchanged = True
```

## Explicit booleans and legacy collapse flags

These blocks exercise the supported alternatives:

```python title="Explicit values" static=true showLineNumbers=false collapse=false
print("Expanded, unnumbered, and static")
```

```python title="Legacy collapsed flag" static collapsed
print("Collapsed")
```

```python title="Legacy expanded flag" static expanded
print("Expanded")
```

## Nested fences

Attributes also work on a fenced block inside a quote. This block should have the title `Quoted.py` and no Run button:

> ```python static title="Quoted.py"
> print("Static quoted block")
> ```

## Verification checklist

- [ ] Ordinary inline code has stronger styling in all three editor modes.
- [ ] Recognized inline language prefixes disappear in Reading View.
- [ ] Language-aware inline code has token colors.
- [ ] Unknown inline language prefixes remain visible.
- [ ] Static blocks have no Run button and are excluded from Run All.
- [ ] `static=false` overrides the global static default.
- [ ] Titles preserve spaces and capitalization.
- [ ] Line-number and collapse overrides work in Reading View and Live Preview.
- [ ] Line backgrounds and line numbers remain visible while editing a block.
- [ ] Diff additions and deletions are colored without coloring file headers.
- [ ] Quoted fenced blocks retain their attributes.

# Per-block and inline formatting

Ordinary inline code: `result`. Language-aware inline code: `{python} result = sum([1, 2, 3])`.

This static block has a title, a numbered gutter, and all three line backgrounds:

```python title="Data Pipeline.py" static showLineNumbers {1} ins={2} del={3}
values = [1, 2, 3]
result = sum(values)
print("Old output")
print(result)
```

This block starts collapsed and overrides the global line-number setting:

```javascript title="Folded example" fold=true ln=false static
const message = "Expand the header to see me";
console.log(message);
```

This block remains runnable even with **Static blocks by default** enabled:

```javascript title="Runnable example" static=false
console.log("Hello from CodeSuite");
```

Diff lines receive backgrounds automatically:

```diff title="Changes.diff"
--- a/example.py
+++ b/example.py
@@ -1,2 +1,2 @@
-print("Old output")
+print("New output")
 unchanged = True
```

> A quoted static block:
>
> ```python static title="Quoted.py"
> print("This block should have no Run button")
> ```

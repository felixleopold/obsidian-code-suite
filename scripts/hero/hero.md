#### Syntax highlighting & execution

```python
import requests
stats = requests.get("https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugin-stats.json").json()["code-suite"]
downloads = stats["downloads"]
```

CodeSuite is at `$downloads` downloads. Fetched live and dropped straight into this sentence, no copy-paste.

#### Theme switching

Same Shiki engine as VS Code: switch between 65+ built-in themes (or import any VS Code `.json`), light or dark, recoloring instantly.

#### Reuse variables in any language

```bash
echo "CodeSuite downloads: $downloads" # created in Python, used in bash
```

#### Inline plots

```python
import matplotlib.pyplot as plt
releases = sorted([(v, n) for v, n in stats.items() if v[0].isdigit()], key=lambda r: [int(x) for x in r[0].split(".")])[-8:]
plt.figure(figsize=(9, 2.4)); plt.bar(*zip(*releases)); plt.title("downloads per release"); plt.show()
```

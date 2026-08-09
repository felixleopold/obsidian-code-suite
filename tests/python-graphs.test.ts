import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { executionScriptName, parseFigureSentinel, wrapPythonForGraphs } from "../src/python-graphs";

const python = process.env["CODE_SUITE_PYTHON"];

test("parses figure sentinels with Unix and Windows line endings", () => {
  assert.equal(parseFigureSentinel("OCODE_FIG_1"), 1);
  assert.equal(parseFigureSentinel("OCODE_FIG_12\r"), 12);
  assert.equal(parseFigureSentinel("OCODE_FIG_1 "), null);
  assert.equal(parseFigureSentinel("user output"), null);
});

test("uses a Python script name that cannot shadow the standard-library code module", () => {
  assert.equal(executionScriptName("python", ".py"), "ocode-exec.py");
  assert.equal(executionScriptName("javascript", ".js"), "code.js");
});

const examples = [
  {
    name: "Matplotlib",
    extension: "png",
    code: `from matplotlib import pyplot as plt
import numpy as np
x = np.arange(0,100,1)
y = x**2
plt.plot(x,y)
plt.show()
`,
  },
  {
    name: "Plotly",
    extension: "html",
    code: `import plotly.express as px
fig = px.scatter(x=[0, 1, 2, 3, 4], y=[0, 1, 4, 9, 16])
fig.show()
`,
  },
];

for (const example of examples) {
  test(`${example.name} produces a captured figure`, { skip: python === undefined }, () => {
    assert.ok(python);
    const runDir = mkdtempSync(join(tmpdir(), "code-suite-python-"));
    const imageDir = join(runDir, "images");
    const scriptPath = join(runDir, executionScriptName("python", ".py"));

    try {
      writeFileSync(scriptPath, wrapPythonForGraphs(example.code, imageDir, true, false, ""), "utf8");
      const result = spawnSync(python, ["-u", scriptPath], { encoding: "utf8" });

      assert.equal(result.status, 0, result.stderr);
      assert.doesNotMatch(result.stderr, /partially initialized module|Error importing optional module/);

      const markerLine = result.stdout.split("\n").find((line) => parseFigureSentinel(line) !== null);
      assert.notEqual(markerLine, undefined, `Missing figure marker in stdout: ${result.stdout}`);
      assert.equal(parseFigureSentinel(markerLine!), 1);
      if (process.platform === "win32") assert.match(result.stdout, /OCODE_FIG_1\r\n/);

      const figurePath = join(imageDir, `fig_1.${example.extension}`);
      assert.ok(existsSync(figurePath), `Missing captured figure: ${figurePath}`);
      assert.ok(statSync(figurePath).size > 0, `Captured figure is empty: ${figurePath}`);
      if (example.extension === "html") assert.match(readFileSync(figurePath, "utf8"), /plotly/i);
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });
}

import { parse } from "acorn";
import type { Pattern } from "acorn";
import { toJs, type VarValue } from "./vars";

function addPatternNames(pattern: Pattern, names: Set<string>): void {
  switch (pattern.type) {
    case "Identifier":
      if (!pattern.name.startsWith("_")) names.add(pattern.name);
      break;
    case "ObjectPattern":
      for (const property of pattern.properties) {
        addPatternNames(property.type === "RestElement" ? property.argument : property.value, names);
      }
      break;
    case "ArrayPattern":
      for (const element of pattern.elements) {
        if (element) addPatternNames(element, names);
      }
      break;
    case "RestElement":
      addPatternNames(pattern.argument, names);
      break;
    case "AssignmentPattern":
      addPatternNames(pattern.left, names);
      break;
  }
}

/** Names whose values must be copied from a block's lexical scope into its replay context. */
export function javascriptTopLevelBindings(source: string): string[] {
  try {
    const program = parse(source, { ecmaVersion: "latest", sourceType: "script" });
    const names = new Set<string>();

    for (const statement of program.body) {
      if (statement.type === "VariableDeclaration") {
        for (const declaration of statement.declarations) {
          addPatternNames(declaration.id, names);
        }
      } else if (statement.type === "FunctionDeclaration") {
        const id = statement.id;
        if (!id.name.startsWith("_")) names.add(id.name);
      } else if (statement.type === "ClassDeclaration") {
        const id = statement.id;
        if (id && !id.name.startsWith("_")) names.add(id.name);
      }
    }

    return [...names];
  } catch {
    // Let Node report the original syntax error. Existing shared values remain
    // available even when the block cannot be inspected for new declarations.
    return [];
  }
}

function seedObject(values: Record<string, VarValue>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [name, toJs(value)]));
}

function javascriptBlock(source: string): string {
  const captures = javascriptTopLevelBindings(source)
    .map((name) => `__ocode_ctx[${JSON.stringify(name)}] = ${name};`)
    .join("\n");
  return `with (__ocode_ctx) {
  (() => {
${source}
${captures}
  })();
}`;
}

/**
 * Build one JavaScript process from replay blocks plus the visible current run.
 * Each block gets its own lexical scope, while declared values and closures are
 * retained in an in-process context object for later blocks.
 */
export function buildJavascriptContextCode(
  previousBlocks: string[],
  currentBlock: string,
  preSeeds: Record<string, VarValue> = {},
  postSeeds: Record<string, VarValue> = {},
): string {
  const replay = previousBlocks.map(javascriptBlock).join("\n");
  // Replay may itself consume a value published by another language. Seed the
  // latest cross-language values before replay, then apply them again below so
  // replayed JavaScript cannot overwrite last-writer-wins state.
  const pre = JSON.stringify(seedObject({ ...preSeeds, ...postSeeds }));
  const post = JSON.stringify(seedObject(postSeeds));

  return `const __ocode_ctx = ${pre};
const __ocode_had_console = Object.prototype.hasOwnProperty.call(__ocode_ctx, "console");
const __ocode_saved_console = __ocode_ctx.console;
const __ocode_silent_console = {
  ...console,
  log() {}, error() {}, warn() {}, info() {}, debug() {}, dir() {}, trace() {}, table() {},
  group() {}, groupCollapsed() {}, groupEnd() {}, time() {}, timeLog() {}, timeEnd() {},
};
__ocode_ctx.console = __ocode_silent_console;
${replay}
if (__ocode_had_console) __ocode_ctx.console = __ocode_saved_console;
else delete __ocode_ctx.console;
Object.assign(__ocode_ctx, ${post});
${javascriptBlock(currentBlock)}
`;
}

/** Emit JSON-safe JavaScript values through the same marker protocol as Python and shells. */
export const JAVASCRIPT_VAR_POSTAMBLE = `
const __ocode_snap = {};
for (const [__ocode_key, __ocode_value] of Object.entries(__ocode_ctx)) {
  if (__ocode_key.startsWith("_") || ["function", "symbol", "undefined"].includes(typeof __ocode_value)) continue;
  try {
    const __ocode_json = JSON.stringify(__ocode_value);
    if (__ocode_json !== undefined) __ocode_snap[__ocode_key] = JSON.parse(__ocode_json);
  } catch {
    try { __ocode_snap[__ocode_key] = String(__ocode_value); } catch {}
  }
}
console.log("\\n__OCODE_VARS__=" + JSON.stringify(__ocode_snap));
`;

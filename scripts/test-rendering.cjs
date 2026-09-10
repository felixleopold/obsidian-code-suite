// Run against an open, disposable vault containing the candidate plugin:
// node scripts/test-rendering.cjs code-suite-render-lifecycle-clean
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const vault = process.argv[2];
assert(vault?.startsWith('code-suite-render-'), 'Pass a disposable code-suite-render-* vault name');

async function checkRendering() {
  if (!app.vault.getName().startsWith('code-suite-render-')) throw Error('Not a rendering test vault');
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const check = (condition, message) => { if (!condition) throw Error(message); };
  const results = [];
  const leaves = app.workspace.getLeavesOfType('markdown').slice(0, 2);
  while (leaves.length < 2) leaves.push(app.workspace.getLeaf('split'));
  const open = async (path, source, modes) => {
    let file = app.vault.getAbstractFileByPath(path);
    if (file) await app.vault.modify(file, source);
    else file = await app.vault.create(path, source);
    for (const [index, leaf] of leaves.entries()) {
      await leaf.openFile(file);
      await leaf.setViewState({ type: 'markdown', state: { file: path, mode: modes[index], source: false } });
      if (modes[index] === 'source') leaf.view.editor.setCursor({ line: 0, ch: 0 });
    }
    app.workspace.setActiveLeaf(leaves[0], { focus: true });
    await pause(500);
  };

  const paragraphs = (label, count) => Array.from({ length: count }, (_, i) => `${label} ${i}. Some text.\n`).join('\n');
  await open('Rendering scroll.md', paragraphs('Before', 45) + '\n```python\nprint(1)\n```\n\n' + paragraphs('After', 80), ['source', 'preview']);
  const editor = leaves[0].view.editor, preview = leaves[1].view;
  editor.setCursor({ line: 91, ch: 5 });
  editor.scrollIntoView({ from: { line: 90, ch: 0 }, to: { line: 93, ch: 0 } }, true);
  preview.previewMode.applyScroll(85);
  await pause(400);
  const scroll = preview.previewMode.getScroll(), editorScroll = editor.getScrollInfo().top;
  editor.replaceRange(' static', { line: 90, ch: 9 });
  await pause(600);
  const wrapper = () => preview.contentEl.querySelector('.markdown-preview-view .ocode-wrapper');
  check(Math.abs(preview.previewMode.getScroll() - scroll) < 1, 'Reading view jumped on a fence edit');
  check(Math.abs(editor.getScrollInfo().top - editorScroll) < 2, 'Editing pane jumped');
  check(wrapper()?.classList.contains('ocode-static'), 'Static option stayed stale');
  check(!wrapper().querySelector('.ocode-run-pill'), 'Static block retained Run');
  editor.replaceRange(' title="Updated" ln=false', { line: 90, ch: editor.getLine(90).length });
  await pause(600);
  check(wrapper().querySelector('.ocode-label')?.textContent === 'Updated', 'Title stayed stale');
  check(!wrapper().querySelector('.ocode-line-num'), 'Line number option stayed stale');
  editor.replaceRange('', { line: 90, ch: 9 }, { line: 90, ch: 16 });
  await pause(600);
  check(!!wrapper().querySelector('.ocode-run-pill'), 'Removing static did not restore Run');
  editor.replaceRange('2', { line: 91, ch: 6 }, { line: 91, ch: 7 });
  await pause(600);
  check(wrapper().querySelector('pre')?.textContent.includes('print(2)'), 'Native source rendering stopped updating');
  check(Math.abs(preview.previewMode.getScroll() - scroll) < 1, 'Reading view jumped on a source edit');
  results.push('Split-pane edits preserve scroll and refresh static/title/line numbers/source');

  editor.replaceRange('```javascript\nconsole.log("started"); setTimeout(() => console.log("finished"), 1200);\n```', { line: 90, ch: 0 }, { line: 92, ch: 3 });
  await pause(600);
  wrapper().querySelector('.ocode-run-pill').click();
  await pause(200);
  const runningWrapper = wrapper();
  editor.replaceRange(' title="After running"', { line: 90, ch: editor.getLine(90).length });
  await pause(400);
  check(wrapper() === runningWrapper, 'Formatting replaced a running block');
  for (let attempt = 0; attempt < 30 && !wrapper().querySelector('.ocode-output')?.textContent.includes('finished'); attempt++) await pause(100);
  await pause(200);
  check(wrapper().querySelector('.ocode-output')?.textContent.includes('finished'), 'Formatting lost running output');
  check(wrapper().querySelector('.ocode-label')?.textContent === 'After running', 'Deferred formatting did not settle after execution');
  results.push('Formatting during execution preserves output and updates after completion');

  const block = '```python\nprint(1)\n```\n\n';
  await open('Rendering duplicates.md', '# Duplicates\n\n' + block + block + 'After both blocks.\n', ['source', 'source']);
  const wrappers = leaf => [...leaf.view.contentEl.querySelectorAll('.cm-content .ocode-wrapper')];
  check(leaves.every(leaf => wrappers(leaf).length === 2), 'Duplicate blocks or panes share DOM');
  const second = wrappers(leaves[0])[1];
  second.querySelector('.ocode-header').click();
  const duplicateEditor = leaves[0].view.editor;
  duplicateEditor.replaceRange(' static', { line: 2, ch: 9 });
  duplicateEditor.setCursor({ line: 0, ch: 0 });
  await pause(500);
  check(wrappers(leaves[0])[1] === second && second.classList.contains('ocode-collapsed'), 'Editing first duplicate transferred second block state');
  duplicateEditor.replaceRange(block, { line: 2, ch: 0 });
  duplicateEditor.setCursor({ line: 0, ch: 0 });
  await pause(500);
  check(wrappers(leaves[0])[2] === second, 'Inserting another block lost existing identity');
  duplicateEditor.replaceRange('', { line: 2, ch: 0 }, { line: 6, ch: 0 });
  duplicateEditor.setCursor({ line: 0, ch: 0 });
  await pause(500);
  check(wrappers(leaves[0])[1] === second, 'Deleting another block lost existing identity');
  results.push('Duplicate blocks retain separate DOM and collapse state through edits/insertion/deletion in split panes');

  const large = '# Large block\n\nBefore\n\n```python collapsed\n' + Array.from({ length: 500 }, (_, i) => `print(${i})`).join('\n') + '\n```\n\n' + paragraphs('After', 100);
  await open('Rendering collapse.md', large, ['source', 'preview']);
  for (const [index, leaf] of leaves.entries()) {
    const view = leaf.view;
    if (index === 0) view.editor.scrollTo(0, 0);
    else view.previewMode.applyScroll(0);
    await pause(200);
    const root = view.contentEl.querySelector(index === 0 ? '.cm-content' : '.markdown-preview-view');
    const blockEl = root.querySelector('.ocode-wrapper');
    for (let cycle = 0; cycle < 3; cycle++) {
      blockEl.querySelector('.ocode-header').click();
      await pause(150);
      check(blockEl.getBoundingClientRect().height > 5000, 'Large block did not expand');
      blockEl.querySelector('.ocode-header').click();
      await pause(150);
      const after = [...root.querySelectorAll(index === 0 ? '.cm-line' : '.el-p')].find(el => el.textContent.startsWith('After 0.'));
      check(after && after.getBoundingClientRect().top < innerHeight, 'Content below collapsed block is not rendered in viewport');
      if (index === 0) check(Math.abs(view.editor.cm.contentHeight - root.getBoundingClientRect().height) < 2, 'CodeMirror height map is stale');
    }
  }
  results.push('500-line blocks expand/collapse repeatedly with following content visible and accurate editor height');
  return results;
}

const response = JSON.parse(execFileSync('obsidian', [
  `vault=${vault}`, 'dev:cdp', 'method=Runtime.evaluate',
  `params=${JSON.stringify({ expression: `(${checkRendering.toString()})()`, awaitPromise: true, returnByValue: true })}`,
], { encoding: 'utf8' }));
assert(!response.exceptionDetails, response.exceptionDetails?.exception?.description ?? JSON.stringify(response));
for (const result of response.result.value) console.log(`PASS ${result}`);

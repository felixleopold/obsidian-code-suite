// The README hero clip. Edit this and hero.md, then `npm run record-hero` (macOS).
// Coordinates are CSS pixels of the note pane; targets are a CSS selector or
// { selector, text, index } (selector defaults to headings, paragraphs and code).
const runButton = (index) => ({ selector: ".ocode-run-pill", index });
const downloads = "code.ocode-var-ref";

export default {
  note: "hero.md",
  width: 800,
  height: 860,
  fps: 20,
  cursor: { x: 560, y: 760 },
  // Merged into the plugin's data.json in the throwaway vault.
  plugin: { theme: "gruvbox-dark-medium", demoThemeCycle: true },

  async play({ hold, moveTo, click, select, scrollTo, waitForRun, command }) {
    await hold(700);

    // Point out `$downloads`, run the fetch, and select the number it became.
    await select(downloads);
    await hold(500);
    await moveTo(runButton(0));
    await hold(250);
    await click();
    await hold(600); // Let "Running…" show before the result.
    await waitForRun(0);
    await select(downloads);
    await hold(1600);

    // Cycle themes (gruvbox → catppuccin → dracula → tokyo night → gruvbox).
    await moveTo({ text: "Same Shiki engine" }, { dx: 120 });
    await click(); // Clears the selection.
    for (let i = 0; i < 4; i++) {
      await command("code-suite:demo-cycle-theme");
      await hold(1500);
    }

    // The Python variable, reused in bash.
    await scrollTo({ text: "Reuse variables" });
    await moveTo(runButton(1));
    await hold(250);
    await click();
    await hold(600);
    await waitForRun(1);
    await hold(1300);

    // An inline plot from the same data.
    await moveTo(runButton(2));
    await hold(250);
    await click();
    await hold(600);
    await waitForRun(2);
    await moveTo({ selector: ".ocode-output-img" }, { dx: 200 });
    await hold(4000);
  },
};

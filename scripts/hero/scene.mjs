// The README hero clip. Edit this and hero.md, then `npm run record-hero` (macOS).
// Coordinates are CSS pixels of the note pane; targets are a CSS selector or
// { selector, text, index } (selector defaults to headings, paragraphs and code).
const runButton = (index) => ({ selector: ".ocode-run-pill", index });

export default {
  note: "hero.md",
  width: 800,
  height: 860,
  fps: 20,
  cursor: { x: 560, y: 760 },
  // Merged into the plugin's data.json in the throwaway vault.
  plugin: { theme: "gruvbox-dark-medium", demoThemeCycle: true },

  async play({ hold, moveTo, click, scrollTo, waitForRun, command }) {
    await hold(700);

    // Run the fetch; `$downloads` fills in below.
    await moveTo(runButton(0));
    await hold(250);
    await click();
    await hold(600); // Let "Running…" show before the result.
    await waitForRun(0);
    await moveTo({ text: "Fetched live" }, { dx: -230 });
    await hold(1600);

    // Cycle themes (gruvbox → catppuccin → dracula → gruvbox).
    await moveTo({ text: "Same Shiki engine" }, { dx: 120 });
    for (let i = 0; i < 3; i++) {
      await command("code-suite:demo-cycle-theme");
      await hold(2000);
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
    await scrollTo({ text: "Inline plots" });
    await moveTo(runButton(2));
    await hold(250);
    await click();
    await hold(600);
    await waitForRun(2);
    await moveTo({ selector: ".ocode-output-img" }, { dx: 200 });
    await hold(4000);
  },
};

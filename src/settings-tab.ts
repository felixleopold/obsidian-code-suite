import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type CodePlugin from "./main";
import { BUNDLED_THEMES, type CustomTheme } from "./settings";

export class CodeSettingTab extends PluginSettingTab {
  plugin: CodePlugin;

  constructor(app: App, plugin: CodePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // ─── About ───────────────────────────────────
    const aboutDiv = containerEl.createDiv({ cls: "ocode-settings-about" });
    aboutDiv.createEl("p", {
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      text: "Obsidian Code replaces the default code block rendering with Shiki-powered syntax highlighting \u2014 the same engine used by VS Code. It works in both reading view and editor (live preview / source mode).",
    });
    aboutDiv.createEl("p", {
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      text: "Code execution runs locally on your machine using the language runtimes installed on your system (e.g. python3, node). Output is streamed live and displayed below the code block. No code is sent to any server.",
    });

    // ─── Theme ───────────────────────────────────
    new Setting(containerEl).setName("Theme").setHeading();

    // Build theme options: bundled + custom
    const themeOptions: Record<string, string> = {};

    // Group by category
    const darkThemes: [string, string][] = [];
    const lightThemes: [string, string][] = [];
    for (const [id, name] of Object.entries(BUNDLED_THEMES)) {
      if (name.toLowerCase().includes("light") || ["catppuccin-latte", "slack-ochin", "snazzy-light"].includes(id)) {
        lightThemes.push([id, name]);
      } else {
        darkThemes.push([id, name]);
      }
    }

    // Dark themes first
    for (const [id, name] of darkThemes.sort((a, b) => a[1].localeCompare(b[1]))) {
      themeOptions[id] = name;
    }
    // Then light themes
    for (const [id, name] of lightThemes.sort((a, b) => a[1].localeCompare(b[1]))) {
      themeOptions[id] = `${name} ☀`;
    }
    // Then custom themes
    for (const ct of this.plugin.settings.customThemes) {
      const id = ct.name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
      themeOptions[id] = `${ct.name} (custom)`;
    }

    new Setting(containerEl)
      .setName("Syntax theme")
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      .setDesc("Color scheme for code blocks. Applies to both reading view and editor. 65 built-in themes from VS Code / Shiki, plus any custom themes you import below.")
      .addDropdown((dropdown) => {
        for (const [value, name] of Object.entries(themeOptions)) {
          dropdown.addOption(value, name);
        }
        dropdown.setValue(this.plugin.settings.theme);
        dropdown.onChange(async (value) => {
          this.plugin.settings.theme = value;
          await this.plugin.saveSettings();
          this.plugin.applyThemeColors();
          await this.plugin.refreshHighlighter();
        });
      });

    // ─── Custom Theme Import ─────────────────────
    new Setting(containerEl)
      .setName("Import VS Code theme")
      .setDesc("Import a VS Code / TextMate color theme (.json). Find themes at https://vscodethemes.com or export from VS Code (Ctrl+Shift+P → \"Generate Color Theme From Current Settings\").")
      .addButton((btn) => {
        // eslint-disable-next-line obsidianmd/ui/sentence-case
        btn.setButtonText("Import .json file");
        btn.onClick(() => {
          const input = document.createElement("input");
          input.type = "file";
          input.accept = ".json";
          input.addEventListener("change", () => {
            void (async () => {
              const file = input.files?.[0];
              if (!file) return;
              try {
                const text = await file.text();
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                const json = JSON.parse(text);
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                const name: string = json.name || file.name.replace(/\.json$/, "");
                const customTheme: CustomTheme = { name, json: text };
                // Load into highlighter
                const id = this.plugin.highlighter.loadCustomTheme(customTheme);
                if (!id) {
                  new Notice("Failed to load theme — invalid format.");
                  return;
                }
                // Save and select
                this.plugin.settings.customThemes.push(customTheme);
                this.plugin.settings.theme = id;
                await this.plugin.saveSettings();
                this.plugin.applyThemeColors();
                new Notice(`Theme "${name}" imported and activated.`);
                this.display(); // Refresh the settings UI
              } catch {
                new Notice("Failed to parse theme file. Make sure it's a valid VS Code theme JSON.");
              }
            })();
          });
          input.click();
        });
      });

    // List existing custom themes with delete buttons
    if (this.plugin.settings.customThemes.length > 0) {
      for (const ct of this.plugin.settings.customThemes) {
        new Setting(containerEl)
          .setName(ct.name)
          .setDesc("Custom imported theme")
          .addButton((btn) => {
            btn.setButtonText("Remove");
            btn.setWarning();
            btn.onClick(async () => {
              this.plugin.settings.customThemes = this.plugin.settings.customThemes.filter((t) => t.name !== ct.name);
              // If this was the active theme, switch to default
              const id = ct.name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
              if (this.plugin.settings.theme === id) {
                this.plugin.settings.theme = "gruvbox-dark-hard";
              }
              await this.plugin.saveSettings();
              this.plugin.applyThemeColors();
              await this.plugin.refreshHighlighter();
              this.display();
            });
          });
      }
    }

    // ─── Appearance ──────────────────────────────
    new Setting(containerEl).setName("Appearance").setHeading();

    new Setting(containerEl)
      .setName("Line numbers")
      .setDesc("Show line numbers in code blocks (reading view only).")
      .addToggle((t) => {
        t.setValue(this.plugin.settings.showLineNumbers);
        t.onChange(async (v) => { this.plugin.settings.showLineNumbers = v; await this.plugin.saveSettings(); });
      });

    new Setting(containerEl)
      .setName("Language label")
      .setDesc("Show the language name in the code block header bar.")
      .addToggle((t) => {
        t.setValue(this.plugin.settings.showLanguageLabel);
        t.onChange(async (v) => { this.plugin.settings.showLanguageLabel = v; await this.plugin.saveSettings(); });
      });

    new Setting(containerEl)
      .setName("Wide code blocks")
      .setDesc("Allow code blocks to extend beyond the normal content width for more horizontal space.")
      .addToggle((t) => {
        t.setValue(this.plugin.settings.wideCodeBlocks);
        t.onChange(async (v) => {
          this.plugin.settings.wideCodeBlocks = v;
          await this.plugin.saveSettings();
          document.body.toggleClass("ocode-wide-blocks", v);
        });
      });

    // ─── Code Execution ──────────────────────────
    new Setting(containerEl).setName("Code execution").setHeading();

    const execDesc = containerEl.createDiv({ cls: "setting-item-description ocode-exec-desc" });
    execDesc.appendText("Code runs ");
    // eslint-disable-next-line obsidianmd/ui/sentence-case
    execDesc.createEl("b", { text: "locally on your machine" });
    execDesc.appendText(" using your installed language runtimes. Supported: Python (");
    // eslint-disable-next-line obsidianmd/ui/sentence-case
    execDesc.createEl("code", { text: "python3" });
    execDesc.appendText("), JavaScript (");
    // eslint-disable-next-line obsidianmd/ui/sentence-case
    execDesc.createEl("code", { text: "node" });
    execDesc.appendText("), TypeScript (");
    // eslint-disable-next-line obsidianmd/ui/sentence-case
    execDesc.createEl("code", { text: "npx ts-node" });
    execDesc.appendText("), Bash/Shell. The process runs in a child process with your system PATH. Output (stdout/stderr) streams live into the output panel. You can send stdin input while the program is running.");

    new Setting(containerEl)
      .setName("Enable code execution")
      .setDesc("Show a run button on code blocks for supported languages. Desktop only.")
      .addToggle((t) => {
        t.setValue(this.plugin.settings.enableExecution);
        t.onChange(async (v) => { this.plugin.settings.enableExecution = v; await this.plugin.saveSettings(); });
      });

    new Setting(containerEl)
      .setName("Execution timeout")
      .setDesc("Maximum seconds before a running process is automatically killed.")
      .addSlider((s) => {
        s.setLimits(5, 120, 5);
        s.setValue(this.plugin.settings.executionTimeout / 1000);
        s.setDynamicTooltip();
        s.onChange(async (v) => { this.plugin.settings.executionTimeout = v * 1000; await this.plugin.saveSettings(); });
      });

    // ─── Environment ─────────────────────────────
    new Setting(containerEl).setName("Environment").setHeading();

    new Setting(containerEl)
      .setName("Python path")
      .setDesc("Absolute path to Python binary or virtualenv (e.g. /path/to/venv/bin/python3). Leave empty to use the system default.")
      .addText((t) => {
        // eslint-disable-next-line obsidianmd/ui/sentence-case
        t.setPlaceholder("python3");
        t.setValue(this.plugin.settings.pythonPath);
        t.onChange(async (v) => { this.plugin.settings.pythonPath = v.trim(); await this.plugin.saveSettings(); });
      });

    new Setting(containerEl)
      .setName("Node.js path")
      .setDesc("Absolute path to Node.js binary. Leave empty to use the system default.")
      .addText((t) => {
        // eslint-disable-next-line obsidianmd/ui/sentence-case
        t.setPlaceholder("node");
        t.setValue(this.plugin.settings.nodePath);
        t.onChange(async (v) => { this.plugin.settings.nodePath = v.trim(); await this.plugin.saveSettings(); });
      });

    new Setting(containerEl)
      .setName("Extra environment variables")
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      .setDesc("Additional environment variables passed to executed code (one KEY=VALUE per line). Useful for PYTHONPATH, API keys, etc.")
      .addTextArea((t) => {
        // eslint-disable-next-line obsidianmd/ui/sentence-case
        t.setPlaceholder("PYTHONPATH=/path/to/libs\nMY_VAR=value");
        t.setValue(this.plugin.settings.extraEnv);
        t.inputEl.rows = 4;
        t.inputEl.cols = 40;
        t.onChange(async (v) => { this.plugin.settings.extraEnv = v; await this.plugin.saveSettings(); });
      });

    // ─── Embedded Files ──────────────────────────
    new Setting(containerEl).setName("Embedded code files").setHeading();

    new Setting(containerEl)
      .setName("Render embedded code files")
      .setDesc("Render ![[file.py]] embeds as fully syntax-highlighted code blocks with the same theme, instead of Obsidian's default plain text rendering.")
      .addToggle((t) => {
        t.setValue(this.plugin.settings.renderEmbeddedFiles);
        t.onChange(async (v) => { this.plugin.settings.renderEmbeddedFiles = v; await this.plugin.saveSettings(); });
      });

    new Setting(containerEl)
      .setName("Collapse embedded files")
      .setDesc("Show embedded code files collapsed by default. Click the header bar to expand/collapse.")
      .addToggle((t) => {
        t.setValue(this.plugin.settings.collapseEmbeds);
        t.onChange(async (v) => { this.plugin.settings.collapseEmbeds = v; await this.plugin.saveSettings(); });
      });
  }
}

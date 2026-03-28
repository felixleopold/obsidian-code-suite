import { App, PluginSettingTab, Setting } from "obsidian";
import type CodePlugin from "./main";
import { THEME_NAMES, type GruvboxVariant } from "./settings";

export class CodeSettingTab extends PluginSettingTab {
  plugin: CodePlugin;

  constructor(app: App, plugin: CodePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // ─── Appearance ──────────────────────────────
    containerEl.createEl("h3", { text: "Appearance" });

    new Setting(containerEl)
      .setName("Theme")
      .setDesc("Gruvbox theme variant for code blocks.")
      .addDropdown((dropdown) => {
        for (const [value, name] of Object.entries(THEME_NAMES)) {
          dropdown.addOption(value, name);
        }
        dropdown.setValue(this.plugin.settings.theme);
        dropdown.onChange(async (value) => {
          this.plugin.settings.theme = value as GruvboxVariant;
          await this.plugin.saveSettings();
          this.plugin.refreshHighlighter();
        });
      });

    new Setting(containerEl)
      .setName("Line numbers")
      .setDesc("Show line numbers in code blocks.")
      .addToggle((t) => {
        t.setValue(this.plugin.settings.showLineNumbers);
        t.onChange(async (v) => { this.plugin.settings.showLineNumbers = v; await this.plugin.saveSettings(); });
      });

    new Setting(containerEl)
      .setName("Language label")
      .setDesc("Show language badge on code blocks.")
      .addToggle((t) => {
        t.setValue(this.plugin.settings.showLanguageLabel);
        t.onChange(async (v) => { this.plugin.settings.showLanguageLabel = v; await this.plugin.saveSettings(); });
      });

    new Setting(containerEl)
      .setName("Wide code blocks")
      .setDesc("Allow code blocks to use more horizontal space than regular content.")
      .addToggle((t) => {
        t.setValue(this.plugin.settings.wideCodeBlocks);
        t.onChange(async (v) => {
          this.plugin.settings.wideCodeBlocks = v;
          await this.plugin.saveSettings();
          document.body.toggleClass("ocode-wide-blocks", v);
        });
      });

    // ─── Code Execution ──────────────────────────
    containerEl.createEl("h3", { text: "Code Execution" });

    new Setting(containerEl)
      .setName("Enable code execution")
      .setDesc("Show run button on code blocks for supported languages.")
      .addToggle((t) => {
        t.setValue(this.plugin.settings.enableExecution);
        t.onChange(async (v) => { this.plugin.settings.enableExecution = v; await this.plugin.saveSettings(); });
      });

    new Setting(containerEl)
      .setName("Execution timeout")
      .setDesc("Max seconds before a running process is killed.")
      .addSlider((s) => {
        s.setLimits(5, 120, 5);
        s.setValue(this.plugin.settings.executionTimeout / 1000);
        s.setDynamicTooltip();
        s.onChange(async (v) => { this.plugin.settings.executionTimeout = v * 1000; await this.plugin.saveSettings(); });
      });

    // ─── Environment ─────────────────────────────
    containerEl.createEl("h3", { text: "Environment" });

    new Setting(containerEl)
      .setName("Python path")
      .setDesc("Path to Python binary or virtualenv python (e.g. /path/to/venv/bin/python3). Leave empty for system default.")
      .addText((t) => {
        t.setPlaceholder("python3");
        t.setValue(this.plugin.settings.pythonPath);
        t.onChange(async (v) => { this.plugin.settings.pythonPath = v.trim(); await this.plugin.saveSettings(); });
      });

    new Setting(containerEl)
      .setName("Node.js path")
      .setDesc("Path to Node.js binary. Leave empty for system default.")
      .addText((t) => {
        t.setPlaceholder("node");
        t.setValue(this.plugin.settings.nodePath);
        t.onChange(async (v) => { this.plugin.settings.nodePath = v.trim(); await this.plugin.saveSettings(); });
      });

    new Setting(containerEl)
      .setName("Extra environment variables")
      .setDesc("Additional environment variables for code execution (one KEY=VALUE per line). Useful for PYTHONPATH, etc.")
      .addTextArea((t) => {
        t.setPlaceholder("PYTHONPATH=/path/to/libs\nMY_VAR=value");
        t.setValue(this.plugin.settings.extraEnv);
        t.inputEl.rows = 4;
        t.inputEl.cols = 40;
        t.onChange(async (v) => { this.plugin.settings.extraEnv = v; await this.plugin.saveSettings(); });
      });

    // ─── Embedded Files ──────────────────────────
    containerEl.createEl("h3", { text: "Embedded Code Files" });

    new Setting(containerEl)
      .setName("Render embedded code files")
      .setDesc("Render ![[file.py]] embeds as syntax-highlighted code blocks.")
      .addToggle((t) => {
        t.setValue(this.plugin.settings.renderEmbeddedFiles);
        t.onChange(async (v) => { this.plugin.settings.renderEmbeddedFiles = v; await this.plugin.saveSettings(); });
      });
  }
}

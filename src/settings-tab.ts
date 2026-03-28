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

    // --- Theme ---
    new Setting(containerEl)
      .setName("Theme")
      .setDesc("Choose which Gruvbox theme variant to use for code blocks.")
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

    // --- Line Numbers ---
    new Setting(containerEl)
      .setName("Line numbers")
      .setDesc("Show line numbers in code blocks.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.showLineNumbers);
        toggle.onChange(async (value) => {
          this.plugin.settings.showLineNumbers = value;
          await this.plugin.saveSettings();
        });
      });

    // --- Language Label ---
    new Setting(containerEl)
      .setName("Language label")
      .setDesc("Show a language badge in the top-right corner of code blocks.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.showLanguageLabel);
        toggle.onChange(async (value) => {
          this.plugin.settings.showLanguageLabel = value;
          await this.plugin.saveSettings();
        });
      });

    // --- Wide Code Blocks ---
    new Setting(containerEl)
      .setName("Wide code blocks")
      .setDesc("Allow code blocks to use more horizontal space than regular content.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.wideCodeBlocks);
        toggle.onChange(async (value) => {
          this.plugin.settings.wideCodeBlocks = value;
          await this.plugin.saveSettings();
          document.body.toggleClass("ocode-wide-blocks", value);
        });
      });

    // --- Code Execution ---
    containerEl.createEl("h3", { text: "Code Execution" });

    new Setting(containerEl)
      .setName("Enable code execution")
      .setDesc("Show a run button on code blocks for supported languages (Python, JavaScript, Bash, etc.).")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.enableExecution);
        toggle.onChange(async (value) => {
          this.plugin.settings.enableExecution = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Execution timeout")
      .setDesc("Maximum time in seconds before a running process is killed.")
      .addSlider((slider) => {
        slider.setLimits(5, 120, 5);
        slider.setValue(this.plugin.settings.executionTimeout / 1000);
        slider.setDynamicTooltip();
        slider.onChange(async (value) => {
          this.plugin.settings.executionTimeout = value * 1000;
          await this.plugin.saveSettings();
        });
      });

    // --- Embedded Files ---
    containerEl.createEl("h3", { text: "Embedded Code Files" });

    new Setting(containerEl)
      .setName("Render embedded code files")
      .setDesc("Render ![[file.py]] embeds as syntax-highlighted code blocks instead of plain text.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.renderEmbeddedFiles);
        toggle.onChange(async (value) => {
          this.plugin.settings.renderEmbeddedFiles = value;
          await this.plugin.saveSettings();
        });
      });
  }
}

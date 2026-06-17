import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type CodePlugin from "./main";
import { BUNDLED_THEMES, type CustomTheme, type ExecutionCwdMode } from "./settings";

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
    aboutDiv.createEl("p").textContent = "Replaces the default code block rendering with VS Code-quality syntax highlighting. Works in both reading view and editor (live preview / source mode)."
    aboutDiv.createEl("p").textContent = "Code execution runs locally on your machine using the language runtimes installed on your system (e.g python3, node). Output is streamed live and displayed below the code block. No code is sent to any server."

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

    // Dark themes first (☾), then light themes (☀)
    for (const [id, name] of darkThemes.sort((a, b) => a[1].localeCompare(b[1]))) {
      themeOptions[id] = `${name} ☾`;
    }
    for (const [id, name] of lightThemes.sort((a, b) => a[1].localeCompare(b[1]))) {
      themeOptions[id] = `${name} ☀`;
    }
    // Then custom themes
    for (const ct of this.plugin.settings.customThemes) {
      const id = ct.name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
      themeOptions[id] = `${ct.name} (custom)`;
    }

    // ─── Auto-theme toggle (always first) ────────
    new Setting(containerEl)
      .setName("Auto-switch theme")
      .setDesc("Automatically switch between a dark and a light theme when Obsidian's appearance changes.")
      .addToggle((t) => {
        t.setValue(this.plugin.settings.autoTheme);
        t.onChange(async (v) => {
          this.plugin.settings.autoTheme = v;
          await this.plugin.saveSettings();
          if (v) this.plugin.applyAutoTheme();
          this.display();
        });
      });

    if (this.plugin.settings.autoTheme) {
      // When auto-switching is on, show dark + light pickers (hide the single theme picker)
      new Setting(containerEl)
        .setName("Dark mode theme")
        .setDesc("Used when Obsidian is in dark mode.")
        .addDropdown((dropdown) => {
          for (const [value, name] of Object.entries(themeOptions)) {
            dropdown.addOption(value, name);
          }
          dropdown.setValue(this.plugin.settings.darkAutoTheme);
          dropdown.onChange(async (value) => {
            this.plugin.settings.darkAutoTheme = value;
            // Only apply immediately when currently in dark mode — applying the
            // wrong-mode theme produces incorrect colors until mode switches.
            const isDark = activeDocument.body.classList.contains("theme-dark");
            if (isDark) {
              this.plugin.settings.theme = value;
            }
            await this.plugin.saveSettings();
            if (isDark) {
              this.plugin.applyThemeColors();
              await this.plugin.refreshHighlighter();
            }
          });
        });

      new Setting(containerEl)
        .setName("Light mode theme")
        .setDesc("Used when Obsidian is in light mode.")
        .addDropdown((dropdown) => {
          for (const [value, name] of Object.entries(themeOptions)) {
            dropdown.addOption(value, name);
          }
          dropdown.setValue(this.plugin.settings.lightAutoTheme);
          dropdown.onChange(async (value) => {
            this.plugin.settings.lightAutoTheme = value;
            const isDark = activeDocument.body.classList.contains("theme-dark");
            if (!isDark) {
              this.plugin.settings.theme = value;
            }
            await this.plugin.saveSettings();
            if (!isDark) {
              this.plugin.applyThemeColors();
              await this.plugin.refreshHighlighter();
            }
          });
        });
    } else {
      // When auto-switching is off, show the single theme picker
      const themeSetting = new Setting(containerEl)
        .setName("Syntax theme")
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
      themeSetting.descEl["textContent"] = "Color scheme for code blocks. Applies to both reading view and editor. 65 built-in themes from VS Code / Shiki, plus any custom themes you import below.";
    }

    // ─── Custom Theme Import ─────────────────────
    new Setting(containerEl)
      .setName("Import VS Code theme")
      .setDesc("Import a VS Code / TextMate color theme (.json). Find themes at https://vscodethemes.com or export from VS Code (Ctrl+Shift+P → \"Generate Color Theme From Current Settings\").")
      .addButton((btn) => {
        btn.buttonEl.textContent = "Import JSON file";
        btn.onClick(() => {
          const input = createEl("input");
          input.type = "file";
          input.accept = ".json";
          input.addEventListener("change", () => {
            void (async () => {
              const file = input.files?.[0];
              if (!file) return;
              try {
                const text = await file.text();
                const json = JSON.parse(text) as { name?: string };
                const name: string = (typeof json.name === "string" && json.name) || file.name.replace(/\.json$/, "");
                const customTheme: CustomTheme = { name, json: text };
                // Load into highlighter
                const id = this.plugin.highlighter.loadCustomTheme(customTheme);
                if (!id) {
                  new Notice("Failed to load theme: invalid format.");
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
        t.onChange(async (v) => {
          this.plugin.settings.showLineNumbers = v;
          activeDocument.body.toggleClass("ocode-lp-lnum", v);
          await this.plugin.saveSettings();
        });
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
          activeDocument.body.toggleClass("ocode-wide-blocks", v);
        });
      });

    new Setting(containerEl)
      .setName("Soft-wrap long lines")
      .setDesc("Wrap long lines in reading view instead of showing a horizontal scrollbar, matching the editor's behavior.")
      .addToggle((t) => {
        t.setValue(this.plugin.settings.wrapCodeInReadingView);
        t.onChange(async (v) => {
          this.plugin.settings.wrapCodeInReadingView = v;
          await this.plugin.saveSettings();
          activeDocument.body.toggleClass("ocode-wrap-code", v);
        });
      });

    new Setting(containerEl)
      .setName("Render HTML blocks")
      .setDesc(
        "Show html code blocks as a live preview by default instead of their source. " +
        "Override per block with a `preview` or `source` flag on the fence (e.g. ```html preview). " +
        "Either way the block gets a Preview/Code toggle."
      )
      .addToggle((t) => {
        t.setValue(this.plugin.settings.renderHtmlBlocks);
        t.onChange(async (v) => {
          this.plugin.settings.renderHtmlBlocks = v;
          await this.plugin.saveSettings();
          this.plugin.refreshRenderedBlocks();
        });
      });

    // ─── Code Execution ──────────────────────────
    new Setting(containerEl).setName("Code execution").setHeading();

    const execDesc = containerEl.createDiv({ cls: "setting-item-description ocode-exec-desc" });
    execDesc.appendText("Code runs ");
    execDesc.createEl("b").appendChild(activeDocument.createTextNode("locally on your machine"));
    execDesc.appendText(" using your installed language runtimes. Supported: Python (");
    execDesc.createEl("code").appendChild(activeDocument.createTextNode("python3"));
    execDesc.appendText("), JavaScript (");
    execDesc.createEl("code").appendChild(activeDocument.createTextNode("node"));
    execDesc.appendText("), TypeScript (");
    execDesc.createEl("code").appendChild(activeDocument.createTextNode("npx tsx"));
    execDesc.appendText("), PowerShell (");
    execDesc.createEl("code").appendChild(activeDocument.createTextNode("pwsh"));
    execDesc.appendText("), Bash/Shell. The process runs in a child process with your system PATH. Output (stdout/stderr) streams live into the output panel. You can send stdin input while the program is running.");

    new Setting(containerEl)
      .setName("Enable code execution")
      .setDesc("Show a run button on code blocks for supported languages. Desktop only.")
      .addToggle((t) => {
        t.setValue(this.plugin.settings.enableExecution);
        t.onChange(async (v) => { this.plugin.settings.enableExecution = v; await this.plugin.saveSettings(); });
      });

    new Setting(containerEl)
      .setName("Show clear-session button")
      .setDesc("Show the 'Clear execution session' button in the note header bar. Disable to declutter the tab bar — the 'Clear execution session for this note' command still works. Desktop only; never shown on mobile.")
      .addToggle((t) => {
        t.setValue(this.plugin.settings.showClearSessionButton);
        t.onChange(async (v) => {
          this.plugin.settings.showClearSessionButton = v;
          await this.plugin.saveSettings();
          this.plugin.refreshViewActions();
        });
      });

    new Setting(containerEl)
      .setName("Shared execution context")
      .setDesc("When enabled, each code block you run accumulates into a per-note session. Later blocks can reference variables defined in earlier blocks (Python, Bash, and Zsh). The session is note-specific, lives in memory only, and resets when Obsidian is closed. Use the 'Clear execution session' command to reset manually. Run blocks top-to-bottom — order matters.")
      .addToggle((t) => {
        t.setValue(this.plugin.settings.sharedContext);
        t.onChange(async (v) => { this.plugin.settings.sharedContext = v; await this.plugin.saveSettings(); });
      });

    new Setting(containerEl)
      .setName("Execution timeout")
      .setDesc("Maximum seconds before a running process is automatically killed.")
      .addSlider((s) => {
        s.setLimits(5, 300, 5);
        s.setValue(this.plugin.settings.executionTimeout / 1000);
        s.setDynamicTooltip();
        s.onChange(async (v) => { this.plugin.settings.executionTimeout = v * 1000; await this.plugin.saveSettings(); });
      });

    new Setting(containerEl)
      .setName("Interactive plots")
      .setDesc("Render Plotly figures as interactive HTML widgets (zoom, pan, hover, legend toggles) instead of static images. The static fallback needs the 'kaleido' package; the interactive path does not. Matplotlib figures are always static images.")
      .addToggle((t) => {
        t.setValue(this.plugin.settings.interactivePlots);
        t.onChange(async (v) => {
          this.plugin.settings.interactivePlots = v;
          await this.plugin.saveSettings();
          this.display();
        });
      });

    if (this.plugin.settings.interactivePlots) {
      new Setting(containerEl)
        .setName("Embed Plotly.js offline")
        .setDesc("Bundle the Plotly.js library inline with each interactive plot so it renders without internet. Produces larger output; when off, the library is loaded from a CDN.")
        .addToggle((t) => {
          t.setValue(this.plugin.settings.embedPlotlyJs);
          t.onChange(async (v) => { this.plugin.settings.embedPlotlyJs = v; await this.plugin.saveSettings(); });
        });
    }

    new Setting(containerEl)
      .setName("Matplotlib style")
      .setDesc("Style applied to all Matplotlib plots. Use a built-in name (e.g. dark_background, seaborn-v0_8-darkgrid) or an absolute path to a .mplstyle file. Leave blank for Matplotlib defaults.")
      .addText((t) => {
        t.setValue(this.plugin.settings.matplotlibStyle);
        t.onChange(async (v) => { this.plugin.settings.matplotlibStyle = v.trim(); await this.plugin.saveSettings(); });
      });

    // ─── Working Directory ───────────────────────
    const cwdOptions: Record<ExecutionCwdMode, string> = {
      vault: "Vault root",
      home: "Home directory",
      custom: "Custom path",
    };

    new Setting(containerEl)
      .setName("Working directory")
      .setDesc("Directory code executes in. The vault root is recommended so scripts can access vault files with relative paths.")
      .addDropdown((dropdown) => {
        for (const [value, label] of Object.entries(cwdOptions)) {
          dropdown.addOption(value, label);
        }
        dropdown.setValue(this.plugin.settings.executionCwd);
        dropdown.onChange(async (value) => {
          this.plugin.settings.executionCwd = value as ExecutionCwdMode;
          await this.plugin.saveSettings();
          this.display();
        });
      });

    if (this.plugin.settings.executionCwd === "custom") {
      new Setting(containerEl)
        .setName("Custom working directory")
        .setDesc("Absolute path to use as the working directory for code execution.")
        .addText((t) => {
          t.inputEl["placeholder"] = "/path/to/directory";
          t.setValue(this.plugin.settings.executionCwdCustom);
          t.onChange(async (v) => { this.plugin.settings.executionCwdCustom = v.trim(); await this.plugin.saveSettings(); });
        });
    }

    // ─── Environment ─────────────────────────────
    new Setting(containerEl).setName("Environment").setHeading();

    new Setting(containerEl)
      .setName("Python path")
      .setDesc("Absolute path to Python binary or virtualenv (e.g. /path/to/venv/bin/python3). When pointing to a venv, its tools (pip, playwright, etc.) are available to all languages including bash.")
      .addText((t) => {
        t.inputEl["placeholder"] = "python3";
        t.setValue(this.plugin.settings.pythonPath);
        t.onChange(async (v) => { this.plugin.settings.pythonPath = v.trim(); await this.plugin.saveSettings(); });
      });

    new Setting(containerEl)
      .setName("Node.js path")
      .setDesc("Absolute path to Node.js binary. Leave empty to use the system default.")
      .addText((t) => {
        t.inputEl["placeholder"] = "node";
        t.setValue(this.plugin.settings.nodePath);
        t.onChange(async (v) => { this.plugin.settings.nodePath = v.trim(); await this.plugin.saveSettings(); });
      });

    new Setting(containerEl)
      .setName("Bash path")
      .setDesc("Absolute path to the bash executable, used by `bash` code blocks. Leave empty to resolve `bash` via PATH (e.g. /opt/homebrew/bin/bash on Apple Silicon).")
      .addText((t) => {
        t.inputEl["placeholder"] = "bash";
        t.setValue(this.plugin.settings.bashPath);
        t.onChange(async (v) => { this.plugin.settings.bashPath = v.trim(); await this.plugin.saveSettings(); });
      });

    new Setting(containerEl)
      .setName("Zsh path")
      .setDesc("Absolute path to the zsh executable. Leave empty to resolve `zsh` via PATH (typically /bin/zsh on macOS). Must point at a zsh-compatible binary — variable tracking emits zsh syntax, so pointing this at bash will fail.")
      .addText((t) => {
        t.inputEl["placeholder"] = "zsh";
        t.setValue(this.plugin.settings.zshPath);
        t.onChange(async (v) => { this.plugin.settings.zshPath = v.trim(); await this.plugin.saveSettings(); });
      });

    new Setting(containerEl)
      .setName("Shell (sh) path")
      .setDesc("Absolute path used by `shell` and `sh` code blocks. Defaults to /bin/sh (POSIX sh). Point at /opt/homebrew/bin/bash if you want these blocks to run under modern bash.")
      .addText((t) => {
        t.inputEl["placeholder"] = "sh";
        t.setValue(this.plugin.settings.shPath);
        t.onChange(async (v) => { this.plugin.settings.shPath = v.trim(); await this.plugin.saveSettings(); });
      });

    new Setting(containerEl)
      .setName("Auto-prepend php opening tag")
      .setDesc("Run php snippets that omit an opening <?php tag by adding one at execution time. The note text is not changed.")
      .addToggle((t) => {
        t.setValue(this.plugin.settings.autoPrependPhpOpenTag);
        t.onChange(async (v) => { this.plugin.settings.autoPrependPhpOpenTag = v; await this.plugin.saveSettings(); });
      });

    new Setting(containerEl)
      .setName("Run bash/zsh as login shell")
      .setDesc("Run Bash and Zsh executions in login mode so startup files can initialize PATH, aliases, and functions.")
      .addToggle((t) => {
        t.setValue(this.plugin.settings.shellLogin);
        t.onChange(async (v) => { this.plugin.settings.shellLogin = v; await this.plugin.saveSettings(); });
      });

    const sourceSetting = new Setting(containerEl)
      .setName("Shell source files")
      .addTextArea((t) => {
        t.inputEl["placeholder"] = "/Users/you/.bashrc\n/Users/you/.config/codesuite/env.sh";
        t.setValue(this.plugin.settings.shellSourceFiles);
        t.inputEl.rows = 3;
        t.inputEl.cols = 40;
        t.onChange(async (v) => { this.plugin.settings.shellSourceFiles = v; await this.plugin.saveSettings(); });
      });
    sourceSetting.descEl["textContent"] = "Absolute paths to files sourced before Bash, Zsh, and Shell blocks run, one per line. Lines starting with # are ignored.";

    const envSetting = new Setting(containerEl)
      .setName("Extra environment variables")
      .addTextArea((t) => {
        t.inputEl["placeholder"] = "PYTHONPATH=/path/to/libs\nMY_VAR=value";
        t.setValue(this.plugin.settings.extraEnv);
        t.inputEl.rows = 4;
        t.inputEl.cols = 40;
        t.onChange(async (v) => { this.plugin.settings.extraEnv = v; await this.plugin.saveSettings(); });
      });
    envSetting.descEl["textContent"] = "Additional environment variables passed to executed code (one KEY=VALUE per line). Useful for PYTHONPATH, API keys, etc.";

    new Setting(containerEl)
      .setName(".env file path")
      .setDesc("Absolute path to a .env file. Variables are loaded into the process environment at execution time. Values from \"Extra environment variables\" (and frontmatter) override anything declared here, so a shared project .env can be mixed with per-note overrides.")
      .addText((t) => {
        t.inputEl["placeholder"] = "/path/to/project/.env";
        t.setValue(this.plugin.settings.envFilePath);
        t.onChange(async (v) => { this.plugin.settings.envFilePath = v.trim(); await this.plugin.saveSettings(); });
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

    new Setting(containerEl)
      .setName("Collapsible inline code blocks")
      .setDesc("Add a collapse toggle to inline code blocks in reading view. Click the header to expand/collapse.")
      .addToggle((t) => {
        t.setValue(this.plugin.settings.inlineCollapsible);
        t.onChange(async (v) => { this.plugin.settings.inlineCollapsible = v; await this.plugin.saveSettings(); this.display(); });
      });

    if (this.plugin.settings.inlineCollapsible) {
      new Setting(containerEl)
        .setName("Collapse inline blocks by default")
        .setDesc("Start all inline code blocks collapsed. Reading view only.")
        .addToggle((t) => {
          t.setValue(this.plugin.settings.inlineCollapsedByDefault);
          t.onChange(async (v) => { this.plugin.settings.inlineCollapsedByDefault = v; await this.plugin.saveSettings(); });
        });
    }

    // ─── Vault code files ───────────────────────
    new Setting(containerEl).setName("Vault code files").setHeading();

    new Setting(containerEl)
      .setName("Show code files in the file explorer")
      .setDesc("Register code file extensions (.py, .js, .sh, etc.) with Obsidian so they appear in the file explorer sidebar and open in CodeSuite's lightweight editor. Requires Obsidian restart to take effect when toggled.")
      .addToggle((t) => {
        t.setValue(this.plugin.settings.enableCodeFileView);
        t.onChange(async (v) => { this.plugin.settings.enableCodeFileView = v; await this.plugin.saveSettings(); new Notice("Restart Obsidian for this change to take effect."); });
      });

    new Setting(containerEl)
      .setName("Imports folder")
      .setDesc("Vault-relative folder used by \"Import code file as alias\". The folder is created on demand. Defaults to CodeSuiteImports.")
      .addText((t) => {
        t.inputEl["placeholder"] = "CodeSuiteImports";
        t.setValue(this.plugin.settings.codeImportsFolder);
        t.onChange(async (v) => { this.plugin.settings.codeImportsFolder = v.trim(); await this.plugin.saveSettings(); });
      });

    // ─── Experimental features ───────────────────────
    new Setting(containerEl).setName("Experimental features").setHeading();

    new Setting(containerEl)
      .setName("Data tables")
      .setDesc("Expose markdown tables to code as variables. Put a %% codesuite: <name> as <shape> %% directive (shapes: records, dict, columns, matrix, vars) on the line directly above a table, or use a 'var | value' header for a vars table. Off by default — behaviour may change in future releases.")
      .addToggle((t) => {
        t.setValue(this.plugin.settings.experimentalTables);
        t.onChange(async (v) => { this.plugin.settings.experimentalTables = v; await this.plugin.saveSettings(); });
      });

    // ─── Sharing: baked outputs ──────────────────────
    // Advanced, off by default — most users never need this. Baking writes a
    // code block's captured output into the note markdown so it shows up in
    // contexts that only read the raw .md (e.g. notes shared via NoteColab,
    // whose web viewer has no CodeSuite to re-run the code).
    new Setting(containerEl).setName("Sharing (baked outputs)").setHeading();

    const bakedDesc = containerEl.createDiv({ cls: "ocode-settings-about" });
    bakedDesc.createEl("p").textContent =
      "Normally execution output lives only in memory and never touches your note. The bake command serializes the current output of each code block into a hidden codesuite-output block right after it, so the output survives anywhere the note is read as plain Markdown — most importantly in shared notes, where the recipient can't run your code.";
    bakedDesc.createEl("p").textContent =
      "When enabled, two commands appear: \"Bake code outputs into note\" and \"Clear baked outputs from note\". Run your code blocks first, then bake.";

    new Setting(containerEl)
      .setName("Enable baked outputs")
      .setDesc("Adds the bake/clear commands and renders baked codesuite-output blocks as output panels. Leave off if you don't share notes with code output.")
      .addToggle((t) => {
        t.setValue(this.plugin.settings.bakedOutputs);
        t.onChange(async (v) => {
          this.plugin.settings.bakedOutputs = v;
          await this.plugin.saveSettings();
          this.display(); // reveal/hide the dependent settings below
        });
      });

    if (this.plugin.settings.bakedOutputs) {
      new Setting(containerEl)
        .setName("Baked figures folder")
        .setDesc("Vault-relative folder where baked figures (e.g. matplotlib PNGs) are written. Keeping figures as files instead of inlining them keeps notes small. Created on demand.")
        .addText((t) => {
          t.inputEl["placeholder"] = "CodeSuite/baked-outputs";
          t.setValue(this.plugin.settings.bakedOutputsFolder);
          t.onChange(async (v) => { this.plugin.settings.bakedOutputsFolder = v.trim(); await this.plugin.saveSettings(); });
        });

      new Setting(containerEl)
        .setName("Inline images instead of files")
        .setDesc("Embed baked figures as base64 directly in the note (self-contained, no extra files) instead of writing image files. Off by default — this makes notes much larger. Interactive Plotly widgets are always inlined regardless.")
        .addToggle((t) => {
          t.setValue(this.plugin.settings.bakedOutputsInlineImages);
          t.onChange(async (v) => { this.plugin.settings.bakedOutputsInlineImages = v; await this.plugin.saveSettings(); });
        });
    }
  }
}

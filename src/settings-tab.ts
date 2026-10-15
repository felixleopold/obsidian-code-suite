import { App, PluginSettingTab, Setting, Notice, setIcon, Platform, requireApiVersion } from "obsidian";
import type CodePlugin from "./main";
import {
  BUNDLED_THEMES,
  parsePassthroughLanguages,
  type CodePluginSettings,
  type CustomTheme,
  type ExecutionCwdMode,
} from "./settings";

const TABS = [
  { id: "appearance", label: "Appearance", icon: "palette" },
  { id: "execution", label: "Execution", icon: "play" },
  { id: "languages", label: "Languages", icon: "code" },
  { id: "files", label: "Files", icon: "folder" },
  { id: "advanced", label: "Advanced", icon: "flask-conical" },
] as const;

type TabId = (typeof TABS)[number]["id"];

type BooleanKey = { [K in keyof CodePluginSettings]-?: CodePluginSettings[K] extends boolean ? K : never }[keyof CodePluginSettings];
type StringKey = { [K in keyof CodePluginSettings]-?: string extends CodePluginSettings[K] ? K : never }[keyof CodePluginSettings];

/** A settings row; assignable to Obsidian's declarative `SettingDefinitionRender`. */
interface Row {
  name: string;
  desc?: string | DocumentFragment;
  visible?: () => boolean;
  searchable?: boolean;
  render: (setting: Setting) => void | (() => void);
}

/** A headed card of rows; assignable to Obsidian's `SettingDefinitionGroup`. */
interface Group {
  type: "group";
  heading?: string;
  cls?: string;
  items: Row[];
}

export class CodeSettingTab extends PluginSettingTab {
  plugin: CodePlugin;
  /** Active tab, kept in memory across opens within a session. */
  private activeTab: TabId = "appearance";
  private tabButtons = new Map<TabId, HTMLElement>();

  constructor(app: App, plugin: CodePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  // Every tab's groups are always defined so Obsidian's settings search
  // indexes all of them; the inactive tabs are only hidden with CSS.
  getSettingDefinitions(): Group[] {
    return [
      { type: "group", cls: "ocode-settings-nav", items: [this.tabBar()] },
      ...this.panel("appearance", this.appearance()),
      ...this.panel("execution", this.execution()),
      ...this.panel("languages", this.languages()),
      ...this.panel("files", this.files()),
      ...this.panel("advanced", this.advanced()),
    ];
  }

  /** Fallback for Obsidian versions before the declarative settings API. */
  display(): void {
    this.renderFallback();
  }

  private renderFallback(): void {
    const { containerEl } = this;
    containerEl.empty();
    for (const group of this.getSettingDefinitions()) {
      const groupEl = containerEl.createDiv({ cls: group.cls });
      if (group.heading) new Setting(groupEl).setName(group.heading).setHeading();
      for (const row of group.items) {
        if (row.visible && !row.visible()) continue;
        const setting = new Setting(groupEl).setName(row.name);
        if (row.desc) setting.setDesc(row.desc);
        row.render(setting);
      }
    }
  }

  /** Re-applies `visible` predicates after a setting they depend on changes. */
  private refreshVisibility(): void {
    if (requireApiVersion("1.13.0")) this.refreshDomState();
    else this.renderFallback();
  }

  /** Rebuilds every row, e.g. after the custom theme list changes. */
  private rerender(): void {
    if (requireApiVersion("1.13.0")) this.update();
    else this.renderFallback();
  }

  // ─── Tab navigation ──────────────────────────
  private panel(tab: TabId, groups: Group[]): Group[] {
    return groups.map((group) => ({ ...group, cls: `ocode-settings-panel ocode-settings-panel-${tab}` }));
  }

  private tabBar(): Row {
    return {
      name: "",
      searchable: false,
      render: (setting) => {
        this.containerEl.addClass("ocode-settings");
        this.containerEl.dataset.ocodeTab = this.activeTab;
        setting.settingEl.addClass("ocode-settings-tabs-row");
        this.tabButtons.clear();
        const nav = setting.settingEl.createDiv({
          cls: "ocode-settings-tabs",
          attr: { role: "tablist", "aria-label": "CodeSuite settings sections" },
        });
        for (const tab of TABS) {
          const active = tab.id === this.activeTab;
          const btn = nav.createDiv({
            cls: "ocode-settings-tab",
            attr: { role: "tab", tabindex: active ? "0" : "-1", "aria-selected": String(active) },
          });
          setIcon(btn.createSpan({ cls: "ocode-settings-tab-icon" }), tab.icon);
          btn.createSpan({ text: tab.label });
          btn.toggleClass("is-active", active);
          btn.addEventListener("click", () => this.selectTab(tab.id));
          btn.addEventListener("keydown", (e) => this.onTabKeydown(e, tab.id));
          this.tabButtons.set(tab.id, btn);
        }

        // Settings search (1.13+) scrolls to and flashes a result's row; if the
        // row sits in a hidden tab, switch to that tab so the result is visible.
        if (!requireApiVersion("1.13.0")) return;
        const observer = new MutationObserver((records) => {
          for (const { target } of records) {
            if (!target.instanceOf(HTMLElement) || !target.hasClass("is-flashing")) continue;
            const tab = TABS.find((t) => target.closest(`.ocode-settings-panel-${t.id}`));
            if (!tab || tab.id === this.activeTab) continue;
            this.selectTab(tab.id);
            target.scrollIntoView({ block: "center" });
          }
        });
        observer.observe(this.containerEl, { subtree: true, attributes: true, attributeFilter: ["class"] });
        return () => observer.disconnect();
      },
    };
  }

  private onTabKeydown(e: KeyboardEvent, id: TabId): void {
    const idx = TABS.findIndex((t) => t.id === id);
    let next: number;
    if (e.key === "ArrowRight") next = (idx + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    else return;
    e.preventDefault();
    const nextId = TABS[next].id;
    this.selectTab(nextId);
    this.tabButtons.get(nextId)?.focus();
  }

  private selectTab(id: TabId): void {
    this.activeTab = id;
    this.containerEl.dataset.ocodeTab = id;
    this.containerEl.scrollTop = 0;
    for (const [tabId, btn] of this.tabButtons) {
      const active = tabId === id;
      btn.toggleClass("is-active", active);
      btn.setAttribute("aria-selected", String(active));
      btn.setAttribute("tabindex", active ? "0" : "-1");
    }
  }

  // ─── Row helpers ─────────────────────────────
  private toggle(key: BooleanKey, afterChange?: (value: boolean) => void): Row["render"] {
    return (setting) => {
      setting.addToggle((t) => {
        t.setValue(this.plugin.settings[key]);
        t.onChange(async (v) => {
          this.plugin.settings[key] = v;
          await this.plugin.saveSettings();
          afterChange?.(v);
        });
      });
    };
  }

  private text(key: StringKey, placeholder = ""): Row["render"] {
    return (setting) => {
      setting.addText((t) => {
        t.setPlaceholder(placeholder);
        t.setValue(this.plugin.settings[key]);
        t.onChange(async (v) => { this.plugin.settings[key] = v.trim(); await this.plugin.saveSettings(); });
      });
    };
  }

  private textArea(key: StringKey, placeholder: string, rows: number, parse: (value: string) => string = (v) => v, afterChange?: () => void): Row["render"] {
    return (setting) => {
      setting.addTextArea((t) => {
        t.setPlaceholder(placeholder);
        t.setValue(this.plugin.settings[key]);
        t.inputEl.rows = rows;
        t.inputEl.cols = 40;
        t.onChange(async (v) => {
          this.plugin.settings[key] = parse(v);
          await this.plugin.saveSettings();
          afterChange?.();
        });
      });
    };
  }

  // ─── Appearance ──────────────────────────────
  private themeOptions(): Record<string, string> {
    const dark: [string, string][] = [];
    const light: [string, string][] = [];
    for (const [id, name] of Object.entries(BUNDLED_THEMES)) {
      if (name.toLowerCase().includes("light") || ["catppuccin-latte", "slack-ochin", "snazzy-light"].includes(id)) {
        light.push([id, name]);
      } else {
        dark.push([id, name]);
      }
    }
    const options: Record<string, string> = {};
    for (const [id, name] of dark.sort((a, b) => a[1].localeCompare(b[1]))) options[id] = `${name} ☾`;
    for (const [id, name] of light.sort((a, b) => a[1].localeCompare(b[1]))) options[id] = `${name} ☀`;
    for (const ct of this.plugin.settings.customThemes) options[themeId(ct)] = `${ct.name} (custom)`;
    return options;
  }

  /** Dark or light auto-theme picker; applies immediately only in its own mode. */
  private autoThemePicker(key: "darkAutoTheme" | "lightAutoTheme", dark: boolean): Row["render"] {
    return (setting) => {
      setting.addDropdown((dropdown) => {
        dropdown.addOptions(this.themeOptions());
        dropdown.setValue(this.plugin.settings[key]);
        dropdown.onChange(async (value) => {
          this.plugin.settings[key] = value;
          // Applying the other mode's theme would show the wrong colors until
          // the mode switches.
          const active = activeDocument.body.classList.contains("theme-dark") === dark;
          if (active) this.plugin.settings.theme = value;
          await this.plugin.saveSettings();
          if (active) {
            this.plugin.applyThemeColors();
            await this.plugin.refreshHighlighter();
          }
        });
      });
    };
  }

  private importTheme(): void {
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
          const id = this.plugin.highlighter.loadCustomTheme(customTheme);
          if (!id) {
            new Notice("Failed to load theme: invalid format.");
            return;
          }
          this.plugin.settings.customThemes.push(customTheme);
          this.plugin.settings.theme = id;
          await this.plugin.saveSettings();
          this.plugin.applyThemeColors();
          new Notice(`Theme "${name}" imported and activated.`);
          this.rerender();
        } catch {
          new Notice("Failed to parse theme file. Make sure it's a valid VS Code theme JSON.");
        }
      })();
    });
    input.click();
  }

  private customThemeRow(ct: CustomTheme): Row {
    return {
      name: ct.name,
      desc: "Imported VS Code theme.",
      render: (setting) => {
        setting.addButton((btn) => {
          btn.setButtonText("Remove");
          btn.buttonEl.addClass("mod-warning");
          btn.onClick(async () => {
            this.plugin.settings.customThemes = this.plugin.settings.customThemes.filter((t) => t.name !== ct.name);
            if (this.plugin.settings.theme === themeId(ct)) this.plugin.settings.theme = "gruvbox-dark-hard";
            await this.plugin.saveSettings();
            this.plugin.applyThemeColors();
            await this.plugin.refreshHighlighter();
            this.rerender();
          });
        });
      },
    };
  }

  private appearance(): Group[] {
    const s = this.plugin.settings;
    return [
      {
        type: "group",
        heading: "Theme",
        items: [
          {
            name: "Match Obsidian's light and dark mode",
            desc: "Use separate themes for light and dark mode and switch automatically.",
            render: this.toggle("autoTheme", (v) => {
              if (v) this.plugin.applyAutoTheme();
              this.rerender(); // the theme pickers' values may have changed
            }),
          },
          {
            name: "Syntax theme",
            desc: "Color scheme for code blocks in reading view and the editor.",
            visible: () => !s.autoTheme,
            render: (setting) => {
              setting.addDropdown((dropdown) => {
                dropdown.addOptions(this.themeOptions());
                dropdown.setValue(s.theme);
                dropdown.onChange(async (value) => {
                  s.theme = value;
                  await this.plugin.saveSettings();
                  this.plugin.applyThemeColors();
                  await this.plugin.refreshHighlighter();
                });
              });
            },
          },
          { name: "Dark mode theme", visible: () => s.autoTheme, render: this.autoThemePicker("darkAutoTheme", true) },
          { name: "Light mode theme", visible: () => s.autoTheme, render: this.autoThemePicker("lightAutoTheme", false) },
          {
            name: "Import VS Code theme",
            desc: "Add a VS Code or TextMate color theme from a .json file, e.g. from vscodethemes.com.",
            render: (setting) => {
              setting.addButton((btn) => btn.setButtonText("Import JSON file").onClick(() => this.importTheme()));
            },
          },
          ...s.customThemes.map((ct) => this.customThemeRow(ct)),
        ],
      },
      {
        type: "group",
        heading: "Code blocks",
        items: [
          {
            name: "Follow Obsidian code size",
            desc: "Use the font size from Obsidian's Appearance settings.",
            render: (setting) => {
              setting.addToggle((t) => {
                t.setValue(s.codeFontSize === null);
                t.onChange(async (v) => {
                  s.codeFontSize = v ? null : 13.5;
                  this.plugin.applyCodeFontSize();
                  await this.plugin.saveSettings();
                  this.rerender(); // reset the slider to the new size
                });
              });
            },
          },
          {
            name: "Custom code size",
            desc: "Code font size in pixels.",
            visible: () => s.codeFontSize !== null,
            render: (setting) => {
              setting.addSlider((slider) => {
                slider.setLimits(8, 24, 0.5);
                slider.setValue(s.codeFontSize ?? 13.5);
                slider.onChange(async (v) => {
                  s.codeFontSize = v;
                  this.plugin.applyCodeFontSize();
                  await this.plugin.saveSettings();
                });
              });
            },
          },
          {
            name: "Line numbers",
            desc: "Per-block line-number options override this.",
            render: this.toggle("showLineNumbers", () => this.plugin.refreshRenderedBlocks()),
          },
          {
            name: "Language label",
            desc: "Show the language name in the block header.",
            render: this.toggle("showLanguageLabel"),
          },
          {
            name: "Wide code blocks",
            desc: "Let code blocks extend beyond the normal content width.",
            render: this.toggle("wideCodeBlocks", (v) => activeDocument.body.toggleClass("ocode-wide-blocks", v)),
          },
          {
            name: "Soft-wrap long lines",
            desc: "Wrap long lines in reading view instead of scrolling horizontally.",
            render: this.toggle("wrapCodeInReadingView", (v) => activeDocument.body.toggleClass("ocode-wrap-code", v)),
          },
          {
            name: "Collapse code blocks by default",
            desc: "Start blocks collapsed; click the header to expand. Per-block collapse, expanded, and fold flags override this.",
            render: this.toggle("inlineCollapsedByDefault", () => this.plugin.refreshRenderedBlocks()),
          },
        ],
      },
      {
        type: "group",
        heading: "Editing",
        items: [
          {
            name: "Tab key in code blocks",
            desc: "Indent with Tab and Shift+Tab inside fenced code blocks. Press Escape, then Tab, to leave the editor.",
            render: this.toggle("enableCodeBlockTab", () => this.refreshVisibility()),
          },
          {
            name: "Code block indentation",
            desc: "Detect from the block and matching language blocks, or always insert one style. Detection falls back to tabs.",
            visible: () => s.enableCodeBlockTab,
            render: (setting) => {
              setting.addDropdown((d) => {
                d.addOptions({
                  auto: "Detect automatically",
                  tabs: "Tabs",
                  "2-spaces": "2 spaces",
                  "4-spaces": "4 spaces",
                  "8-spaces": "8 spaces",
                });
                d.setValue(s.codeBlockIndentation);
                d.onChange(async (v) => {
                  switch (v) {
                    case "auto":
                    case "tabs":
                    case "2-spaces":
                    case "4-spaces":
                    case "8-spaces":
                      s.codeBlockIndentation = v;
                      break;
                    default:
                      return;
                  }
                  await this.plugin.saveSettings();
                });
              });
            },
          },
        ],
      },
      {
        type: "group",
        heading: "Inline code",
        items: [
          {
            name: "Enhanced inline code styling",
            desc: "Give inline code a stronger background, border, and spacing.",
            render: this.toggle("styleInlineCode", () => {
              this.app.workspace.updateOptions();
              this.plugin.refreshRenderedBlocks();
            }),
          },
          {
            name: "Inline syntax highlighting",
            desc: "Highlight inline code with a language prefix, e.g. `{python} values.sum()`.",
            render: this.toggle("highlightInlineCode", () => {
              this.app.workspace.updateOptions();
              this.plugin.refreshRenderedBlocks();
            }),
          },
          {
            name: "CodeSuite variables panel",
            desc: "List code_vars and template_context frontmatter below Properties in reading view. Obsidian's unsupported-type warning for these fields is hidden either way.",
            render: this.toggle("showFrontmatterVarsPanel", () => this.plugin.refreshFrontmatterPanels()),
          },
        ],
      },
      {
        type: "group",
        heading: "HTML blocks",
        items: [
          {
            name: "Render HTML blocks",
            desc: "Show html blocks as a live preview instead of source. Override per block with a preview or source flag.",
            render: this.toggle("renderHtmlBlocks", () => this.plugin.refreshRenderedBlocks()),
          },
          {
            name: "PDF export for HTML blocks",
            desc: "Add a PDF button to rendered html blocks to save or print just that block on A4. Override per block with pdf or nopdf. Desktop only.",
            render: this.toggle("htmlBlockPdfExport", () => this.plugin.refreshRenderedBlocks()),
          },
          {
            name: "HTML block templating",
            desc: "Render html blocks containing {{ … }} as templates with frontmatter, vars, partials, and loops. A template flag on the fence opts in a single block.",
            render: this.toggle("htmlTemplating", () => this.plugin.refreshRenderedBlocks()),
          },
        ],
      },
    ];
  }

  // ─── Execution ───────────────────────────────
  private execution(): Group[] {
    const s = this.plugin.settings;
    const cwdOptions: Record<ExecutionCwdMode, string> = {
      vault: "Vault root",
      home: "Home directory",
      custom: "Custom path",
    };
    return [
      {
        type: "group",
        heading: "Running code",
        items: [
          {
            name: "Enable code execution",
            desc: "Show a run button on supported code blocks. Code runs locally with your installed runtimes. Desktop only.",
            render: this.toggle("enableExecution"),
          },
          {
            name: "Static blocks by default",
            desc: "Keep blocks highlighted but not runnable. Add static=false to a fence to make one block runnable.",
            render: this.toggle("staticBlocksByDefault", () => this.plugin.refreshRenderedBlocks()),
          },
          {
            name: "Shared execution context",
            desc: "Blocks in a note share one in-memory session, so later blocks can use earlier variables (Python, Bash, Zsh). Run blocks top to bottom.",
            render: this.toggle("sharedContext"),
          },
          {
            name: "Show clear-session button",
            desc: "Show the clear-session button in the note header. The command works either way. Desktop only.",
            render: this.toggle("showClearSessionButton", () => this.plugin.refreshViewActions()),
          },
          {
            name: "Execution timeout",
            desc: "Seconds before a running process is stopped.",
            render: (setting) => {
              setting.addSlider((slider) => {
                slider.setLimits(5, 300, 5);
                slider.setValue(s.executionTimeout / 1000);
                slider.onChange(async (v) => { s.executionTimeout = v * 1000; await this.plugin.saveSettings(); });
              });
            },
          },
        ],
      },
      {
        type: "group",
        heading: "Environment",
        items: [
          {
            name: "Working directory",
            desc: "Where code runs. The vault root lets scripts use vault-relative paths.",
            render: (setting) => {
              setting.addDropdown((dropdown) => {
                dropdown.addOptions(cwdOptions);
                dropdown.setValue(s.executionCwd);
                dropdown.onChange(async (value) => {
                  s.executionCwd = value as ExecutionCwdMode;
                  await this.plugin.saveSettings();
                  this.refreshVisibility();
                });
              });
            },
          },
          {
            name: "Custom working directory",
            desc: "Absolute path code runs in.",
            visible: () => s.executionCwd === "custom",
            render: this.text("executionCwdCustom", "/path/to/directory"),
          },
          {
            name: "Extra environment variables",
            desc: "One KEY=VALUE per line, e.g. PYTHONPATH or API keys.",
            render: this.textArea("extraEnv", "PYTHONPATH=/path/to/libs\nMY_VAR=value", 4),
          },
          {
            name: ".env file path",
            desc: "Absolute path to a .env file loaded before each run. Extra variables and frontmatter override it.",
            render: this.text("envFilePath", "/path/to/project/.env"),
          },
        ],
      },
      {
        type: "group",
        heading: "Plots",
        items: [
          {
            name: "Interactive plots",
            desc: "Render Plotly figures as interactive widgets instead of static images, which need kaleido. Matplotlib is always static.",
            render: this.toggle("interactivePlots", () => this.refreshVisibility()),
          },
          {
            name: "Embed Plotly.js offline",
            desc: "Bundle Plotly.js with each plot so it renders without internet. Larger output; otherwise it loads from a CDN.",
            visible: () => s.interactivePlots,
            render: this.toggle("embedPlotlyJs"),
          },
          {
            name: "Matplotlib style",
            desc: "Built-in style name or absolute path to a .mplstyle file. Leave blank for defaults.",
            render: this.text("matplotlibStyle", "dark_background"),
          },
        ],
      },
    ];
  }

  // ─── Languages ───────────────────────────────
  private languages(): Group[] {
    const s = this.plugin.settings;
    return [
      {
        type: "group",
        heading: "Interpreters",
        items: [
          {
            name: "Python path",
            desc: "Python binary or virtualenv interpreter; a venv's tools are also available to other languages. Leave any interpreter path blank to find it on PATH.",
            render: this.text("pythonPath", "python3"),
          },
          { name: "Node.js path", render: this.text("nodePath", "node") },
          {
            name: "Bash path",
            desc: "Used by bash blocks, e.g. /opt/homebrew/bin/bash.",
            render: this.text("bashPath", "bash"),
          },
          {
            name: "Zsh path",
            desc: "Must be zsh-compatible; variable tracking emits zsh syntax.",
            render: this.text("zshPath", "zsh"),
          },
          {
            name: "Shell (sh) path",
            desc: "Used by shell and sh blocks.",
            render: this.text("shPath", "sh"),
          },
          {
            name: "Rscript path",
            desc: "Used by r blocks. On Windows, R is not on PATH by default.",
            render: this.text("rPath", "Rscript"),
          },
          {
            name: "Dotnet path",
            desc: "Used by csharp blocks. Requires .NET 10 or later.",
            render: this.text("dotnetPath", "dotnet"),
          },
          {
            name: "WSL path translation",
            desc: "Pass script paths to WSL shells as /mnt/c/…. Choose Off for Git Bash, Cygwin, or MSYS.",
            visible: () => Platform.isWin,
            render: (setting) => {
              setting.addDropdown((d) => {
                d.addOptions({ auto: "Auto-detect", on: "On (always translate)", off: "Off (never translate)" });
                d.setValue(s.wslMode);
                d.onChange(async (v) => {
                  s.wslMode = v as "auto" | "on" | "off";
                  await this.plugin.saveSettings();
                });
              });
            },
          },
        ],
      },
      {
        type: "group",
        heading: "MATLAB",
        items: [
          {
            name: "MATLAB Python path",
            desc: "Python interpreter with a MATLAB Engine package for your MATLAB release. Clear the note session after changing it.",
            render: this.text("matlabPythonPath", "/path/to/matlab-venv/bin/python3"),
          },
          {
            name: "Session idle timeout",
            desc: "Minutes before an idle MATLAB Engine shuts down to free memory. 0 means never.",
            render: (setting) => {
              setting.addSlider((slider) => {
                slider.setLimits(0, 60, 1);
                slider.setValue(Math.max(0, Math.round(s.matlabSessionIdleTimeout / 60_000)));
                slider.onChange(async (minutes) => {
                  s.matlabSessionIdleTimeout = minutes * 60_000;
                  await this.plugin.saveSettings();
                });
              });
            },
          },
        ],
      },
      {
        type: "group",
        heading: "Shell startup",
        items: [
          {
            name: "Run bash/zsh as login shell",
            desc: "Let startup files set up PATH, aliases, and functions.",
            render: this.toggle("shellLogin"),
          },
          {
            name: "Shell source files",
            desc: "Files sourced before Bash, Zsh, and Shell blocks, one absolute path per line. Lines starting with # are ignored.",
            render: this.textArea("shellSourceFiles", "/Users/you/.bashrc\n/Users/you/.config/codesuite/env.sh", 3),
          },
        ],
      },
      {
        type: "group",
        heading: "Code block passthrough",
        items: [
          {
            name: "Additional passthrough languages",
            desc: "Fence languages CodeSuite leaves for Obsidian or other plugins to render, one per line. Mermaid, dataview, dataviewjs, and query always pass through.",
            render: this.textArea(
              "additionalPassthroughLanguages",
              "base\nd2\nvid",
              4,
              (v) => parsePassthroughLanguages(v).join("\n"),
              () => this.plugin.refreshRenderedBlocks(),
            ),
          },
        ],
      },
      {
        type: "group",
        heading: "PHP",
        items: [
          {
            name: "Auto-prepend php opening tag",
            desc: "Add <?php when running snippets without one. The note is not changed.",
            render: this.toggle("autoPrependPhpOpenTag"),
          },
        ],
      },
    ];
  }

  // ─── Files ───────────────────────────────────
  private files(): Group[] {
    return [
      {
        type: "group",
        heading: "Embedded code files",
        items: [
          {
            name: "Render embedded code files",
            desc: "Highlight ![[file.py]] embeds with your syntax theme.",
            render: this.toggle("renderEmbeddedFiles"),
          },
          {
            name: "Collapse embedded files",
            desc: "Start embeds collapsed; click the header to expand.",
            render: this.toggle("collapseEmbeds"),
          },
        ],
      },
      {
        type: "group",
        heading: "Vault code files",
        items: [
          {
            name: "Show code files in the file explorer",
            desc: "List .py, .js, .sh, and other code files in the file explorer and open them in CodeSuite's editor. Requires a restart.",
            render: this.toggle("enableCodeFileView", () => new Notice("Restart Obsidian for this change to take effect.")),
          },
          {
            name: "Imports folder",
            desc: "Vault folder used by \"Import code file as alias\". Created on demand.",
            render: this.text("codeImportsFolder", "CodeSuiteImports"),
          },
        ],
      },
    ];
  }

  // ─── Advanced ────────────────────────────────
  private advanced(): Group[] {
    const s = this.plugin.settings;
    return [
      {
        type: "group",
        heading: "Experimental",
        items: [
          {
            name: "Data tables",
            desc: "Expose Markdown tables to code. Put %% codesuite: <name> as <shape> %% above a table (records, dict, columns, matrix, or vars). May change in future releases.",
            render: this.toggle("experimentalTables"),
          },
        ],
      },
      {
        // Baking writes captured output into the note so it survives where
        // only the raw .md is read, e.g. notes shared via NoteColab.
        type: "group",
        heading: "Baked outputs",
        items: [
          {
            name: "Enable baked outputs",
            desc: "Add commands that save block output into the note as hidden codesuite-output blocks, so readers who cannot run your code still see results.",
            render: this.toggle("bakedOutputs", () => this.refreshVisibility()),
          },
          {
            name: "Baked figures folder",
            desc: "Vault folder for baked figures such as Matplotlib PNGs. Created on demand.",
            visible: () => s.bakedOutputs,
            render: this.text("bakedOutputsFolder", "CodeSuite/baked-outputs"),
          },
          {
            name: "Inline images instead of files",
            desc: "Embed baked figures as base64 in the note. Makes notes much larger. Plotly widgets are always inlined.",
            visible: () => s.bakedOutputs,
            render: this.toggle("bakedOutputsInlineImages"),
          },
        ],
      },
    ];
  }
}

function themeId(theme: CustomTheme): string {
  return theme.name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

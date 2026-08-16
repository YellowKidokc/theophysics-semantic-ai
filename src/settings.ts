/**
 * Settings tab.
 *
 * Everything the classifier uses is editable here: which provider to call,
 * a key per provider, and both classification axes.
 */

import { App, PluginSettingTab, Setting, Notice, requestUrl } from 'obsidian';
import type SemanticAIPlugin from './main';
import {
  CategoryDefinition,
  PROVIDERS,
  PROVIDER_IDS,
  PALETTE_SLOTS,
  ProviderId,
  TAXONOMY_PRESETS,
  TopicDefinition,
  clonePreset,
  getPreset,
  slugToId
} from './types';
import { PromptManager } from './ai/prompt-manager';
import { AIClassifier, activeProvider } from './ai/classifier';
import { createCustomClassifierSettings } from './ui/prompt-tabs';

interface TabDefinition {
  id: string;
  name: string;
  render: (containerEl: HTMLElement) => void;
}

export class SemanticAISettingTab extends PluginSettingTab {
  plugin: SemanticAIPlugin;
  promptManager: PromptManager;
  classifier: AIClassifier;

  /** Tab to reopen after a re-render, so edits don't bounce the user home. */
  private activeTabId = 'provider';

  /** Holds the preset dropdown choice until the user presses Load. */
  private pendingPresetId = '';

  constructor(app: App, plugin: SemanticAIPlugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.promptManager = plugin.promptManager;
    this.classifier = plugin.classifier;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('semantic-ai-settings-tab');

    this.createMainTabs(containerEl);
  }

  /** Save, then rebuild the tab so derived UI reflects the change. */
  private async saveAndRedraw(): Promise<void> {
    await this.plugin.saveSettings();
    this.display();
  }

  private createMainTabs(containerEl: HTMLElement): void {
    const tabs: TabDefinition[] = [
      { id: 'provider', name: 'AI provider', render: this.renderProviderSettings.bind(this) },
      { id: 'categories', name: 'Categories', render: this.renderCategorySettings.bind(this) },
      { id: 'topics', name: 'Topics', render: this.renderTopicSettings.bind(this) },
      { id: 'custom', name: 'Custom classifiers', render: this.renderCustomClassifiers.bind(this) },
      { id: 'display', name: 'Display', render: this.renderDisplaySettings.bind(this) },
      { id: 'sync', name: 'Sync', render: this.renderSyncSettings.bind(this) }
    ];

    if (!tabs.some(t => t.id === this.activeTabId)) {
      this.activeTabId = tabs[0].id;
    }

    const tabContainer = containerEl.createDiv({ cls: 'semantic-ai-main-tabs' });
    const tabNav = tabContainer.createDiv({ cls: 'semantic-ai-main-tab-nav' });
    tabNav.setAttribute('role', 'tablist');
    tabNav.setAttribute('aria-label', 'Settings sections');

    const tabContent = tabContainer.createDiv({ cls: 'semantic-ai-main-tab-content' });

    const buttons: HTMLButtonElement[] = [];
    const panels: HTMLElement[] = [];

    const activate = (index: number, moveFocus: boolean): void => {
      buttons.forEach((btn, i) => {
        const selected = i === index;
        btn.toggleClass('active', selected);
        btn.setAttribute('aria-selected', String(selected));
        btn.tabIndex = selected ? 0 : -1;
      });
      panels.forEach((panel, i) => panel.toggleClass('active', i === index));
      this.activeTabId = tabs[index].id;
      if (moveFocus) {
        buttons[index].focus();
      }
    };

    tabs.forEach((tab, index) => {
      const isActive = tab.id === this.activeTabId;

      const button = tabNav.createEl('button', {
        cls: `semantic-ai-main-tab-btn${isActive ? ' active' : ''}`,
        text: tab.name
      });
      button.type = 'button';
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(isActive));
      button.id = `semantic-ai-tab-${tab.id}`;
      button.setAttribute('aria-controls', `semantic-ai-panel-${tab.id}`);
      button.tabIndex = isActive ? 0 : -1;
      buttons.push(button);

      const panel = tabContent.createDiv({
        cls: `semantic-ai-main-tab-panel${isActive ? ' active' : ''}`
      });
      panel.setAttribute('role', 'tabpanel');
      panel.id = `semantic-ai-panel-${tab.id}`;
      panel.setAttribute('aria-labelledby', `semantic-ai-tab-${tab.id}`);
      panels.push(panel);

      tab.render(panel);

      button.addEventListener('click', () => activate(index, false));
      button.addEventListener('keydown', (evt: KeyboardEvent) => {
        let next = -1;
        if (evt.key === 'ArrowRight') next = (index + 1) % tabs.length;
        if (evt.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
        if (evt.key === 'Home') next = 0;
        if (evt.key === 'End') next = tabs.length - 1;

        if (next !== -1) {
          evt.preventDefault();
          activate(next, true);
        }
      });
    });
  }

  /* ---------------------------------------------------------------------- */
  /* AI provider                                                            */
  /* ---------------------------------------------------------------------- */

  private renderProviderSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('Provider').setHeading();

    new Setting(containerEl)
      .setName('Active provider')
      .setDesc('Which service runs the classification. Keys for the others are kept, so you can switch back and forth.')
      .addDropdown(dropdown => {
        for (const id of PROVIDER_IDS) {
          dropdown.addOption(id, PROVIDERS[id].name);
        }
        dropdown
          .setValue(this.plugin.settings.provider)
          .onChange(async (value) => {
            this.plugin.settings.provider = value as ProviderId;
            await this.saveAndRedraw();
          });
      });

    const active = activeProvider(this.plugin.settings);
    new Setting(containerEl)
      .setName('Test connection')
      .setDesc(`Sends one short prompt to ${PROVIDERS[active.id].name} using ${active.model || 'the default model'}.`)
      .addButton(button => {
        button
          .setButtonText('Test')
          .onClick(async () => {
            button.setButtonText('Testing…');
            button.setDisabled(true);

            const result = await this.classifier.testConnection();

            button.setButtonText('Test');
            button.setDisabled(false);
            new Notice(result.message, result.success ? 5000 : 10000);
          });
      });

    // Every provider gets its own block, so both an OpenAI key and a DeepSeek
    // key can be stored at the same time.
    for (const id of PROVIDER_IDS) {
      this.renderOneProvider(containerEl, id);
    }
  }

  private renderOneProvider(containerEl: HTMLElement, id: ProviderId): void {
    const info = PROVIDERS[id];
    const config = this.plugin.settings.providers[id];
    const isActive = this.plugin.settings.provider === id;

    const section = containerEl.createDiv({
      cls: `semantic-ai-provider-block${isActive ? ' is-active' : ''}`
    });

    new Setting(section)
      .setName(isActive ? `${info.name} (in use)` : info.name)
      .setHeading();

    if (info.requiresKey) {
      const keySetting = new Setting(section)
        .setName('API key')
        .addText(text => {
          text
            .setPlaceholder(id === 'anthropic' ? 'sk-ant-…' : 'sk-…')
            .setValue(config.apiKey)
            .onChange(async (value) => {
              config.apiKey = value.trim();
              await this.plugin.saveSettings();
            });

          text.inputEl.type = 'password';
          text.inputEl.setAttribute('aria-label', `${info.name} API key`);
          text.inputEl.autocomplete = 'off';
          text.inputEl.addClass('semantic-ai-wide-input');
        });

      const desc = keySetting.descEl;
      desc.appendText(config.apiKey ? 'A key is saved. ' : 'No key saved yet. ');
      desc.appendText('Stored in this vault\'s plugin data, in plain text. ');
      if (info.keyUrl) {
        desc.createEl('a', {
          text: 'Get a key',
          href: info.keyUrl,
          attr: { rel: 'noopener' }
        });
      }
    }

    new Setting(section)
      .setName('Model')
      .setDesc(info.suggestedModels.length > 0
        ? `Suggested: ${info.suggestedModels.join(', ')}`
        : 'The model name your endpoint expects.')
      .addText(text => {
        text
          .setPlaceholder(info.defaultModel || 'model name')
          .setValue(config.model)
          .onChange(async (value) => {
            config.model = value.trim();
            await this.plugin.saveSettings();
          });
        text.inputEl.setAttribute('aria-label', `${info.name} model name`);
        text.inputEl.addClass('semantic-ai-wide-input');
      });

    new Setting(section)
      .setName('Endpoint')
      .setDesc(info.defaultEndpoint
        ? 'Change this only for a proxy or self-hosted gateway.'
        : 'Full URL of your chat-completions compatible endpoint.')
      .addText(text => {
        text
          .setPlaceholder(info.defaultEndpoint || 'https://…')
          .setValue(config.endpoint)
          .onChange(async (value) => {
            config.endpoint = value.trim();
            await this.plugin.saveSettings();
          });
        text.inputEl.setAttribute('aria-label', `${info.name} endpoint URL`);
        text.inputEl.addClass('semantic-ai-wide-input');
      })
      .addExtraButton(button => {
        button
          .setIcon('rotate-ccw')
          .setTooltip('Reset to default')
          .onClick(async () => {
            config.endpoint = info.defaultEndpoint;
            config.model = info.defaultModel;
            await this.saveAndRedraw();
          });
        button.extraSettingsEl.setAttribute('aria-label', `Reset ${info.name} endpoint and model to defaults`);
      });
  }

  /* ---------------------------------------------------------------------- */
  /* Categories (axis 1)                                                    */
  /* ---------------------------------------------------------------------- */

  private renderCategorySettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('Starting point').setHeading();

    const presetSetting = new Setting(containerEl)
      .setName('Preset')
      .setDesc('Loading a preset replaces your categories and topics. Export first if you want to keep the current set.')
      .addDropdown(dropdown => {
        for (const preset of TAXONOMY_PRESETS) {
          dropdown.addOption(preset.id, preset.name);
        }
        if (!getPreset(this.plugin.settings.presetId)) {
          dropdown.addOption(this.plugin.settings.presetId, 'Custom');
        }
        dropdown.setValue(this.plugin.settings.presetId);
        dropdown.onChange(value => {
          this.pendingPresetId = value;
        });
        dropdown.selectEl.setAttribute('aria-label', 'Taxonomy preset');
      })
      .addButton(button => {
        button
          .setButtonText('Load')
          .onClick(async () => {
            const preset = getPreset(this.pendingPresetId || this.plugin.settings.presetId);
            if (!preset) {
              new Notice('Pick a preset to load.');
              return;
            }

            const copy = clonePreset(preset);
            this.plugin.settings.presetId = preset.id;
            this.plugin.settings.categories = copy.categories;
            this.plugin.settings.topics = copy.topics;
            this.plugin.settings.axis2Label = preset.axis2Label;
            this.plugin.settings.systemContext = preset.systemContext;
            await this.saveAndRedraw();
            new Notice(`Loaded the "${preset.name}" preset.`);
          });
      });

    const current = getPreset(this.plugin.settings.presetId);
    if (current) {
      presetSetting.descEl.createEl('div', { text: current.description });
    }

    new Setting(containerEl)
      .setName('Vault context')
      .setDesc('Optional. One or two sentences about what this vault contains, added to every prompt. Leave empty for a neutral prompt.')
      .addTextArea(text => {
        text
          .setPlaceholder('e.g. Notes for a book about coastal shipping, 1850-1910.')
          .setValue(this.plugin.settings.systemContext)
          .onChange(async (value) => {
            this.plugin.settings.systemContext = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 3;
        text.inputEl.addClass('semantic-ai-wide-input');
        text.inputEl.setAttribute('aria-label', 'Vault context sentence');
      });

    new Setting(containerEl).setName('Categories').setHeading();
    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'Each category answers "what is this?". Enabled categories are the ones a normal classification run looks for. The id is written into your notes, so renaming an id leaves existing tags pointing at the old name.'
    });

    const listEl = containerEl.createDiv({ cls: 'semantic-ai-category-list' });

    if (this.plugin.settings.categories.length === 0) {
      listEl.createEl('p', {
        cls: 'semantic-ai-empty',
        text: 'No categories yet. Add one below, or load a preset.'
      });
    }

    this.plugin.settings.categories.forEach((category, index) => {
      this.renderCategoryItem(listEl, category, index);
    });

    new Setting(containerEl)
      .setName('Add a category')
      .setDesc('Creates an empty category you can name and describe.')
      .addButton(button => {
        button
          .setButtonText('Add')
          .setCta()
          .onClick(async () => {
            const count = this.plugin.settings.categories.length;
            this.plugin.settings.categories.push({
              id: `Category${count + 1}`,
              name: `Category ${count + 1}`,
              plural: `Category ${count + 1} items`,
              prompt: '',
              color: (count % PALETTE_SLOTS) + 1,
              enabled: true
            });
            this.plugin.settings.presetId = 'custom';
            await this.saveAndRedraw();
          });
      });

    this.renderTaxonomyImportExport(containerEl);
  }

  private renderCategoryItem(containerEl: HTMLElement, category: CategoryDefinition, index: number): void {
    const itemEl = containerEl.createDiv({ cls: 'semantic-ai-category-item' });

    const swatch = itemEl.createSpan({ cls: 'semantic-ai-color-swatch' });
    swatch.dataset.color = String(category.color);
    swatch.setAttribute('aria-hidden', 'true');

    new Setting(itemEl)
      .setName(category.name || category.id)
      .setDesc(`id: ${category.id}`)
      .addToggle(toggle => {
        toggle
          .setValue(category.enabled)
          .onChange(async (value) => {
            category.enabled = value;
            await this.plugin.saveSettings();
          });
        toggle.toggleEl.setAttribute('aria-label', `Include ${category.name} in classification runs`);
      })
      .addExtraButton(button => {
        button
          .setIcon('trash-2')
          .setTooltip('Delete category')
          .onClick(async () => {
            this.plugin.settings.categories.splice(index, 1);
            this.plugin.settings.presetId = 'custom';
            await this.saveAndRedraw();
          });
        button.extraSettingsEl.setAttribute('aria-label', `Delete the ${category.name} category`);
      });

    const details = itemEl.createEl('details', { cls: 'semantic-ai-category-details' });
    details.createEl('summary', { text: 'Edit' });

    new Setting(details)
      .setName('Name')
      .addText(text => {
        text.setValue(category.name).onChange(async (value) => {
          category.name = value;
          await this.plugin.saveSettings();
        });
        text.inputEl.setAttribute('aria-label', `Name for the ${category.id} category`);
      });

    new Setting(details)
      .setName('Plural')
      .setDesc('Used in summaries, for example "Found 3 decisions".')
      .addText(text => {
        text.setValue(category.plural).onChange(async (value) => {
          category.plural = value;
          await this.plugin.saveSettings();
        });
        text.inputEl.setAttribute('aria-label', `Plural name for the ${category.id} category`);
      });

    new Setting(details)
      .setName('Id')
      .setDesc('Written into your notes. Change it only before you have tagged anything with it.')
      .addText(text => {
        text.setValue(category.id).onChange(async (value) => {
          const next = slugToId(value);
          const clash = this.plugin.settings.categories
            .some((c, i) => i !== index && c.id === next);
          if (clash || !next) {
            return;
          }
          category.id = next;
          this.plugin.settings.presetId = 'custom';
          await this.plugin.saveSettings();
        });
        text.inputEl.setAttribute('aria-label', `Id for the ${category.name} category`);
      });

    new Setting(details)
      .setName('Colour')
      .setDesc('Palette slot used for badges and diagram nodes.')
      .addDropdown(dropdown => {
        for (let slot = 1; slot <= PALETTE_SLOTS; slot++) {
          dropdown.addOption(String(slot), `Colour ${slot}`);
        }
        dropdown
          .setValue(String(category.color))
          .onChange(async (value) => {
            category.color = Number(value);
            swatch.dataset.color = value;
            await this.plugin.saveSettings();
          });
        dropdown.selectEl.setAttribute('aria-label', `Colour for the ${category.name} category`);
      });

    const stock = this.promptManager.getStockPrompt(category.id);

    new Setting(details)
      .setName('Prompt')
      .setDesc('What the model is told to look for. Describe the category the way you would to a research assistant.')
      .addTextArea(text => {
        text
          .setPlaceholder('Identify every … Return each with a short label.')
          .setValue(category.prompt)
          .onChange(async (value) => {
            category.prompt = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 5;
        text.inputEl.addClass('semantic-ai-wide-input');
        text.inputEl.setAttribute('aria-label', `Prompt for the ${category.name} category`);
      });

    if (stock !== null) {
      new Setting(details)
        .setName('Reset prompt')
        .setDesc(this.promptManager.isDefaultPrompt(category.id)
          ? 'Currently using the preset wording.'
          : 'Restore the wording this category ships with.')
        .addButton(button => {
          button
            .setButtonText('Reset')
            .setDisabled(this.promptManager.isDefaultPrompt(category.id))
            .onClick(async () => {
              this.promptManager.resetPrompt(category.id);
              await this.saveAndRedraw();
            });
        });
    }
  }

  private renderTaxonomyImportExport(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('Import and export').setHeading();

    new Setting(containerEl)
      .setName('Export taxonomy')
      .setDesc('Copies categories, topics and custom classifiers to the clipboard as JSON.')
      .addButton(button => {
        button
          .setButtonText('Copy JSON')
          .onClick(async () => {
            try {
              await navigator.clipboard.writeText(this.promptManager.exportTaxonomy());
              new Notice('Taxonomy copied to the clipboard.');
            } catch {
              new Notice('Could not write to the clipboard.');
            }
          });
      });

    let importText = '';

    new Setting(containerEl)
      .setName('Import taxonomy')
      .setDesc('Paste JSON exported from this plugin, then choose import. This replaces your current categories.')
      .addTextArea(text => {
        text
          .setPlaceholder('{ "categories": [ … ] }')
          .onChange(value => {
            importText = value;
          });
        text.inputEl.rows = 4;
        text.inputEl.addClass('semantic-ai-wide-input');
        text.inputEl.setAttribute('aria-label', 'Taxonomy JSON to import');
      })
      .addButton(button => {
        button
          .setButtonText('Import')
          .onClick(async () => {
            if (!importText.trim()) {
              new Notice('Paste some JSON first.');
              return;
            }
            try {
              this.promptManager.importTaxonomy(importText);
              await this.saveAndRedraw();
              new Notice('Taxonomy imported.');
            } catch (error) {
              new Notice(error instanceof Error ? error.message : 'Import failed.');
            }
          });
      });
  }

  /* ---------------------------------------------------------------------- */
  /* Topics (axis 2)                                                        */
  /* ---------------------------------------------------------------------- */

  private renderTopicSettings(containerEl: HTMLElement): void {
    const label = this.plugin.settings.axis2Label || 'Topic';

    new Setting(containerEl).setName('Second axis').setHeading();
    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'The second axis answers "where does this belong?". Every element gets a category and, optionally, one or more values from this list.'
    });

    new Setting(containerEl)
      .setName('Enable the second axis')
      .setDesc('Turn this off to classify by category only, which makes each request cheaper.')
      .addToggle(toggle => {
        toggle
          .setValue(this.plugin.settings.enableTopics)
          .onChange(async (value) => {
            this.plugin.settings.enableTopics = value;
            await this.saveAndRedraw();
          });
      });

    new Setting(containerEl)
      .setName('What to call it')
      .setDesc('The word used in prompts and in the interface, for example topic, domain, department, or thread.')
      .addText(text => {
        text
          .setPlaceholder('Topic')
          .setValue(this.plugin.settings.axis2Label)
          .onChange(async (value) => {
            this.plugin.settings.axis2Label = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.setAttribute('aria-label', 'Name for the second axis');
      });

    if (!this.plugin.settings.enableTopics) {
      return;
    }

    new Setting(containerEl).setName(`${label} values`).setHeading();

    const listEl = containerEl.createDiv({ cls: 'semantic-ai-topic-list' });

    if (this.plugin.settings.topics.length === 0) {
      listEl.createEl('p', {
        cls: 'semantic-ai-empty',
        text: 'No values yet. Add one below, or load a preset from the categories tab.'
      });
    }

    this.plugin.settings.topics.forEach((topic, index) => {
      this.renderTopicItem(listEl, topic, index);
    });

    new Setting(containerEl)
      .setName(`Add a ${label.toLowerCase()}`)
      .addButton(button => {
        button
          .setButtonText('Add')
          .setCta()
          .onClick(async () => {
            const count = this.plugin.settings.topics.length;
            this.plugin.settings.topics.push({
              id: `Topic${count + 1}`,
              name: `Topic ${count + 1}`,
              description: '',
              enabled: true
            });
            this.plugin.settings.presetId = 'custom';
            await this.saveAndRedraw();
          });
      });

    new Setting(containerEl)
      .setName('Extra instructions')
      .setDesc('Optional. Added after the list, for rules like "assign at most two" or "leave empty when unsure".')
      .addTextArea(text => {
        text
          .setPlaceholder('Assign at most two values per element.')
          .setValue(this.plugin.settings.topicPrompt)
          .onChange(async (value) => {
            this.plugin.settings.topicPrompt = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 3;
        text.inputEl.addClass('semantic-ai-wide-input');
        text.inputEl.setAttribute('aria-label', 'Extra instructions for the second axis');
      });
  }

  private renderTopicItem(containerEl: HTMLElement, topic: TopicDefinition, index: number): void {
    const setting = new Setting(containerEl)
      .setName(topic.name || topic.id)
      .addText(text => {
        text
          .setPlaceholder('Name')
          .setValue(topic.name)
          .onChange(async (value) => {
            topic.name = value;
            topic.id = slugToId(value) || topic.id;
            await this.plugin.saveSettings();
          });
        text.inputEl.setAttribute('aria-label', `Name for the ${topic.id} value`);
      })
      .addText(text => {
        text
          .setPlaceholder('What belongs here')
          .setValue(topic.description)
          .onChange(async (value) => {
            topic.description = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.addClass('semantic-ai-wide-input');
        text.inputEl.setAttribute('aria-label', `Description for the ${topic.id} value`);
      })
      .addToggle(toggle => {
        toggle
          .setValue(topic.enabled)
          .onChange(async (value) => {
            topic.enabled = value;
            await this.plugin.saveSettings();
          });
        toggle.toggleEl.setAttribute('aria-label', `Include ${topic.name} when classifying`);
      })
      .addExtraButton(button => {
        button
          .setIcon('trash-2')
          .setTooltip('Delete')
          .onClick(async () => {
            this.plugin.settings.topics.splice(index, 1);
            this.plugin.settings.presetId = 'custom';
            await this.saveAndRedraw();
          });
        button.extraSettingsEl.setAttribute('aria-label', `Delete the ${topic.name} value`);
      });

    setting.settingEl.addClass('semantic-ai-topic-item');
  }

  /* ---------------------------------------------------------------------- */
  /* Custom classifiers                                                     */
  /* ---------------------------------------------------------------------- */

  private renderCustomClassifiers(containerEl: HTMLElement): void {
    createCustomClassifierSettings(containerEl, this.promptManager, () => this.plugin.saveSettings());
  }

  /* ---------------------------------------------------------------------- */
  /* Display                                                                */
  /* ---------------------------------------------------------------------- */

  private renderDisplaySettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('Tags in notes').setHeading();

    new Setting(containerEl)
      .setName('Show tag blocks')
      .setDesc('Display the semantic tag block in notes rather than keeping it collapsed.')
      .addToggle(toggle => {
        toggle
          .setValue(this.plugin.settings.showHiddenTags)
          .onChange(async (value) => {
            this.plugin.settings.showHiddenTags = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Generate a diagram after classifying')
      .addToggle(toggle => {
        toggle
          .setValue(this.plugin.settings.autoGenerateMermaid)
          .onChange(async (value) => {
            this.plugin.settings.autoGenerateMermaid = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Diagram location')
      .addDropdown(dropdown => {
        dropdown
          .addOption('panel', 'Side panel')
          .addOption('append', 'Appended to the note')
          .setValue(this.plugin.settings.mermaidPosition)
          .onChange(async (value) => {
            this.plugin.settings.mermaidPosition = value as 'panel' | 'append';
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl).setName('Diagram').setHeading();

    new Setting(containerEl)
      .setName('Direction')
      .addDropdown(dropdown => {
        dropdown
          .addOption('TD', 'Top to bottom')
          .addOption('LR', 'Left to right')
          .addOption('BT', 'Bottom to top')
          .addOption('RL', 'Right to left')
          .setValue(this.plugin.settings.graphDirection)
          .onChange(async (value) => {
            this.plugin.settings.graphDirection = value as 'TD' | 'LR' | 'BT' | 'RL';
            await this.saveAndRedraw();
          });
      });

    const preview = containerEl.createEl('pre', { cls: 'semantic-ai-preview' });
    const sample = this.plugin.settings.categories.slice(0, 3);
    const lines = [`graph ${this.plugin.settings.graphDirection}`];
    sample.forEach((category, i) => {
      lines.push(`  n${i}["${category.name}: example"]`);
    });
    for (let i = 1; i < sample.length; i++) {
      lines.push(`  n${i - 1} --> n${i}`);
    }
    preview.setText(lines.join('\n'));

    new Setting(containerEl).setName('Batch processing').setHeading();

    new Setting(containerEl)
      .setName('Confirm before a batch run')
      .addToggle(toggle => {
        toggle
          .setValue(this.plugin.settings.confirmBatchProcessing)
          .onChange(async (value) => {
            this.plugin.settings.confirmBatchProcessing = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Show a cost estimate')
      .setDesc('Estimates are approximate and based on published list prices.')
      .addToggle(toggle => {
        toggle
          .setValue(this.plugin.settings.showTokenEstimate)
          .onChange(async (value) => {
            this.plugin.settings.showTokenEstimate = value;
            await this.plugin.saveSettings();
          });
      });
  }

  /* ---------------------------------------------------------------------- */
  /* Sync                                                                   */
  /* ---------------------------------------------------------------------- */

  private renderSyncSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('Database sync').setHeading();
    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'Optional. Sends tags to a PostgreSQL database through a helper service you run yourself. Every tag carries a UUID, which is what the database keys on.'
    });

    new Setting(containerEl)
      .setName('Enable sync')
      .addToggle(toggle => {
        toggle
          .setValue(this.plugin.settings.enablePostgresSync)
          .onChange(async (value) => {
            this.plugin.settings.enablePostgresSync = value;
            await this.saveAndRedraw();
          });
      });

    if (!this.plugin.settings.enablePostgresSync) {
      return;
    }

    new Setting(containerEl)
      .setName('Helper service URL')
      .setDesc('The local service that holds the database credentials and runs the queries.')
      .addText(text => {
        text
          .setPlaceholder('http://localhost:5000')
          .setValue(this.plugin.settings.pythonServiceUrl)
          .onChange(async (value) => {
            this.plugin.settings.pythonServiceUrl = value.trim();
            await this.plugin.saveSettings();
          });
        text.inputEl.addClass('semantic-ai-wide-input');
        text.inputEl.setAttribute('aria-label', 'Helper service URL');
      });

    new Setting(containerEl).setName('Connections').setHeading();

    const connections = this.plugin.settings.postgresConnections;

    if (connections.length === 0) {
      containerEl.createEl('p', {
        cls: 'semantic-ai-empty',
        text: 'No connections yet.'
      });
    }

    connections.forEach((conn, index) => {
      const connEl = containerEl.createDiv({ cls: 'semantic-ai-connection-item' });
      const isActive = this.plugin.settings.activeConnectionId === conn.id;

      new Setting(connEl)
        .setName(conn.name || 'Unnamed connection')
        .setDesc(this.connectionStatusText(conn.lastTestStatus, conn.lastTested, conn.lastTestMessage))
        .addButton(button => {
          button
            .setButtonText(isActive ? 'In use' : 'Use this one')
            .setDisabled(isActive)
            .onClick(async () => {
              this.plugin.settings.activeConnectionId = conn.id;
              await this.saveAndRedraw();
            });
        })
        .addExtraButton(button => {
          button
            .setIcon('trash-2')
            .setTooltip('Delete connection')
            .onClick(async () => {
              connections.splice(index, 1);
              if (this.plugin.settings.activeConnectionId === conn.id) {
                this.plugin.settings.activeConnectionId = connections[0]?.id || null;
              }
              await this.saveAndRedraw();
            });
          button.extraSettingsEl.setAttribute('aria-label', `Delete the ${conn.name} connection`);
        });

      new Setting(connEl)
        .setName('Name')
        .addText(text => {
          text
            .setPlaceholder('Local development')
            .setValue(conn.name)
            .onChange(async (value) => {
              conn.name = value;
              await this.plugin.saveSettings();
            });
          text.inputEl.setAttribute('aria-label', 'Connection name');
        });

      new Setting(connEl)
        .setName('Connection string')
        .setDesc('Sent to your helper service, not to any third party.')
        .addText(text => {
          text
            .setPlaceholder('postgresql://user:password@localhost:5432/database')
            .setValue(conn.connectionString)
            .onChange(async (value) => {
              conn.connectionString = value.trim();
              await this.plugin.saveSettings();
            });
          text.inputEl.type = 'password';
          text.inputEl.addClass('semantic-ai-wide-input semantic-ai-mono-input');
          text.inputEl.setAttribute('aria-label', 'Connection string');
        })
        .addButton(button => {
          button
            .setButtonText('Test')
            .onClick(async () => {
              button.setButtonText('Testing…');
              button.setDisabled(true);

              const result = await this.testPostgresConnection(conn.connectionString);

              conn.lastTested = new Date().toISOString();
              conn.lastTestStatus = result.success ? 'success' : 'failed';
              conn.lastTestMessage = result.message;
              await this.plugin.saveSettings();

              new Notice(result.message);
              this.display();
            });
        });
    });

    new Setting(containerEl)
      .setName('Add a connection')
      .addButton(button => {
        button
          .setButtonText('Add')
          .setCta()
          .onClick(async () => {
            const id = `conn_${Date.now()}`;
            connections.push({
              id,
              name: 'New connection',
              connectionString: '',
              lastTested: null,
              lastTestStatus: 'never',
              lastTestMessage: null
            });
            if (!this.plugin.settings.activeConnectionId) {
              this.plugin.settings.activeConnectionId = id;
            }
            await this.saveAndRedraw();
          });
      });
  }

  private connectionStatusText(
    status: 'success' | 'failed' | 'never',
    lastTested: string | null,
    message: string | null
  ): string {
    if (status === 'never' || !lastTested) {
      return 'Not tested yet.';
    }

    const when = new Date(lastTested).toLocaleString();
    const outcome = status === 'success' ? 'Last test succeeded' : 'Last test failed';
    return message ? `${outcome} at ${when}. ${message}` : `${outcome} at ${when}.`;
  }

  private async testPostgresConnection(connectionString: string): Promise<{ success: boolean; message: string }> {
    const serviceUrl = this.plugin.settings.pythonServiceUrl;

    if (!serviceUrl) {
      return { success: false, message: 'Set the helper service URL first.' };
    }

    if (!connectionString) {
      return { success: false, message: 'Enter a connection string first.' };
    }

    try {
      const response = await requestUrl({
        url: `${serviceUrl.replace(/\/$/, '')}/test-connection`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionString }),
        throw: false
      });

      if (response.status !== 200) {
        return { success: false, message: `Helper service returned ${response.status}.` };
      }

      const result = response.json;
      return {
        success: Boolean(result?.success),
        message: result?.success ? 'Connection succeeded.' : `Connection failed: ${result?.error || 'no detail given'}`
      };
    } catch {
      return {
        success: false,
        message: `Could not reach the helper service at ${serviceUrl}.`
      };
    }
  }
}

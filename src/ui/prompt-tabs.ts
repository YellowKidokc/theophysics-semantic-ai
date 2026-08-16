/**
 * Custom classifier settings.
 *
 * Categories are edited on the categories tab. A custom classifier is a
 * throwaway prompt invoked by keyword, for one-off passes over a note.
 */

import { Notice, Setting } from 'obsidian';
import { CustomClassifier } from '../types';
import { PromptManager } from '../ai/prompt-manager';

export function createCustomClassifierSettings(
  containerEl: HTMLElement,
  promptManager: PromptManager,
  onSave: () => void
): void {
  new Setting(containerEl).setName('Custom classifiers').setHeading();
  containerEl.createEl('p', {
    cls: 'setting-item-description',
    text: 'A classifier is a prompt you can run on demand without adding a category. Results are tagged with the keyword you give it.'
  });

  const listEl = containerEl.createDiv({ cls: 'semantic-ai-classifier-list' });

  function renderClassifiers(): void {
    listEl.empty();

    const classifiers = promptManager.getCustomClassifiers();

    if (classifiers.length === 0) {
      listEl.createEl('p', {
        cls: 'semantic-ai-empty',
        text: 'No custom classifiers yet.'
      });
      return;
    }

    for (const classifier of classifiers) {
      createClassifierItem(listEl, classifier, promptManager, onSave, renderClassifiers);
    }
  }

  renderClassifiers();

  new Setting(containerEl).setName('Add a classifier').setHeading();

  let newKeyword = '';
  let newPrompt = '';

  new Setting(containerEl)
    .setName('Keyword')
    .setDesc('A short unique word used to invoke this classifier, for example "method" or "objection".')
    .addText(text => {
      text
        .setPlaceholder('keyword')
        .onChange(value => {
          newKeyword = value;
        });
      text.inputEl.setAttribute('aria-label', 'Keyword for the new classifier');
    });

  new Setting(containerEl)
    .setName('Prompt')
    .setDesc('What the model should look for when this keyword runs.')
    .addTextArea(text => {
      text
        .setPlaceholder('Identify every … Return each with a short label.')
        .onChange(value => {
          newPrompt = value;
        });
      text.inputEl.rows = 4;
      text.inputEl.addClass('semantic-ai-wide-input');
      text.inputEl.setAttribute('aria-label', 'Prompt for the new classifier');
    });

  new Setting(containerEl)
    .addButton(button => {
      button
        .setButtonText('Add classifier')
        .setCta()
        .onClick(() => {
          if (!newKeyword.trim() || !newPrompt.trim()) {
            new Notice('Give the classifier a keyword and a prompt.');
            return;
          }

          const keyword = newKeyword.trim();

          if (promptManager.findClassifierByKeyword(keyword)) {
            new Notice(`A classifier called "${keyword}" already exists.`);
            return;
          }

          promptManager.addCustomClassifier(keyword, newPrompt.trim());
          onSave();
          renderClassifiers();

          newKeyword = '';
          newPrompt = '';
        });
    });
}

function createClassifierItem(
  containerEl: HTMLElement,
  classifier: CustomClassifier,
  promptManager: PromptManager,
  onSave: () => void,
  rerender: () => void
): void {
  const itemEl = containerEl.createDiv({ cls: 'semantic-ai-classifier-item' });

  new Setting(itemEl)
    .setName(classifier.keyword)
    .setDesc(classifier.enabled ? 'Enabled' : 'Disabled')
    .addToggle(toggle => {
      toggle
        .setValue(classifier.enabled)
        .onChange(value => {
          promptManager.updateCustomClassifier(classifier.id, { enabled: value });
          onSave();
          rerender();
        });
      toggle.toggleEl.setAttribute('aria-label', `Enable the ${classifier.keyword} classifier`);
    })
    .addExtraButton(button => {
      button
        .setIcon('trash-2')
        .setTooltip('Delete classifier')
        .onClick(() => {
          promptManager.removeCustomClassifier(classifier.id);
          onSave();
          rerender();
        });
      button.extraSettingsEl.setAttribute('aria-label', `Delete the ${classifier.keyword} classifier`);
    });

  new Setting(itemEl)
    .setName('Prompt')
    .addTextArea(text => {
      text
        .setValue(classifier.prompt)
        .onChange(value => {
          promptManager.updateCustomClassifier(classifier.id, { prompt: value });
          onSave();
        });
      text.inputEl.rows = 3;
      text.inputEl.addClass('semantic-ai-wide-input');
      text.inputEl.setAttribute('aria-label', `Prompt for the ${classifier.keyword} classifier`);
    });
}

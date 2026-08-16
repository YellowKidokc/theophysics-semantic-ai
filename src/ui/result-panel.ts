/**
 * Modals shown around a classification run: the preview, the batch runner,
 * and the category picker.
 */

import { Modal, App, Setting, TFile } from 'obsidian';
import {
  CategoryDefinition,
  ClassificationResult,
  SemanticAISettings,
  TagType,
  TokenEstimate,
  categoryColor,
  categoryName
} from '../types';
import { getTagCounts } from '../tagging/tag-writer';

const PREVIEW_LIMIT = 12;

/**
 * Shows what the model found and lets the user apply or discard it.
 */
export class ClassificationResultModal extends Modal {
  private settings: SemanticAISettings;
  private result: ClassificationResult;
  private filePath: string;
  private onConfirm: () => void;

  constructor(
    app: App,
    settings: SemanticAISettings,
    result: ClassificationResult,
    filePath: string,
    onConfirm: () => void
  ) {
    super(app);
    this.settings = settings;
    this.result = result;
    this.filePath = filePath;
    this.onConfirm = onConfirm;
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    contentEl.addClass('semantic-ai-result-modal');

    titleEl.setText('Classification results');

    contentEl.createEl('p', {
      cls: 'semantic-ai-file-path',
      text: this.filePath
    });

    const counts = getTagCounts(this.result.tags);
    const summaryEl = contentEl.createDiv({ cls: 'semantic-ai-result-summary' });

    const total = this.result.tags.length;
    summaryEl.createEl('p', {
      text: `Found ${total} element${total === 1 ? '' : 's'}:`
    });

    const countsList = summaryEl.createEl('ul');
    for (const [type, count] of Object.entries(counts)) {
      countsList.createEl('li', {
        text: `${categoryName(this.settings, type)}: ${count}`
      });
    }

    if (total > 0) {
      const previewEl = contentEl.createDiv({ cls: 'semantic-ai-tag-preview' });
      const previewList = previewEl.createDiv({ cls: 'semantic-ai-preview-list' });

      for (const tag of this.result.tags.slice(0, PREVIEW_LIMIT)) {
        const tagEl = previewList.createDiv({ cls: 'semantic-ai-preview-tag' });

        const badge = tagEl.createSpan({
          cls: 'semantic-ai-tag-type',
          text: categoryName(this.settings, tag.customType || tag.type)
        });
        badge.dataset.color = String(categoryColor(this.settings, tag.type));

        tagEl.createSpan({ cls: 'semantic-ai-tag-label', text: tag.label });

        if (tag.topics?.length) {
          tagEl.createSpan({
            cls: 'semantic-ai-tag-topics',
            text: tag.topics.join(', ')
          });
        }
      }

      if (total > PREVIEW_LIMIT) {
        previewList.createEl('p', {
          cls: 'semantic-ai-more',
          text: `… and ${total - PREVIEW_LIMIT} more`
        });
      }
    }

    new Setting(contentEl)
      .addButton(button => {
        button
          .setButtonText('Cancel')
          .onClick(() => this.close());
      })
      .addButton(button => {
        button
          .setButtonText('Apply tags')
          .setCta()
          .onClick(() => {
            this.onConfirm();
            this.close();
          });
        // Focus the primary action so the modal is usable from the keyboard.
        window.setTimeout(() => button.buttonEl.focus(), 0);
      });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/**
 * Confirms a batch run, then reports progress while it goes.
 */
export class BatchProcessingModal extends Modal {
  private files: TFile[];
  private estimate: TokenEstimate;
  private showEstimate: boolean;
  private onConfirm: () => void;
  private onCancelRunCallback: (() => void) | null = null;

  private progressEl: HTMLElement | null = null;
  private resultsEl: HTMLElement | null = null;
  private startButton: HTMLButtonElement | null = null;
  private isProcessing = false;

  constructor(
    app: App,
    files: TFile[],
    estimate: TokenEstimate,
    showEstimate: boolean,
    onConfirm: () => void
  ) {
    super(app);
    this.files = files;
    this.estimate = estimate;
    this.showEstimate = showEstimate;
    this.onConfirm = onConfirm;
  }

  /** Register a callback used when the user stops a run mid-way. */
  onCancelRun(callback: () => void): void {
    this.onCancelRunCallback = callback;
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    contentEl.addClass('semantic-ai-batch-modal');

    titleEl.setText('Classify a folder');

    contentEl.createEl('p', {
      text: `${this.files.length} note${this.files.length === 1 ? '' : 's'} will be sent to the AI provider, one request each.`
    });

    if (this.showEstimate) {
      const estimateEl = contentEl.createDiv({ cls: 'semantic-ai-estimate' });
      const estimateList = estimateEl.createEl('ul');
      estimateList.createEl('li', {
        text: `Approximate tokens: ${(this.estimate.inputTokens + this.estimate.estimatedOutputTokens).toLocaleString()}`
      });
      estimateList.createEl('li', {
        text: this.estimate.estimatedCost > 0
          ? `Approximate cost: $${this.estimate.estimatedCost.toFixed(4)} at list prices`
          : 'No cost estimate available for this model.'
      });
    }

    const fileListEl = contentEl.createDiv({ cls: 'semantic-ai-file-list' });
    const list = fileListEl.createEl('ul');
    for (const file of this.files.slice(0, 20)) {
      list.createEl('li', { text: file.path });
    }
    if (this.files.length > 20) {
      list.createEl('li', {
        cls: 'semantic-ai-more',
        text: `… and ${this.files.length - 20} more`
      });
    }

    this.progressEl = contentEl.createDiv({ cls: 'semantic-ai-progress hidden' });
    this.resultsEl = this.progressEl.createDiv({ cls: 'semantic-ai-progress-results' });
    // Announce each file as it finishes for screen reader users.
    this.resultsEl.setAttribute('role', 'log');
    this.resultsEl.setAttribute('aria-live', 'polite');
    this.resultsEl.setAttribute('aria-label', 'Batch progress');

    new Setting(contentEl)
      .addButton(button => {
        button
          .setButtonText('Cancel')
          .onClick(() => {
            if (this.isProcessing) {
              this.onCancelRunCallback?.();
              button.setButtonText('Stopping…');
              button.setDisabled(true);
            } else {
              this.close();
            }
          });
      })
      .addButton(button => {
        this.startButton = button.buttonEl;
        button
          .setButtonText('Start')
          .setCta()
          .onClick(() => {
            if (this.isProcessing) {
              return;
            }
            this.isProcessing = true;
            this.progressEl?.removeClass('hidden');
            button.setDisabled(true);
            button.setButtonText('Working…');
            this.onConfirm();
          });
      });
  }

  updateProgress(file: string, status: string, counts?: Record<string, number>): void {
    if (!this.resultsEl) return;

    const itemEl = this.resultsEl.createDiv({ cls: 'semantic-ai-progress-item' });
    itemEl.createSpan({
      cls: 'semantic-ai-progress-file',
      text: file.split('/').pop() || file
    });

    if (status === 'complete' && counts) {
      const countsText = Object.entries(counts)
        .map(([type, count]) => `${count} ${type}`)
        .join(', ');

      itemEl.createSpan({
        cls: 'semantic-ai-progress-counts',
        text: countsText || 'nothing found'
      });
    } else if (status === 'processing') {
      itemEl.createSpan({ cls: 'semantic-ai-progress-counts', text: 'working…' });
    } else {
      itemEl.createSpan({ cls: 'semantic-ai-progress-error', text: status });
    }

    this.resultsEl.scrollTop = this.resultsEl.scrollHeight;
  }

  complete(totalTags: number): void {
    this.isProcessing = false;

    this.progressEl?.createEl('p', {
      cls: 'semantic-ai-complete',
      text: `Done. ${totalTags} tag${totalTags === 1 ? '' : 's'} written.`
    });

    if (this.startButton) {
      this.startButton.disabled = false;
      this.startButton.setText('Close');
      this.startButton.addEventListener('click', () => this.close());
      this.startButton.focus();
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/**
 * Lets the user pick which categories a single run should look for.
 */
export class TagSelectionModal extends Modal {
  private categories: CategoryDefinition[];
  private selected: Set<TagType>;
  private onConfirm: (types: TagType[]) => void;

  constructor(
    app: App,
    categories: CategoryDefinition[],
    defaultTypes: TagType[],
    onConfirm: (types: TagType[]) => void
  ) {
    super(app);
    this.categories = categories;
    this.selected = new Set(defaultTypes);
    this.onConfirm = onConfirm;
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    contentEl.addClass('semantic-ai-selection-modal');

    titleEl.setText('Choose categories');

    if (this.categories.length === 0) {
      contentEl.createEl('p', {
        text: 'No categories are defined. Add some in the plugin settings.'
      });
      return;
    }

    const typesEl = contentEl.createDiv({ cls: 'semantic-ai-type-selection' });
    const toggles = new Map<TagType, (value: boolean) => void>();

    for (const category of this.categories) {
      new Setting(typesEl)
        .setName(category.name)
        .setDesc(category.prompt.slice(0, 120) + (category.prompt.length > 120 ? '…' : ''))
        .addToggle(toggle => {
          toggle
            .setValue(this.selected.has(category.id))
            .onChange(value => {
              if (value) {
                this.selected.add(category.id);
              } else {
                this.selected.delete(category.id);
              }
            });

          toggles.set(category.id, (value: boolean) => toggle.setValue(value));
        });
    }

    const setAll = (value: boolean): void => {
      for (const category of this.categories) {
        if (value) {
          this.selected.add(category.id);
        } else {
          this.selected.delete(category.id);
        }
        toggles.get(category.id)?.(value);
      }
    };

    new Setting(contentEl)
      .addButton(button => button.setButtonText('Select all').onClick(() => setAll(true)))
      .addButton(button => button.setButtonText('Clear all').onClick(() => setAll(false)));

    new Setting(contentEl)
      .addButton(button => {
        button.setButtonText('Cancel').onClick(() => this.close());
      })
      .addButton(button => {
        button
          .setButtonText('Classify')
          .setCta()
          .onClick(() => {
            if (this.selected.size === 0) {
              return;
            }
            this.onConfirm(Array.from(this.selected));
            this.close();
          });
        window.setTimeout(() => button.buttonEl.focus(), 0);
      });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

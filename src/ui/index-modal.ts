/**
 * Modals for building the concept index: confirm, progress, and folder picker.
 */

import { App, Modal, Setting, TFolder } from 'obsidian';
import { IndexCostEstimate } from '../indexing/vault-indexer';

export class IndexConfirmationModal extends Modal {
  private indexScope: 'folder' | 'vault';
  private scopePath: string;
  private estimate: IndexCostEstimate;
  private onConfirm: () => void;

  constructor(
    app: App,
    scope: 'folder' | 'vault',
    scopePath: string,
    estimate: IndexCostEstimate,
    onConfirm: () => void
  ) {
    super(app);
    this.indexScope = scope;
    this.scopePath = scopePath;
    this.estimate = estimate;
    this.onConfirm = onConfirm;
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    contentEl.addClass('semantic-ai-index-modal');

    titleEl.setText(this.indexScope === 'vault' ? 'Index the whole vault' : 'Index a folder');

    contentEl.createEl('p', {
      text: this.indexScope === 'vault'
        ? 'Scans every markdown note in the vault for tags this plugin has written.'
        : `Scans every markdown note in ${this.scopePath} for tags this plugin has written.`
    });

    const estimateSection = contentEl.createDiv({ cls: 'semantic-ai-estimate-section' });
    const estimateGrid = estimateSection.createDiv({ cls: 'semantic-ai-estimate-grid' });

    this.addEstimateItem(estimateGrid, 'Notes to scan', String(this.estimate.fileCount));
    this.addEstimateItem(estimateGrid, 'Characters', this.estimate.totalCharacters.toLocaleString());
    this.addEstimateItem(estimateGrid, 'Approximate tokens', this.estimate.estimatedTokens.toLocaleString());

    contentEl.createEl('p', {
      cls: 'semantic-ai-cost-note',
      text: 'Indexing reads tags that are already in your notes. It makes no AI requests and costs nothing.'
    });

    if (this.estimate.warning) {
      contentEl.createEl('p', {
        cls: 'semantic-ai-index-warning',
        text: this.estimate.warning
      });
    }

    if (this.indexScope === 'vault') {
      contentEl.createEl('p', {
        cls: 'semantic-ai-muted',
        text: 'Indexing one folder at a time is faster on a large vault.'
      });
    }

    const infoSection = contentEl.createDiv({ cls: 'semantic-ai-index-info' });
    infoSection.createEl('p', { text: 'The index gives you:' });
    const infoList = infoSection.createEl('ul');
    infoList.createEl('li', { text: 'A cross-reference of every tagged concept' });
    infoList.createEl('li', { text: 'Where each concept appears' });
    infoList.createEl('li', { text: 'Which notes share concepts, and how strongly' });

    new Setting(contentEl)
      .addButton(button => {
        button.setButtonText('Cancel').onClick(() => this.close());
      })
      .addButton(button => {
        button
          .setButtonText(this.indexScope === 'vault' ? 'Index vault' : 'Index folder')
          .setCta()
          .onClick(() => {
            this.onConfirm();
            this.close();
          });
        window.setTimeout(() => button.buttonEl.focus(), 0);
      });
  }

  private addEstimateItem(container: HTMLElement, label: string, value: string): void {
    const item = container.createDiv({ cls: 'semantic-ai-estimate-item' });
    item.createSpan({ cls: 'semantic-ai-estimate-label', text: label });
    item.createSpan({ cls: 'semantic-ai-estimate-value', text: value });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class IndexProgressModal extends Modal {
  private statusEl: HTMLElement | null = null;
  private currentFileEl: HTMLElement | null = null;
  private progressBar: HTMLElement | null = null;

  onOpen(): void {
    const { contentEl, titleEl } = this;
    contentEl.addClass('semantic-ai-progress-modal');

    titleEl.setText('Building index');

    this.statusEl = contentEl.createEl('p', { cls: 'semantic-ai-progress-status' });
    this.statusEl.setAttribute('role', 'status');
    this.statusEl.setAttribute('aria-live', 'polite');
    this.statusEl.setText('Starting…');

    const progressContainer = contentEl.createDiv({ cls: 'semantic-ai-progress-bar-container' });
    progressContainer.setAttribute('role', 'progressbar');
    progressContainer.setAttribute('aria-valuemin', '0');
    progressContainer.setAttribute('aria-valuemax', '100');
    progressContainer.setAttribute('aria-valuenow', '0');
    progressContainer.setAttribute('aria-label', 'Indexing progress');

    // Width comes from a CSS custom property; the stylesheet owns the rest.
    this.progressBar = progressContainer.createDiv({ cls: 'semantic-ai-progress-bar' });
    this.setProgress(0);

    this.currentFileEl = contentEl.createEl('p', { cls: 'semantic-ai-current-file' });
  }

  private setProgress(percent: number): void {
    const clamped = Math.max(0, Math.min(100, Math.round(percent)));
    this.progressBar?.setCssProps({ '--semantic-ai-progress': `${clamped}%` });
    this.progressBar?.parentElement?.setAttribute('aria-valuenow', String(clamped));
  }

  updateProgress(current: number, total: number, fileName: string): void {
    const percent = total > 0 ? (current / total) * 100 : 0;

    this.statusEl?.setText(`Processing ${current} of ${total} notes (${Math.round(percent)}%)`);
    this.setProgress(percent);
    this.currentFileEl?.setText(fileName);
  }

  complete(stats: { files: number; concepts: number; relations: number; timeMs: number }): void {
    this.statusEl?.setText('Index complete.');
    this.setProgress(100);
    this.progressBar?.addClass('complete');
    this.currentFileEl?.setText('');

    const statsEl = this.contentEl.createDiv({ cls: 'semantic-ai-index-stats' });
    const list = statsEl.createEl('ul');
    list.createEl('li', { text: `Notes indexed: ${stats.files}` });
    list.createEl('li', { text: `Concepts found: ${stats.concepts}` });
    list.createEl('li', { text: `Relationships: ${stats.relations}` });
    list.createEl('li', { text: `Time taken: ${(stats.timeMs / 1000).toFixed(2)}s` });

    new Setting(this.contentEl)
      .addButton(button => {
        button
          .setButtonText('Close')
          .setCta()
          .onClick(() => this.close());
        window.setTimeout(() => button.buttonEl.focus(), 0);
      });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class FolderSelectionModal extends Modal {
  private folders: TFolder[];
  private onSelect: (folder: TFolder) => void;

  constructor(app: App, folders: TFolder[], onSelect: (folder: TFolder) => void) {
    super(app);
    this.folders = folders;
    this.onSelect = onSelect;
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    contentEl.addClass('semantic-ai-folder-modal');

    titleEl.setText('Choose a folder to index');

    const folderList = contentEl.createDiv({ cls: 'semantic-ai-folder-list' });
    const sorted = [...this.folders].sort((a, b) => a.path.localeCompare(b.path));

    sorted.forEach((folder, index) => {
      const item = folderList.createEl('button', {
        cls: 'semantic-ai-folder-item',
        text: folder.isRoot() ? 'Vault root' : folder.path
      });
      item.type = 'button';

      item.addEventListener('click', () => {
        this.onSelect(folder);
        this.close();
      });

      if (index === 0) {
        window.setTimeout(() => item.focus(), 0);
      }
    });

    new Setting(contentEl)
      .addButton(button => {
        button.setButtonText('Cancel').onClick(() => this.close());
      });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/**
 * Semantic AI
 * Classifies notes against a taxonomy you define, writes the results back as
 * UUID-stamped tags, and draws the result as a graph.
 */

import {
  Plugin,
  TFile,
  TFolder,
  Notice,
  MarkdownView,
  Menu,
  Editor,
  WorkspaceLeaf
} from 'obsidian';

import {
  SemanticAISettings,
  TagType,
  SemanticTag,
  enabledCategoryIds,
  migrateSettings
} from './types';

import { SemanticAISettingTab } from './settings';
import { PromptManager } from './ai/prompt-manager';
import { AIClassifier, BatchClassifier } from './ai/classifier';
import {
  writeTags,
  readTags,
  setConceptRegistry
} from './tagging/tag-writer';
import { ConceptRegistry } from './tagging/concept-registry';
import { MermaidView, MERMAID_VIEW_TYPE, createMermaidCodeBlock } from './ui/mermaid-view';
import {
  ClassificationResultModal,
  BatchProcessingModal,
  TagSelectionModal
} from './ui/result-panel';
import { VaultIndexer } from './indexing/vault-indexer';
import { ConceptTrackerView, CONCEPT_TRACKER_VIEW_TYPE } from './ui/concept-tracker-view';
import {
  ConceptJourneyView,
  CONCEPT_JOURNEY_VIEW_TYPE,
  ConceptJourney,
  JourneyAnalysis
} from './ui/concept-journey-view';
import {
  IndexConfirmationModal,
  IndexProgressModal,
  FolderSelectionModal
} from './ui/index-modal';

const TAG_BLOCK_END = '%%--- END SEMANTIC TAGS ---%%';

export default class SemanticAIPlugin extends Plugin {
  settings: SemanticAISettings;
  promptManager: PromptManager;
  classifier: AIClassifier;
  vaultIndexer: VaultIndexer;
  conceptRegistry: ConceptRegistry;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.promptManager = new PromptManager(this.settings);
    this.classifier = new AIClassifier(this.settings, this.promptManager);
    this.vaultIndexer = new VaultIndexer(this.app.vault);

    // Shared registry so the same concept keeps the same UUID across notes.
    this.conceptRegistry = new ConceptRegistry(this.app.vault, this.manifest.dir);
    await this.conceptRegistry.load();
    setConceptRegistry(this.conceptRegistry);

    this.registerView(
      MERMAID_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new MermaidView(leaf, this.settings)
    );

    this.registerView(
      CONCEPT_TRACKER_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new ConceptTrackerView(leaf, this.settings, (filePath) => {
        this.openFileByPath(filePath);
      })
    );

    this.registerView(
      CONCEPT_JOURNEY_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new ConceptJourneyView(leaf)
    );

    this.addSettingTab(new SemanticAISettingTab(this.app, this));

    this.addRibbonIcon('brain', 'Semantic AI', (evt: MouseEvent) => {
      this.showSemanticMenu(evt);
    });

    this.registerCommands();
    this.registerContextMenu();
  }

  async onunload(): Promise<void> {
    if (this.conceptRegistry?.isDirty()) {
      await this.conceptRegistry.save();
    }
  }

  async loadSettings(): Promise<void> {
    this.settings = migrateSettings(await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);

    this.promptManager?.updateSettings(this.settings);
    this.classifier?.updateSettings(this.settings);

    for (const leaf of this.app.workspace.getLeavesOfType(MERMAID_VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof MermaidView) {
        view.updateSettings(this.settings);
      }
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Commands                                                               */
  /* ---------------------------------------------------------------------- */

  private registerCommands(): void {
    this.addCommand({
      id: 'classify-note',
      name: 'Classify current note',
      editorCallback: async (_editor: Editor, view: MarkdownView) => {
        await this.runClassifier(view.file);
      }
    });

    this.addCommand({
      id: 'classify-note-choose-categories',
      name: 'Classify current note, choosing categories',
      editorCallback: async (_editor: Editor, view: MarkdownView) => {
        await this.runClassifierWithSelection(view.file);
      }
    });

    // One command per category, so any taxonomy gets its own shortcuts.
    // Registered from saved settings at load time; changing categories takes
    // effect after Obsidian reloads the plugin.
    for (const category of this.settings.categories) {
      this.addCommand({
        id: `classify-as-${category.id.toLowerCase()}`,
        name: `Classify as: ${category.name.toLowerCase()}`,
        editorCallback: async (_editor: Editor, view: MarkdownView) => {
          await this.classifyAs(view.file, category.id);
        }
      });
    }

    for (const classifier of this.settings.customClassifiers) {
      this.addCommand({
        id: `run-classifier-${classifier.id}`,
        name: `Run classifier: ${classifier.keyword}`,
        editorCallback: async (_editor: Editor, view: MarkdownView) => {
          await this.runCustomClassifier(view.file, classifier.keyword);
        }
      });
    }

    this.addCommand({
      id: 'toggle-tag-visibility',
      name: 'Toggle tag block visibility',
      callback: async () => {
        this.settings.showHiddenTags = !this.settings.showHiddenTags;
        await this.saveSettings();
        new Notice(this.settings.showHiddenTags ? 'Tag blocks shown' : 'Tag blocks hidden');
      }
    });

    this.addCommand({
      id: 'open-semantic-map',
      name: 'Open semantic map for current note',
      editorCallback: async (_editor: Editor, view: MarkdownView) => {
        await this.openSemanticMap(view.file);
      }
    });

    this.addCommand({
      id: 'regenerate-graph',
      name: 'Regenerate graph for current note',
      editorCallback: async (_editor: Editor, view: MarkdownView) => {
        await this.regenerateGraph(view.file);
      }
    });

    this.addCommand({
      id: 'batch-classify-folder',
      name: 'Classify every note in the current folder',
      callback: async () => {
        const folder = this.app.workspace.getActiveFile()?.parent;
        if (folder) {
          await this.batchClassifyFolder(folder);
        } else {
          new Notice('Open a note first, so there is a folder to work on.');
        }
      }
    });

    this.addCommand({
      id: 'index-current-folder',
      name: 'Index the current folder',
      callback: async () => {
        const folder = this.app.workspace.getActiveFile()?.parent;
        if (folder) {
          await this.indexFolder(folder);
        } else {
          new Notice('Open a note first, so there is a folder to index.');
        }
      }
    });

    this.addCommand({
      id: 'index-choose-folder',
      name: 'Index a folder, choosing which',
      callback: async () => {
        await this.showFolderSelectionForIndex();
      }
    });

    this.addCommand({
      id: 'index-vault',
      name: 'Index the whole vault',
      callback: async () => {
        await this.indexVault();
      }
    });

    this.addCommand({
      id: 'open-concept-tracker',
      name: 'Open concept tracker',
      callback: async () => {
        await this.openConceptTracker();
      }
    });

    this.addCommand({
      id: 'open-concept-journey',
      name: 'Open concept journey',
      callback: async () => {
        await this.openConceptJourney();
      }
    });

    this.addCommand({
      id: 'show-registry-stats',
      name: 'Show concept registry statistics',
      callback: () => {
        const stats = this.conceptRegistry.getStats();
        const typeBreakdown = Object.entries(stats.byType)
          .map(([type, count]) => `  ${type}: ${count}`)
          .join('\n');

        new Notice(
          `Concepts: ${stats.totalConcepts}\n` +
          `With aliases: ${stats.withAliases}\n` +
          `Updated: ${new Date(stats.lastUpdated).toLocaleString()}\n` +
          `By category:\n${typeBreakdown}`,
          10000
        );
      }
    });

    this.addCommand({
      id: 'export-registry',
      name: 'Export concept registry',
      callback: async () => {
        const filename = `concept-registry-${new Date().toISOString().split('T')[0]}.json`;

        if (this.app.vault.getAbstractFileByPath(filename)) {
          new Notice(`${filename} already exists. Delete or rename it first.`);
          return;
        }

        await this.app.vault.create(filename, this.conceptRegistry.exportJSON());
        new Notice(`Exported to ${filename}`);
      }
    });

    this.addCommand({
      id: 'save-registry',
      name: 'Save concept registry',
      callback: async () => {
        await this.conceptRegistry.save();
        new Notice('Concept registry saved');
      }
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Menus                                                                  */
  /* ---------------------------------------------------------------------- */

  private registerContextMenu(): void {
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu: Menu, file) => {
        if (file instanceof TFile && file.extension === 'md') {
          menu.addSeparator();

          menu.addItem((item) => {
            item
              .setTitle('Classify note')
              .setIcon('brain')
              .onClick(async () => {
                await this.runClassifier(file);
              });
          });

          menu.addItem((item) => {
            item
              .setTitle('Classify, choosing categories')
              .setIcon('tag')
              .onClick(async () => {
                await this.runClassifierWithSelection(file);
              });
          });

          menu.addItem((item) => {
            item
              .setTitle('Open semantic map')
              .setIcon('git-branch')
              .onClick(async () => {
                await this.openSemanticMap(file);
              });
          });
        }

        if (file instanceof TFolder) {
          menu.addSeparator();

          menu.addItem((item) => {
            item
              .setTitle('Classify every note in this folder')
              .setIcon('brain')
              .onClick(async () => {
                await this.batchClassifyFolder(file);
              });
          });

          menu.addItem((item) => {
            item
              .setTitle('Index this folder')
              .setIcon('search')
              .onClick(async () => {
                await this.indexFolder(file);
              });
          });
        }
      })
    );

    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu: Menu, _editor: Editor, view: MarkdownView) => {
        menu.addSeparator();

        menu.addItem((item) => {
          item
            .setTitle('Classify note')
            .setIcon('brain')
            .onClick(async () => {
              await this.runClassifier(view.file);
            });
        });

        menu.addItem((item) => {
          item
            .setTitle('Open semantic map')
            .setIcon('git-branch')
            .onClick(async () => {
              await this.openSemanticMap(view.file);
            });
        });
      })
    );
  }

  private showSemanticMenu(evt: MouseEvent): void {
    const menu = new Menu();

    menu.addItem((item) => {
      item
        .setTitle('Classify current note')
        .setIcon('brain')
        .onClick(async () => {
          await this.runClassifier(this.app.workspace.getActiveFile());
        });
    });

    menu.addItem((item) => {
      item
        .setTitle('Classify, choosing categories')
        .setIcon('tag')
        .onClick(async () => {
          await this.runClassifierWithSelection(this.app.workspace.getActiveFile());
        });
    });

    menu.addItem((item) => {
      item
        .setTitle('Open semantic map')
        .setIcon('git-branch')
        .onClick(async () => {
          await this.openSemanticMap(this.app.workspace.getActiveFile());
        });
    });

    menu.addSeparator();

    menu.addItem((item) => {
      item
        .setTitle('Open concept tracker')
        .setIcon('search')
        .onClick(async () => {
          await this.openConceptTracker();
        });
    });

    menu.addItem((item) => {
      item
        .setTitle('Open concept journey')
        .setIcon('route')
        .onClick(async () => {
          await this.openConceptJourney();
        });
    });

    menu.addItem((item) => {
      item
        .setTitle('Index the whole vault')
        .setIcon('vault')
        .onClick(async () => {
          await this.indexVault();
        });
    });

    menu.showAtMouseEvent(evt);
  }

  /* ---------------------------------------------------------------------- */
  /* Classification                                                         */
  /* ---------------------------------------------------------------------- */

  async runClassifier(file: TFile | null): Promise<void> {
    await this.runClassifierWithTypes(file, enabledCategoryIds(this.settings));
  }

  async runClassifierWithSelection(file: TFile | null): Promise<void> {
    if (!file) {
      new Notice('No note is open.');
      return;
    }

    new TagSelectionModal(
      this.app,
      this.settings.categories,
      enabledCategoryIds(this.settings),
      async (types) => {
        await this.runClassifierWithTypes(file, types);
      }
    ).open();
  }

  async runClassifierWithTypes(file: TFile | null, types: TagType[]): Promise<void> {
    if (!file) {
      new Notice('No note is open.');
      return;
    }

    const validation = this.classifier.validateConfiguration();
    if (!validation.valid) {
      new Notice(`Cannot classify: ${validation.error}. Check the plugin settings.`);
      return;
    }

    const notice = new Notice('Classifying…', 0);

    try {
      const content = await this.app.vault.cachedRead(file);
      const result = await this.classifier.classify(content, types, file.path);
      notice.hide();

      if (result.tags.length === 0) {
        new Notice('Nothing matched the selected categories.');
        return;
      }

      this.showResult(file, result.tags, () => this.settings.autoGenerateMermaid);
    } catch (error) {
      notice.hide();
      new Notice(this.errorMessage(error), 10000);
    }
  }

  async classifyAs(file: TFile | null, type: TagType): Promise<void> {
    if (!file) {
      new Notice('No note is open.');
      return;
    }

    const validation = this.classifier.validateConfiguration();
    if (!validation.valid) {
      new Notice(`Cannot classify: ${validation.error}. Check the plugin settings.`);
      return;
    }

    const notice = new Notice('Classifying…', 0);

    try {
      const content = await this.app.vault.cachedRead(file);
      const result = await this.classifier.classifySingleType(content, type, file.path);
      notice.hide();

      if (result.tags.length === 0) {
        new Notice(`No ${this.promptManager.getTagTypeName(type).toLowerCase()} found.`);
        return;
      }

      this.showResult(file, result.tags, () => false);
    } catch (error) {
      notice.hide();
      new Notice(this.errorMessage(error), 10000);
    }
  }

  async runCustomClassifier(file: TFile | null, keyword: string): Promise<void> {
    if (!file) {
      new Notice('No note is open.');
      return;
    }

    const notice = new Notice(`Running "${keyword}"…`, 0);

    try {
      const content = await this.app.vault.cachedRead(file);
      const result = await this.classifier.classifyCustom(content, keyword, file.path);
      notice.hide();

      if (result.tags.length === 0) {
        new Notice(`"${keyword}" found nothing.`);
        return;
      }

      this.showResult(file, result.tags, () => false);
    } catch (error) {
      notice.hide();
      new Notice(this.errorMessage(error), 10000);
    }
  }

  /** Preview the tags, then write them if the user confirms. */
  private showResult(file: TFile, tags: SemanticTag[], wantsDiagram: () => boolean): void {
    new ClassificationResultModal(
      this.app,
      this.settings,
      { tags },
      file.path,
      async () => {
        await writeTags(this.app.vault, file, tags);
        new Notice(`Applied ${tags.length} tag${tags.length === 1 ? '' : 's'}`);

        if (this.conceptRegistry.isDirty()) {
          await this.conceptRegistry.save();
        }

        if (wantsDiagram()) {
          if (this.settings.mermaidPosition === 'panel') {
            await this.openSemanticMap(file);
          } else {
            await this.appendMermaid(file, tags);
          }
        }
      }
    ).open();
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Something went wrong.';
  }

  /* ---------------------------------------------------------------------- */
  /* Graph                                                                  */
  /* ---------------------------------------------------------------------- */

  async openSemanticMap(file: TFile | null): Promise<void> {
    if (!file) {
      new Notice('No note is open.');
      return;
    }

    const leaf = await this.revealLeaf(MERMAID_VIEW_TYPE);
    if (!leaf) {
      return;
    }

    const view = leaf.view;
    if (view instanceof MermaidView) {
      const tags = await readTags(this.app.vault, file);
      view.setTags(tags, file.path);
    }
  }

  async regenerateGraph(file: TFile | null): Promise<void> {
    if (!file) {
      new Notice('No note is open.');
      return;
    }

    const tags = await readTags(this.app.vault, file);

    if (tags.length === 0) {
      new Notice('This note has no tags yet.');
      return;
    }

    if (this.settings.mermaidPosition === 'panel') {
      await this.openSemanticMap(file);
    } else {
      await this.appendMermaid(file, tags);
    }
  }

  /**
   * Replace the note's diagram block with a fresh one.
   *
   * Uses Vault.process so the read and write are one atomic step, which keeps
   * a concurrent edit from being overwritten.
   */
  private async appendMermaid(file: TFile, tags: SemanticTag[]): Promise<void> {
    const mermaidBlock = createMermaidCodeBlock(tags, this.settings.graphDirection, this.settings);

    if (!mermaidBlock) {
      return;
    }

    await this.app.vault.process(file, (data) => {
      // Drop any block this plugin wrote previously.
      const content = data.replace(/\n\n```mermaid\ngraph[\s\S]*?```\n/g, '');

      const tagBlockIndex = content.indexOf('\n\n%%--- SEMANTIC TAGS ---%%');
      if (tagBlockIndex !== -1) {
        return content.slice(0, tagBlockIndex) + mermaidBlock + content.slice(tagBlockIndex);
      }

      return content.trimEnd() + mermaidBlock;
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Batch processing                                                       */
  /* ---------------------------------------------------------------------- */

  async batchClassifyFolder(folder: TFolder): Promise<void> {
    const validation = this.classifier.validateConfiguration();
    if (!validation.valid) {
      new Notice(`Cannot classify: ${validation.error}. Check the plugin settings.`);
      return;
    }

    const prefix = folder.isRoot() ? '' : `${folder.path}/`;
    const files = this.app.vault.getMarkdownFiles()
      .filter(f => f.path.startsWith(prefix));

    if (files.length === 0) {
      new Notice('No markdown notes in that folder.');
      return;
    }

    const types = enabledCategoryIds(this.settings);

    const fileContents = await Promise.all(
      files.map(async f => ({
        path: f.path,
        content: await this.app.vault.cachedRead(f)
      }))
    );

    const estimator = new BatchClassifier(this.classifier, () => undefined);
    const estimate = estimator.estimateBatchCost(fileContents, types);

    const modal = new BatchProcessingModal(
      this.app,
      files,
      {
        inputTokens: Math.round(estimate.totalTokens / 1.2),
        estimatedOutputTokens: Math.round(estimate.totalTokens - estimate.totalTokens / 1.2),
        estimatedCost: estimate.estimatedCost
      },
      this.settings.showTokenEstimate,
      async () => {
        let totalTags = 0;

        const processor = new BatchClassifier(
          this.classifier,
          (file, status, counts) => {
            modal.updateProgress(file, status, counts);
            if (counts) {
              totalTags += Object.values(counts).reduce((a, b) => a + b, 0);
            }
          }
        );

        modal.onCancelRun(() => processor.cancel());

        const results = await processor.processFiles(fileContents, types);

        for (const [path, result] of results) {
          if (result.tags.length === 0) {
            continue;
          }
          const file = this.app.vault.getAbstractFileByPath(path);
          if (file instanceof TFile) {
            await writeTags(this.app.vault, file, result.tags);
          }
        }

        if (this.conceptRegistry.isDirty()) {
          await this.conceptRegistry.save();
        }

        modal.complete(totalTags);
      }
    );

    modal.open();
  }

  /* ---------------------------------------------------------------------- */
  /* Indexing                                                               */
  /* ---------------------------------------------------------------------- */

  async indexFolder(folder: TFolder): Promise<void> {
    const estimate = await this.vaultIndexer.estimateIndexCost('folder', folder.path);

    new IndexConfirmationModal(
      this.app,
      'folder',
      folder.path,
      estimate,
      async () => {
        await this.runIndexing('folder', folder.path);
      }
    ).open();
  }

  async indexVault(): Promise<void> {
    const estimate = await this.vaultIndexer.estimateIndexCost('vault');

    new IndexConfirmationModal(
      this.app,
      'vault',
      '/',
      estimate,
      async () => {
        await this.runIndexing('vault');
      }
    ).open();
  }

  private async runIndexing(scope: 'folder' | 'vault', folderPath?: string): Promise<void> {
    const progressModal = new IndexProgressModal(this.app);
    progressModal.open();

    try {
      const index = await this.vaultIndexer.buildIndex(
        scope,
        folderPath,
        (current, total, fileName) => {
          progressModal.updateProgress(current, total, fileName);
        }
      );

      progressModal.complete({
        files: index.metadata.totalFiles,
        concepts: index.metadata.totalConcepts,
        relations: index.relations.length,
        timeMs: index.metadata.processingTimeMs || 0
      });

      await this.openConceptTracker();
    } catch (error) {
      progressModal.close();
      new Notice(`Indexing failed: ${this.errorMessage(error)}`);
    }
  }

  async showFolderSelectionForIndex(): Promise<void> {
    const folders = this.app.vault.getAllLoadedFiles()
      .filter((f): f is TFolder => f instanceof TFolder);

    new FolderSelectionModal(
      this.app,
      folders,
      async (folder) => {
        await this.indexFolder(folder);
      }
    ).open();
  }

  /* ---------------------------------------------------------------------- */
  /* Views                                                                  */
  /* ---------------------------------------------------------------------- */

  /** Find or create a leaf of the given type in the right sidebar. */
  private async revealLeaf(viewType: string): Promise<WorkspaceLeaf | null> {
    const existing = this.app.workspace.getLeavesOfType(viewType)[0];

    if (existing) {
      this.app.workspace.revealLeaf(existing);
      return existing;
    }

    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) {
      new Notice('Could not open the side panel.');
      return null;
    }

    await leaf.setViewState({ type: viewType, active: true });
    this.app.workspace.revealLeaf(leaf);
    return leaf;
  }

  private openFileByPath(filePath: string): void {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (file instanceof TFile) {
      this.app.workspace.getLeaf().openFile(file);
    }
  }

  async openConceptTracker(): Promise<void> {
    const leaf = await this.revealLeaf(CONCEPT_TRACKER_VIEW_TYPE);
    const view = leaf?.view;

    if (view instanceof ConceptTrackerView) {
      view.setIndex(this.vaultIndexer.getIndex());
    }
  }

  async openConceptJourney(): Promise<void> {
    const leaf = await this.revealLeaf(CONCEPT_JOURNEY_VIEW_TYPE);
    const view = leaf?.view;

    if (!(view instanceof ConceptJourneyView)) {
      return;
    }

    view.setDataSources(
      this.conceptRegistry,
      this.vaultIndexer.getIndex(),
      (filePath: string) => this.openFileByPath(filePath),
      async (journey: ConceptJourney): Promise<JourneyAnalysis> => this.analyzeConceptJourney(journey),
      async (journey: ConceptJourney): Promise<void> => this.generateConceptForwardLinks(journey)
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Concept journeys                                                       */
  /* ---------------------------------------------------------------------- */

  private async analyzeConceptJourney(journey: ConceptJourney): Promise<JourneyAnalysis> {
    const validation = this.classifier.validateConfiguration();
    if (!validation.valid) {
      throw new Error(`Cannot analyse: ${validation.error}.`);
    }

    const prompt = this.promptManager.buildConceptJourneyPrompt(
      journey.concept,
      journey.aliases,
      journey.occurrences.map(o => ({
        file: o.fileName,
        type: o.tag.type,
        label: o.tag.label
      }))
    );

    const response = await this.classifier.complete(prompt, 2048);

    let jsonStr = response.trim();

    const fenced = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) {
      jsonStr = fenced[1].trim();
    }

    const objectMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      jsonStr = objectMatch[0];
    }

    try {
      const analysis = JSON.parse(jsonStr);

      return {
        narrative: typeof analysis.narrative === 'string' ? analysis.narrative : 'No narrative returned.',
        contradictions: Array.isArray(analysis.contradictions) ? analysis.contradictions : [],
        gaps: Array.isArray(analysis.gaps) ? analysis.gaps : [],
        suggestions: Array.isArray(analysis.suggestions) ? analysis.suggestions : []
      };
    } catch {
      throw new Error('The model did not return valid JSON for this analysis.');
    }
  }

  /**
   * Link each occurrence of a concept to the next one, so a note points at
   * where the idea is picked up again.
   */
  private async generateConceptForwardLinks(journey: ConceptJourney): Promise<void> {
    if (journey.occurrences.length < 2) {
      new Notice('A concept needs at least two occurrences to link them up.');
      return;
    }

    let linksAdded = 0;

    for (let i = 0; i < journey.occurrences.length - 1; i++) {
      const current = journey.occurrences[i];
      const next = journey.occurrences[i + 1];

      const file = this.app.vault.getAbstractFileByPath(current.file);
      if (!(file instanceof TFile)) {
        continue;
      }

      const forwardLink = `\n%%forward-link::${journey.concept}::[[${next.fileName}]]%%`;
      let added = false;

      await this.app.vault.process(file, (content) => {
        if (content.includes(`forward-link::${journey.concept}`)) {
          return content;
        }

        added = true;

        const tagBlockEnd = content.indexOf(TAG_BLOCK_END);
        if (tagBlockEnd !== -1) {
          const cut = tagBlockEnd + TAG_BLOCK_END.length;
          return content.slice(0, cut) + forwardLink + content.slice(cut);
        }

        return content.trimEnd() + forwardLink;
      });

      if (added) {
        linksAdded++;
      }
    }

    new Notice(`Added ${linksAdded} forward link${linksAdded === 1 ? '' : 's'} for "${journey.concept}"`);
  }
}

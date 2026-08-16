/**
 * Concept Journey View
 * Track the evolution of a concept across documents with AI analysis
 */

import { ItemView, WorkspaceLeaf } from 'obsidian';
import { SemanticTag, TagType, hashToColorSlot } from '../types';
import { VaultIndex } from '../indexing/vault-indexer';
import { ConceptRegistry } from '../tagging/concept-registry';

export const CONCEPT_JOURNEY_VIEW_TYPE = 'concept-journey-view';

export interface ConceptOccurrence {
  file: string;
  fileName: string;
  tag: SemanticTag;
  context?: string;  // Surrounding text
  order: number;     // Processing order
}

export interface ConceptJourney {
  concept: string;
  aliases: string[];
  occurrences: ConceptOccurrence[];
  typeProgression: { type: TagType; file: string; count: number }[];
  relatedConcepts: string[];
}

export interface JourneyAnalysis {
  narrative: string;
  contradictions: string[];
  gaps: string[];
  suggestions: string[];
}

export class ConceptJourneyView extends ItemView {
  private container: HTMLElement;
  private searchInput: HTMLInputElement;
  private aliasContainer: HTMLElement;
  private journeyContainer: HTMLElement;
  private analysisContainer: HTMLElement;

  private currentJourney: ConceptJourney | null = null;
  private aliases: string[] = [];
  private registry: ConceptRegistry | null = null;
  private index: VaultIndex | null = null;

  private onAnalyzeRequest: ((journey: ConceptJourney) => Promise<JourneyAnalysis>) | null = null;
  private onOpenFile: ((filePath: string) => void) | null = null;
  private onGenerateForwardLinks: ((journey: ConceptJourney) => Promise<void>) | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return CONCEPT_JOURNEY_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Concept Journey';
  }

  getIcon(): string {
    return 'route';
  }

  async onOpen(): Promise<void> {
    this.container = this.contentEl;
    this.container.empty();
    this.container.addClass('concept-journey-view');

    this.renderView();
  }

  async onClose(): Promise<void> {
    this.container.empty();
  }

  /**
   * Set data sources
   */
  setDataSources(
    registry: ConceptRegistry,
    index: VaultIndex | null,
    onOpenFile: (filePath: string) => void,
    onAnalyzeRequest: (journey: ConceptJourney) => Promise<JourneyAnalysis>,
    onGenerateForwardLinks: (journey: ConceptJourney) => Promise<void>
  ): void {
    this.registry = registry;
    this.index = index;
    this.onOpenFile = onOpenFile;
    this.onAnalyzeRequest = onAnalyzeRequest;
    this.onGenerateForwardLinks = onGenerateForwardLinks;
  }

  /**
   * Render the main view
   */
  private renderView(): void {
    // Header
    const header = this.container.createEl('div', { cls: 'journey-header' });
    header.createEl('h3', { text: 'Concept journey' });
    header.createEl('p', {
      text: 'See how one concept develops across your notes',
      cls: 'journey-subtitle'
    });

    // Search section
    const searchSection = this.container.createEl('div', { cls: 'journey-search-section' });

    const searchRow = searchSection.createEl('div', { cls: 'journey-search-row' });
    this.searchInput = searchRow.createEl('input', {
      type: 'text',
      placeholder: 'Concept to trace',
      cls: 'journey-search-input'
    });

    const searchBtn = searchRow.createEl('button', {
      text: 'Track',
      cls: 'journey-search-btn'
    });
    searchBtn.addEventListener('click', () => this.searchConcept());

    this.searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.searchConcept();
    });

    // Alias section
    this.aliasContainer = searchSection.createEl('div', { cls: 'journey-alias-section' });
    this.renderAliasSection();

    // Journey timeline container
    this.journeyContainer = this.container.createEl('div', { cls: 'journey-timeline-container' });
    this.journeyContainer.createEl('div', {
      text: 'Search for a concept to see where it appears and how it develops.',
      cls: 'journey-placeholder'
    });

    // Analysis container
    this.analysisContainer = this.container.createEl('div', { cls: 'journey-analysis-container' });
  }

  /**
   * Render alias management section
   */
  private renderAliasSection(): void {
    this.aliasContainer.empty();

    const aliasHeader = this.aliasContainer.createEl('div', { cls: 'alias-header' });
    aliasHeader.createEl('span', { text: 'Aliases:', cls: 'alias-label' });

    const addAliasBtn = aliasHeader.createEl('button', {
      text: 'Add alias',
      cls: 'alias-add-btn'
    });
    addAliasBtn.addEventListener('click', () => this.showAddAliasInput());

    // Show current aliases
    if (this.aliases.length > 0) {
      const aliasList = this.aliasContainer.createEl('div', { cls: 'alias-list' });

      for (const alias of this.aliases) {
        const aliasTag = aliasList.createEl('span', { cls: 'alias-tag' });
        aliasTag.createEl('span', { text: alias });

        const removeBtn = aliasTag.createEl('span', {
          text: '×',
          cls: 'alias-remove'
        });
        removeBtn.addEventListener('click', () => {
          this.aliases = this.aliases.filter(a => a !== alias);
          this.renderAliasSection();
          if (this.currentJourney) {
            this.searchConcept(); // Refresh search
          }
        });
      }
    }
  }

  /**
   * Show input for adding alias
   */
  private showAddAliasInput(): void {
    const existing = this.aliasContainer.querySelector('.alias-input-row');
    if (existing) return;

    const inputRow = this.aliasContainer.createEl('div', { cls: 'alias-input-row' });

    const input = inputRow.createEl('input', {
      type: 'text',
      placeholder: 'Alias',
      cls: 'alias-input'
    });

    const addBtn = inputRow.createEl('button', { text: 'Add', cls: 'alias-confirm-btn' });

    const doAdd = () => {
      const value = input.value.trim();
      if (value && !this.aliases.includes(value)) {
        this.aliases.push(value);
        this.renderAliasSection();
        if (this.currentJourney) {
          this.searchConcept(); // Refresh
        }
      }
    };

    addBtn.addEventListener('click', doAdd);
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') doAdd();
    });

    input.focus();
  }

  /**
   * Search for a concept
   */
  private async searchConcept(): Promise<void> {
    const concept = this.searchInput.value.trim();
    if (!concept) return;

    if (!this.index) {
      this.showError('Index not loaded. Please run "Index Vault" first.');
      return;
    }

    this.journeyContainer.empty();
    this.journeyContainer.createEl('div', {
      text: 'Searching…',
      cls: 'journey-loading'
    });

    // Build the journey
    const journey = this.buildJourney(concept);

    if (journey.occurrences.length === 0) {
      this.journeyContainer.empty();
      this.journeyContainer.createEl('div', {
        text: `No occurrences found for "${concept}" or its aliases`,
        cls: 'journey-no-results'
      });
      return;
    }

    this.currentJourney = journey;
    this.renderJourney(journey);
  }

  /**
   * Build concept journey from index
   */
  private buildJourney(concept: string): ConceptJourney {
    const searchTerms = [concept.toLowerCase(), ...this.aliases.map(a => a.toLowerCase())];
    const occurrences: ConceptOccurrence[] = [];
    const typeCount = new Map<string, { type: TagType; file: string; count: number }>();
    const relatedSet = new Set<string>();

    if (!this.index) {
      return { concept, aliases: this.aliases, occurrences: [], typeProgression: [], relatedConcepts: [] };
    }

    // Search through all indexed concepts
    let order = 0;
    for (const [conceptKey, conceptData] of this.index.concepts.entries()) {
      const normalizedKey = conceptKey.toLowerCase();

      // Check if this concept matches our search terms
      const matches = searchTerms.some(term =>
        normalizedKey.includes(term) || term.includes(normalizedKey)
      );

      if (matches) {
        for (const occurrence of conceptData.occurrences) {
          occurrences.push({
            file: occurrence.filePath,
            fileName: occurrence.fileName,
            tag: {
              type: occurrence.tagType,
              uuid: occurrence.tagUuid,
              label: occurrence.label,
              parentUuid: null
            },
            order: order++
          });

          // Track type progression
          const typeKey = `${occurrence.tagType}-${occurrence.filePath}`;
          if (!typeCount.has(typeKey)) {
            typeCount.set(typeKey, {
              type: occurrence.tagType,
              file: occurrence.filePath,
              count: 1
            });
          } else {
            typeCount.get(typeKey)!.count++;
          }
        }
      } else {
        // Check if this concept appears in same files as our search - it's related
        for (const occurrence of conceptData.occurrences) {
          if (occurrences.some(o => o.file === occurrence.filePath)) {
            relatedSet.add(conceptData.label);
          }
        }
      }
    }

    // Sort occurrences by file order (assuming alphabetical = chronological for now)
    occurrences.sort((a, b) => a.file.localeCompare(b.file));

    // Re-assign order after sorting
    occurrences.forEach((o, i) => o.order = i + 1);

    return {
      concept,
      aliases: this.aliases,
      occurrences,
      typeProgression: Array.from(typeCount.values()),
      relatedConcepts: Array.from(relatedSet).slice(0, 20) // Limit to 20
    };
  }

  /**
   * Render the journey timeline
   */
  private renderJourney(journey: ConceptJourney): void {
    this.journeyContainer.empty();

    // Summary header
    const summary = this.journeyContainer.createEl('div', { cls: 'journey-summary' });
    summary.createEl('h4', { text: `Journey of "${journey.concept}"` });
    summary.createEl('p', {
      text: `Found ${journey.occurrences.length} occurrences across ${new Set(journey.occurrences.map(o => o.file)).size} files`
    });

    // Action buttons
    const actions = this.journeyContainer.createEl('div', { cls: 'journey-actions' });

    const analyzeBtn = actions.createEl('button', {
      text: 'Analyse with AI',
      cls: 'journey-action-btn analyze-btn'
    });
    analyzeBtn.addEventListener('click', () => this.runAnalysis());

    const linksBtn = actions.createEl('button', {
      text: 'Add forward links',
      cls: 'journey-action-btn links-btn'
    });
    linksBtn.addEventListener('click', () => this.generateLinks());

    // Timeline
    const timeline = this.journeyContainer.createEl('div', { cls: 'journey-timeline' });

    // Group by file for cleaner display
    const fileGroups = new Map<string, ConceptOccurrence[]>();
    for (const occ of journey.occurrences) {
      if (!fileGroups.has(occ.file)) {
        fileGroups.set(occ.file, []);
      }
      fileGroups.get(occ.file)!.push(occ);
    }

    let stepNum = 1;
    for (const [file, occs] of fileGroups) {
      const step = timeline.createEl('div', { cls: 'timeline-step' });

      // Step indicator
      const indicator = step.createEl('div', { cls: 'step-indicator' });
      indicator.createEl('span', { text: String(stepNum++), cls: 'step-number' });
      indicator.createEl('div', { cls: 'step-line' });

      // Step content
      const content = step.createEl('div', { cls: 'step-content' });

      const fileHeader = content.createEl('div', { cls: 'step-file-header' });
      // A button rather than an anchor, so it is reachable by keyboard.
      const fileName = file.split('/').pop() || file;
      const fileLink = fileHeader.createEl('button', {
        text: fileName,
        cls: 'step-file-link'
      });
      fileLink.type = 'button';
      fileLink.setAttribute('aria-label', `Open ${fileName}`);
      fileLink.addEventListener('click', () => {
        if (this.onOpenFile) this.onOpenFile(file);
      });

      // Show types found in this file
      const typeBadges = content.createEl('div', { cls: 'step-types' });
      const typeGroups = new Map<TagType, number>();
      for (const occ of occs) {
        typeGroups.set(occ.tag.type, (typeGroups.get(occ.tag.type) || 0) + 1);
      }

      for (const [type, count] of typeGroups) {
        const badge = typeBadges.createEl('span', { cls: 'type-badge' });
        badge.dataset.color = String(hashToColorSlot(type));
        badge.createEl('span', { text: type });
        if (count > 1) {
          badge.createEl('span', { text: ` (${count})`, cls: 'type-count' });
        }
      }

      // Show labels
      const labels = content.createEl('div', { cls: 'step-labels' });
      const uniqueLabels = [...new Set(occs.map(o => o.tag.label))];
      labels.createEl('span', {
        text: uniqueLabels.join(', '),
        cls: 'label-text'
      });
    }

    // Related concepts section
    if (journey.relatedConcepts.length > 0) {
      const relatedSection = this.journeyContainer.createEl('div', { cls: 'journey-related' });
      relatedSection.createEl('h5', { text: 'Related concepts' });

      const relatedList = relatedSection.createEl('div', { cls: 'related-list' });
      for (const related of journey.relatedConcepts) {
        const tag = relatedList.createEl('span', {
          text: related,
          cls: 'related-tag'
        });
        tag.addEventListener('click', () => {
          this.searchInput.value = related;
          this.aliases = [];
          this.renderAliasSection();
          this.searchConcept();
        });
      }
    }
  }

  /**
   * Run AI analysis on the journey
   */
  private async runAnalysis(): Promise<void> {
    if (!this.currentJourney || !this.onAnalyzeRequest) return;

    this.analysisContainer.empty();
    this.analysisContainer.addClass('visible');

    const loading = this.analysisContainer.createEl('div', { cls: 'analysis-loading' });
    loading.createEl('span', { text: 'Analysing…' });

    try {
      const analysis = await this.onAnalyzeRequest(this.currentJourney);
      this.renderAnalysis(analysis);
    } catch (error) {
      this.analysisContainer.empty();
      this.analysisContainer.createEl('div', {
        text: `Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        cls: 'analysis-error'
      });
    }
  }

  /**
   * Render analysis results
   */
  private renderAnalysis(analysis: JourneyAnalysis): void {
    this.analysisContainer.empty();
    this.analysisContainer.addClass('visible');

    const header = this.analysisContainer.createEl('div', { cls: 'analysis-header' });
    header.createEl('h4', { text: 'AI analysis' });

    // Narrative
    const narrativeSection = this.analysisContainer.createEl('div', { cls: 'analysis-section' });
    narrativeSection.createEl('h5', { text: 'Narrative' });
    narrativeSection.createEl('p', { text: analysis.narrative, cls: 'narrative-text' });

    // Contradictions
    if (analysis.contradictions.length > 0) {
      const contradictionsSection = this.analysisContainer.createEl('div', { cls: 'analysis-section contradictions' });
      contradictionsSection.createEl('h5', { text: 'Possible contradictions' });
      const list = contradictionsSection.createEl('ul');
      for (const item of analysis.contradictions) {
        list.createEl('li', { text: item });
      }
    }

    // Gaps
    if (analysis.gaps.length > 0) {
      const gapsSection = this.analysisContainer.createEl('div', { cls: 'analysis-section gaps' });
      gapsSection.createEl('h5', { text: 'Gaps in the argument' });
      const list = gapsSection.createEl('ul');
      for (const item of analysis.gaps) {
        list.createEl('li', { text: item });
      }
    }

    // Suggestions
    if (analysis.suggestions.length > 0) {
      const suggestionsSection = this.analysisContainer.createEl('div', { cls: 'analysis-section suggestions' });
      suggestionsSection.createEl('h5', { text: 'Suggestions' });
      const list = suggestionsSection.createEl('ul');
      for (const item of analysis.suggestions) {
        list.createEl('li', { text: item });
      }
    }
  }

  /**
   * Generate forward links
   */
  private async generateLinks(): Promise<void> {
    if (!this.currentJourney || !this.onGenerateForwardLinks) return;

    const btn = this.journeyContainer.querySelector('.links-btn') as HTMLButtonElement;
    if (btn) {
      btn.setText('Adding…');
      btn.disabled = true;
    }

    try {
      await this.onGenerateForwardLinks(this.currentJourney);
      if (btn) {
        btn.setText('Links added');
      }
    } catch (error) {
      if (btn) {
        btn.setText('Failed');
      }
    }

    window.setTimeout(() => {
      if (btn) {
        btn.setText('Add forward links');
        btn.disabled = false;
      }
    }, 2000);
  }

  /**
   * Show error message
   */
  private showError(message: string): void {
    this.journeyContainer.empty();
    this.journeyContainer.createEl('div', {
      text: message,
      cls: 'journey-error'
    });
  }
}

/**
 * Semantic map view.
 *
 * Renders the tags in a note as a Mermaid graph plus a readable tag list.
 * Node shapes come from each category's palette slot, so a user-defined
 * taxonomy gets a consistent look without any category names being baked in.
 */

import { ItemView, WorkspaceLeaf, Notice } from 'obsidian';
import {
  SemanticTag,
  SemanticAISettings,
  categoryColor,
  categoryName
} from '../types';
import { buildTagHierarchy } from '../tagging/tag-writer';

export const MERMAID_VIEW_TYPE = 'semantic-ai-mermaid-view';

/** One Mermaid node shape per palette slot. */
const SHAPES: { open: string; close: string }[] = [
  { open: '([', close: '])' },   // stadium
  { open: '[', close: ']' },     // rectangle
  { open: '[(', close: ')]' },   // cylinder
  { open: '{{', close: '}}' },   // hexagon
  { open: '((', close: '))' },   // circle
  { open: '[[', close: ']]' },   // subroutine
  { open: '{', close: '}' },     // rhombus
  { open: '>', close: ']' }      // asymmetric
];

function shapeForColor(color: number): { open: string; close: string } {
  return SHAPES[(color - 1) % SHAPES.length];
}

/** Escape a label so it cannot break out of a Mermaid node. */
function escapeLabel(label: string): string {
  const cleaned = label
    .replace(/["`]/g, "'")
    .replace(/[[\]{}()<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned.length > 60 ? `${cleaned.slice(0, 60)}…` : cleaned;
}

/**
 * Build the Mermaid source for a set of tags.
 * Exported so notes and the panel render exactly the same graph.
 */
export function buildMermaid(
  tags: SemanticTag[],
  direction: 'TD' | 'LR' | 'BT' | 'RL' = 'TD',
  settings?: SemanticAISettings
): string {
  if (tags.length === 0) {
    return '';
  }

  const lines: string[] = [`graph ${direction}`];
  const nodeIds = new Map<string, string>();

  tags.forEach((tag, index) => {
    const nodeId = `n${index}`;
    nodeIds.set(tag.uuid, nodeId);

    const color = settings ? categoryColor(settings, tag.type) : 1;
    const shape = shapeForColor(color);
    const typeLabel = settings ? categoryName(settings, tag.customType || tag.type) : tag.type;

    lines.push(`  ${nodeId}${shape.open}"${escapeLabel(`${typeLabel}: ${tag.label}`)}"${shape.close}`);
  });

  for (const tag of tags) {
    if (tag.parentUuid && nodeIds.has(tag.parentUuid)) {
      lines.push(`  ${nodeIds.get(tag.parentUuid)} --> ${nodeIds.get(tag.uuid)}`);
    }
  }

  return lines.join('\n');
}

export class MermaidView extends ItemView {
  private settings: SemanticAISettings;
  private currentTags: SemanticTag[] = [];
  private currentFilePath = '';

  constructor(leaf: WorkspaceLeaf, settings: SemanticAISettings) {
    super(leaf);
    this.settings = settings;
  }

  getViewType(): string {
    return MERMAID_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Semantic map';
  }

  getIcon(): string {
    return 'git-branch';
  }

  updateSettings(settings: SemanticAISettings): void {
    this.settings = settings;
    this.refresh();
  }

  setTags(tags: SemanticTag[], filePath: string): void {
    this.currentTags = tags;
    this.currentFilePath = filePath;
    this.refresh();
  }

  clear(): void {
    this.currentTags = [];
    this.currentFilePath = '';
    this.refresh();
  }

  refresh(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass('semantic-ai-map-view');

    if (this.currentTags.length === 0) {
      container.createDiv({
        cls: 'semantic-ai-empty-state',
        text: 'No tags in this note yet. Run a classification to fill this in.'
      });
      return;
    }

    this.renderView(container);
  }

  private renderView(container: HTMLElement): void {
    const header = container.createDiv({ cls: 'semantic-ai-header' });
    const headerRow = header.createDiv({ cls: 'semantic-ai-header-row' });

    headerRow.createEl('h3', {
      text: this.currentFilePath.split('/').pop() || 'Semantic map'
    });

    const copyBtn = headerRow.createEl('button', {
      cls: 'semantic-ai-copy-btn',
      text: 'Copy'
    });
    copyBtn.type = 'button';
    copyBtn.setAttribute('aria-label', 'Copy the map and diagram source to the clipboard');
    copyBtn.addEventListener('click', () => this.copyAllContent());

    this.renderSummary(container.createDiv({ cls: 'semantic-ai-summary' }));
    this.renderMermaid(container.createDiv({ cls: 'semantic-ai-diagram' }));
    this.renderTagList(container.createDiv({ cls: 'semantic-ai-tag-list' }));
  }

  private async copyAllContent(): Promise<void> {
    const fileName = this.currentFilePath.split('/').pop() || 'note';

    const counts = this.countByType();
    const summaryLines = Object.entries(counts)
      .map(([type, count]) => `  ${categoryName(this.settings, type)}: ${count}`)
      .join('\n');

    const tagDetails = this.currentTags
      .map(tag => `- [${tag.type}] ${tag.label} (${tag.uuid.slice(0, 8)})`)
      .join('\n');

    const output = `# Semantic map: ${fileName}

## Summary
${summaryLines}

## Tags (${this.currentTags.length})
${tagDetails}

## Diagram
\`\`\`mermaid
${this.generateMermaid()}
\`\`\`
`;

    try {
      await navigator.clipboard.writeText(output);
      new Notice('Copied to the clipboard.');
    } catch {
      new Notice('Could not write to the clipboard.');
    }
  }

  private countByType(): Record<string, number> {
    const counts: Record<string, number> = {};

    for (const tag of this.currentTags) {
      const key = tag.customType || tag.type;
      counts[key] = (counts[key] || 0) + 1;
    }

    return counts;
  }

  private renderSummary(container: HTMLElement): void {
    const grid = container.createDiv({ cls: 'semantic-ai-summary-grid' });

    for (const [type, count] of Object.entries(this.countByType())) {
      const item = grid.createDiv({ cls: 'semantic-ai-summary-item' });
      item.dataset.color = String(categoryColor(this.settings, type));
      item.createSpan({ cls: 'semantic-ai-count', text: String(count) });
      item.createSpan({ cls: 'semantic-ai-type', text: categoryName(this.settings, type) });
    }
  }

  private renderMermaid(container: HTMLElement): void {
    const mermaidCode = this.generateMermaid();

    const pre = container.createEl('pre', { cls: 'mermaid' });
    pre.setText(mermaidCode);

    const codeBlock = container.createEl('pre', { cls: 'semantic-ai-code hidden' });
    codeBlock.createEl('code', { text: mermaidCode });

    const toggleBtn = container.createEl('button', {
      cls: 'semantic-ai-toggle-code',
      text: 'Show source'
    });
    toggleBtn.type = 'button';
    toggleBtn.setAttribute('aria-expanded', 'false');
    toggleBtn.setAttribute('aria-controls', 'semantic-ai-mermaid-source');
    codeBlock.id = 'semantic-ai-mermaid-source';

    toggleBtn.addEventListener('click', () => {
      const hidden = codeBlock.hasClass('hidden');
      codeBlock.toggleClass('hidden', !hidden);
      toggleBtn.setText(hidden ? 'Hide source' : 'Show source');
      toggleBtn.setAttribute('aria-expanded', String(hidden));
    });
  }

  private renderTagList(container: HTMLElement): void {
    container.createEl('h4', { text: 'Tags' });

    const hierarchy = buildTagHierarchy(this.currentTags);
    const rootTags = hierarchy.get('root') || [];

    const list = container.createEl('ul', { cls: 'semantic-ai-tag-tree' });
    this.renderTagLevel(list, rootTags, hierarchy);
  }

  private renderTagLevel(
    container: HTMLElement,
    tags: SemanticTag[],
    hierarchy: Map<string, SemanticTag[]>
  ): void {
    for (const tag of tags) {
      const item = container.createEl('li', { cls: 'semantic-ai-tag-item' });

      const badge = item.createSpan({
        cls: 'semantic-ai-tag-badge',
        text: categoryName(this.settings, tag.customType || tag.type)
      });
      badge.dataset.color = String(categoryColor(this.settings, tag.type));

      item.createSpan({ cls: 'semantic-ai-tag-label', text: tag.label });

      if (tag.topics?.length) {
        item.createSpan({ cls: 'semantic-ai-tag-topics', text: tag.topics.join(', ') });
      }

      item.createSpan({ cls: 'semantic-ai-tag-uuid', text: tag.uuid.slice(0, 8) });

      const children = hierarchy.get(tag.uuid);
      if (children && children.length > 0) {
        this.renderTagLevel(item.createEl('ul'), children, hierarchy);
      }
    }
  }

  generateMermaid(): string {
    return buildMermaid(this.currentTags, this.settings.graphDirection || 'TD', this.settings);
  }

  async onOpen(): Promise<void> {
    this.refresh();
  }

  async onClose(): Promise<void> {
    this.currentTags = [];
  }
}

/**
 * Wrap the graph in a fenced block ready to paste into a note.
 * Returns an empty string when there is nothing to draw.
 */
export function createMermaidCodeBlock(
  tags: SemanticTag[],
  direction?: 'TD' | 'LR' | 'BT' | 'RL',
  settings?: SemanticAISettings
): string {
  const mermaidCode = buildMermaid(tags, direction, settings);

  if (!mermaidCode) {
    return '';
  }

  return `\n\n\`\`\`mermaid\n${mermaidCode}\n\`\`\`\n`;
}

/** Kept for callers that only need the source. */
export function generateMermaidForNote(
  tags: SemanticTag[],
  direction: 'TD' | 'LR' | 'BT' | 'RL' = 'TD',
  settings?: SemanticAISettings
): string {
  return buildMermaid(tags, direction, settings);
}

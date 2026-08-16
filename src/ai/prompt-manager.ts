/**
 * Prompt Manager
 * Builds prompts from the user's own categories and topics — nothing about the
 * wording here assumes a particular subject area.
 */

import {
  TagType,
  CategoryDefinition,
  CustomClassifier,
  SemanticAISettings,
  TAXONOMY_PRESETS,
  categoryPlural,
  enabledCategories,
  enabledCategoryIds,
  enabledTopics,
  getCategory,
  getPreset,
  topicsActive
} from '../types';

export class PromptManager {
  private settings: SemanticAISettings;

  constructor(settings: SemanticAISettings) {
    this.settings = settings;
  }

  updateSettings(settings: SemanticAISettings): void {
    this.settings = settings;
  }

  /* ---------------------------------------------------------------------- */
  /* Categories                                                             */
  /* ---------------------------------------------------------------------- */

  getCategories(): CategoryDefinition[] {
    return this.settings.categories;
  }

  getEnabledCategoryIds(): TagType[] {
    return enabledCategoryIds(this.settings);
  }

  getPrompt(type: TagType): string {
    return getCategory(this.settings, type)?.prompt || '';
  }

  setPrompt(type: TagType, prompt: string): void {
    const category = getCategory(this.settings, type);
    if (category) {
      category.prompt = prompt;
    }
  }

  /**
   * The prompt this category ships with, preferring the preset currently
   * loaded. Returns null for categories the user invented themselves.
   */
  getStockPrompt(type: TagType): string | null {
    const current = getPreset(this.settings.presetId);
    const fromCurrent = current?.categories.find(c => c.id === type);
    if (fromCurrent) {
      return fromCurrent.prompt;
    }

    for (const preset of TAXONOMY_PRESETS) {
      const match = preset.categories.find(c => c.id === type);
      if (match) {
        return match.prompt;
      }
    }

    return null;
  }

  isDefaultPrompt(type: TagType): boolean {
    const stock = this.getStockPrompt(type);
    return stock !== null && stock === this.getPrompt(type);
  }

  resetPrompt(type: TagType): boolean {
    const stock = this.getStockPrompt(type);
    if (stock === null) return false;
    this.setPrompt(type, stock);
    return true;
  }

  /** Display name for a category id — the plural form used in summaries. */
  getTagTypeName(type: TagType): string {
    return categoryPlural(this.settings, type);
  }

  /* ---------------------------------------------------------------------- */
  /* Custom classifiers                                                     */
  /* ---------------------------------------------------------------------- */

  getCustomClassifiers(): CustomClassifier[] {
    return this.settings.customClassifiers || [];
  }

  addCustomClassifier(keyword: string, prompt: string): CustomClassifier {
    const classifier: CustomClassifier = {
      id: `custom-${Date.now()}`,
      keyword,
      prompt,
      enabled: true
    };

    if (!this.settings.customClassifiers) {
      this.settings.customClassifiers = [];
    }

    this.settings.customClassifiers.push(classifier);
    return classifier;
  }

  updateCustomClassifier(id: string, updates: Partial<CustomClassifier>): void {
    const classifiers = this.settings.customClassifiers || [];
    const index = classifiers.findIndex(c => c.id === id);

    if (index !== -1) {
      classifiers[index] = { ...classifiers[index], ...updates };
    }
  }

  removeCustomClassifier(id: string): void {
    this.settings.customClassifiers = (this.settings.customClassifiers || [])
      .filter(c => c.id !== id);
  }

  findClassifierByKeyword(keyword: string): CustomClassifier | undefined {
    return (this.settings.customClassifiers || [])
      .find(c => c.enabled && c.keyword.toLowerCase() === keyword.toLowerCase());
  }

  /* ---------------------------------------------------------------------- */
  /* Prompt construction                                                    */
  /* ---------------------------------------------------------------------- */

  /** Optional framing line the user sets in settings. */
  private contextLine(): string {
    const context = (this.settings.systemContext || '').trim();
    return context ? `\n\nContext for this vault: ${context}` : '';
  }

  private axisLabel(): string {
    return (this.settings.axis2Label || 'Topic').trim() || 'Topic';
  }

  /** The axis-2 instructions, or an empty string when axis 2 is off. */
  private topicSection(): string {
    if (!topicsActive(this.settings)) {
      return '';
    }

    const label = this.axisLabel();
    const list = enabledTopics(this.settings)
      .map(t => (t.description ? `- ${t.id}: ${t.description}` : `- ${t.id}`))
      .join('\n');

    const extra = (this.settings.topicPrompt || '').trim();
    const extraSection = extra ? `\n\n${extra}` : '';

    return `\n\n## ${label} assignment\nFor each element, also decide which of the following ${label.toLowerCase()} values apply. An element may have several, or none.\n\n${list}${extraSection}`;
  }

  private topicField(): string {
    if (!topicsActive(this.settings)) {
      return '';
    }
    const ids = enabledTopics(this.settings).map(t => t.id);
    return `\n- "topics": An array of ${this.axisLabel().toLowerCase()} values from this list: ${ids.join(', ')}`;
  }

  private topicExample(index: number): string {
    if (!topicsActive(this.settings)) {
      return '';
    }
    const ids = enabledTopics(this.settings).map(t => t.id);
    const picked = ids[index % ids.length];
    return `, "topics": ["${picked}"]`;
  }

  buildClassificationPrompt(content: string, types: TagType[]): string {
    return `${this.buildSystemPrompt(types)}\n\n${this.buildUserPrompt(content)}`;
  }

  buildSystemPrompt(types: TagType[]): string {
    const selected = types.length > 0 ? types : this.getEnabledCategoryIds();
    const categories = selected
      .map(id => getCategory(this.settings, id))
      .filter((c): c is CategoryDefinition => Boolean(c));

    const usable = categories.length > 0 ? categories : enabledCategories(this.settings);
    const ids = usable.map(c => c.id);

    const exampleA = ids[0] || 'Note';
    const exampleB = ids[1] || exampleA;

    const header = `You are a semantic analysis assistant. You read a document and label the elements you find.${this.contextLine()}

Output format: return a JSON array of objects. Each object must have:
- "type": the category id, one of: ${ids.join(', ')}
- "label": a concise, descriptive label for the element
- "parentLabel": (optional) the label of a parent element, when one element sits under another
- "confidence": (optional) a score from 0 to 1${this.topicField()}

Example output:
[
  {"type": "${exampleA}", "label": "A short label naming the element", "confidence": 0.9${this.topicExample(0)}},
  {"type": "${exampleB}", "label": "Another element that follows from the first", "parentLabel": "A short label naming the element", "confidence": 0.8${this.topicExample(1)}}
]

Category definitions:`;

    const definitions = usable
      .map(c => `\n### ${c.id} (${c.name})\n${c.prompt}`)
      .join('\n');

    return `${header}${definitions}${this.topicSection()}`;
  }

  buildUserPrompt(content: string): string {
    return `Analyze the following text and identify every element that fits the categories above. Return ONLY valid JSON, no other text.

---
TEXT TO ANALYZE:
${content}
---

JSON Response:`;
  }

  buildSingleTypePrompt(content: string, type: TagType): string {
    const category = getCategory(this.settings, type);
    const name = category?.plural || type;
    const prompt = category?.prompt || `Identify every ${type} in the text.`;

    const topicInstruction = topicsActive(this.settings)
      ? `\nAlso assign each element the ${this.axisLabel().toLowerCase()} values that apply.`
      : '';

    return `You are a semantic analysis assistant. Your task is to identify ${name} in the given text.${this.contextLine()}${topicInstruction}

${prompt}

Output format: return a JSON array of objects. Each object must have:
- "type": "${type}"
- "label": a concise, descriptive label
- "confidence": (optional) a score from 0 to 1${this.topicField()}${this.topicSection()}

Return ONLY valid JSON, no other text.

---
TEXT TO ANALYZE:
${content}
---

JSON Response:`;
  }

  buildCustomClassifierPrompt(content: string, classifier: CustomClassifier): string {
    return `You are a semantic analysis assistant analyzing text against custom criteria.${this.contextLine()}

Custom classifier: ${classifier.keyword}
Instructions: ${classifier.prompt}

Output format: return a JSON array of objects. Each object must have:
- "type": "Custom"
- "customType": "${classifier.keyword}"
- "label": a concise, descriptive label
- "confidence": (optional) a score from 0 to 1

Return ONLY valid JSON, no other text.

---
TEXT TO ANALYZE:
${content}
---

JSON Response:`;
  }

  /**
   * Prompt for analysing how one concept develops across several notes.
   */
  buildConceptJourneyPrompt(
    concept: string,
    aliases: string[],
    occurrences: { file: string; type: string; label: string }[]
  ): string {
    const aliasText = aliases.length > 0
      ? `\nAliases and related terms: ${aliases.join(', ')}`
      : '';

    const occurrenceList = occurrences.map((o, i) =>
      `${i + 1}. File: "${o.file}"\n   Category: ${o.type}\n   Label: "${o.label}"`
    ).join('\n\n');

    return `You are analyzing how a single concept develops across a set of notes.${this.contextLine()}

CONCEPT: "${concept}"${aliasText}

OCCURRENCES (in document order):
${occurrenceList}

TASK: describe how this concept evolves across these documents. Return a JSON object with this structure:

{
  "narrative": "2-4 sentences describing how the concept develops. Note shifts in meaning, growing complexity, or changes of understanding.",
  "contradictions": ["Tensions between how the concept is used in different documents. Empty array if none."],
  "gaps": ["Places where the reasoning jumps without support, or where evidence is missing. Empty array if none."],
  "suggestions": ["Ways to strengthen the chain: evidence needed, connections to explore, terms to define. Empty array if none."]
}

Important:
- Be specific and name actual files when discussing contradictions or gaps
- Focus on the development of the idea, not just where it appears
- If the concept appears consistently without evolution, say so in the narrative
- Return ONLY valid JSON, no other text

JSON Response:`;
  }

  /* ---------------------------------------------------------------------- */
  /* Import / export                                                        */
  /* ---------------------------------------------------------------------- */

  /** Export the whole taxonomy so it can be shared or reused in another vault. */
  exportTaxonomy(): string {
    return JSON.stringify({
      version: 2,
      presetId: this.settings.presetId,
      systemContext: this.settings.systemContext,
      axis2Label: this.settings.axis2Label,
      categories: this.settings.categories,
      topics: this.settings.topics,
      topicPrompt: this.settings.topicPrompt,
      customClassifiers: this.settings.customClassifiers
    }, null, 2);
  }

  /**
   * Import a taxonomy. Accepts both the current format and the v1 format,
   * which was a flat map of category id to prompt.
   */
  importTaxonomy(json: string): void {
    let data: Record<string, unknown>;

    try {
      data = JSON.parse(json) as Record<string, unknown>;
    } catch {
      throw new Error('That file is not valid JSON.');
    }

    if (Array.isArray(data.categories)) {
      const categories = data.categories as CategoryDefinition[];
      if (categories.length === 0) {
        throw new Error('That file contains no categories.');
      }
      this.settings.categories = categories.map((c, i) => ({
        id: String(c.id || `Category${i + 1}`),
        name: String(c.name || c.id || `Category ${i + 1}`),
        plural: String(c.plural || c.name || c.id || `Category ${i + 1}`),
        prompt: String(c.prompt || ''),
        color: Number(c.color) || (i % 8) + 1,
        enabled: c.enabled !== false
      }));
      this.settings.presetId = 'custom';
    } else if (data.prompts && typeof data.prompts === 'object') {
      // v1 format: { prompts: { Axiom: "…" } }
      const prompts = data.prompts as Record<string, string>;
      for (const [id, prompt] of Object.entries(prompts)) {
        const existing = getCategory(this.settings, id);
        if (existing) {
          existing.prompt = prompt;
        }
      }
    } else {
      throw new Error('That file has no categories or prompts in it.');
    }

    if (Array.isArray(data.topics)) {
      this.settings.topics = (data.topics as Record<string, unknown>[]).map((t, i) => ({
        id: String(t.id || `Topic${i + 1}`),
        name: String(t.name || t.id || `Topic ${i + 1}`),
        description: String(t.description || ''),
        enabled: t.enabled !== false
      }));
    }

    if (typeof data.systemContext === 'string') {
      this.settings.systemContext = data.systemContext;
    }
    if (typeof data.axis2Label === 'string' && data.axis2Label.trim()) {
      this.settings.axis2Label = data.axis2Label;
    }
    if (typeof data.topicPrompt === 'string') {
      this.settings.topicPrompt = data.topicPrompt;
    }
    if (Array.isArray(data.customClassifiers)) {
      this.settings.customClassifiers = data.customClassifiers as CustomClassifier[];
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Token and cost estimation                                                  */
/* -------------------------------------------------------------------------- */

export function estimateTokens(text: string): number {
  // Rough estimate: ~4 characters per token for English text.
  return Math.ceil(text.length / 4);
}

export function estimatePromptTokens(prompt: string, content: string): number {
  return estimateTokens(prompt) + estimateTokens(content);
}

/**
 * Approximate USD per million tokens. Providers change these, so the numbers
 * are a planning aid rather than a quote — matched by longest name prefix so
 * dated model ids resolve to their family.
 */
const PRICING: { prefix: string; input: number; output: number }[] = [
  { prefix: 'gpt-4o-mini', input: 0.15, output: 0.60 },
  { prefix: 'gpt-4o', input: 2.50, output: 10.00 },
  { prefix: 'gpt-4.1-mini', input: 0.40, output: 1.60 },
  { prefix: 'gpt-4.1', input: 2.00, output: 8.00 },
  { prefix: 'gpt-4-turbo', input: 10.00, output: 30.00 },
  { prefix: 'gpt-3.5-turbo', input: 0.50, output: 1.50 },
  { prefix: 'deepseek-reasoner', input: 0.55, output: 2.19 },
  { prefix: 'deepseek-chat', input: 0.27, output: 1.10 },
  { prefix: 'claude-3-5-haiku', input: 0.80, output: 4.00 },
  { prefix: 'claude-3-haiku', input: 0.25, output: 1.25 },
  { prefix: 'claude-3-5-sonnet', input: 3.00, output: 15.00 },
  { prefix: 'claude-sonnet', input: 3.00, output: 15.00 },
  { prefix: 'claude-opus', input: 15.00, output: 75.00 },
  { prefix: 'claude-3-opus', input: 15.00, output: 75.00 }
];

export function estimateCost(
  inputTokens: number,
  outputTokens: number,
  model: string
): number {
  const name = (model || '').toLowerCase();

  // Local models cost nothing to run.
  if (!name) {
    return 0;
  }

  const match = PRICING
    .filter(p => name.startsWith(p.prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];

  if (!match) {
    return 0;
  }

  return (inputTokens / 1_000_000) * match.input + (outputTokens / 1_000_000) * match.output;
}

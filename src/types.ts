/**
 * Core types for the plugin.
 *
 * The classifier works on two independent axes. Neither axis is hard-coded:
 * both are plain data the user edits in settings, so the same plugin can tag
 * research papers, meeting notes, a novel draft, or anything else.
 *
 *   Axis 1 — categories: "what is this?"   (Idea, Decision, Axiom, Character, …)
 *   Axis 2 — topics:     "where does it belong?" (Work, Physics, Act two, …)
 *
 * Presets below are only starting points — every id, name and prompt is editable.
 */

/**
 * A category id. This is a free-form string, not a closed union: whatever the
 * user names a category becomes the value written into the tag block, so ids
 * from older versions ('Axiom', 'Claim', …) keep working unchanged.
 */
export type TagType = string;

/** A topic id (axis 2). Free-form for the same reason. */
export type Domain = string;

/** One axis-1 category. */
export interface CategoryDefinition {
  /** Stable key written into tag blocks. Changing it orphans existing tags. */
  id: string;
  /** Singular display name. */
  name: string;
  /** Plural display name, used in summaries and notices. */
  plural: string;
  /** Instruction sent to the model for this category. */
  prompt: string;
  /** Palette slot 1-8, used for badges and diagram colours. */
  color: number;
  /** Whether this category is included in a default classification run. */
  enabled: boolean;
}

/** One axis-2 topic. */
export interface TopicDefinition {
  id: string;
  name: string;
  /** Short gloss that tells the model what belongs under this topic. */
  description: string;
  enabled: boolean;
}

/** A ready-made pair of axes the user can load in one click. */
export interface TaxonomyPreset {
  id: string;
  name: string;
  description: string;
  /** Framing sentence prepended to every prompt. May be empty. */
  systemContext: string;
  /** What axis 2 is called in this preset ('Topic', 'Domain', 'Department', …). */
  axis2Label: string;
  categories: CategoryDefinition[];
  topics: TopicDefinition[];
}

/** A semantic tag with UUID and hierarchy support. */
export interface SemanticTag {
  type: TagType;
  uuid: string;
  label: string;
  parentUuid: string | null;
  /** Set when the tag came from a custom classifier rather than a category. */
  customType?: string;
  /** Axis 2 assignments. */
  topics?: Domain[];
  metadata?: Record<string, unknown>;
}

/** Parsed tag from file content. */
export interface ParsedTag {
  raw: string;
  tag: SemanticTag;
  lineNumber: number;
}

/** Classification result from AI. */
export interface ClassificationResult {
  tags: SemanticTag[];
  mermaidGraph?: string;
  summary?: string;
}

/** Batch processing result. */
export interface BatchResult {
  file: string;
  success: boolean;
  tagCounts: Record<TagType, number>;
  error?: string;
}

/** Custom classifier definition — a one-off prompt invoked by keyword. */
export interface CustomClassifier {
  id: string;
  keyword: string;
  prompt: string;
  enabled: boolean;
}

/* -------------------------------------------------------------------------- */
/* AI providers                                                               */
/* -------------------------------------------------------------------------- */

export type ProviderId = 'openai' | 'deepseek' | 'anthropic' | 'ollama' | 'custom';

export const PROVIDER_IDS: ProviderId[] = ['openai', 'deepseek', 'anthropic', 'ollama', 'custom'];

/** Per-provider credentials. Kept separately so switching provider keeps both keys. */
export interface ProviderConfig {
  apiKey: string;
  endpoint: string;
  model: string;
}

/** How a provider's HTTP request is shaped. */
export type WireFormat = 'openai' | 'anthropic' | 'ollama';

export interface ProviderInfo {
  name: string;
  wireFormat: WireFormat;
  defaultEndpoint: string;
  defaultModel: string;
  requiresKey: boolean;
  /** Where to get a key, shown in settings. */
  keyUrl: string;
  suggestedModels: string[];
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  openai: {
    name: 'OpenAI',
    wireFormat: 'openai',
    defaultEndpoint: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4o-mini',
    requiresKey: true,
    keyUrl: 'https://platform.openai.com/api-keys',
    suggestedModels: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1']
  },
  deepseek: {
    name: 'DeepSeek',
    wireFormat: 'openai',
    defaultEndpoint: 'https://api.deepseek.com/chat/completions',
    defaultModel: 'deepseek-chat',
    requiresKey: true,
    keyUrl: 'https://platform.deepseek.com/api_keys',
    suggestedModels: ['deepseek-chat', 'deepseek-reasoner']
  },
  anthropic: {
    name: 'Anthropic',
    wireFormat: 'anthropic',
    defaultEndpoint: 'https://api.anthropic.com/v1/messages',
    defaultModel: 'claude-3-5-haiku-latest',
    requiresKey: true,
    keyUrl: 'https://console.anthropic.com/settings/keys',
    suggestedModels: ['claude-3-5-haiku-latest', 'claude-sonnet-4-5', 'claude-opus-4-1']
  },
  ollama: {
    name: 'Ollama (local)',
    wireFormat: 'ollama',
    defaultEndpoint: 'http://localhost:11434/api/generate',
    defaultModel: 'llama3.1',
    requiresKey: false,
    keyUrl: 'https://ollama.com',
    suggestedModels: ['llama3.1', 'mistral', 'qwen2.5']
  },
  custom: {
    name: 'Custom endpoint',
    wireFormat: 'openai',
    defaultEndpoint: '',
    defaultModel: '',
    requiresKey: false,
    keyUrl: '',
    suggestedModels: []
  }
};

export function defaultProviderConfigs(): Record<ProviderId, ProviderConfig> {
  const configs = {} as Record<ProviderId, ProviderConfig>;
  for (const id of PROVIDER_IDS) {
    configs[id] = {
      apiKey: '',
      endpoint: PROVIDERS[id].defaultEndpoint,
      model: PROVIDERS[id].defaultModel
    };
  }
  return configs;
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

export interface SemanticAISettings {
  // --- AI provider ---
  provider: ProviderId;
  providers: Record<ProviderId, ProviderConfig>;

  // --- Taxonomy (both axes are user-defined) ---
  /** Id of the preset last loaded, or 'custom' once edited. */
  presetId: string;
  /** Optional framing sentence prepended to every prompt. */
  systemContext: string;
  categories: CategoryDefinition[];
  /** What axis 2 is called in the UI and in prompts. */
  axis2Label: string;
  enableTopics: boolean;
  topics: TopicDefinition[];
  /** Extra instructions for axis 2. Empty means "generate from the topic list". */
  topicPrompt: string;

  // --- Custom classifiers ---
  customClassifiers: CustomClassifier[];

  // --- UI ---
  showHiddenTags: boolean;
  autoGenerateMermaid: boolean;
  mermaidPosition: 'append' | 'panel';

  // --- Graph ---
  graphDirection: 'TD' | 'LR' | 'BT' | 'RL';
  graphTheme: 'default' | 'forest' | 'dark' | 'neutral';

  // --- Batch processing ---
  confirmBatchProcessing: boolean;
  showTokenEstimate: boolean;

  // --- Backend sync ---
  enablePostgresSync: boolean;
  postgresConnections: PostgresConnection[];
  activeConnectionId: string | null;
  pythonServiceUrl: string;

  // --- Legacy fields, read once by migrateSettings() then left alone ---
  aiProvider?: string;
  apiKey?: string;
  apiEndpoint?: string;
  modelName?: string;
  prompts?: Record<string, string>;
  enableDomainMapping?: boolean;
  domainMappingPrompt?: string;
  postgresConnectionString?: string;
}

/** Postgres connection profile. */
export interface PostgresConnection {
  id: string;
  name: string;
  connectionString: string;
  lastTested: string | null;
  lastTestStatus: 'success' | 'failed' | 'never';
  lastTestMessage: string | null;
}

/* -------------------------------------------------------------------------- */
/* Presets                                                                    */
/* -------------------------------------------------------------------------- */

function category(
  id: string,
  name: string,
  plural: string,
  color: number,
  prompt: string,
  enabled = true
): CategoryDefinition {
  return { id, name, plural, color, prompt, enabled };
}

function topic(id: string, name: string, description: string): TopicDefinition {
  return { id, name, description, enabled: true };
}

/** Categories that are useful in any preset, off by default. */
function structuralCategories(): CategoryDefinition[] {
  return [
    category('Relationship', 'Relationship', 'Relationships', 4,
      'Identify explicit or implicit relationships between concepts, entities, or events. Return each relationship with a label describing the connection.', false),
    category('InternalLink', 'Internal link', 'Internal links', 5,
      'Identify references to other notes or sections within this vault. Return each with a label.', false),
    category('ExternalLink', 'External link', 'External links', 5,
      'Identify references to external sources, URLs, or citations. Return each with a descriptive label.', false),
    category('ProperName', 'Proper name', 'Proper names', 6,
      'Identify proper names of people, places, organizations, or specific entities. Return each with contextual information.', false),
    category('ForwardLink', 'Forward link', 'Forward links', 5,
      'Identify concepts or topics that could be expanded in future notes or require further exploration. Return each with a suggested focus.', false),
    category('WordOntology', 'Term mapping', 'Term mappings', 7,
      'Identify specialized terms and link them to their definitions, origins, or categories. Return each term with its category and definition.', false),
    category('Sentence', 'Sentence', 'Sentences', 8,
      'Identify key sentences that carry important claims, evidence, or concepts. Return each with a label describing its significance.', false),
    category('Paragraph', 'Paragraph', 'Paragraphs', 8,
      'Identify paragraphs that form logical units of thought. Return each with a summary label.', false)
  ];
}

const GENERAL_PRESET: TaxonomyPreset = {
  id: 'general',
  name: 'General notes',
  description: 'Neutral, everyday categories that suit most vaults.',
  systemContext: '',
  axis2Label: 'Topic',
  categories: [
    category('Idea', 'Idea', 'Ideas', 1,
      'Identify ideas, proposals, or suggestions the author puts forward. Return each with a short label naming the idea.'),
    category('Question', 'Question', 'Questions', 2,
      'Identify open questions, uncertainties, or things the author explicitly wants to find out. Return each as a question.'),
    category('Decision', 'Decision', 'Decisions', 3,
      'Identify decisions that were made, including what was chosen and, where stated, why. Return each with a label naming the decision.'),
    category('Task', 'Task', 'Tasks', 4,
      'Identify concrete actions or next steps, whether or not they are written as checkboxes. Return each as an action starting with a verb.'),
    category('Fact', 'Fact', 'Facts', 5,
      'Identify verifiable factual statements — figures, dates, measurements, and specific events. Return each with a label stating the fact.'),
    category('Quote', 'Quote', 'Quotes', 6,
      'Identify quoted or directly attributed passages. Return each with a label naming the speaker or source and the gist.'),
    category('Person', 'Person', 'People', 7,
      'Identify people and organizations mentioned, with the role or relevance they have in this note.'),
    category('Term', 'Term', 'Terms', 8,
      'Identify terms, names, or jargon that are defined or that a reader would need defined. Return each term with its meaning in context.'),
    category('Source', 'Source', 'Sources', 5,
      'Identify sources being drawn on: books, articles, links, datasets, or conversations. Return each with a label identifying the source.'),
    category('Insight', 'Insight', 'Insights', 1,
      'Identify conclusions, realisations, or takeaways — points where the author works out what something means. Return each with a label stating the insight.')
  ],
  topics: [
    topic('Work', 'Work', 'Job, employer, clients, professional projects'),
    topic('Personal', 'Personal', 'Family, home, relationships, personal admin'),
    topic('Research', 'Research', 'Reading, study, investigation, notes on sources'),
    topic('Finance', 'Finance', 'Money, budgets, pricing, contracts, costs'),
    topic('Health', 'Health', 'Physical and mental health, fitness, medical'),
    topic('Technology', 'Technology', 'Software, hardware, tools, engineering'),
    topic('Creative', 'Creative', 'Writing, art, music, design, making things'),
    topic('Learning', 'Learning', 'Skills being acquired, courses, practice')
  ]
};

const RESEARCH_PRESET: TaxonomyPreset = {
  id: 'research',
  name: 'Research and academic',
  description: 'Epistemic categories for papers, proofs, and formal frameworks.',
  systemContext: '',
  axis2Label: 'Domain',
  categories: [
    category('Axiom', 'Axiom', 'Axioms', 1,
      'Identify core foundational truths. These are axioms — statements that do not rely on prior proof and that support other claims. They are self-evident starting points of a deductive chain. Return each axiom with a clear, concise label.'),
    category('Claim', 'Claim', 'Claims', 2,
      'Identify claims made by the author. A claim asserts a position that can be supported or refuted by evidence or argument. It is not self-evident (unlike an axiom) and requires justification. Return each claim with a descriptive label.'),
    category('Hypothesis', 'Hypothesis', 'Hypotheses', 3,
      'Identify testable conjectures or proposed explanations that have not yet been confirmed or refuted. A hypothesis is a predictive statement derived from theory or observation that awaits validation. Return each hypothesis with a label stating what it predicts.'),
    category('Definition', 'Definition', 'Definitions', 8,
      'Identify formal definitions — statements that specify the precise meaning of a term, symbol, or concept. A definition establishes what something IS, not what it does or implies. Return each definition with its term and concise meaning.'),
    category('Theory', 'Theory', 'Theories', 7,
      'Identify coherent explanatory frameworks — structured sets of principles, axioms, and derived results that together explain a domain of phenomena. A theory is broader than a single claim or hypothesis. Return each theory with a label naming the framework.'),
    category('Observation', 'Observation', 'Observations', 5,
      'Identify empirical or experiential data points — specific things noted, measured, or witnessed. An observation is a raw datum, not yet interpreted as evidence for a particular claim. Return each observation with a label describing what was observed.'),
    category('Law', 'Law', 'Laws', 4,
      'Identify universal regularities stated as laws — physical, logical, or moral laws asserting invariant relationships. A law is more established than a hypothesis and is typically expressed as a precise equation or rule. Return each law with its name or formulation.'),
    category('Theorem', 'Theorem', 'Theorems', 6,
      'Identify formally derived results — propositions that follow deductively from axioms, definitions, and previously proved results. A theorem has a proof chain back to foundational axioms. Return each theorem with a label and note which axioms or lemmas it depends on.'),
    category('Lemma', 'Lemma', 'Lemmas', 6,
      'Identify supporting results used as stepping stones toward proving a theorem. A lemma is a subsidiary proposition proved for use in a larger proof. Return each lemma with a label and note what it supports.'),
    category('Canonical', 'Canonical element', 'Canonical elements', 1,
      'Identify authoritative, settled elements — items that have achieved canonical status through review, proof, or acceptance. These are the load-bearing pillars of the knowledge graph. Return each with a label and its basis for canonical status.'),
    category('EvidenceBundle', 'Evidence bundle', 'Evidence bundles', 3,
      'Identify evidence used to support claims or axioms: empirical data, quotes, citations, logical arguments, or experimental results grouped together. Return each piece of evidence with a label describing what it supports.'),
    category('ScientificProcess', 'Method', 'Methods', 4,
      'Identify methodologies, experimental procedures, or process steps described in the text. Return each with a label describing the process.', false),
    ...structuralCategories()
  ],
  topics: [
    topic('Physics', 'Physics', 'Classical and quantum mechanics, thermodynamics, electromagnetism, relativity, field theory'),
    topic('Theology', 'Theology', 'Scripture, doctrine, divine attributes, soteriology, eschatology'),
    topic('Mathematics', 'Mathematics', 'Algebra, topology, analysis, logic, set theory, proof theory'),
    topic('InformationTheory', 'Information theory', 'Entropy, information, computation, signal, encoding, complexity'),
    topic('Consciousness', 'Consciousness', 'Qualia, awareness, perception, phenomenology, neural correlates'),
    topic('Morality', 'Morality', 'Ethics, virtue, justice, moral law, deontology, teleology'),
    topic('Cosmology', 'Cosmology', 'Origins, cosmic structure, dark energy, inflation, fine-tuning'),
    topic('Biology', 'Biology', 'Evolution, genetics, ecology, neuroscience, systems biology'),
    topic('Philosophy', 'Philosophy', 'Metaphysics, epistemology, ontology, philosophy of mind and science'),
    topic('History', 'History', 'Historical events, historiography, history of ideas and science')
  ]
};

const WRITING_PRESET: TaxonomyPreset = {
  id: 'writing',
  name: 'Fiction and long-form writing',
  description: 'Story elements for drafts, outlines, and revision notes.',
  systemContext: '',
  axis2Label: 'Thread',
  categories: [
    category('Character', 'Character', 'Characters', 1,
      'Identify characters, with what this passage establishes about them.'),
    category('Setting', 'Setting', 'Settings', 5,
      'Identify places and time periods, with what this passage establishes about them.'),
    category('Scene', 'Scene', 'Scenes', 2,
      'Identify discrete scenes or beats. Return each with a label naming what happens.'),
    category('PlotPoint', 'Plot point', 'Plot points', 3,
      'Identify events that change the story\'s direction — reversals, revelations, decisions, and turning points.'),
    category('Theme', 'Theme', 'Themes', 7,
      'Identify themes and recurring ideas the text is working through. Return each with a label naming the theme.'),
    category('Conflict', 'Conflict', 'Conflicts', 4,
      'Identify sources of tension: what a character wants and what stands in the way.'),
    category('Motif', 'Motif', 'Motifs', 6,
      'Identify recurring images, objects, phrases, or symbols. Return each with a label and what it seems to carry.'),
    category('RevisionNote', 'Revision note', 'Revision notes', 8,
      'Identify passages that need work: continuity slips, unclear motivation, pacing problems, placeholder text. Return each with a label stating the problem.')
  ],
  topics: [
    topic('Plot', 'Plot', 'Events and their causal chain'),
    topic('Character', 'Character', 'Interiority, motivation, arc'),
    topic('Voice', 'Voice', 'Prose style, register, narration'),
    topic('Pacing', 'Pacing', 'Rhythm, tension, scene length'),
    topic('Structure', 'Structure', 'Act shape, chapter order, framing'),
    topic('Continuity', 'Continuity', 'Facts that must stay consistent'),
    topic('Research', 'Research', 'Things to verify before publication')
  ]
};

const PROJECT_PRESET: TaxonomyPreset = {
  id: 'project',
  name: 'Projects and meetings',
  description: 'Categories for specs, meeting notes, and delivery work.',
  systemContext: '',
  axis2Label: 'Area',
  categories: [
    category('Requirement', 'Requirement', 'Requirements', 1,
      'Identify things the deliverable must do or satisfy. Return each as a single testable statement.'),
    category('Decision', 'Decision', 'Decisions', 3,
      'Identify decisions made, what was chosen, and the reasoning given. Return each with a label naming the decision.'),
    category('ActionItem', 'Action item', 'Action items', 4,
      'Identify commitments and next steps, with the owner and any deadline stated. Return each starting with a verb.'),
    category('Risk', 'Risk', 'Risks', 2,
      'Identify risks and things that could go wrong, with the impact if they do.'),
    category('Assumption', 'Assumption', 'Assumptions', 6,
      'Identify unstated or stated assumptions the plan depends on. Return each with a label stating what is being assumed.'),
    category('Dependency', 'Dependency', 'Dependencies', 5,
      'Identify things this work waits on: other teams, systems, approvals, or deliveries.'),
    category('Metric', 'Metric', 'Metrics', 7,
      'Identify numbers used as measures of success, targets, or current state. Return each with the metric and its value.'),
    category('Stakeholder', 'Stakeholder', 'Stakeholders', 8,
      'Identify people and groups with an interest in this work, and what they care about.'),
    category('OpenQuestion', 'Open question', 'Open questions', 2,
      'Identify unresolved questions that block or shape the work.')
  ],
  topics: [
    topic('Engineering', 'Engineering', 'Implementation, architecture, infrastructure'),
    topic('Design', 'Design', 'User experience, interface, research'),
    topic('Product', 'Product', 'Scope, roadmap, prioritisation'),
    topic('Operations', 'Operations', 'Process, tooling, running the system'),
    topic('Commercial', 'Commercial', 'Pricing, contracts, customers, budget'),
    topic('Legal', 'Legal', 'Compliance, privacy, licensing, policy')
  ]
};

const BLANK_PRESET: TaxonomyPreset = {
  id: 'blank',
  name: 'Blank',
  description: 'One starter category. Build your own set from scratch.',
  systemContext: '',
  axis2Label: 'Topic',
  categories: [
    category('Note', 'Note', 'Notes', 1,
      'Identify the notable elements in this text and return each with a short descriptive label.')
  ],
  topics: []
};

export const TAXONOMY_PRESETS: TaxonomyPreset[] = [
  GENERAL_PRESET,
  RESEARCH_PRESET,
  PROJECT_PRESET,
  WRITING_PRESET,
  BLANK_PRESET
];

export function getPreset(id: string): TaxonomyPreset | undefined {
  return TAXONOMY_PRESETS.find(p => p.id === id);
}

/** Deep copy of a preset, so editing settings never mutates the preset itself. */
export function clonePreset(preset: TaxonomyPreset): {
  categories: CategoryDefinition[];
  topics: TopicDefinition[];
} {
  return {
    categories: preset.categories.map(c => ({ ...c })),
    topics: preset.topics.map(t => ({ ...t }))
  };
}

/** Number of palette slots available to categories. */
export const PALETTE_SLOTS = 8;

/* -------------------------------------------------------------------------- */
/* Defaults and migration                                                     */
/* -------------------------------------------------------------------------- */

const DEFAULT_PRESET = GENERAL_PRESET;

export const DEFAULT_SETTINGS: SemanticAISettings = {
  provider: 'openai',
  providers: defaultProviderConfigs(),

  presetId: DEFAULT_PRESET.id,
  systemContext: DEFAULT_PRESET.systemContext,
  categories: clonePreset(DEFAULT_PRESET).categories,
  axis2Label: DEFAULT_PRESET.axis2Label,
  enableTopics: true,
  topics: clonePreset(DEFAULT_PRESET).topics,
  topicPrompt: '',

  customClassifiers: [],

  showHiddenTags: false,
  autoGenerateMermaid: true,
  mermaidPosition: 'panel',

  graphDirection: 'TD',
  graphTheme: 'default',

  confirmBatchProcessing: true,
  showTokenEstimate: true,

  enablePostgresSync: false,
  postgresConnections: [],
  activeConnectionId: null,
  pythonServiceUrl: 'http://localhost:5000'
};

/**
 * Fold saved data into the current settings shape.
 *
 * Settings saved by earlier versions carry a flat `apiKey`/`modelName` and a
 * `prompts` map keyed by the old fixed category names. Those are converted to
 * the research preset with the user's prompt edits preserved, so upgrading
 * changes nothing about how an existing vault classifies.
 */
export function migrateSettings(saved: Partial<SemanticAISettings> | null): SemanticAISettings {
  const settings: SemanticAISettings = {
    ...DEFAULT_SETTINGS,
    providers: defaultProviderConfigs(),
    categories: clonePreset(DEFAULT_PRESET).categories,
    topics: clonePreset(DEFAULT_PRESET).topics,
    postgresConnections: []
  };

  if (!saved) {
    return settings;
  }

  // Copy over anything already in the current shape.
  Object.assign(settings, saved);
  settings.providers = { ...defaultProviderConfigs(), ...(saved.providers || {}) };
  for (const id of PROVIDER_IDS) {
    settings.providers[id] = { ...defaultProviderConfigs()[id], ...(saved.providers?.[id] || {}) };
  }

  // Legacy: a single provider with a single key.
  const legacyProvider = saved.aiProvider as ProviderId | undefined;
  if (legacyProvider && PROVIDER_IDS.includes(legacyProvider)) {
    if (!saved.provider) {
      settings.provider = legacyProvider;
    }
    const target = settings.providers[legacyProvider];
    if (saved.apiKey && !target.apiKey) target.apiKey = saved.apiKey;
    if (saved.apiEndpoint) target.endpoint = saved.apiEndpoint;
    if (saved.modelName) target.model = saved.modelName;
  }

  // Legacy: fixed category set with editable prompts.
  if (!saved.categories && saved.prompts) {
    const research = clonePreset(RESEARCH_PRESET);
    const savedPrompts = saved.prompts;
    settings.presetId = RESEARCH_PRESET.id;
    settings.axis2Label = RESEARCH_PRESET.axis2Label;
    settings.categories = research.categories.map(c =>
      savedPrompts[c.id] ? { ...c, prompt: savedPrompts[c.id] } : c
    );
    settings.topics = research.topics;
  }

  // Legacy: domain mapping is now the topics axis.
  if (saved.enableDomainMapping !== undefined && saved.enableTopics === undefined) {
    settings.enableTopics = saved.enableDomainMapping;
  }
  if (saved.domainMappingPrompt && !saved.topicPrompt) {
    settings.topicPrompt = saved.domainMappingPrompt;
  }

  // Never persist a taxonomy with no categories — the classifier would have
  // nothing to ask for.
  if (!Array.isArray(settings.categories) || settings.categories.length === 0) {
    settings.categories = clonePreset(BLANK_PRESET).categories;
  }
  if (!Array.isArray(settings.topics)) {
    settings.topics = [];
  }
  if (!Array.isArray(settings.postgresConnections)) {
    settings.postgresConnections = [];
  }

  // Legacy fields have been folded in; drop them so they are not written back.
  delete settings.aiProvider;
  delete settings.apiKey;
  delete settings.apiEndpoint;
  delete settings.modelName;
  delete settings.prompts;
  delete settings.enableDomainMapping;
  delete settings.domainMappingPrompt;
  delete settings.postgresConnectionString;

  return settings;
}

/* -------------------------------------------------------------------------- */
/* Taxonomy helpers                                                           */
/* -------------------------------------------------------------------------- */

export function getCategory(settings: SemanticAISettings, id: TagType): CategoryDefinition | undefined {
  return settings.categories.find(c => c.id === id);
}

/** Categories included in a default classification run. */
export function enabledCategories(settings: SemanticAISettings): CategoryDefinition[] {
  const enabled = settings.categories.filter(c => c.enabled);
  return enabled.length > 0 ? enabled : settings.categories;
}

export function enabledCategoryIds(settings: SemanticAISettings): TagType[] {
  return enabledCategories(settings).map(c => c.id);
}

export function enabledTopics(settings: SemanticAISettings): TopicDefinition[] {
  return settings.topics.filter(t => t.enabled);
}

/** True when axis 2 is switched on and has something to assign. */
export function topicsActive(settings: SemanticAISettings): boolean {
  return settings.enableTopics && enabledTopics(settings).length > 0;
}

/** Display name for a category id, falling back to the raw id. */
export function categoryName(settings: SemanticAISettings, id: TagType): string {
  return getCategory(settings, id)?.name || id;
}

/** Plural display name for a category id, falling back to the raw id. */
export function categoryPlural(settings: SemanticAISettings, id: TagType): string {
  return getCategory(settings, id)?.plural || id;
}

/** Stable palette slot for an arbitrary id, used when no category defines one. */
export function hashToColorSlot(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) % 1000;
  }
  return (hash % PALETTE_SLOTS) + 1;
}

/** Palette slot for a category, derived from its id when it has no definition. */
export function categoryColor(settings: SemanticAISettings, id: TagType): number {
  const category = getCategory(settings, id);
  if (category) {
    return ((category.color - 1) % PALETTE_SLOTS + PALETTE_SLOTS) % PALETTE_SLOTS + 1;
  }
  return hashToColorSlot(id);
}

/** Turn a display name into a usable category id. */
export function slugToId(name: string): string {
  const cleaned = name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  return cleaned || 'Category';
}

/* -------------------------------------------------------------------------- */
/* AI wire types                                                              */
/* -------------------------------------------------------------------------- */

export interface AIClassificationResponse {
  type: TagType;
  label: string;
  parentLabel?: string;
  confidence?: number;
  /** Axis 2 assignments returned by the model. */
  topics?: Domain[];
  /** Accepted as an alias for `topics` for robustness across models. */
  domains?: Domain[];
  customType?: string;
  metadata?: Record<string, unknown>;
}

export interface TokenEstimate {
  inputTokens: number;
  estimatedOutputTokens: number;
  estimatedCost: number;
}

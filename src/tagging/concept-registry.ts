/**
 * Concept Registry
 * Central registry for consistent UUIDs across all documents
 * This is the single source of truth for concept identification
 */

import { Notice, Vault, normalizePath } from 'obsidian';
import { TagType } from '../types';
import { generateUUID } from './uuid-generator';

/**
 * Registry entry for a concept
 */
export interface ConceptRegistryEntry {
  uuid: string;
  label: string;
  normalizedLabel: string;
  type: TagType;
  firstSeenFile: string;
  firstSeenDate: string;
  aliases: string[];  // Alternative labels that map to same concept
  metadata?: Record<string, unknown>;
}

/**
 * Registry data structure
 */
export interface ConceptRegistryData {
  version: string;
  lastUpdated: string;
  concepts: Record<string, ConceptRegistryEntry>;  // keyed by normalized label
  uuidIndex: Record<string, string>;  // uuid -> normalized label (reverse lookup)
}

const REGISTRY_FILENAME = 'concept-registry.json';
const REGISTRY_VERSION = '1.0.0';

/**
 * Concept Registry class
 * Manages the central registry of concepts and their UUIDs
 */
export class ConceptRegistry {
  private vault: Vault;
  private registryPath: string;
  private data: ConceptRegistryData;
  private loaded: boolean = false;
  private dirty: boolean = false;

  /**
   * @param pluginDir the plugin's own folder, from `manifest.dir`. It sits
   *   inside the config directory, which is not part of the vault file tree,
   *   so this class goes through the adapter rather than the Vault API.
   */
  constructor(vault: Vault, pluginDir?: string) {
    this.vault = vault;
    const base = pluginDir || `${vault.configDir}/plugins/semantic-ai`;
    this.registryPath = normalizePath(`${base}/${REGISTRY_FILENAME}`);
    this.data = this.createEmptyRegistry();
  }

  /**
   * Create empty registry structure
   */
  private createEmptyRegistry(): ConceptRegistryData {
    return {
      version: REGISTRY_VERSION,
      lastUpdated: new Date().toISOString(),
      concepts: {},
      uuidIndex: {}
    };
  }

  /**
   * Normalize a label for consistent matching
   */
  normalizeLabel(label: string): string {
    return label
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')  // Remove special chars except hyphens
      .replace(/\s+/g, ' ')       // Normalize whitespace
      .trim();
  }

  /**
   * Load registry from file
   */
  async load(): Promise<void> {
    try {
      if (await this.vault.adapter.exists(this.registryPath)) {
        const content = await this.vault.adapter.read(this.registryPath);
        const parsed = JSON.parse(content) as ConceptRegistryData;

        this.data = {
          version: parsed.version || REGISTRY_VERSION,
          lastUpdated: parsed.lastUpdated || new Date().toISOString(),
          concepts: parsed.concepts || {},
          uuidIndex: parsed.uuidIndex || {}
        };

        if (this.data.version !== REGISTRY_VERSION) {
          this.migrateRegistry();
        }
      } else {
        this.data = this.createEmptyRegistry();
        this.dirty = true;
      }

      this.loaded = true;
    } catch (error) {
      // A corrupt registry must not stop the plugin loading; start fresh and
      // leave the old file alone so it can be recovered by hand.
      new Notice('Semantic AI could not read its concept registry, so it started a new one.');
      this.data = this.createEmptyRegistry();
      this.loaded = true;
    }
  }

  /**
   * Save registry to file
   */
  async save(): Promise<void> {
    if (!this.dirty && this.loaded) return;

    this.data.lastUpdated = new Date().toISOString();

    try {
      const dir = this.registryPath.slice(0, this.registryPath.lastIndexOf('/'));

      if (dir && !(await this.vault.adapter.exists(dir))) {
        await this.vault.adapter.mkdir(dir);
      }

      await this.vault.adapter.write(this.registryPath, JSON.stringify(this.data, null, 2));
      this.dirty = false;
    } catch (error) {
      new Notice('Semantic AI could not save its concept registry.');
    }
  }

  /**
   * Migrate registry from older versions
   */
  private migrateRegistry(): void {
    // Future migrations go here
    this.data.version = REGISTRY_VERSION;
    this.dirty = true;
  }

  /**
   * Get or create a UUID for a concept
   * This is the main method - ensures consistent UUIDs
   */
  getOrCreateUUID(label: string, type: TagType, sourceFile: string): string {
    const normalized = this.normalizeLabel(label);

    // Check if concept exists
    if (this.data.concepts[normalized]) {
      return this.data.concepts[normalized].uuid;
    }

    // Check aliases
    for (const entry of Object.values(this.data.concepts)) {
      if (entry.aliases.includes(normalized)) {
        return entry.uuid;
      }
    }

    // Create new entry
    const uuid = generateUUID();

    this.data.concepts[normalized] = {
      uuid,
      label,  // Keep original casing
      normalizedLabel: normalized,
      type,
      firstSeenFile: sourceFile,
      firstSeenDate: new Date().toISOString(),
      aliases: []
    };

    this.data.uuidIndex[uuid] = normalized;
    this.dirty = true;

    return uuid;
  }

  /**
   * Get UUID for a concept (returns undefined if not found)
   */
  getUUID(label: string): string | undefined {
    const normalized = this.normalizeLabel(label);
    return this.data.concepts[normalized]?.uuid;
  }

  /**
   * Get concept by UUID
   */
  getByUUID(uuid: string): ConceptRegistryEntry | undefined {
    const normalized = this.data.uuidIndex[uuid];
    if (normalized) {
      return this.data.concepts[normalized];
    }
    return undefined;
  }

  /**
   * Get concept by label
   */
  getByLabel(label: string): ConceptRegistryEntry | undefined {
    const normalized = this.normalizeLabel(label);
    return this.data.concepts[normalized];
  }

  /**
   * Check if concept exists
   */
  exists(label: string): boolean {
    const normalized = this.normalizeLabel(label);
    return !!this.data.concepts[normalized];
  }

  /**
   * Add an alias for a concept
   */
  addAlias(label: string, alias: string): boolean {
    const normalized = this.normalizeLabel(label);
    const normalizedAlias = this.normalizeLabel(alias);

    const entry = this.data.concepts[normalized];
    if (!entry) return false;

    if (!entry.aliases.includes(normalizedAlias)) {
      entry.aliases.push(normalizedAlias);
      this.dirty = true;
    }

    return true;
  }

  /**
   * Merge two concepts (keep first, redirect second)
   */
  mergeConcepts(keepLabel: string, mergeLabel: string): boolean {
    const keepNorm = this.normalizeLabel(keepLabel);
    const mergeNorm = this.normalizeLabel(mergeLabel);

    const keepEntry = this.data.concepts[keepNorm];
    const mergeEntry = this.data.concepts[mergeNorm];

    if (!keepEntry || !mergeEntry) return false;

    // Add merged label as alias
    keepEntry.aliases.push(mergeNorm);
    keepEntry.aliases.push(...mergeEntry.aliases);

    // Remove duplicates
    keepEntry.aliases = [...new Set(keepEntry.aliases)];

    // Update UUID index
    delete this.data.uuidIndex[mergeEntry.uuid];

    // Remove merged entry
    delete this.data.concepts[mergeNorm];

    this.dirty = true;
    return true;
  }

  /**
   * Update concept metadata
   */
  updateMetadata(label: string, metadata: Record<string, unknown>): boolean {
    const normalized = this.normalizeLabel(label);
    const entry = this.data.concepts[normalized];

    if (!entry) return false;

    entry.metadata = { ...entry.metadata, ...metadata };
    this.dirty = true;

    return true;
  }

  /**
   * Get all concepts
   */
  getAllConcepts(): ConceptRegistryEntry[] {
    return Object.values(this.data.concepts);
  }

  /**
   * Get concepts by type
   */
  getConceptsByType(type: TagType): ConceptRegistryEntry[] {
    return Object.values(this.data.concepts).filter(c => c.type === type);
  }

  /**
   * Search concepts
   */
  search(query: string): ConceptRegistryEntry[] {
    const normalizedQuery = this.normalizeLabel(query);

    return Object.values(this.data.concepts).filter(entry => {
      return entry.normalizedLabel.includes(normalizedQuery) ||
             entry.aliases.some(a => a.includes(normalizedQuery));
    });
  }

  /**
   * Get registry statistics
   */
  getStats(): {
    totalConcepts: number;
    byType: Record<string, number>;
    withAliases: number;
    lastUpdated: string;
  } {
    const byType: Record<string, number> = {};
    let withAliases = 0;

    for (const entry of Object.values(this.data.concepts)) {
      byType[entry.type] = (byType[entry.type] || 0) + 1;
      if (entry.aliases.length > 0) withAliases++;
    }

    return {
      totalConcepts: Object.keys(this.data.concepts).length,
      byType,
      withAliases,
      lastUpdated: this.data.lastUpdated
    };
  }

  /**
   * Export registry to JSON string
   */
  exportJSON(): string {
    return JSON.stringify(this.data, null, 2);
  }

  /**
   * Import registry from JSON string (merges with existing)
   */
  importJSON(json: string, overwrite: boolean = false): number {
    const imported: ConceptRegistryData = JSON.parse(json);
    let count = 0;

    for (const [key, entry] of Object.entries(imported.concepts)) {
      if (overwrite || !this.data.concepts[key]) {
        this.data.concepts[key] = entry;
        this.data.uuidIndex[entry.uuid] = key;
        count++;
      }
    }

    this.dirty = true;
    return count;
  }

  /**
   * Clear the registry (dangerous!)
   */
  clear(): void {
    this.data = this.createEmptyRegistry();
    this.dirty = true;
  }

  /**
   * Get raw data (for Python sync)
   */
  getRawData(): ConceptRegistryData {
    return this.data;
  }

  /**
   * Check if registry needs saving
   */
  isDirty(): boolean {
    return this.dirty;
  }
}

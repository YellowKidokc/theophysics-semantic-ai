/**
 * Vault Index Module - PATCHED FOR LARGE VAULTS
 * Cross-document tracking and concept indexing
 * 
 * CHANGES FROM ORIGINAL:
 * 1. Added MAX_FILES limit with scope warning
 * 2. Added batch processing with memory release
 * 3. Limited relationship calculations (skip O(n²) on large vaults)
 * 4. Added progress callbacks for UI feedback
 * 5. Added abort signal support
 */

import { TFile, Vault } from 'obsidian';
import { SemanticTag, TagType } from '../types';
import { parseTags } from '../tagging/tag-writer';
import { estimateTokens } from '../ai/prompt-manager';

// === CONFIGURABLE LIMITS ===
const MAX_FILES_FOR_FULL_INDEX = 500;       // Above this, skip expensive operations
const MAX_FILES_FOR_RELATIONS = 200;        // Above this, skip cross-file relations
const MAX_CONCEPTS_FOR_RELATED = 1000;      // Above this, skip related concept calc
const BATCH_SIZE = 50;                       // Process files in batches
const BATCH_DELAY_MS = 10;                   // Allow UI to breathe between batches

/**
 * Concept occurrence tracking
 */
export interface ConceptOccurrence {
  filePath: string;
  fileName: string;
  tagUuid: string;
  tagType: TagType;
  label: string;
  lineNumber?: number;
  context?: string;
}

/**
 * Concept entry in the index
 */
export interface ConceptEntry {
  label: string;
  normalizedLabel: string;
  occurrences: ConceptOccurrence[];
  firstSeen: {
    filePath: string;
    fileName: string;
    date?: string;
  };
  totalCount: number;
  fileCount: number;
  tagTypes: TagType[];
  relatedConcepts: string[];
}

/**
 * Cross-document relationship
 */
export interface CrossDocumentRelation {
  sourceFile: string;
  targetFile: string;
  sharedConcepts: string[];
  relationshipStrength: number;
}

/**
 * Index metadata
 */
export interface IndexMetadata {
  lastUpdated: string;
  scope: 'folder' | 'vault';
  scopePath: string;
  totalFiles: number;
  totalTags: number;
  totalConcepts: number;
  estimatedTokens?: number;
  processingTimeMs?: number;
  warnings?: string[];  // NEW: Track what was skipped
}

/**
 * Complete vault/folder index
 */
export interface VaultIndex {
  metadata: IndexMetadata;
  concepts: Map<string, ConceptEntry>;
  relations: CrossDocumentRelation[];
  fileIndex: Map<string, SemanticTag[]>;
}

/**
 * Index cost estimate
 */
export interface IndexCostEstimate {
  fileCount: number;
  totalCharacters: number;
  estimatedTokens: number;
  estimatedCost: number;
  warning?: string;
}

/**
 * Sleep helper for batch delays
 */
const sleep = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

/**
 * Builds a cross-note index of the tags this plugin has written.
 */
export class VaultIndexer {
  private vault: Vault;
  private currentIndex: VaultIndex | null = null;
  private abortController: AbortController | null = null;

  constructor(vault: Vault) {
    this.vault = vault;
  }

  /**
   * Get current index
   */
  getIndex(): VaultIndex | null {
    return this.currentIndex;
  }

  /**
   * Abort current indexing operation
   */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Estimate cost for indexing
   */
  async estimateIndexCost(
    scope: 'folder' | 'vault',
    folderPath?: string
  ): Promise<IndexCostEstimate> {
    const files = this.getFilesInScope(scope, folderPath);
    
    // DON'T read all files just to estimate - use file metadata
    let estimatedCharacters = 0;
    for (const file of files.slice(0, 100)) {  // Sample first 100
      estimatedCharacters += file.stat.size;
    }
    
    // Extrapolate
    const avgSize = estimatedCharacters / Math.min(files.length, 100);
    const totalCharacters = Math.round(avgSize * files.length);
    const estimatedTokens = estimateTokens(String(totalCharacters));
    const estimatedCost = (estimatedTokens / 1_000_000) * 0.15;

    let warning: string | undefined;
    if (files.length > MAX_FILES_FOR_FULL_INDEX) {
      warning = `⚠️ Large vault: ${files.length} files. Cross-file relations will be SKIPPED to prevent memory issues. Consider indexing specific folders.`;
    }
    if (files.length > 1000) {
      warning = `🛑 Very large vault: ${files.length} files. STRONGLY recommend indexing folders individually. Full vault index may crash Obsidian.`;
    }

    return {
      fileCount: files.length,
      totalCharacters,
      estimatedTokens,
      estimatedCost,
      warning
    };
  }

  /**
   * Get markdown files in scope
   */
  private getFilesInScope(scope: 'folder' | 'vault', folderPath?: string): TFile[] {
    const allFiles = this.vault.getMarkdownFiles();

    if (scope === 'vault') {
      return allFiles;
    }

    if (scope === 'folder' && folderPath) {
      return allFiles.filter(f => f.path.startsWith(folderPath));
    }

    return allFiles;
  }

  /**
   * Build a concept index over a folder or the whole vault.
   */
  async buildIndex(
    scope: 'folder' | 'vault',
    folderPath?: string,
    onProgress?: (current: number, total: number, fileName: string, status?: string) => void
  ): Promise<VaultIndex> {
    // Setup abort controller
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const startTime = Date.now();
    const files = this.getFilesInScope(scope, folderPath);
    const warnings: string[] = [];

    const concepts = new Map<string, ConceptEntry>();
    const fileIndex = new Map<string, SemanticTag[]>();
    const relations: CrossDocumentRelation[] = [];

    let totalTags = 0;

    // Check limits and warn
    const skipRelations = files.length > MAX_FILES_FOR_RELATIONS;
    const skipRelatedConcepts = files.length > MAX_FILES_FOR_FULL_INDEX;

    if (skipRelations) {
      warnings.push(`Skipped cross-file relations (${files.length} files > ${MAX_FILES_FOR_RELATIONS} limit)`);
    }
    if (skipRelatedConcepts) {
      warnings.push(`Skipped related concepts calculation (${files.length} files > ${MAX_FILES_FOR_FULL_INDEX} limit)`);
    }

    // === BATCH PROCESSING ===
    for (let batchStart = 0; batchStart < files.length; batchStart += BATCH_SIZE) {
      // Check for abort
      if (signal.aborted) {
        throw new Error('Indexing aborted by user');
      }

      const batchEnd = Math.min(batchStart + BATCH_SIZE, files.length);
      const batch = files.slice(batchStart, batchEnd);

      // Process batch
      for (let i = 0; i < batch.length; i++) {
        const file = batch[i];
        const globalIndex = batchStart + i;

        if (onProgress) {
          const status = skipRelations ? '(lite mode - relations skipped)' : '';
          onProgress(globalIndex + 1, files.length, file.name, status);
        }

        try {
          const content = await this.vault.cachedRead(file);
          const parsedTags = parseTags(content);
          const tags = parsedTags.map(pt => pt.tag);

          fileIndex.set(file.path, tags);
          totalTags += tags.length;

          // Index each tag as a concept
          for (const parsedTag of parsedTags) {
            const tag = parsedTag.tag;
            const normalizedLabel = this.normalizeLabel(tag.label);

            const occurrence: ConceptOccurrence = {
              filePath: file.path,
              fileName: file.name,
              tagUuid: tag.uuid,
              tagType: tag.type,
              label: tag.label,
              lineNumber: parsedTag.lineNumber
            };

            if (concepts.has(normalizedLabel)) {
              const entry = concepts.get(normalizedLabel)!;
              entry.occurrences.push(occurrence);
              entry.totalCount++;

              if (!entry.tagTypes.includes(tag.type)) {
                entry.tagTypes.push(tag.type);
              }

              const uniqueFiles = new Set(entry.occurrences.map(o => o.filePath));
              entry.fileCount = uniqueFiles.size;
            } else {
              concepts.set(normalizedLabel, {
                label: tag.label,
                normalizedLabel,
                occurrences: [occurrence],
                firstSeen: {
                  filePath: file.path,
                  fileName: file.name,
                  date: new Date().toISOString()
                },
                totalCount: 1,
                fileCount: 1,
                tagTypes: [tag.type],
                relatedConcepts: []
              });
            }
          }
        } catch (err) {
          // One unreadable note should not abandon the whole index.
          warnings.push(`Could not read ${file.path}`);
        }
      }

      // === MEMORY RELIEF: Yield to event loop between batches ===
      await sleep(BATCH_DELAY_MS);
    }

    // === CONDITIONAL CROSS-DOCUMENT RELATIONS ===
    if (!skipRelations) {
      if (onProgress) {
        onProgress(files.length, files.length, 'Building relationships...', '');
      }

      const fileConceptMap = new Map<string, Set<string>>();
      for (const [filePath, tags] of fileIndex) {
        const conceptsInFile = new Set(tags.map(t => this.normalizeLabel(t.label)));
        fileConceptMap.set(filePath, conceptsInFile);
      }

      const filePaths = Array.from(fileConceptMap.keys());
      
      // Process in batches with limits
      let relationCount = 0;
      const MAX_RELATIONS = 5000;

      outer: for (let i = 0; i < filePaths.length; i++) {
        for (let j = i + 1; j < filePaths.length; j++) {
          if (relationCount >= MAX_RELATIONS) break outer;

          const file1 = filePaths[i];
          const file2 = filePaths[j];
          const concepts1 = fileConceptMap.get(file1)!;
          const concepts2 = fileConceptMap.get(file2)!;

          const sharedConcepts = Array.from(concepts1).filter(c => concepts2.has(c));

          if (sharedConcepts.length > 0) {
            const maxConcepts = Math.max(concepts1.size, concepts2.size);
            const relationshipStrength = sharedConcepts.length / maxConcepts;

            relations.push({
              sourceFile: file1,
              targetFile: file2,
              sharedConcepts,
              relationshipStrength
            });
            relationCount++;
          }
        }

        // Yield periodically
        if (i % 100 === 0) await sleep(1);
      }

      if (relationCount >= MAX_RELATIONS) {
        warnings.push(`Relations capped at ${MAX_RELATIONS}`);
      }
    }

    // === CONDITIONAL RELATED CONCEPTS ===
    if (!skipRelatedConcepts && concepts.size <= MAX_CONCEPTS_FOR_RELATED) {
      if (onProgress) {
        onProgress(files.length, files.length, 'Finding related concepts...', '');
      }

      let processed = 0;
      for (const [label, entry] of concepts) {
        const filesWithConcept = new Set(entry.occurrences.map(o => o.filePath));
        const related = new Set<string>();

        for (const [otherLabel, otherEntry] of concepts) {
          if (otherLabel === label) continue;

          const otherFiles = new Set(otherEntry.occurrences.map(o => o.filePath));
          const hasOverlap = Array.from(filesWithConcept).some(f => otherFiles.has(f));

          if (hasOverlap) {
            related.add(otherEntry.label);
          }
        }

        entry.relatedConcepts = Array.from(related).slice(0, 20);

        processed++;
        if (processed % 200 === 0) await sleep(1);  // Yield
      }
    }

    const processingTimeMs = Date.now() - startTime;

    const metadata: IndexMetadata = {
      lastUpdated: new Date().toISOString(),
      scope,
      scopePath: folderPath || '/',
      totalFiles: files.length,
      totalTags,
      totalConcepts: concepts.size,
      processingTimeMs,
      warnings: warnings.length > 0 ? warnings : undefined
    };

    this.currentIndex = {
      metadata,
      concepts,
      relations,
      fileIndex
    };

    this.abortController = null;
    return this.currentIndex;
  }

  /**
   * Normalize label for matching
   */
  private normalizeLabel(label: string): string {
    return label
      .toLowerCase()
      .trim()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ');
  }

  // ... rest of methods unchanged (searchConcepts, getConcept, etc.)
  
  /**
   * Search concepts
   */
  searchConcepts(query: string): ConceptEntry[] {
    if (!this.currentIndex) return [];

    const normalizedQuery = this.normalizeLabel(query);
    const results: ConceptEntry[] = [];

    for (const [label, entry] of this.currentIndex.concepts) {
      if (label.includes(normalizedQuery) || entry.label.toLowerCase().includes(query.toLowerCase())) {
        results.push(entry);
      }
    }

    return results.sort((a, b) => b.totalCount - a.totalCount);
  }

  getConcept(label: string): ConceptEntry | undefined {
    if (!this.currentIndex) return undefined;
    return this.currentIndex.concepts.get(this.normalizeLabel(label));
  }

  getRelatedFiles(filePath: string): CrossDocumentRelation[] {
    if (!this.currentIndex) return [];
    return this.currentIndex.relations
      .filter(r => r.sourceFile === filePath || r.targetFile === filePath)
      .sort((a, b) => b.relationshipStrength - a.relationshipStrength);
  }

  getTopConcepts(limit: number = 20): ConceptEntry[] {
    if (!this.currentIndex) return [];
    return Array.from(this.currentIndex.concepts.values())
      .sort((a, b) => b.totalCount - a.totalCount)
      .slice(0, limit);
  }

  getConceptsByType(type: TagType): ConceptEntry[] {
    if (!this.currentIndex) return [];
    return Array.from(this.currentIndex.concepts.values())
      .filter(entry => entry.tagTypes.includes(type))
      .sort((a, b) => b.totalCount - a.totalCount);
  }

  getStatistics(): {
    totalConcepts: number;
    totalOccurrences: number;
    avgOccurrencesPerConcept: number;
    conceptsAppearingMultipleTimes: number;
    conceptsInMultipleFiles: number;
    strongRelationships: number;
    typeBreakdown: Record<string, number>;
  } | null {
    if (!this.currentIndex) return null;

    let totalOccurrences = 0;
    let conceptsAppearingMultipleTimes = 0;
    let conceptsInMultipleFiles = 0;
    const typeBreakdown: Record<string, number> = {};

    for (const entry of this.currentIndex.concepts.values()) {
      totalOccurrences += entry.totalCount;
      if (entry.totalCount > 1) conceptsAppearingMultipleTimes++;
      if (entry.fileCount > 1) conceptsInMultipleFiles++;
      for (const type of entry.tagTypes) {
        typeBreakdown[type] = (typeBreakdown[type] || 0) + 1;
      }
    }

    const strongRelationships = this.currentIndex.relations
      .filter(r => r.relationshipStrength > 0.3).length;

    return {
      totalConcepts: this.currentIndex.metadata.totalConcepts,
      totalOccurrences,
      avgOccurrencesPerConcept: totalOccurrences / (this.currentIndex.metadata.totalConcepts || 1),
      conceptsAppearingMultipleTimes,
      conceptsInMultipleFiles,
      strongRelationships,
      typeBreakdown
    };
  }

  exportToJSON(): string {
    if (!this.currentIndex) return '{}';
    const exportData = {
      metadata: this.currentIndex.metadata,
      concepts: Object.fromEntries(this.currentIndex.concepts),
      relations: this.currentIndex.relations,
      fileIndex: Object.fromEntries(this.currentIndex.fileIndex)
    };
    return JSON.stringify(exportData, null, 2);
  }

  importFromJSON(json: string): void {
    const data = JSON.parse(json);
    this.currentIndex = {
      metadata: data.metadata,
      concepts: new Map(Object.entries(data.concepts)),
      relations: data.relations,
      fileIndex: new Map(Object.entries(data.fileIndex))
    };
  }

  clearIndex(): void {
    this.currentIndex = null;
  }
}

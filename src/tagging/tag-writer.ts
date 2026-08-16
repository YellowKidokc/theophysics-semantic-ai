/**
 * Tag Writer Module
 * Handles reading, writing, and parsing semantic tags in notes
 */

import { TFile, Vault } from 'obsidian';
import { SemanticTag, TagType, ParsedTag } from '../types';
import { globalUUIDRegistry } from './uuid-generator';
import { ConceptRegistry } from './concept-registry';

// Tag format: %%tag::TYPE::UUID::"Label"::PARENT%% with an optional trailing
// ::@topic,topic segment. The TYPE group allows one embedded colon so custom
// types written as Custom:keyword round-trip correctly.
const TAG_REGEX = /%%tag::([^:%]+(?::[^:%]+)*)::([^:%]+)::"([^"]*)"::([^:%]*)(?:::@([^%]*))?%%/g;
const TAG_BLOCK_START = '\n\n%%--- SEMANTIC TAGS ---%%\n';
const TAG_BLOCK_END = '\n%%--- END SEMANTIC TAGS ---%%';

// Global concept registry reference (set by plugin)
let conceptRegistry: ConceptRegistry | null = null;

/**
 * Set the global concept registry
 */
export function setConceptRegistry(registry: ConceptRegistry): void {
  conceptRegistry = registry;
}

/**
 * Get the global concept registry
 */
export function getConceptRegistry(): ConceptRegistry | null {
  return conceptRegistry;
}

/**
 * Create a semantic tag object (uses registry if available)
 */
export function createTag(
  type: TagType,
  label: string,
  parentUuid: string | null = null,
  customType?: string,
  sourceFile?: string
): SemanticTag {
  let uuid: string;

  // Use concept registry for consistent UUIDs
  if (conceptRegistry && sourceFile) {
    uuid = conceptRegistry.getOrCreateUUID(label, type, sourceFile);
  } else {
    // Fallback to simple UUID generation
    uuid = globalUUIDRegistry.generateUnique();
    globalUUIDRegistry.register(uuid, label);
  }

  return {
    type,
    uuid,
    label,
    parentUuid,
    customType
  };
}

/**
 * Create a tag with explicit registry usage
 */
export function createTagWithRegistry(
  registry: ConceptRegistry,
  type: TagType,
  label: string,
  sourceFile: string,
  parentUuid: string | null = null,
  customType?: string
): SemanticTag {
  const uuid = registry.getOrCreateUUID(label, type, sourceFile);

  return {
    type,
    uuid,
    label,
    parentUuid,
    customType
  };
}

/**
 * Format a tag for writing to file
 */
export function formatTag(tag: SemanticTag): string {
  const parentPart = tag.parentUuid || 'null';
  const typePart = tag.customType ? `Custom:${tag.customType}` : tag.type;

  // Colons and quotes would break the delimiter, so they are stripped here
  // rather than producing a tag line that cannot be parsed back.
  const label = tag.label.replace(/["\n]/g, ' ').trim();

  const topicPart = tag.topics?.length
    ? `::@${tag.topics.map(t => t.replace(/[^A-Za-z0-9_-]/g, '')).join(',')}`
    : '';

  return `%%tag::${typePart}::${tag.uuid}::"${label}"::${parentPart}${topicPart}%%`;
}

/**
 * Parse tags from file content
 */
export function parseTags(content: string): ParsedTag[] {
  const tags: ParsedTag[] = [];
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    let match;
    TAG_REGEX.lastIndex = 0;

    while ((match = TAG_REGEX.exec(line)) !== null) {
      let type: TagType = match[1];
      let customType: string | undefined;

      // Custom classifier output is stored as Custom:keyword.
      if (match[1].startsWith('Custom:')) {
        type = 'Custom';
        customType = match[1].slice('Custom:'.length);
      }

      const topics = match[5]
        ? match[5].split(',').map(t => t.trim()).filter(Boolean)
        : undefined;

      const tag: SemanticTag = {
        type,
        uuid: match[2],
        label: match[3],
        parentUuid: match[4] === 'null' || match[4] === '' ? null : match[4],
        customType,
        topics
      };

      tags.push({
        raw: match[0],
        tag,
        lineNumber: index + 1
      });

      // Register the UUID
      globalUUIDRegistry.register(tag.uuid, tag.label);
    }
  });

  return tags;
}

/**
 * Check if content has a semantic tags block
 */
export function hasTagBlock(content: string): boolean {
  return content.includes('%%--- SEMANTIC TAGS ---%%');
}

/**
 * Extract the tag block from content
 */
export function extractTagBlock(content: string): string | null {
  const startIndex = content.indexOf('%%--- SEMANTIC TAGS ---%%');
  const endIndex = content.indexOf('%%--- END SEMANTIC TAGS ---%%');

  if (startIndex === -1 || endIndex === -1) {
    return null;
  }

  return content.slice(startIndex, endIndex + '%%--- END SEMANTIC TAGS ---%%'.length);
}

/**
 * Remove the tag block from content
 */
export function removeTagBlock(content: string): string {
  const startIndex = content.indexOf('\n\n%%--- SEMANTIC TAGS ---%%');
  const endIndex = content.indexOf('%%--- END SEMANTIC TAGS ---%%');

  if (startIndex === -1 || endIndex === -1) {
    return content;
  }

  return content.slice(0, startIndex) + content.slice(endIndex + '%%--- END SEMANTIC TAGS ---%%'.length);
}

/**
 * Create a formatted tag block
 */
export function createTagBlock(tags: SemanticTag[]): string {
  if (tags.length === 0) {
    return '';
  }

  const formattedTags = tags.map(formatTag).join('\n');
  return `${TAG_BLOCK_START}${formattedTags}${TAG_BLOCK_END}`;
}

/**
 * Write tags to a file
 */
export async function writeTags(
  vault: Vault,
  file: TFile,
  tags: SemanticTag[],
  append: boolean = true
): Promise<void> {
  // Vault.process reads and writes in one atomic step, so a note being edited
  // at the same time is not silently overwritten.
  await vault.process(file, (content) => {
    if (append && hasTagBlock(content)) {
      const existingTags = parseTags(content);
      const existingUuids = new Set(existingTags.map(pt => pt.tag.uuid));

      const newTags = tags.filter(tag => !existingUuids.has(tag.uuid));
      const allTags = [...existingTags.map(pt => pt.tag), ...newTags];

      return removeTagBlock(content).trimEnd() + createTagBlock(allTags);
    }

    if (hasTagBlock(content)) {
      return removeTagBlock(content).trimEnd() + createTagBlock(tags);
    }

    return content.trimEnd() + createTagBlock(tags);
  });
}

/**
 * Read tags from a file
 */
export async function readTags(vault: Vault, file: TFile): Promise<SemanticTag[]> {
  const content = await vault.cachedRead(file);
  return parseTags(content).map(pt => pt.tag);
}

/**
 * Remove specific tags from a file
 */
export async function removeTags(
  vault: Vault,
  file: TFile,
  uuidsToRemove: string[]
): Promise<void> {
  await vault.process(file, (content) => {
    const remainingTags = parseTags(content)
      .filter(pt => !uuidsToRemove.includes(pt.tag.uuid))
      .map(pt => pt.tag);

    const stripped = removeTagBlock(content);

    return remainingTags.length > 0
      ? stripped.trimEnd() + createTagBlock(remainingTags)
      : stripped;
  });
}

/**
 * Update a specific tag
 */
export async function updateTag(
  vault: Vault,
  file: TFile,
  uuid: string,
  updates: Partial<SemanticTag>
): Promise<void> {
  await vault.process(file, (content) => {
    const updatedTags = parseTags(content).map(pt =>
      // The UUID is the identity of the tag, so it is never overwritten.
      pt.tag.uuid === uuid ? { ...pt.tag, ...updates, uuid } : pt.tag
    );

    return removeTagBlock(content).trimEnd() + createTagBlock(updatedTags);
  });
}

/**
 * Get tag counts by type
 */
export function getTagCounts(tags: SemanticTag[]): Record<TagType, number> {
  const counts: Record<string, number> = {};

  for (const tag of tags) {
    const key = tag.customType ? `Custom:${tag.customType}` : tag.type;
    counts[key] = (counts[key] || 0) + 1;
  }

  return counts as Record<TagType, number>;
}

/**
 * Build tag hierarchy from flat list
 */
export function buildTagHierarchy(tags: SemanticTag[]): Map<string, SemanticTag[]> {
  const hierarchy = new Map<string, SemanticTag[]>();

  // Group by parent UUID
  for (const tag of tags) {
    const parentKey = tag.parentUuid || 'root';
    const children = hierarchy.get(parentKey) || [];
    children.push(tag);
    hierarchy.set(parentKey, children);
  }

  return hierarchy;
}

/**
 * Find related tags (same parent or child tags)
 */
export function findRelatedTags(tags: SemanticTag[], uuid: string): SemanticTag[] {
  const tag = tags.find(t => t.uuid === uuid);
  if (!tag) return [];

  const related: SemanticTag[] = [];

  // Find siblings (same parent)
  if (tag.parentUuid) {
    related.push(...tags.filter(t => t.parentUuid === tag.parentUuid && t.uuid !== uuid));
  }

  // Find children
  related.push(...tags.filter(t => t.parentUuid === uuid));

  // Find parent
  if (tag.parentUuid) {
    const parent = tags.find(t => t.uuid === tag.parentUuid);
    if (parent) related.push(parent);
  }

  return related;
}

/**
 * Toggle visibility of tag blocks in content (for display purposes)
 */
export function getContentWithTagVisibility(content: string, showTags: boolean): string {
  if (showTags) {
    return content;
  }

  // Hide the tag block by removing it from displayed content
  return removeTagBlock(content);
}

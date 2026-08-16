/**
 * AI Classifier
 * Talks to the configured provider and turns its answer into semantic tags.
 */

import { requestUrl, RequestUrlParam } from 'obsidian';
import {
  SemanticTag,
  TagType,
  Domain,
  ClassificationResult,
  AIClassificationResponse,
  SemanticAISettings,
  ProviderConfig,
  ProviderId,
  PROVIDERS,
  TokenEstimate,
  enabledCategoryIds,
  enabledTopics,
  topicsActive
} from '../types';
import { PromptManager, estimatePromptTokens, estimateCost } from './prompt-manager';
import { createTag } from '../tagging/tag-writer';

/** Resolved connection details for the provider that is currently selected. */
export function activeProvider(settings: SemanticAISettings): {
  id: ProviderId;
  config: ProviderConfig;
  endpoint: string;
  model: string;
} {
  const id = settings.provider;
  const info = PROVIDERS[id] || PROVIDERS.openai;
  const config = settings.providers?.[id] || { apiKey: '', endpoint: '', model: '' };

  return {
    id,
    config,
    endpoint: config.endpoint || info.defaultEndpoint,
    model: config.model || info.defaultModel
  };
}

export class AIClassifier {
  private settings: SemanticAISettings;
  private promptManager: PromptManager;

  constructor(settings: SemanticAISettings, promptManager: PromptManager) {
    this.settings = settings;
    this.promptManager = promptManager;
  }

  updateSettings(settings: SemanticAISettings): void {
    this.settings = settings;
    this.promptManager.updateSettings(settings);
  }

  /**
   * Classify content across a set of categories. Defaults to whichever
   * categories the user has enabled.
   */
  async classify(
    content: string,
    types?: TagType[],
    sourceFile?: string
  ): Promise<ClassificationResult> {
    const selected = types && types.length > 0 ? types : enabledCategoryIds(this.settings);
    const prompt = this.promptManager.buildClassificationPrompt(content, selected);

    const response = await this.complete(prompt);
    const parsed = this.parseAIResponse(response);
    const tags = this.convertToTags(parsed, sourceFile);

    return {
      tags,
      summary: `Found ${tags.length} element${tags.length === 1 ? '' : 's'}`
    };
  }

  /** Classify content for a single category. */
  async classifySingleType(content: string, type: TagType, sourceFile?: string): Promise<ClassificationResult> {
    const prompt = this.promptManager.buildSingleTypePrompt(content, type);

    const response = await this.complete(prompt);
    const parsed = this.parseAIResponse(response);
    const tags = this.convertToTags(parsed, sourceFile);

    return {
      tags,
      summary: `Found ${tags.length} ${this.promptManager.getTagTypeName(type).toLowerCase()}`
    };
  }

  /** Run a custom classifier by keyword. */
  async classifyCustom(content: string, keyword: string, sourceFile?: string): Promise<ClassificationResult> {
    const classifier = this.promptManager.findClassifierByKeyword(keyword);

    if (!classifier) {
      throw new Error(`Custom classifier '${keyword}' not found`);
    }

    const prompt = this.promptManager.buildCustomClassifierPrompt(content, classifier);

    const response = await this.complete(prompt);
    const parsed = this.parseAIResponse(response);
    const tags = this.convertToTags(parsed, sourceFile);

    return {
      tags,
      summary: `Found ${tags.length} '${keyword}' element${tags.length === 1 ? '' : 's'}`
    };
  }

  /** Estimate tokens and cost for a classification run. */
  estimateClassification(content: string, types: TagType[]): TokenEstimate {
    const prompt = this.promptManager.buildClassificationPrompt(content, types);
    const inputTokens = estimatePromptTokens(prompt, '');

    // Classification output runs roughly a fifth of the input.
    const estimatedOutputTokens = Math.ceil(inputTokens * 0.2);
    const { model } = activeProvider(this.settings);

    return {
      inputTokens,
      estimatedOutputTokens,
      estimatedCost: estimateCost(inputTokens, estimatedOutputTokens, model)
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Provider transport                                                     */
  /* ---------------------------------------------------------------------- */

  /**
   * Send a prompt to the active provider and return the raw text reply.
   * Public so other features can reuse the same transport and credentials.
   */
  async complete(prompt: string, maxTokens = 4096): Promise<string> {
    const { id, config, endpoint, model } = activeProvider(this.settings);
    const info = PROVIDERS[id] || PROVIDERS.openai;

    if (info.requiresKey && !config.apiKey) {
      throw new Error(`No API key set for ${info.name}. Add one in the plugin settings.`);
    }

    if (!endpoint) {
      throw new Error(`No endpoint set for ${info.name}. Add one in the plugin settings.`);
    }

    switch (info.wireFormat) {
      case 'anthropic':
        return this.callAnthropic(endpoint, config.apiKey, model, prompt, maxTokens);
      case 'ollama':
        return this.callOllama(endpoint, model, prompt);
      case 'openai':
      default:
        return this.callOpenAICompatible(endpoint, config.apiKey, model, prompt, maxTokens, info.name);
    }
  }

  /** OpenAI, DeepSeek, and any other chat-completions-compatible endpoint. */
  private async callOpenAICompatible(
    endpoint: string,
    apiKey: string,
    model: string,
    prompt: string,
    maxTokens: number,
    providerName: string
  ): Promise<string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const requestParams: RequestUrlParam = {
      url: endpoint,
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: maxTokens
      }),
      throw: false
    };

    const response = await requestUrl(requestParams);

    if (response.status !== 200) {
      throw new Error(`${providerName} error ${response.status}: ${this.errorDetail(response.text)}`);
    }

    const data = response.json;
    const text = data?.choices?.[0]?.message?.content;

    if (typeof text !== 'string') {
      throw new Error(`${providerName} returned an unexpected response shape.`);
    }

    return text;
  }

  private async callAnthropic(
    endpoint: string,
    apiKey: string,
    model: string,
    prompt: string,
    maxTokens: number
  ): Promise<string> {
    const requestParams: RequestUrlParam = {
      url: endpoint,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }]
      }),
      throw: false
    };

    const response = await requestUrl(requestParams);

    if (response.status !== 200) {
      throw new Error(`Anthropic error ${response.status}: ${this.errorDetail(response.text)}`);
    }

    const data = response.json;
    const text = data?.content?.[0]?.text;

    if (typeof text !== 'string') {
      throw new Error('Anthropic returned an unexpected response shape.');
    }

    return text;
  }

  private async callOllama(endpoint: string, model: string, prompt: string): Promise<string> {
    const requestParams: RequestUrlParam = {
      url: endpoint,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false }),
      throw: false
    };

    const response = await requestUrl(requestParams);

    if (response.status !== 200) {
      throw new Error(`Ollama error ${response.status}: ${this.errorDetail(response.text)}`);
    }

    const data = response.json;

    if (typeof data?.response !== 'string') {
      throw new Error('Ollama returned an unexpected response shape.');
    }

    return data.response;
  }

  /** Pull a readable message out of an error body without dumping the whole payload. */
  private errorDetail(body: string): string {
    if (!body) {
      return 'no response body';
    }

    try {
      const parsed = JSON.parse(body);
      const message = parsed?.error?.message || parsed?.error || parsed?.message;
      if (typeof message === 'string') {
        return message;
      }
    } catch {
      // Not JSON — fall through to the truncated raw body.
    }

    return body.length > 300 ? `${body.slice(0, 300)}…` : body;
  }

  /* ---------------------------------------------------------------------- */
  /* Response handling                                                      */
  /* ---------------------------------------------------------------------- */

  private parseAIResponse(response: string): AIClassificationResponse[] {
    let jsonStr = response.trim();

    // Strip a markdown code fence if the model wrapped its answer in one.
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    // Drop any prose before or after the array.
    const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      jsonStr = arrayMatch[0];
    }

    try {
      const parsed = JSON.parse(jsonStr);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      // Salvage whatever complete objects are in there.
      const partialMatch = jsonStr.match(/\{[^{}]*\}/g);
      if (partialMatch) {
        const results: AIClassificationResponse[] = [];
        for (const match of partialMatch) {
          try {
            results.push(JSON.parse(match));
          } catch {
            // Skip entries that are still malformed.
          }
        }
        if (results.length > 0) {
          return results;
        }
      }

      throw new Error('The model did not return valid JSON. Try a different model, or a smaller note.');
    }
  }

  private convertToTags(responses: AIClassificationResponse[], sourceFile?: string): SemanticTag[] {
    const tags: SemanticTag[] = [];
    const labelToUuid = new Map<string, string>();
    const validTopics = new Set(enabledTopics(this.settings).map(t => t.id));
    const wantTopics = topicsActive(this.settings);

    // First pass: create the tags.
    const accepted: AIClassificationResponse[] = [];

    for (const response of responses) {
      if (!response.type || !response.label) {
        continue;
      }

      const tag = createTag(
        response.type,
        response.label,
        null,
        response.type === 'Custom' ? response.customType : undefined,
        sourceFile
      );

      if (response.metadata) {
        tag.metadata = response.metadata;
      }

      if (wantTopics) {
        const claimed = response.topics || response.domains;
        if (Array.isArray(claimed)) {
          const kept = claimed.filter((d): d is Domain => typeof d === 'string' && validTopics.has(d));
          if (kept.length > 0) {
            tag.topics = kept;
          }
        }
      }

      tags.push(tag);
      accepted.push(response);
      labelToUuid.set(response.label, tag.uuid);
    }

    // Second pass: resolve parent references now that every label has a UUID.
    for (let i = 0; i < accepted.length; i++) {
      const parentLabel = accepted[i].parentLabel;
      if (parentLabel && labelToUuid.has(parentLabel)) {
        const parentUuid = labelToUuid.get(parentLabel) || null;
        // Don't let an element be its own parent.
        if (parentUuid !== tags[i].uuid) {
          tags[i].parentUuid = parentUuid;
        }
      }
    }

    return tags;
  }

  /* ---------------------------------------------------------------------- */
  /* Configuration                                                          */
  /* ---------------------------------------------------------------------- */

  validateConfiguration(): { valid: boolean; error?: string } {
    const { id, config, endpoint } = activeProvider(this.settings);
    const info = PROVIDERS[id] || PROVIDERS.openai;

    if (info.requiresKey && !config.apiKey) {
      return { valid: false, error: `no API key set for ${info.name}` };
    }

    if (!endpoint) {
      return { valid: false, error: `no endpoint set for ${info.name}` };
    }

    if (this.settings.categories.length === 0) {
      return { valid: false, error: 'no categories defined' };
    }

    return { valid: true };
  }

  /** Round-trip a tiny prompt so the user can check credentials from settings. */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    const validation = this.validateConfiguration();
    if (!validation.valid) {
      return { success: false, message: `Cannot connect: ${validation.error}.` };
    }

    try {
      const response = await this.complete('Respond with exactly: {"test": "success"}', 64);
      const { id, model } = activeProvider(this.settings);

      if (response.includes('success')) {
        return { success: true, message: `Connected to ${PROVIDERS[id].name} using ${model}.` };
      }

      return {
        success: true,
        message: `Connected to ${PROVIDERS[id].name}, but ${model} replied in an unexpected format.`
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Connection failed'
      };
    }
  }
}

/**
 * Batch classifier for processing multiple files.
 */
export class BatchClassifier {
  private classifier: AIClassifier;
  private onProgress: (file: string, status: string, counts?: Record<string, number>) => void;
  private cancelled = false;

  constructor(
    classifier: AIClassifier,
    onProgress: (file: string, status: string, counts?: Record<string, number>) => void
  ) {
    this.classifier = classifier;
    this.onProgress = onProgress;
  }

  /** Stop after the file currently in flight. */
  cancel(): void {
    this.cancelled = true;
  }

  async processFiles(
    files: { path: string; content: string }[],
    types: TagType[]
  ): Promise<Map<string, ClassificationResult>> {
    const results = new Map<string, ClassificationResult>();

    for (const file of files) {
      if (this.cancelled) {
        break;
      }

      this.onProgress(file.path, 'processing');

      try {
        const result = await this.classifier.classify(file.content, types, file.path);
        results.set(file.path, result);

        const counts: Record<string, number> = {};
        for (const tag of result.tags) {
          counts[tag.type] = (counts[tag.type] || 0) + 1;
        }

        this.onProgress(file.path, 'complete', counts);
      } catch (error) {
        this.onProgress(file.path, `error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        results.set(file.path, { tags: [], summary: 'Classification failed' });
      }

      // Space requests out so providers don't rate-limit the batch.
      await new Promise(resolve => window.setTimeout(resolve, 500));
    }

    return results;
  }

  estimateBatchCost(
    files: { content: string }[],
    types: TagType[]
  ): { totalTokens: number; estimatedCost: number } {
    let totalTokens = 0;
    let estimatedCost = 0;

    for (const file of files) {
      const estimate = this.classifier.estimateClassification(file.content, types);
      totalTokens += estimate.inputTokens + estimate.estimatedOutputTokens;
      estimatedCost += estimate.estimatedCost;
    }

    return { totalTokens, estimatedCost };
  }
}

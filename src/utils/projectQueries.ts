import type {
  ParsedScrivenerProject,
  ScrivenerBinderNode,
  ScrivenerCollection,
  ScrivenerCollectionSearch,
  ScrivenerDocumentContent,
  ScrivenerMetaSettings,
  ScrivenerStyleSpan,
  ScrivenerPlaceholderLocation,
  ScrivenerSearchIndex,
  ScrivenerSearchIndexDocument,
} from '../types.js';
import { extractPlaceholders } from '../rtf/extractPlaceholders.js';
import { buildBoolQuery } from './boolQuery.js';

function flattenBinder(nodes: ScrivenerBinderNode[]): ScrivenerBinderNode[] {
  const result: ScrivenerBinderNode[] = [];
  const stack = [...nodes];
  for (let index = 0; index < stack.length; index += 1) {
    const node = stack[index];
    if (!node) continue;
    result.push(node);
    if (node.children?.length) {
      stack.push(...node.children);
    }
  }
  return result;
}

function findDocumentForNode(
  docs: Record<string, ScrivenerDocumentContent>,
  node: ScrivenerBinderNode,
): ScrivenerDocumentContent | undefined {
  // textId is usually UUID; fallback to node uuid
  return docs[String(node.textId ?? node.uuid)];
}

function normalize(text: string, caseSensitive?: boolean, ignoreDiacritics?: boolean): string {
  let value = text;
  if (ignoreDiacritics) {
    value = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  if (!caseSensitive) {
    value = value.toLowerCase();
  }
  return value;
}

function tokenise(query?: string): string[] {
  if (!query) return [];
  return (query.match(/"[^"]+"|\S+/g) ?? []).map((token) => token.replace(/^"+|"+$/g, '').trim());
}

function resolveLabelName(id: number, metadata: ScrivenerMetaSettings): string | undefined {
  return metadata.labels.find((label) => label.id === id)?.title;
}

function resolveStatusName(id: number, metadata: ScrivenerMetaSettings): string | undefined {
  return metadata.statuses.find((status) => status.id === id)?.title;
}

function resolveSectionName(id: string | undefined, metadata: ScrivenerMetaSettings): string | undefined {
  if (!id) return undefined;
  return metadata.sectionTypes.find((s) => s.id === id)?.title;
}

function collectTexts(
  node: ScrivenerBinderNode,
  doc?: ScrivenerDocumentContent,
  searchDoc?: ScrivenerSearchIndexDocument,
): string {
  const parts: string[] = [];
  if (node.title) parts.push(node.title);
  if (doc?.synopsis) parts.push(doc.synopsis);
  if (doc?.textPlain) {
    parts.push(doc.textPlain);
  } else if (doc?.textRtf) {
    parts.push(doc.textRtf);
  }
  if (doc?.notesPlain) {
    parts.push(doc.notesPlain);
  } else if (doc?.notesRtf) {
    parts.push(doc.notesRtf);
  }
  if (searchDoc?.text) {
    parts.push(searchDoc.text);
  }
  if (searchDoc?.notes) {
    parts.push(searchDoc.notes);
  }
  return parts.join('\n');
}

function matchTokens(text: string, tokens: string[], operator: string, caseSensitive?: boolean, ignoreDiacritics?: boolean): boolean {
  if (!tokens.length) return false;
  const haystack = normalize(text, caseSensitive, ignoreDiacritics);
  if (operator === 'All') {
    return tokens.every((token) => haystack.includes(normalize(token, caseSensitive, ignoreDiacritics)));
  }
  return tokens.some((token) => haystack.includes(normalize(token, caseSensitive, ignoreDiacritics)));
}

function matchRegEx(text: string, pattern: string, caseSensitive?: boolean): boolean {
  try {
    const flags = caseSensitive ? 'm' : 'im';
    const re = new RegExp(pattern, flags);
    return re.test(text);
  } catch {
    return false;
  }
}

function matchLabel(
  search: ScrivenerCollectionSearch,
  node: ScrivenerBinderNode,
  metadata: ScrivenerMetaSettings,
): boolean {
  if (!node.meta?.labelId) return false;
  const labelName = resolveLabelName(node.meta.labelId, metadata);
  const query = search.query ?? '';
  const tokens = tokenise(query).filter(
    (token) => token.toUpperCase() !== 'OR' && token.toUpperCase() !== 'AND' && !token.startsWith('label:'),
  );
  const candidates = tokens.length ? tokens : tokenise(query.replace(/label:/gi, ''));
  if (!candidates.length) return false;
  const normalized = normalize(labelName ?? '', search.caseSensitive, search.ignoreDiacritics);
  return candidates.some((token) => normalized === normalize(token, search.caseSensitive, search.ignoreDiacritics));
}

function matchStatus(
  search: ScrivenerCollectionSearch,
  node: ScrivenerBinderNode,
  metadata: ScrivenerMetaSettings,
): boolean {
  if (!node.meta?.statusId) return false;
  const statusName = resolveStatusName(node.meta.statusId, metadata);
  const tokens = tokenise(search.query);
  if (!tokens.length) return false;
  const normalized = normalize(statusName ?? '', search.caseSensitive, search.ignoreDiacritics);
  return tokens.some((token) => normalized === normalize(token, search.caseSensitive, search.ignoreDiacritics));
}

function matchSectionType(
  search: ScrivenerCollectionSearch,
  node: ScrivenerBinderNode,
  metadata: ScrivenerMetaSettings,
): boolean {
  const sectionTitle =
    node.meta?.sectionTypeTitle ??
    resolveSectionName(node.meta?.sectionTypeId, metadata);
  const tokens = tokenise(search.query);
  if (!tokens.length || !sectionTitle) return false;
  const normalized = normalize(sectionTitle, search.caseSensitive, search.ignoreDiacritics);
  return tokens.some((token) => normalized === normalize(token, search.caseSensitive, search.ignoreDiacritics));
}

function matchKeyword(
  search: ScrivenerCollectionSearch,
  node: ScrivenerBinderNode,
): boolean {
  if (!node.meta?.keywords?.length) return false;
  const keywords = node.meta.keywords.map((k) => normalize(k, search.caseSensitive, search.ignoreDiacritics));
  const tokens = tokenise(search.query);
  if (!tokens.length) return false;
  return tokens.some((token) => keywords.includes(normalize(token, search.caseSensitive, search.ignoreDiacritics)));
}

function matchTextual(
  search: ScrivenerCollectionSearch,
  node: ScrivenerBinderNode,
  doc: ScrivenerDocumentContent | undefined,
  searchDoc?: ScrivenerSearchIndexDocument,
): boolean {
  const content = collectTexts(node, doc, searchDoc);
  if (!content) return false;
  if (search.operator === 'RegEx') {
    return matchRegEx(content, search.query ?? '', search.caseSensitive);
  }
  const query = search.query ?? '';
  const normalized = (value: string) => normalize(value, search.caseSensitive, search.ignoreDiacritics);
  const evaluator = buildBoolQuery(query, normalized);
  return evaluator.evaluate(content);
}

function selectSearchDoc(
  searchIndex: ScrivenerSearchIndex | undefined,
  node: ScrivenerBinderNode,
  lookup?: Map<string, ScrivenerSearchIndexDocument>,
): ScrivenerSearchIndexDocument | undefined {
  if (!searchIndex) return undefined;
  if (lookup) {
    return lookup.get(String(node.textId ?? '')) ?? lookup.get(node.uuid);
  }
  return searchIndex.documents.find((doc) => doc.id === node.textId || doc.id === node.uuid);
}

function buildSearchDocLookup(
  searchIndex: ScrivenerSearchIndex | undefined,
): Map<string, ScrivenerSearchIndexDocument> | undefined {
  if (!searchIndex?.documents?.length) {
    return undefined;
  }
  const map = new Map<string, ScrivenerSearchIndexDocument>();
  for (const doc of searchIndex.documents) {
    const id = String(doc.id ?? '').trim();
    if (id) {
      map.set(id, doc);
    }
  }
  return map;
}

/**
 * Determines whether a binder node/document matches a Scrivener saved-search definition.
 * Supports the most common search types: Label, Status, SectionType, Keyword, Text/All.
 */
export function matchesCollectionSearch(
  search: ScrivenerCollectionSearch,
  metadata: ScrivenerMetaSettings,
  node: ScrivenerBinderNode,
  doc?: ScrivenerDocumentContent,
  searchIndex?: ScrivenerSearchIndex,
  searchDocLookup?: Map<string, ScrivenerSearchIndexDocument>,
): boolean {
  const searchDoc = selectSearchDoc(searchIndex, node, searchDocLookup);
  const searchType = (search.type ?? (search as any).Type ?? '').toString();
  switch (searchType) {
    case 'Label':
      return matchLabel(search, node, metadata);
    case 'Status':
      return matchStatus(search, node, metadata);
    case 'SectionType':
      return matchSectionType(search, node, metadata);
    case 'Keyword':
    case 'Keywords':
      return matchKeyword(search, node);
    case 'Notes':
    case 'Text':
    case 'All':
    default:
      return matchTextual(search, node, doc, searchDoc);
  }
}

export function findCollectionMatches(
  collection: ScrivenerCollection,
  project: ParsedScrivenerProject,
): ScrivenerBinderNode[] {
  if (!collection) return [];
  const search = collection.search;
  const flat = flattenBinder(project.binder);
  if (!search) {
    // Arbitrary collections have binderUUIDs stored
    if (collection.binderUUIDs?.length) {
      const set = new Set(collection.binderUUIDs);
      return flat.filter((node) => set.has(node.uuid));
    }
    return [];
  }
  const searchDocLookup = buildSearchDocLookup(project.search);
  return flat.filter((node) =>
    matchesCollectionSearch(
      search,
      project.metadata,
      node,
      findDocumentForNode(project.documents, node),
      project.search,
      searchDocLookup,
    ),
  );
}

export interface CollectPlaceholdersOptions {
  includeNotes?: boolean;
  includeSearchIndex?: boolean;
}

/**
 * Aggregate all placeholders across the project.
 * Relies on precomputed document placeholders when available, otherwise extracts on the fly.
 */
export function collectPlaceholders(
  project: ParsedScrivenerProject,
  options: CollectPlaceholdersOptions = {},
): ScrivenerPlaceholderLocation[] {
  const results: ScrivenerPlaceholderLocation[] = [];
  const flatBinder = flattenBinder(project.binder);
  const binderById = new Map(flatBinder.map((node) => [node.uuid, node]));

  for (const doc of Object.values(project.documents)) {
    const node = binderById.get(doc.uuid);
    const title = node?.title;
    const placeholders =
      doc.placeholders ??
      extractPlaceholders(doc.textRtf ?? doc.textPlain ?? '', 'text', doc.textPlain);
    for (const placeholder of placeholders) {
      if (!options.includeNotes && placeholder.source === 'notes') continue;
      results.push({
        ...placeholder,
        uuid: doc.uuid,
        binderTitle: title,
      });
    }
    if (options.includeNotes && doc.notesRtf && !doc.notesPlain) {
      const extra = extractPlaceholders(doc.notesRtf, 'notes', doc.notesPlain);
      for (const placeholder of extra) {
        results.push({
          ...placeholder,
          uuid: doc.uuid,
          binderTitle: title,
        });
      }
    }
  }

  if (options.includeSearchIndex && project.search?.documents?.length) {
    for (const searchDoc of project.search.documents) {
      const combined = `${searchDoc.title ?? ''}\n${searchDoc.text ?? ''}\n${searchDoc.notes ?? ''}`;
      const matches = extractPlaceholders(combined, 'text', combined);
      if (!matches.length) continue;
      for (const placeholder of matches) {
        results.push({
          ...placeholder,
          uuid: String(searchDoc.id),
          binderTitle: searchDoc.title,
        });
      }
    }
  }

  return results;
}

export interface PlaceholderParagraphMatch {
  uuid: string;
  binderTitle?: string;
  paragraph: string;
  start: number;
  end: number;
  placeholders: ScrivenerPlaceholderLocation[];
}

function splitParagraphsWithOffsets(text: string): Array<{ text: string; start: number; end: number }> {
  const result: Array<{ text: string; start: number; end: number }> = [];
  let start = 0;
  for (let i = 0; i <= text.length; i += 1) {
    if (i === text.length || text[i] === '\n') {
      const end = i;
      const chunk = text.slice(start, end);
      if (chunk.length) {
        result.push({ text: chunk, start, end });
      }
      start = i + 1;
    }
  }
  return result;
}

function ensureBinderMap(project: ParsedScrivenerProject): Map<string, ScrivenerBinderNode> {
  const map = new Map<string, ScrivenerBinderNode>();
  const stack = [...project.binder];
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    map.set(node.uuid, node);
    if (node.children?.length) {
      stack.push(...node.children);
    }
  }
  return map;
}

export function findParagraphsWithPlaceholders(
  project: ParsedScrivenerProject,
  predicate?: (paragraph: PlaceholderParagraphMatch) => boolean,
): PlaceholderParagraphMatch[] {
  const matches: PlaceholderParagraphMatch[] = [];
  const binderMap = ensureBinderMap(project);
  const placeholdersByUuid = new Map<string, ScrivenerPlaceholderLocation[]>();
  for (const placeholder of collectPlaceholders(project, { includeNotes: false })) {
    const list = placeholdersByUuid.get(placeholder.uuid) ?? [];
    list.push(placeholder);
    placeholdersByUuid.set(placeholder.uuid, list);
  }

  for (const doc of Object.values(project.documents)) {
    if (!doc.textPlain) continue;
    const node = binderMap.get(doc.uuid);
    const placeholders = placeholdersByUuid.get(doc.uuid) ?? [];
    if (!placeholders.length) continue;
    const paragraphs = splitParagraphsWithOffsets(doc.textPlain);
    for (const para of paragraphs) {
      const hits = placeholders.filter(
        (ph) => ph.start >= para.start && ph.start <= para.end,
      );
      if (!hits.length) continue;
      const match: PlaceholderParagraphMatch = {
        uuid: doc.uuid,
        binderTitle: node?.title,
        paragraph: para.text,
        start: para.start,
        end: para.end,
        placeholders: hits,
      };
      if (!predicate || predicate(match)) {
        matches.push(match);
      }
    }
  }
  return matches;
}

export interface StyleSpanMatch {
  uuid: string;
  binderTitle?: string;
  span: ScrivenerStyleSpan;
}

export function findStyleSpans(
  project: ParsedScrivenerProject,
  predicate: (span: ScrivenerStyleSpan, doc: ScrivenerDocumentContent, binder?: ScrivenerBinderNode) => boolean,
): StyleSpanMatch[] {
  const matches: StyleSpanMatch[] = [];
  const binderMap = ensureBinderMap(project);
  for (const doc of Object.values(project.documents)) {
    if (!doc.styleSpans?.length) continue;
    const node = binderMap.get(doc.uuid);
    for (const span of doc.styleSpans) {
      if (predicate(span, doc, node)) {
        matches.push({
          uuid: doc.uuid,
          binderTitle: node?.title,
          span,
        });
      }
    }
  }
  return matches;
}

export interface ProjectSummary {
  countsByLabel: Record<string, number>;
  countsByStatus: Record<string, number>;
  countsBySectionType: Record<string, number>;
  docCount: number;
  wordCount: number;
  charCount: number;
}

function countWords(text?: string): number {
  if (!text) return 0;
  const tokens = text
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return tokens.length;
}

export function summarizeProject(project: ParsedScrivenerProject): ProjectSummary {
  const countsByLabel: Record<string, number> = {};
  const countsByStatus: Record<string, number> = {};
  const countsBySectionType: Record<string, number> = {};
  let docCount = 0;
  let wordCount = 0;
  let charCount = 0;
  const labelMap = new Map(project.metadata.labels.map((l) => [l.id, l.title ?? String(l.id)]));
  const statusMap = new Map(project.metadata.statuses.map((s) => [s.id, s.title ?? String(s.id)]));
  const sectionMap = new Map(project.metadata.sectionTypes.map((s) => [s.id, s.title ?? s.id]));

  for (const doc of Object.values(project.documents)) {
    docCount += 1;
    if (doc.textPlain) {
      wordCount += countWords(doc.textPlain);
      charCount += doc.textPlain.length;
    }
    const meta = doc.binderMeta;
    if (meta?.labelId !== undefined) {
      const name = labelMap.get(meta.labelId) ?? String(meta.labelId);
      countsByLabel[name] = (countsByLabel[name] ?? 0) + 1;
    }
    if (meta?.statusId !== undefined) {
      const name = statusMap.get(meta.statusId) ?? String(meta.statusId);
      countsByStatus[name] = (countsByStatus[name] ?? 0) + 1;
    }
    if (meta?.sectionTypeId) {
      const name = sectionMap.get(meta.sectionTypeId) ?? meta.sectionTypeId;
      countsBySectionType[name] = (countsBySectionType[name] ?? 0) + 1;
    }
  }

  return {
    countsByLabel,
    countsByStatus,
    countsBySectionType,
    docCount,
    wordCount,
    charCount,
  };
}

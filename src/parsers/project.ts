import { ScrivenerArchive } from '../archive/ScrivenerArchive.js';
import { parseXml } from '../utils/xml.js';
import type {
  ParsedScrivenerProject,
  ParsedScrivenerProjectBinder,
  ScrivenerBinderNode,
  ScrivenerParserOptions,
  ScrivenerProjectInfo,
} from '../types.js';
import { parseBinder } from './binder.js';
import { parseDocuments } from './documents.js';
import { parseMetaSettings } from './metadata.js';
import { parseSettings } from './settings.js';
import { parseStats } from './stats.js';
import { parseSnapshots } from './snapshots.js';
import { parseSearchIndex } from './search.js';
import { parseResources } from './resources.js';
import { buildCompilePlan } from './compile-plan.js';
import { readScrImageLinkTokenAt } from '../rtf/parseScrImageLink.js';


function findScrivxPath(archive: ScrivenerArchive): string {
  const candidates = archive
    .list()
    .filter((path) => path.toLowerCase().endsWith('.scrivx'))
    .sort((a, b) => a.length - b.length);
  if (!candidates.length) {
    throw new Error('No .scrivx file found inside the archive.');
  }
  return candidates[0];
}

function getProjectInfo(node: any): ScrivenerProjectInfo {
  return {
    identifier: node.Identifier,
    version: node.Version,
    creator: node.Creator,
    device: node.Device,
    author: node.Author,
    modified: node.Modified,
    modId: node.ModID,
    title: node.Title,
  };
}

function deriveRoot(path: string): string {
  const lastSlash = path.lastIndexOf('/');
  return lastSlash === -1 ? '' : path.slice(0, lastSlash);
}

function parseAutoCompleteList(node: any): string[] {
  const items = node?.AutoCompleteList?.Completion;
  if (!items) return [];
  const list = Array.isArray(items) ? items : [items];
  return list
    .map((entry: any) => String(entry['#text'] ?? entry.text ?? entry))
    .filter(Boolean);
}

function normalizeDisplayTitle(value?: string): string | undefined {
  const normalized = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || undefined;
}

function clipDisplayTitleSentence(value?: string): string | undefined {
  const normalized = normalizeDisplayTitle(value);
  if (!normalized) {
    return undefined;
  }

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (!'.!?…'.includes(char)) {
      continue;
    }

    const previous = normalized[index - 1] ?? '';
    const next = normalized[index + 1] ?? '';
    if (char === '.' && /\d/.test(previous) && /\d/.test(next)) {
      continue;
    }

    if (!next || /\s/.test(next)) {
      return normalizeDisplayTitle(normalized.slice(0, index + 1));
    }

    let cursor = index + 1;
    while (cursor < normalized.length && /[\s"'”’»)\]]/.test(normalized[cursor])) {
      cursor += 1;
    }

    if (cursor >= normalized.length) {
      return normalizeDisplayTitle(normalized.slice(0, index + 1));
    }

    if (/[A-ZÀ-ÖØ-Þ]/.test(normalized[cursor])) {
      return normalizeDisplayTitle(normalized.slice(0, index + 1));
    }
  }

  return normalized;
}

function countPrecedingBackslashes(text: string, index: number): number {
  let count = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
    count += 1;
  }
  return count;
}

function isEscapedPlaceholderStart(text: string, index: number): boolean {
  return countPrecedingBackslashes(text, index) % 2 === 1;
}

function readImageTokenAt(text: string, start: number): { end: number } | null {
  const token = readScrImageLinkTokenAt(text, start);
  return token ? { end: token.end } : null;
}

function readMarkupTokenAt(text: string, start: number): { end: number } | null {
  if (
    (!text.startsWith('<$', start) && !text.startsWith('<!$', start))
    || isEscapedPlaceholderStart(text, start)
  ) {
    return null;
  }

  let depth = 1;
  let cursor = start + (text.startsWith('<!$', start) ? 3 : 2);
  while (cursor < text.length) {
    const char = text[cursor];
    if (char === '\n' || char === '\r') {
      return null;
    }
    if (!isEscapedPlaceholderStart(text, cursor)) {
      if (text.startsWith('<!$', cursor)) {
        depth += 1;
        cursor += 3;
        continue;
      }
      if (text.startsWith('<$', cursor)) {
        depth += 1;
        cursor += 2;
        continue;
      }
    }
    if (char === '>' && countPrecedingBackslashes(text, cursor) % 2 === 0) {
      depth -= 1;
      cursor += 1;
      if (depth === 0) {
        return { end: cursor };
      }
      continue;
    }
    cursor += 1;
  }

  return null;
}

function stripDisplayTitleMarkup(value?: string): string {
  const text = String(value ?? '');
  if (!text) {
    return '';
  }

  let result = '';
  for (let index = 0; index < text.length;) {
    const image = readImageTokenAt(text, index);
    if (image) {
      index = image.end;
      continue;
    }

    const markup = readMarkupTokenAt(text, index);
    if (markup) {
      index = markup.end;
      continue;
    }

    result += text[index];
    index += 1;
  }

  return result;
}

function deriveExplicitDisplayTitle(value?: string): string | undefined {
  const text = stripDisplayTitleMarkup(value);
  const lines = String(text ?? '').split(/\r?\n/);
  for (const line of lines) {
    const candidate = normalizeDisplayTitle(line);
    if (candidate) {
      return candidate;
    }
  }
  return undefined;
}

function deriveDisplayTitleCandidate(value?: string): string | undefined {
  const text = stripDisplayTitleMarkup(value);
  const lines = String(text ?? '').split(/\r?\n/);
  for (const line of lines) {
    const candidate = clipDisplayTitleSentence(line);
    if (candidate) {
      return candidate;
    }
  }
  return undefined;
}

function deriveBinderDisplayTitleInfo(
  rawTitle: string | undefined,
  textPlain: string | undefined,
): { displayTitle?: string; displayTitleIsDerived: boolean } {
  const explicitTitle = deriveExplicitDisplayTitle(rawTitle);
  if (explicitTitle) {
    return {
      displayTitle: explicitTitle,
      displayTitleIsDerived: false,
    };
  }

  const lines = String(textPlain ?? '').split(/\r?\n/);
  for (const line of lines) {
    const candidate = deriveDisplayTitleCandidate(line);
    if (candidate) {
      return {
        displayTitle: candidate,
        displayTitleIsDerived: true,
      };
    }
  }

  return {
    displayTitle: undefined,
    displayTitleIsDerived: false,
  };
}

function applyBinderDisplayTitles(nodes: any[], documents: Record<string, any>) {
  for (const node of nodes || []) {
    const doc = node?.textId ? documents[node.textId] : undefined;
    const titleInfo = deriveBinderDisplayTitleInfo(node?.title, doc?.textPlain);
    node.displayTitle = titleInfo.displayTitle;
    node.displayTitleIsDerived = titleInfo.displayTitleIsDerived;
    if (node.children?.length) {
      applyBinderDisplayTitles(node.children, documents);
    }
  }
}

function normalizeTopLevelBinderSections(binder: ScrivenerBinderNode[]) {
  const draft = binder.find((n) => n.type === 'DraftFolder' || n.type === 'Draft');
  const research = binder.find((n) => n.type === 'ResearchFolder' || n.type === 'Research');
  const trash = binder.find((n) => n.type === 'TrashFolder' || n.type === 'Trash');
  const extras = binder.filter((n) => n !== draft && n !== research && n !== trash);
  return { draft, research, trash, extras };
}

export function parseProjectBinder(
  archive: ScrivenerArchive,
  options: ScrivenerParserOptions = {},
): ParsedScrivenerProjectBinder {
  const scrivxPath = findScrivxPath(archive);
  const rootPath = deriveRoot(scrivxPath);
  const projectTree = parseXml<any>(archive.readText(scrivxPath));
  const projectNode = projectTree?.ScrivenerProject ?? projectTree;
  const diagnostics = options.diagnostics ?? [];
  const metadata = parseMetaSettings(projectNode);
  const binder = projectNode.Binder
    ? parseBinder(projectNode.Binder, {
        customMetaFields: metadata.customMeta,
        sectionTypes: metadata.sectionTypes,
      })
    : [];

  return {
    info: getProjectInfo(projectNode),
    binder,
    metadata,
    binderSections: options.normalizeBinderSections ? normalizeTopLevelBinderSections(binder) : undefined,
    diagnostics: diagnostics.length ? diagnostics : undefined,
    archive: {
      root: rootPath,
      scrivxPath,
    },
  };
}

export function parseProject(
  archive: ScrivenerArchive,
  options: ScrivenerParserOptions = {},
): ParsedScrivenerProject {
  const scrivxPath = findScrivxPath(archive);
  const rootPath = deriveRoot(scrivxPath);
  const projectTree = parseXml<any>(archive.readText(scrivxPath));
  const projectNode = projectTree?.ScrivenerProject ?? projectTree;

  const decodeRtf = options.decodeRtf !== false;
  const includeBinaryAssets = Boolean(options.includeBinaryAssets);
  const loadSnapshots = options.loadSnapshots !== false;
  const extractPlaceholders = Boolean(options.extractPlaceholders);
  const extractStyleIds = Boolean(options.extractStyleIds);
  const extractStyleSpans = Boolean(options.extractStyleSpans);
  const attachBinderMetaToDocs = Boolean(options.attachBinderMetaToDocs);
  const extractEmbeddedImages = Boolean(options.extractEmbeddedImages);
  const extractInlineAnnotations = Boolean(options.extractInlineAnnotations);
  const extractLinkedImages = Boolean(options.extractLinkedImages);
  const extractHyperlinks = Boolean(options.extractHyperlinks);
  const extractBookmarks = Boolean(options.extractBookmarks);
  const extractFields = Boolean(options.extractFields);
  const extractTables = Boolean(options.extractTables);
  const computeTextCounts = Boolean(options.computeTextCounts);
  const normalizeBinderSections = Boolean(options.normalizeBinderSections);
  const diagnostics = options.diagnostics ?? [];
  const diagnosticOptions = {
    tolerant: Boolean(options.tolerant),
    diagnostics,
  };

  const metadata = parseMetaSettings(projectNode);
  const binder = projectNode.Binder
    ? parseBinder(projectNode.Binder, {
        customMetaFields: metadata.customMeta,
        sectionTypes: metadata.sectionTypes,
      })
    : [];
  const resources = parseResources(archive, {
    basePath: rootPath,
    includeBinaryAssets,
    ...diagnosticOptions,
  });
  const documents = parseDocuments(archive, {
    basePath: rootPath,
    decodeRtf,
    includeBinaryAssets,
    extractPlaceholders,
    extractStyleIds,
    extractStyleSpans,
    extractEmbeddedImages,
    extractInlineAnnotations,
    extractLinkedImages,
    extractHyperlinks,
    extractBookmarks,
    extractFields,
    extractTables,
    computeTextCounts,
    styleDefinitions: resources.styles,
    ...diagnosticOptions,
  });
  applyBinderDisplayTitles(binder, documents);
  const snapshots = loadSnapshots ? parseSnapshots(archive, {
    basePath: rootPath,
    decodeRtf,
    extractPlaceholders,
    extractEmbeddedImages,
    extractInlineAnnotations,
    extractLinkedImages,
    extractHyperlinks,
    extractBookmarks,
    extractFields,
    extractTables,
    computeTextCounts,
    ...diagnosticOptions,
  }) : {};
  const settings = parseSettings(archive, rootPath, diagnosticOptions);
  const autoComplete = parseAutoCompleteList(projectNode);
  if (autoComplete.length) {
    settings.autoComplete = autoComplete;
  }
  if (projectNode.PrintSettings) {
    settings.printSettings = projectNode.PrintSettings;
  }
  if (metadata.labels) {
    metadata.labels = metadata.labels.map((label) => ({
      id: label.id,
      title: label.title,
      color: label.color ?? undefined,
    }));
  }
  if (metadata.statuses) {
    metadata.statuses = metadata.statuses.map((status) => ({
      id: status.id,
      title: status.title,
    }));
  }
  if (metadata.keywords) {
    metadata.keywords = metadata.keywords.map((kw) => ({
      id: kw.id,
      title: kw.title,
      color: kw.color ?? undefined,
    }));
  }
  const stats = parseStats(archive, rootPath, projectNode, diagnosticOptions);
  const search = parseSearchIndex(archive, rootPath, diagnosticOptions);
  const compilePlan = buildCompilePlan(binder, settings);

  const binderById = new Map<string, any>();
  const stack = [...binder];
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    binderById.set(node.uuid, node.meta);
    if (node.children?.length) {
      stack.push(...node.children);
    }
  }
  if (attachBinderMetaToDocs) {
    for (const doc of Object.values(documents)) {
      const meta = binderById.get(doc.uuid);
      if (meta) {
        doc.binderMeta = meta;
      }
    }
  }

  let binderSections;
  if (normalizeBinderSections) {
    binderSections = normalizeTopLevelBinderSections(binder);
  }

  return {
    info: getProjectInfo(projectNode),
    binder,
    documents,
    metadata,
    settings,
    compilePlan,
    stats,
    snapshots,
    search,
    resources,
    templateFolderUUID: projectNode.TemplateFolderUUID,
    autoComplete: settings.autoComplete,
    binderSections,
    diagnostics: diagnostics.length ? diagnostics : undefined,
    archive: {
      root: rootPath,
      scrivxPath,
    },
  };
}

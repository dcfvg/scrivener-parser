import '../polyfills/buffer.js';
import plist from 'plist';
import { ScrivenerArchive } from '../archive/ScrivenerArchive.js';
import type {
  ScrivenerCompileFormat,
  ScrivenerCompileFormatSelection,
  ScrivenerCompileLayout,
  ScrivenerCompileLayoutFormatting,
  ScrivenerCompileMetadata,
  ScrivenerCompileMetadataValue,
  ScrivenerCompileSettings,
  ScrivenerCompileTextValue,
  ScrivenerFavoriteEntry,
  ScrivenerFavorites,
  ScrivenerFavoritesBucket,
  ScrivenerIniFile,
  ScrivenerLegacyCompilePreset,
  ScrivenerProjectPreferences,
  ScrivenerScriptFormat,
  ScrivenerSettingsData,
  ScrivenerStructuredObject,
  ScrivenerStructuredValue,
  ScrivenerTemplateInfo,
  ScrivenerTutorialInfo,
  ScrivenerUiCommon,
  ScrivenerUiCommonEditorSummary,
  ScrivenerUiState,
} from '../types.js';
import { toArray, asNumber } from '../utils/collections.js';
import { yesNo } from '../utils/strings.js';
import { parseXml } from '../utils/xml.js';
import { extractPlaceholders } from '../rtf/extractPlaceholders.js';
import { rtfToText } from '../rtf/rtfToText.js';
import {
  recordParserDiagnostic,
  tryOptionalParse,
  type ParserDiagnosticSink,
} from '../utils/diagnostics.js';

function joinPath(base: string, child: string): string {
  return base ? `${base.replace(/\/$/, '')}/${child}` : child;
}

function readXmlFile(
  archive: ScrivenerArchive,
  path: string,
  options?: ParserDiagnosticSink,
): unknown {
  if (!archive.has(path)) {
    return undefined;
  }
  return tryOptionalParse(
    options,
    {
      code: 'xml_parse_failed',
      path,
    },
    undefined,
    () => parseXml(archive.readText(path)),
  );
}

function readPlistFile(
  archive: ScrivenerArchive,
  path: string,
  options?: ParserDiagnosticSink,
): unknown {
  if (!archive.has(path)) {
    return undefined;
  }
  return tryOptionalParse(
    options,
    {
      code: 'plist_parse_failed',
      path,
    },
    undefined,
    () => plist.parse(archive.readText(path)),
  );
}

function readJsonFile(
  archive: ScrivenerArchive,
  path: string,
  options?: ParserDiagnosticSink,
): unknown {
  if (!archive.has(path)) {
    return undefined;
  }
  try {
    return JSON.parse(archive.readText(path));
  } catch (error) {
    recordParserDiagnostic(options, {
      code: 'json_parse_failed',
      path,
      error,
    });
    return undefined;
  }
}

function readRecents(archive: ScrivenerArchive, path: string): string[] {
  if (!archive.has(path)) {
    return [];
  }
  return archive
    .readText(path)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function readNodeText(node: unknown): string | undefined {
  if (node === undefined || node === null) {
    return undefined;
  }
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
    return String(node);
  }
  if (typeof node === 'object') {
    const record = node as Record<string, unknown>;
    const text = record['#text'] ?? record._cdata ?? record.CDATA;
    if (typeof text === 'string' || typeof text === 'number' || typeof text === 'boolean') {
      return String(text);
    }
  }
  return undefined;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = String(value ?? '').trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function collectPlaceholderValues(value: string | undefined, isRtf = false): string[] {
  if (!value) {
    return [];
  }
  return uniqueStrings(
    extractPlaceholders(value, 'text', isRtf ? undefined : value).map((placeholder) => placeholder.value),
  );
}

function parseCompileTextValue(raw: string | undefined, options?: {
  isRtf?: boolean;
  case?: string;
}): ScrivenerCompileTextValue | undefined {
  if (!raw) {
    return undefined;
  }
  const isRtf = Boolean(options?.isRtf);
  const text = isRtf ? rtfToText(raw) || undefined : raw;
  return {
    raw,
    text,
    case: options?.case,
    placeholdersUsed: collectPlaceholderValues(raw, isRtf),
  };
}

function parseCompileMetadataValues(node: unknown): ScrivenerCompileMetadataValue[] {
  const values: ScrivenerCompileMetadataValue[] = [];
  for (const entry of toArray((node as any)?.Value)) {
    const key = String((entry as any)?.Key ?? '').trim();
    const value = readNodeText(entry);
    if (!key && !value) {
      continue;
    }
    values.push({
      key,
      value,
      placeholdersUsed: collectPlaceholderValues(value),
    });
  }
  return values;
}

function normalizeStructuredValue(value: unknown): ScrivenerStructuredValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeStructuredValue(entry))
      .filter((entry): entry is ScrivenerStructuredValue => entry !== undefined);
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const result: ScrivenerStructuredObject = {};
    for (const [key, entry] of Object.entries(record)) {
      if (key === '#text' || key === '_cdata' || key === 'CDATA') {
        continue;
      }
      const normalized = normalizeStructuredValue(entry);
      if (normalized !== undefined) {
        result[key] = normalized;
      }
    }
    const text = readNodeText(record);
    if (text !== undefined && text !== '') {
      if (!Object.keys(result).length) {
        return text;
      }
      result.text = text;
    }
    return Object.keys(result).length ? result : undefined;
  }
  return String(value);
}

function asStructuredObject(value: unknown): ScrivenerStructuredObject | undefined {
  const normalized = normalizeStructuredValue(value);
  if (!normalized || Array.isArray(normalized) || typeof normalized !== 'object') {
    return undefined;
  }
  return normalized as ScrivenerStructuredObject;
}

function collectStructuredPlaceholders(value: ScrivenerStructuredValue | undefined): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (typeof value === 'string') {
    return collectPlaceholderValues(value, /\\(?:rtf|pard|fonttbl|colortbl)/.test(value));
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return [];
  }
  if (Array.isArray(value)) {
    return uniqueStrings(value.flatMap((entry) => collectStructuredPlaceholders(entry)));
  }
  return uniqueStrings(
    Object.values(value).flatMap((entry) => collectStructuredPlaceholders(entry)),
  );
}

function parseCompileLayoutFormatting(node: any): ScrivenerCompileLayoutFormatting | undefined {
  if (!node) {
    return undefined;
  }

  const formatting: ScrivenerCompileLayoutFormatting = {
    override: yesNo(node.Override),
    ebooksUseBaseFormatting: yesNo(node.EbooksUseBaseFormatting),
    title: parseCompileTextValue(readNodeText(node.Title), { isRtf: true }),
    titlePrefix: parseCompileTextValue(readNodeText(node.TitlePrefix), { isRtf: true }),
    titleSuffix: parseCompileTextValue(readNodeText(node.TitleSuffix), { isRtf: true }),
    metaData: parseCompileTextValue(readNodeText(node.MetaData), { isRtf: true }),
    synopsis: parseCompileTextValue(readNodeText(node.Synopsis), { isRtf: true }),
    notes: parseCompileTextValue(readNodeText(node.Notes), { isRtf: true }),
    text: parseCompileTextValue(readNodeText(node.Text), { isRtf: true }),
    subtitles: parseCompileTextValue(readNodeText(node.Subtitles), { isRtf: true }),
    preserveUncommonAlignment: yesNo(node.PreserveUncommonAlignment),
    preserveTabsAndIndents: yesNo(node.PreserveTabsAndIndents),
    placeholdersUsed: [],
  };

  formatting.placeholdersUsed = uniqueStrings([
    ...(formatting.title?.placeholdersUsed ?? []),
    ...(formatting.titlePrefix?.placeholdersUsed ?? []),
    ...(formatting.titleSuffix?.placeholdersUsed ?? []),
    ...(formatting.metaData?.placeholdersUsed ?? []),
    ...(formatting.synopsis?.placeholdersUsed ?? []),
    ...(formatting.notes?.placeholdersUsed ?? []),
    ...(formatting.text?.placeholdersUsed ?? []),
    ...(formatting.subtitles?.placeholdersUsed ?? []),
  ]);

  const hasValues = Boolean(
    formatting.override !== undefined
    || formatting.ebooksUseBaseFormatting !== undefined
    || formatting.title
    || formatting.titlePrefix
    || formatting.titleSuffix
    || formatting.metaData
    || formatting.synopsis
    || formatting.notes
    || formatting.text
    || formatting.subtitles
    || formatting.preserveUncommonAlignment !== undefined
    || formatting.preserveTabsAndIndents !== undefined,
  );
  return hasValues ? formatting : undefined;
}

function parseCompileLayout(node: any): ScrivenerCompileLayout | undefined {
  const id = String(node?.ID ?? '').trim();
  const name = readNodeText(node?.Name) ?? (typeof node?.Name === 'string' ? node.Name : undefined);
  if (!id && !name) {
    return undefined;
  }

  const prefix = parseCompileTextValue(readNodeText(node?.Titles?.Prefix), {
    case: node?.Titles?.Prefix?.Case,
  });
  const formatting = parseCompileLayoutFormatting(node?.Formatting);
  const include = {
    titles: yesNo(node?.Include?.Titles),
    synopses: yesNo(node?.Include?.Synopses),
    notes: yesNo(node?.Include?.Notes),
    text: yesNo(node?.Include?.Text),
  };
  const hasInclude = Object.values(include).some((value) => value !== undefined);

  const layout: ScrivenerCompileLayout = {
    id,
    name,
    include: hasInclude ? include : undefined,
    includeTitles: include.titles,
    rtfBookmark: yesNo(readNodeText(node?.RTFBookmark) ?? node?.RTFBookmark),
    blankLineSeparator: node?.BlankLineSeparator
      ? {
          text: readNodeText(node.BlankLineSeparator),
          skipStyles: yesNo(node.BlankLineSeparator.SkipStyles),
          placeholdersUsed: collectPlaceholderValues(readNodeText(node.BlankLineSeparator)),
        }
      : undefined,
    titles: prefix ? { prefix } : undefined,
    formatting,
    separators: node?.Separators
      ? {
          before: node.Separators.Before
            ? {
                type: node.Separators.Before.Type,
                use: yesNo(node.Separators.Before.Use),
              }
            : undefined,
          between: node.Separators.Between
            ? {
                type: node.Separators.Between.Type,
                use: yesNo(node.Separators.Between.Use),
              }
            : undefined,
          afterOverride: node.Separators.AfterOverride
            ? {
                type: node.Separators.AfterOverride.Type,
                use: yesNo(node.Separators.AfterOverride.Use),
              }
            : undefined,
        }
      : undefined,
    placeholdersUsed: [],
  };

  layout.placeholdersUsed = uniqueStrings([
    ...(layout.blankLineSeparator?.placeholdersUsed ?? []),
    ...(layout.titles?.prefix?.placeholdersUsed ?? []),
    ...(layout.formatting?.placeholdersUsed ?? []),
  ]);

  return layout;
}

function parseCompileFormats(rawFormats: Record<string, unknown>): Record<string, ScrivenerCompileFormat> {
  const formats: Record<string, ScrivenerCompileFormat> = {};

  for (const [fallbackId, raw] of Object.entries(rawFormats)) {
    const node = raw as any;
    const id = String(node?.CompileFormat?.ID ?? node?.ID ?? fallbackId).trim();
    const root = (node?.CompileFormat ?? node) as any;
    const name = readNodeText(root?.Name) ?? (typeof root?.Name === 'string' ? root.Name : undefined);
    const sectionLayouts = toArray(root?.SectionLayouts?.Layout)
      .map((layoutNode: any) => parseCompileLayout(layoutNode))
      .filter((layout): layout is ScrivenerCompileLayout => Boolean(layout));

    const compileFormat: ScrivenerCompileFormat = {
      id,
      name,
      supportedTypes: toArray(root?.SupportedTypes?.Type).map((type) => String(type)),
      sectionLayouts,
      styles: asStructuredObject(root?.Styles),
      formattingOptions: asStructuredObject(root?.FormattingOptions),
      titleLinks: asStructuredObject(root?.TitleLinks),
      layoutOptions: asStructuredObject(root?.Layout),
      transformations: asStructuredObject(root?.Transformations),
      statistics: asStructuredObject(root?.Statistics),
      tablesOptions: asStructuredObject(root?.Tables),
      footnotesAndComments: asStructuredObject(root?.FootnotesAndComments),
      pageSettings: asStructuredObject(root?.PageSettings),
      printPdf: asStructuredObject(root?.PrintPDF),
      rtfOptions: asStructuredObject(root?.RTF),
      scriptFormats: asStructuredObject(root?.ScriptFormats),
      html: asStructuredObject(root?.HTML),
      plainText: asStructuredObject(root?.PlainText),
      multiMarkdown: asStructuredObject(root?.MMD),
      ebookSettings: asStructuredObject(root?.EBookSettings),
      postProcessing: asStructuredObject(root?.PostProcessing),
      raw: asStructuredObject(root),
      placeholdersUsed: [],
    };

    compileFormat.placeholdersUsed = uniqueStrings([
      ...sectionLayouts.flatMap((layout) => layout.placeholdersUsed),
      ...collectStructuredPlaceholders(compileFormat.styles),
      ...collectStructuredPlaceholders(compileFormat.formattingOptions),
      ...collectStructuredPlaceholders(compileFormat.titleLinks),
      ...collectStructuredPlaceholders(compileFormat.layoutOptions),
      ...collectStructuredPlaceholders(compileFormat.transformations),
      ...collectStructuredPlaceholders(compileFormat.statistics),
      ...collectStructuredPlaceholders(compileFormat.tablesOptions),
      ...collectStructuredPlaceholders(compileFormat.footnotesAndComments),
      ...collectStructuredPlaceholders(compileFormat.pageSettings),
      ...collectStructuredPlaceholders(compileFormat.printPdf),
      ...collectStructuredPlaceholders(compileFormat.rtfOptions),
      ...collectStructuredPlaceholders(compileFormat.scriptFormats),
      ...collectStructuredPlaceholders(compileFormat.html),
      ...collectStructuredPlaceholders(compileFormat.plainText),
      ...collectStructuredPlaceholders(compileFormat.multiMarkdown),
      ...collectStructuredPlaceholders(compileFormat.ebookSettings),
      ...collectStructuredPlaceholders(compileFormat.postProcessing),
    ]);

    formats[id] = compileFormat;
  }

  return formats;
}

function readCompileFormats(
  archive: ScrivenerArchive,
  base: string,
  options?: ParserDiagnosticSink,
): {
  raw: Record<string, unknown>;
  parsed: Record<string, ScrivenerCompileFormat>;
} {
  const formatsPath = joinPath(base, 'Settings/Compile Formats');
  const files = archive
    .list(formatsPath)
    .filter((path) => path.startsWith(`${formatsPath}/`) && path.toLowerCase().endsWith('.scrformat'));
  const raw: Record<string, unknown> = {};
  for (const path of files) {
    const relative = path.slice(formatsPath.length + 1);
    const name = relative.replace(/\.[^.]+$/, '');
    const parsed = tryOptionalParse(
      options,
      {
        code: 'xml_parse_failed',
        path,
      },
      undefined,
      () => parseXml(archive.readText(path)),
    );
    if (parsed !== undefined) {
      raw[name] = parsed;
    }
  }
  return {
    raw,
    parsed: parseCompileFormats(raw),
  };
}

function parseCompileMetadata(node: any): ScrivenerCompileMetadata | undefined {
  if (!node) {
    return undefined;
  }
  const fountainTitlePageMetaData = parseCompileMetadataValues(node.FountainTitlePageMetaData);
  const mmdMetaData = parseCompileMetadataValues(node.MMDMetaData);
  const metadata: ScrivenerCompileMetadata = {
    projectTitle: readNodeText(node.ProjectTitle),
    authors: toArray(node.Authors?.Author).map((author: any) => ({
      name: readNodeText(author) ?? '',
      fileAs: author.FileAs,
      role: author.Role,
    })),
    surname: readNodeText(node.Surname),
    forename: readNodeText(node.Forename),
    ebookLanguage: readNodeText(node.EbookLanguage),
    fountainTitlePageMetaData,
    mmdMetaData,
    placeholdersUsed: [],
  };

  metadata.placeholdersUsed = uniqueStrings([
    collectPlaceholderValues(metadata.projectTitle),
    ...metadata.authors.flatMap((author) => collectPlaceholderValues(author.name)),
    collectPlaceholderValues(metadata.surname),
    collectPlaceholderValues(metadata.forename),
    collectPlaceholderValues(metadata.ebookLanguage),
    ...fountainTitlePageMetaData.flatMap((entry) => entry.placeholdersUsed),
    ...mmdMetaData.flatMap((entry) => entry.placeholdersUsed),
  ].flat());

  const hasValues = Boolean(
    metadata.projectTitle
    || metadata.authors.length
    || metadata.surname
    || metadata.forename
    || metadata.ebookLanguage
    || metadata.fountainTitlePageMetaData.length
    || metadata.mmdMetaData.length,
  );
  return hasValues ? metadata : undefined;
}

function parseCompileSettings(
  rawCompile: unknown,
  compileFormats: Record<string, ScrivenerCompileFormat>,
): ScrivenerCompileSettings | undefined {
  const root = (rawCompile as any)?.CompileSettings ?? rawCompile;
  if (!root || typeof root !== 'object') {
    return undefined;
  }

  const contentNode = root?.ProjectSettings?.Content;
  const content = contentNode
    ? {
        scope: contentNode.Scope,
        includeSelectionDescendants: yesNo(contentNode.IncludeSelectionDescendants),
        compileGroupType: contentNode.CompileGroup?.Type,
        filter: contentNode.Filter
          ? {
              state: contentNode.Filter.State,
              exclude: yesNo(contentNode.Filter.Exclude),
              type: contentNode.Filter.Type,
              collectionId: readNodeText(contentNode.Filter.CollectionID),
              label: readNodeText(contentNode.Filter.Label),
              status: readNodeText(contentNode.Filter.Status),
            }
          : undefined,
      }
    : undefined;

  const optionsNode = root?.ProjectSettings?.Options;
  const options = optionsNode
    ? {
        removeComments: yesNo(readNodeText(optionsNode.RemoveComments)),
        removeAnnotations: yesNo(readNodeText(optionsNode.RemoveAnnotations)),
        resampleImages: optionsNode.ResampleImages
          ? {
              enabled: yesNo(readNodeText(optionsNode.ResampleImages) ?? optionsNode.ResampleImages),
              dpi: asNumber(optionsNode.ResampleImages.DPI),
            }
          : undefined,
        removeHighlights: yesNo(readNodeText(optionsNode.RemoveHighlights)),
        removeTextColor: yesNo(readNodeText(optionsNode.RemoveTextColor)),
        removeTrailingWhitespace: yesNo(readNodeText(optionsNode.RemoveTrailingWhitespace)),
        convertTablesAndListToMMD: yesNo(readNodeText(optionsNode.ConvertTablesAndListToMMD)),
        reduceImageWidth: optionsNode.ReduceImageWidth
          ? {
              enabled: yesNo(readNodeText(optionsNode.ReduceImageWidth) ?? optionsNode.ReduceImageWidth),
              dpi: asNumber(optionsNode.ReduceImageWidth.DPI),
            }
          : undefined,
        pdf: optionsNode.PDF
          ? {
              cover: optionsNode.PDF.Cover
                ? {
                    bleed: asNumber(optionsNode.PDF.Cover.Bleed),
                    bleedUnits: optionsNode.PDF.Cover.BleedUnits,
                  }
                : undefined,
              compression: optionsNode.PDF.Compression
                ? {
                    enabled: yesNo(optionsNode.PDF.Compression.Enabled),
                    imageResolutionCompressionType: readNodeText(
                      optionsNode.PDF.Compression.ImageResolutionCompressionType,
                    ),
                    imageResolution: asNumber(readNodeText(optionsNode.PDF.Compression.ImageResolution)),
                    compressionQuality: asNumber(readNodeText(optionsNode.PDF.Compression.CompressionQuality)),
                  }
                : undefined,
            }
          : undefined,
        scriptwriting: optionsNode.Scriptwriting
          ? {
              includeTitles: yesNo(readNodeText(optionsNode.Scriptwriting.IncludeTitles)),
              includeSynopses: yesNo(readNodeText(optionsNode.Scriptwriting.IncludeSynopses)),
              commentsAsScriptNotes: yesNo(readNodeText(optionsNode.Scriptwriting.CommentsAsScriptNotes)),
            }
          : undefined,
        ebook: optionsNode.Ebook
          ? {
              startAfterFrontMatter: yesNo(readNodeText(optionsNode.Ebook.StartAfterFrontMatter)),
              cover: optionsNode.Ebook.Cover
                ? {
                    imageDocumentSource: optionsNode.Ebook.Cover.ImageDocument?.Source,
                    title: readNodeText(optionsNode.Ebook.Cover.Title),
                    svg: optionsNode.Ebook.Cover.SVG
                      ? {
                          width: asNumber(optionsNode.Ebook.Cover.SVG.Width),
                          height: asNumber(optionsNode.Ebook.Cover.SVG.Height),
                          content: readNodeText(optionsNode.Ebook.Cover.SVG),
                        }
                      : undefined,
                  }
                : undefined,
              toc: optionsNode.Ebook.TOC
                ? {
                    pandocDepth: asNumber(optionsNode.Ebook.TOC.PandocDepth),
                    html: optionsNode.Ebook.TOC.HTML
                      ? {
                          generate: yesNo(optionsNode.Ebook.TOC.HTML.Generate),
                          title: readNodeText(optionsNode.Ebook.TOC.HTML.Title),
                        }
                      : undefined,
                  }
                : undefined,
            }
          : undefined,
      }
    : undefined;

  const metadata = parseCompileMetadata(root?.ProjectSettings?.MetaData);

  const formats = Object.fromEntries(
    toArray(root?.FormatSettings?.Format)
      .map((formatNode: any) => {
        const id = String(formatNode?.ID ?? '').trim();
        if (!id) {
          return undefined;
        }
        const format: ScrivenerCompileFormatSelection = {
          id,
          name: compileFormats[id]?.name,
          sectionLayouts: Object.fromEntries(
            toArray(formatNode?.SectionLayouts?.Type)
              .map((typeNode: any) => {
                const typeId = String(typeNode?.ID ?? '').trim();
                const layoutId = readNodeText(typeNode);
                if (!typeId || !layoutId) {
                  return undefined;
                }
                return [typeId, layoutId] as const;
              })
              .filter((entry): entry is readonly [string, string] => Boolean(entry)),
          ),
          font: readNodeText(formatNode.Font),
        };
        return [id, format] as const;
      })
      .filter((entry): entry is readonly [string, ScrivenerCompileFormatSelection] => Boolean(entry)),
  );

  const lastUsedFormats = Object.fromEntries(
    Object.entries(root?.LastUsedFormats ?? {})
      .map(([key, value]) => {
        const text = readNodeText(value);
        return text ? [key, text] as const : undefined;
      })
      .filter((entry): entry is readonly [string, string] => Boolean(entry)),
  );
  const currentFileType = readNodeText(root?.CurrentFileType);
  const selectedFormatId = currentFileType
    ? (lastUsedFormats[currentFileType] ?? lastUsedFormats[currentFileType.toLowerCase()])
    : undefined;

  return {
    currentFileType,
    content,
    options,
    metadata,
    formats,
    selectedFormatId,
    selectedFormat: selectedFormatId ? formats[selectedFormatId] : undefined,
    lastUsedFormats,
    placeholdersUsed: uniqueStrings([
      ...(metadata?.placeholdersUsed ?? []),
      ...Object.values(compileFormats).flatMap((format) => format.placeholdersUsed),
    ]),
  };
}

function parseIni(raw: string): ScrivenerIniFile {
  const global: Record<string, string> = {};
  const sections: Record<string, Record<string, string>> = {};
  let currentSection = global;

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) {
      continue;
    }
    const sectionMatch = trimmed.match(/^\[(.+)]$/);
    if (sectionMatch) {
      const sectionName = sectionMatch[1].trim();
      sections[sectionName] = sections[sectionName] ?? {};
      currentSection = sections[sectionName];
      continue;
    }
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      currentSection[trimmed] = '';
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1);
    currentSection[key] = value;
  }

  return {
    raw,
    global,
    sections,
  };
}

function readIniFile(archive: ScrivenerArchive, path: string): ScrivenerIniFile | undefined {
  if (!archive.has(path)) {
    return undefined;
  }
  return parseIni(archive.readText(path));
}

function parseTemplateInfo(raw: unknown): ScrivenerTemplateInfo | undefined {
  const root = (raw as any)?.TemplateSettings ?? raw;
  if (!root || typeof root !== 'object') {
    return undefined;
  }
  return {
    title: readNodeText((root as any).Title),
    description: readNodeText((root as any).Description),
    category: readNodeText((root as any).Category),
    customImageData: readNodeText((root as any).CustomImageData),
    fields: asStructuredObject(root) ?? {},
  };
}

function parseScriptFormat(raw: unknown): ScrivenerScriptFormat | undefined {
  const root = (raw as any)?.ScrivenerScriptFormat ?? raw;
  if (!root || typeof root !== 'object') {
    return undefined;
  }
  const scriptElements = toArray((root as any)?.ScriptElements?.Element)
    .map((element) => normalizeStructuredValue(element))
    .filter((element): element is ScrivenerStructuredValue => element !== undefined);

  return {
    title: readNodeText((root as any).Title),
    scriptElements: scriptElements.length ? scriptElements : undefined,
    fields: asStructuredObject(root) ?? {},
  };
}

function parseTutorialInfo(raw: string | undefined): ScrivenerTutorialInfo | undefined {
  const value = String(raw ?? '').trim();
  if (!value) {
    return undefined;
  }
  const idMatch = value.match(/(?:^|\n)ID:([^\n]+)/);
  return {
    id: idMatch?.[1]?.trim(),
    raw: value,
  };
}

function parseFavoriteEntries(node: unknown): ScrivenerFavoriteEntry[] {
  return toArray((node as any)?.UUID)
    .map((entry: any) => ({
      uuid: String(readNodeText(entry) ?? '').trim(),
      date: readNodeText(entry?.Date) ?? (typeof entry?.Date === 'string' ? entry.Date : undefined),
      used: asNumber(entry?.Used),
    }))
    .filter((entry) => entry.uuid);
}

function parseFavoritesBucket(node: unknown): ScrivenerFavoritesBucket | undefined {
  if (!node || typeof node !== 'object') {
    return undefined;
  }
  const recent = parseFavoriteEntries((node as any).Recent);
  const popular = parseFavoriteEntries((node as any).Popular);
  if (!recent.length && !popular.length) {
    return undefined;
  }
  return { recent, popular };
}

function parseFavorites(raw: unknown): ScrivenerFavorites | undefined {
  const root = (raw as any)?.Favorites ?? raw;
  if (!root || typeof root !== 'object') {
    return undefined;
  }

  const favorites: ScrivenerFavorites = {
    version: readNodeText((root as any).Version) ?? (typeof (root as any).Version === 'string' ? (root as any).Version : undefined),
    moveTo: parseFavoritesBucket((root as any).MoveTo),
    append: parseFavoritesBucket((root as any).Append),
    raw: asStructuredObject(root),
  };

  const hasValues = Boolean(
    favorites.version
    || favorites.moveTo
    || favorites.append
    || favorites.raw,
  );

  return hasValues ? favorites : undefined;
}

function parseProjectPreferences(raw: unknown): ScrivenerProjectPreferences | undefined {
  const root = (raw as any)?.ProjectPreferences ?? raw;
  if (!root || typeof root !== 'object') {
    return undefined;
  }

  const textFormatRaw = readNodeText((root as any).TextFormatRTFData);
  const footnotesFontNode = (root as any).FootnotesFont;
  const footnoteMarkerNode = (root as any).FootnoteMarker;

  const preferences: ScrivenerProjectPreferences = {
    version: readNodeText((root as any).Version) ?? (typeof (root as any).Version === 'string' ? (root as any).Version : undefined),
    useProjectPreferences: yesNo(readNodeText((root as any).UseProjectPreferences)),
    textFormat: parseCompileTextValue(textFormatRaw, { isRtf: true }),
    useCustomFootnotesFont: yesNo(readNodeText((root as any).UseCustomFootnotesFont)),
    footnotesFont: footnotesFontNode ? {
      name: readNodeText(footnotesFontNode),
      size: asNumber((footnotesFontNode as any)?.Size),
    } : undefined,
    footnoteMarker: footnoteMarkerNode ? {
      value: readNodeText(footnoteMarkerNode),
      useMarker: yesNo(readNodeText((footnoteMarkerNode as any)?.UseMarker) ?? (typeof (footnoteMarkerNode as any)?.UseMarker === 'string' ? (footnoteMarkerNode as any).UseMarker : undefined)),
    } : undefined,
    raw: asStructuredObject(root),
  };

  const hasValues = Boolean(
    preferences.version
    || preferences.useProjectPreferences !== undefined
    || preferences.textFormat
    || preferences.useCustomFootnotesFont !== undefined
    || preferences.footnotesFont?.name
    || preferences.footnotesFont?.size !== undefined
    || preferences.footnoteMarker?.value
    || preferences.footnoteMarker?.useMarker !== undefined
    || preferences.raw,
  );

  return hasValues ? preferences : undefined;
}

function parseIdList(node: unknown): string[] | undefined {
  const ids = toArray((node as any)?.ItemID)
    .map((item) => String(readNodeText(item) ?? '').trim())
    .filter(Boolean);
  return ids.length ? ids : undefined;
}

function parseUiCommonNavigationHistory(node: unknown) {
  const items = toArray((node as any)?.HistoryItem)
    .map((entry: any) => ({
      type: typeof entry?.Type === 'string' ? entry.Type : undefined,
      viewMode: typeof entry?.ViewMode === 'string' ? entry.ViewMode : undefined,
      value: readNodeText(entry),
    }))
    .filter((entry) => entry.type || entry.viewMode || entry.value);
  return items.length ? items : undefined;
}

function parseUiCommonEditor(node: unknown): ScrivenerUiCommonEditorSummary | undefined {
  if (!node || typeof node !== 'object') {
    return undefined;
  }

  const view = (node as any).View;
  const contentItemIds = parseIdList(view?.Content);
  const editor: ScrivenerUiCommonEditorSummary = {
    currentViewMode: readNodeText(view?.CurrentViewMode),
    groupsViewMode: readNodeText(view?.GroupsViewMode),
    selectionAffects: readNodeText(view?.SelectionAffects),
    contentItemIds,
    navigationHistory: parseUiCommonNavigationHistory(view?.NavigationHistory),
  };

  const hasValues = Boolean(
    editor.currentViewMode
    || editor.groupsViewMode
    || editor.selectionAffects
    || editor.contentItemIds?.length
    || editor.navigationHistory?.length,
  );

  return hasValues ? editor : undefined;
}

function parseUiCommon(raw: unknown): ScrivenerUiCommon | undefined {
  const root = (raw as any)?.UIStates ?? raw;
  if (!root || typeof root !== 'object') {
    return undefined;
  }

  const editorsNode = (root as any).Editors;
  const editorEntries = Object.entries(editorsNode ?? {})
    .filter(([key]) => /^Editor\d+$/.test(key))
    .map(([key, value]) => [key, parseUiCommonEditor(value)] as const)
    .filter((entry): entry is readonly [string, ScrivenerUiCommonEditorSummary] => Boolean(entry[1]));

  const uiCommon: ScrivenerUiCommon = {
    split: readNodeText((root as any).Split),
    binderAffects: readNodeText((root as any).BinderAffects),
    binderExpandedItems: parseIdList((root as any).Binder?.ExpandedItems),
    binderSelection: parseIdList((root as any).Binder?.Selection),
    selectedCollection: readNodeText((root as any).Binder?.SelectedCollection),
    inspectorView: readNodeText((root as any).Inspector?.View),
    projectKeywordExpandedItems: parseIdList((root as any).ProjectKeywords?.ExpandedItems),
    editors: editorEntries.length ? Object.fromEntries(editorEntries) : undefined,
    raw: asStructuredObject(root),
  };

  const hasValues = Boolean(
    uiCommon.split
    || uiCommon.binderAffects
    || uiCommon.binderExpandedItems?.length
    || uiCommon.binderSelection?.length
    || uiCommon.selectedCollection
    || uiCommon.inspectorView
    || uiCommon.projectKeywordExpandedItems?.length
    || uiCommon.editors
    || uiCommon.raw,
  );

  return hasValues ? uiCommon : undefined;
}

function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value
    .map((entry) => String(entry ?? '').trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}

function parseMixedArray(value: unknown): Array<string | number> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value.filter((entry) => typeof entry === 'string' || typeof entry === 'number');
  return items.length ? items as Array<string | number> : undefined;
}

function parseCollectionSelections(value: unknown): Record<string, string[]> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, entry]) => [key, parseStringArray(entry)] as const)
    .filter((entry): entry is readonly [string, string[]] => Boolean(entry[1]?.length));

  return entries.length ? Object.fromEntries(entries) : undefined;
}

function parseUiState(raw: unknown): ScrivenerUiState | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }

  const record = raw as Record<string, unknown>;
  const compileOption =
    record.SCRSelectedCompileOptionsInfoSaveName
    && typeof record.SCRSelectedCompileOptionsInfoSaveName === 'object'
    && !Array.isArray(record.SCRSelectedCompileOptionsInfoSaveName)
      ? record.SCRSelectedCompileOptionsInfoSaveName as Record<string, unknown>
      : undefined;

  const ui: ScrivenerUiState = {
    binderState: parseStringArray(record.binderState),
    binderSelection: parseMixedArray(record.binderSelection),
    binderIsCollapsed: typeof record.binderIsCollapsed === 'boolean' ? record.binderIsCollapsed : undefined,
    binderWidth: asNumber(
      typeof record.binderWidth === 'string' || typeof record.binderWidth === 'number'
        ? record.binderWidth
        : undefined,
    ),
    mainWindowShowsFormatBar: typeof record.MainWindowShowsFormatBar === 'boolean' ? record.MainWindowShowsFormatBar : undefined,
    commentsScaleFactor: asNumber(
      typeof record.CommentsScaleFactor === 'string' || typeof record.CommentsScaleFactor === 'number'
        ? record.CommentsScaleFactor
        : undefined,
    ),
    notesScaleFactor: asNumber(
      typeof record.NotesScaleFactor === 'string' || typeof record.NotesScaleFactor === 'number'
        ? record.NotesScaleFactor
        : undefined,
    ),
    selectedCompileOption: compileOption ? {
      tag: asNumber(
        typeof compileOption.Tag === 'string' || typeof compileOption.Tag === 'number'
          ? compileOption.Tag
          : undefined,
      ),
      title: typeof compileOption.Title === 'string' ? compileOption.Title : undefined,
    } : undefined,
    collectionSelections: parseCollectionSelections(record.CollectionSelections),
    raw: asStructuredObject(raw),
  };

  const hasValues = Boolean(
    ui.binderState?.length
    || ui.binderSelection?.length
    || ui.binderIsCollapsed !== undefined
    || ui.binderWidth !== undefined
    || ui.mainWindowShowsFormatBar !== undefined
    || ui.commentsScaleFactor !== undefined
    || ui.notesScaleFactor !== undefined
    || ui.selectedCompileOption?.tag !== undefined
    || ui.selectedCompileOption?.title
    || ui.collectionSelections
    || ui.raw,
  );

  return hasValues ? ui : undefined;
}

function parseLegacyCompile(
  archive: ScrivenerArchive,
  base: string,
  options?: ParserDiagnosticSink,
): Record<string, ScrivenerLegacyCompilePreset> | undefined {
  const legacyPath = joinPath(base, 'Settings/LegacyCompile');
  const files = archive
    .list(legacyPath)
    .filter((path) => path.startsWith(`${legacyPath}/`) && path.toLowerCase().endsWith('.plist'));
  if (!files.length) {
    return undefined;
  }

  const presets = new Map<string, ScrivenerLegacyCompilePreset>();
  for (const path of files) {
    const relative = path.slice(legacyPath.length + 1);
    const parts = relative.split('/').filter(Boolean);
    if (!parts.length) {
      continue;
    }
    const presetId = parts.length > 1 ? parts[0] : 'default';
    const fileName = parts.length > 1 ? parts.slice(1).join('/') : parts[0];
    const parsed = asStructuredObject(readPlistFile(archive, path, options)) ?? {};
    const existing = presets.get(presetId) ?? {
      id: presetId,
      title: undefined,
      files: {},
    };
    existing.files[fileName] = parsed;
    const title = parsed.SCRTemplateCompileSettingsTitle;
    if (!existing.title && typeof title === 'string' && title.trim()) {
      existing.title = title.trim();
    }
    presets.set(presetId, existing);
  }

  return Object.fromEntries([...presets.entries()]);
}

export function parseSettings(
  archive: ScrivenerArchive,
  basePath: string,
  options: ParserDiagnosticSink = {},
): ScrivenerSettingsData {
  const compileRaw = readXmlFile(archive, joinPath(basePath, 'Settings/compile.xml'), options);
  const compileFormatsData = readCompileFormats(archive, basePath, options);
  const templateInfoRaw = readXmlFile(archive, joinPath(basePath, 'Settings/templateinfo.xml'), options);
  const scriptFormatRaw = readXmlFile(archive, joinPath(basePath, 'Settings/scriptformat.xml'), options);
  const tutorialRaw = archive.has(joinPath(basePath, 'Settings/tutorial'))
    ? archive.readText(joinPath(basePath, 'Settings/tutorial'))
    : undefined;

  return {
    compile: parseCompileSettings(compileRaw, compileFormatsData.parsed),
    compileRaw,
    compileFormats: compileFormatsData.parsed,
    compileFormatsRaw: compileFormatsData.raw,
    favorites: parseFavorites(readXmlFile(archive, joinPath(basePath, 'Settings/favorites.xml'), options)),
    mobile: readJsonFile(archive, joinPath(basePath, 'Settings/mobile.settings'), options),
    projectPreferences: parseProjectPreferences(readXmlFile(archive, joinPath(basePath, 'Settings/projectpreferences.xml'), options)),
    recents: readRecents(archive, joinPath(basePath, 'Settings/recents.txt')),
    ui: parseUiState(readPlistFile(archive, joinPath(basePath, 'Settings/ui.plist'), options)),
    uiCommon: parseUiCommon(readXmlFile(archive, joinPath(basePath, 'Settings/ui-common.xml'), options)),
    compileIni: readIniFile(archive, joinPath(basePath, 'Settings/compile.ini')),
    uiIni: readIniFile(archive, joinPath(basePath, 'Settings/ui.ini')),
    templateInfo: parseTemplateInfo(templateInfoRaw),
    scriptFormat: parseScriptFormat(scriptFormatRaw),
    legacyCompile: parseLegacyCompile(archive, basePath, options),
    tutorial: parseTutorialInfo(tutorialRaw),
  };
}

import { ScrivenerArchive } from '../archive/ScrivenerArchive.js';
import type { ScrivenerComment, ScrivenerSnapshot, ScrivenerStyleDefinition } from '../types.js';
import { parseXml, readXmlNodeText as readNodeText } from '../utils/xml.js';
import { toArray } from '../utils/collections.js';
import { rtfToText } from '../rtf/rtfToText.js';
import { extractStyleSpans } from '../rtf/extractStyleSpans.js';
import { parseRtfContent, type ParsedRtfContent } from './rtf-content.js';
import {
  recordParserDiagnostic,
  tryOptionalParse,
  type ParserDiagnosticSink,
} from '../utils/diagnostics.js';
import { linkCommentAnchors } from './comment-anchors.js';
import {
  hasScrivenerCommentNodes,
  parseScrivenerCommentNodes,
} from './comments.js';

interface SnapshotOptions extends ParserDiagnosticSink {
  basePath: string;
  decodeRtf: boolean;
  extractPlaceholders?: boolean;
  extractEmbeddedImages?: boolean;
  extractInlineAnnotations?: boolean;
  extractLinkedImages?: boolean;
  extractHyperlinks?: boolean;
  extractBookmarks?: boolean;
  extractFields?: boolean;
  extractTables?: boolean;
  extractStyleSpans?: boolean;
  computeTextCounts?: boolean;
  styleDefinitions?: ScrivenerStyleDefinition[];
  documentStyleIdsByUuid?: Record<string, string[]>;
}

function joinPath(base: string, child: string): string {
  return base ? `${base.replace(/\/$/, '')}/${child}` : child;
}

interface SnapshotMeta {
  title?: string;
  date?: string;
  text?: string;
  commentsText?: string;
  styleIds?: string[];
  comments?: ScrivenerComment[];
}

interface SnapshotRtfEntry {
  file: string;
  date?: string;
  content: Uint8Array;
}

function dedupeSnapshotMeta(entries: SnapshotMeta[]): SnapshotMeta[] {
  const deduped = new Map<string, SnapshotMeta>();

  entries.forEach((entry, index) => {
    const baseKey = `${entry.date ?? ''}::${entry.title ?? ''}`;
    const key = baseKey !== '::' ? baseKey : `__index__${index}`;
    const previous = deduped.get(key);

    if (!previous) {
      deduped.set(key, entry);
      return;
    }

    deduped.set(key, {
      title: previous.title ?? entry.title,
      date: previous.date ?? entry.date,
      text: entry.text ?? previous.text,
      commentsText: entry.commentsText ?? previous.commentsText,
      styleIds: previous.styleIds ?? entry.styleIds,
      comments: previous.comments ?? entry.comments,
    });
  });

  return [...deduped.values()];
}

function parseSnapshotComments(
  commentsNode: any,
  options: SnapshotOptions,
  path: string,
): ScrivenerComment[] | undefined {
  const comments = parseScrivenerCommentNodes(commentsNode, options, { path });
  return comments.length ? comments : undefined;
}

function parseSnapshotCommentsText(commentsNode: any): string | undefined {
  if (!commentsNode || hasScrivenerCommentNodes(commentsNode)) {
    return undefined;
  }
  const text = readNodeText(commentsNode);
  return text?.trim() ? text : undefined;
}

function parseStyleIds(raw?: string): string[] | undefined {
  if (!raw) return undefined;
  const styleIds = raw
    .split(/[;, \r\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return styleIds.length ? styleIds : undefined;
}

function parseSnapshotMeta(
  content: string,
  path: string,
  options: ParserDiagnosticSink,
): SnapshotMeta[] {
  const xml = tryOptionalParse<any | undefined>(
    options,
    {
      code: 'xml_parse_failed',
      path,
    },
    undefined,
    () => parseXml<any>(content),
  );
  if (!xml) {
    return [];
  }
  const nodes = toArray(
    xml?.SnapshotIndexes?.Snapshot ?? xml?.Snapshots?.Snapshot ?? xml?.Snapshot ?? [],
  );
  return nodes.map((node: any) => ({
    title: node.Title ?? node['#text'] ?? node.title,
    date: node.Date ?? node.date ?? node['@_Date'],
    text: node.Text ?? node.text,
    commentsText: parseSnapshotCommentsText(node.Comments ?? node.comments),
    styleIds: parseStyleIds(node.StyleIDs ?? node.styleIds),
    comments: parseSnapshotComments(node.Comments ?? node.comments, options as SnapshotOptions, path),
  }));
}

function filenameToDate(name: string): string | undefined {
  const match = name.match(
    /^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})([+-]\d{4})?\.rtf$/,
  );
  if (!match) {
    return undefined;
  }
  const [, year, month, day, hour, minute, second, zone = '+0000'] = match;
  return `${year}-${month}-${day} ${hour}:${minute}:${second} ${zone}`;
}

function buildSnapshotFromEntry(
  uuid: string,
  meta: SnapshotMeta,
  entry: SnapshotRtfEntry | undefined,
  options: SnapshotOptions,
): ScrivenerSnapshot {
  if (!entry) {
    return linkCommentAnchors({
      title: meta.title,
      date: meta.date,
      rtf: '',
      plainText: meta.text,
      indexText: meta.text,
      hasIndexText: Boolean(meta.text),
      indexComments: meta.commentsText,
      hasIndexComments: Boolean(meta.commentsText),
      hasText: false,
      styleIds: meta.styleIds,
      comments: meta.comments,
    });
  }

  const parsed = tryOptionalParse<ParsedRtfContent | undefined>(
    options,
    {
      code: 'rtf_parse_failed',
      path: entry.file,
    },
    undefined,
    () => parseRtfContent(entry.content, {
      decodeRtf: options.decodeRtf,
      extractPlaceholders: options.extractPlaceholders,
      extractEmbeddedImages: options.extractEmbeddedImages,
      extractInlineAnnotations: options.extractInlineAnnotations,
      extractLinkedImages: options.extractLinkedImages,
      extractHyperlinks: options.extractHyperlinks,
      extractBookmarks: options.extractBookmarks,
      extractFields: options.extractFields,
      extractTables: options.extractTables,
      computeTextCounts: options.computeTextCounts,
      placeholderSource: 'text',
    }),
  );
  if (!parsed) {
    return linkCommentAnchors({
      title: meta.title,
      date: meta.date ?? entry.date,
      rtf: '',
      plainText: meta.text,
      sourceFile: entry.file,
      hasText: false,
      indexText: meta.text,
      hasIndexText: Boolean(meta.text),
      indexComments: meta.commentsText,
      hasIndexComments: Boolean(meta.commentsText),
      styleIds: meta.styleIds,
      comments: meta.comments,
    });
  }

  const plainText = parsed.plainText ?? meta.text ?? rtfToText(parsed.rtf);
  const styleIds = meta.styleIds ?? options.documentStyleIdsByUuid?.[uuid];
  const styleSpans = options.extractStyleSpans && options.decodeRtf
    ? extractStyleSpans(
      parsed.rtf,
      plainText,
      options.styleDefinitions,
      styleIds,
    )
    : undefined;

  return linkCommentAnchors({
    title: meta.title,
    date: meta.date ?? entry.date,
    rtf: parsed.rtf,
    plainText,
    sourceFile: entry.file,
    hasText: true,
    styleIds: meta.styleIds,
    comments: meta.comments,
    textWordCount: parsed.textWordCount,
    textCharCount: parsed.textCharCount,
    paragraphs: parsed.paragraphs,
    runs: parsed.runs,
    styleSpans: styleSpans?.length ? styleSpans : undefined,
    placeholders: parsed.placeholders,
    embeddedImages: parsed.embeddedImages,
    embeddedPdfs: parsed.embeddedPdfs,
    inlineAnnotations: parsed.inlineAnnotations,
    linkedImages: parsed.linkedImages,
    hyperlinks: parsed.hyperlinks,
    bookmarks: parsed.bookmarks,
    fields: parsed.fields,
    commentAnchors: parsed.commentAnchors,
    footnotes: parsed.footnotes,
    lists: parsed.lists,
    assets: parsed.assets,
    rtfModel: parsed.rtfModel,
    tables: parsed.tables,
    indexText: meta.text,
    hasIndexText: Boolean(meta.text),
    indexComments: meta.commentsText,
    hasIndexComments: Boolean(meta.commentsText),
  });
}

export function parseSnapshots(
  archive: ScrivenerArchive,
  options: SnapshotOptions,
): Record<string, ScrivenerSnapshot[]> {
  const prefix = joinPath(options.basePath, 'Snapshots');
  const files = archive
    .list(prefix)
    .filter((path) => path.startsWith(`${prefix}/`));
  const grouped = new Map<string, string[]>();
  for (const path of files) {
    const relative = path.slice(prefix.length + 1);
    const [folder, rest] = relative.split('/', 2);
    if (!folder || !rest) {
      continue;
    }
    const uuid = folder.replace(/\.snapshots$/, '');
    if (!grouped.has(uuid)) {
      grouped.set(uuid, []);
    }
    grouped.get(uuid)!.push(rest);
  }

  const snapshotIndex: Record<string, ScrivenerSnapshot[]> = {};
  for (const [uuid, paths] of grouped.entries()) {
    const base = joinPath(prefix, `${uuid}.snapshots`);
    let metaEntries: SnapshotMeta[] = [];
    if (archive.has(`${base}/index.xml`)) {
      metaEntries = metaEntries.concat(parseSnapshotMeta(
        archive.readText(`${base}/index.xml`),
        `${base}/index.xml`,
        options,
      ));
    }
    if (archive.has(`${base}/snapshot.indexes`)) {
      metaEntries = metaEntries.concat(parseSnapshotMeta(
        archive.readText(`${base}/snapshot.indexes`),
        `${base}/snapshot.indexes`,
        options,
      ));
    }
    metaEntries = dedupeSnapshotMeta(metaEntries);
    const rtfEntries = paths
      .filter((file) => file.endsWith('.rtf'))
      .map((file) => ({
        file,
        date: filenameToDate(file),
        content: archive.readRtfBytes(`${base}/${file}`),
      }));
    const rtfByDate = new Map<string, SnapshotRtfEntry>();
    for (const entry of rtfEntries) {
      if (entry.date) {
        rtfByDate.set(entry.date, entry);
      }
    }
    if (!metaEntries.length && rtfEntries.length) {
      metaEntries = rtfEntries.map((entry) => ({ title: entry.file, date: entry.date }));
    }
    const combined: ScrivenerSnapshot[] = [];
    let fallbackIndex = 0;
    for (const meta of metaEntries) {
      let entry = meta.date ? rtfByDate.get(meta.date) : undefined;
      if (!entry && fallbackIndex < rtfEntries.length) {
        entry = rtfEntries[fallbackIndex];
        fallbackIndex += 1;
        recordParserDiagnostic(options, {
          code: 'snapshot_rtf_fallback_match',
          path: entry ? `${base}/${entry.file}` : base,
          message: meta.date
            ? `Snapshot metadata date "${meta.date}" did not match an RTF filename; matched ${entry.file} by order.`
            : `Snapshot metadata without a date matched ${entry.file} by order.`,
        });
      }
      combined.push(buildSnapshotFromEntry(uuid, meta, entry, options));
    }
    snapshotIndex[uuid] = combined;
  }
  return snapshotIndex;
}

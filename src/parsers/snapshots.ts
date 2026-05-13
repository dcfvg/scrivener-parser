import { ScrivenerArchive } from '../archive/ScrivenerArchive.js';
import type { ScrivenerSnapshot } from '../types.js';
import { parseXml } from '../utils/xml.js';
import { toArray } from '../utils/collections.js';
import { rtfToText } from '../rtf/rtfToText.js';
import { parseRtfContent } from './rtf-content.js';

interface SnapshotOptions {
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
  computeTextCounts?: boolean;
}

function joinPath(base: string, child: string): string {
  return base ? `${base.replace(/\/$/, '')}/${child}` : child;
}

interface SnapshotMeta {
  title?: string;
  date?: string;
  text?: string;
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
    });
  });

  return [...deduped.values()];
}

function parseSnapshotMeta(content: string): SnapshotMeta[] {
  const xml = parseXml<any>(content);
  const nodes = toArray(
    xml?.SnapshotIndexes?.Snapshot ?? xml?.Snapshots?.Snapshot ?? xml?.Snapshot ?? [],
  );
  return nodes.map((node: any) => ({
    title: node.Title ?? node['#text'] ?? node.title,
    date: node.Date ?? node.date ?? node['@_Date'],
    text: node.Text ?? node.text,
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
  meta: SnapshotMeta,
  entry: SnapshotRtfEntry | undefined,
  options: SnapshotOptions,
): ScrivenerSnapshot {
  if (!entry) {
    return {
      title: meta.title,
      date: meta.date,
      rtf: '',
      plainText: meta.text,
      indexText: meta.text,
      hasIndexText: Boolean(meta.text),
      hasText: false,
    };
  }

  const parsed = parseRtfContent(entry.content, {
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
  });

  return {
    title: meta.title,
    date: meta.date ?? entry.date,
    rtf: parsed.rtf,
    plainText: parsed.plainText ?? meta.text ?? rtfToText(parsed.rtf),
    sourceFile: entry.file,
    hasText: true,
    textWordCount: parsed.textWordCount,
    textCharCount: parsed.textCharCount,
    paragraphs: parsed.paragraphs,
    runs: parsed.runs,
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
  };
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
      metaEntries = metaEntries.concat(parseSnapshotMeta(archive.readText(`${base}/index.xml`)));
    }
    if (archive.has(`${base}/snapshot.indexes`)) {
      metaEntries = metaEntries.concat(parseSnapshotMeta(archive.readText(`${base}/snapshot.indexes`)));
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
      }
      combined.push(buildSnapshotFromEntry(meta, entry, options));
    }
    snapshotIndex[uuid] = combined;
  }
  return snapshotIndex;
}

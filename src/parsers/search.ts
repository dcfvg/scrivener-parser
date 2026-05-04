import { ScrivenerArchive } from '../archive/ScrivenerArchive.js';
import type { ScrivenerSearchIndex } from '../types.js';
import { parseXml } from '../utils/xml.js';
import { toArray } from '../utils/collections.js';

function joinPath(base: string, child: string): string {
  return base ? `${base.replace(/\/$/, '')}/${child}` : child;
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

export function parseSearchIndex(archive: ScrivenerArchive, basePath: string): ScrivenerSearchIndex {
  const path = joinPath(basePath, 'Files/search.indexes');
  if (!archive.has(path)) {
    return { documents: [] };
  }
  const xml = parseXml<any>(archive.readText(path));
  const root = xml?.SearchIndexes ?? xml;
  const docs = toArray(root?.Documents?.Document ?? xml?.Documents?.Document ?? []);
  return {
    version: readNodeText(root?.Version) ?? root?.Version,
    documents: docs.map((doc: any) => ({
      id: String(doc.ID ?? doc.Id ?? ''),
      title: readNodeText(doc.Title),
      synopsis: readNodeText(doc.Synopsis),
      text: readNodeText(doc.Text),
      comments: readNodeText(doc.Comments),
      notes: readNodeText(doc.Notes),
    })),
  };
}

import { ScrivenerArchive } from '../archive/ScrivenerArchive.js';
import type { ScrivenerSearchIndex } from '../types.js';
import { parseXml, readXmlNodeText as readNodeText } from '../utils/xml.js';
import { toArray } from '../utils/collections.js';
import { tryOptionalParse, type ParserDiagnosticSink } from '../utils/diagnostics.js';

function joinPath(base: string, child: string): string {
  return base ? `${base.replace(/\/$/, '')}/${child}` : child;
}

export function parseSearchIndex(
  archive: ScrivenerArchive,
  basePath: string,
  options: ParserDiagnosticSink = {},
): ScrivenerSearchIndex {
  const path = joinPath(basePath, 'Files/search.indexes');
  if (!archive.has(path)) {
    return { documents: [] };
  }
  const xml = tryOptionalParse<any | undefined>(
    options,
    {
      code: 'xml_parse_failed',
      path,
    },
    undefined,
    () => parseXml<any>(archive.readText(path)),
  );
  if (!xml) {
    return { documents: [] };
  }
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

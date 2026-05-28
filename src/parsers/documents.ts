import type {
  ScrivenerDocumentContent,
  ScrivenerComment,
  ScrivenerPlaceholder,
  ScrivenerStyleDefinition,
} from '../types.js';
import { ScrivenerArchive } from '../archive/ScrivenerArchive.js';
import { rtfToText } from '../rtf/rtfToText.js';
import { extractPlaceholders } from '../rtf/extractPlaceholders.js';
import { extractStyleSpans } from '../rtf/extractStyleSpans.js';
import { parseRtfContent, type ParsedRtfContent } from './rtf-content.js';
import { parseXml } from '../utils/xml.js';
import { bufferToBase64 } from '../utils/encoding.js';
import { guessMimeType } from '../utils/mime.js';
import { tryOptionalParse, type ParserDiagnosticSink } from '../utils/diagnostics.js';
import { linkCommentAnchors } from './comment-anchors.js';
import { parseScrivenerCommentNodes } from './comments.js';

export interface DocumentParsingOptions extends ParserDiagnosticSink {
  basePath: string;
  decodeRtf: boolean;
  includeBinaryAssets: boolean;
  extractPlaceholders: boolean;
  extractStyleIds: boolean;
  extractStyleSpans: boolean;
  extractEmbeddedImages: boolean;
  extractInlineAnnotations: boolean;
  extractLinkedImages: boolean;
  extractHyperlinks: boolean;
  extractBookmarks: boolean;
  extractFields: boolean;
  extractTables: boolean;
  computeTextCounts: boolean;
  styleDefinitions?: ScrivenerStyleDefinition[];
  documentIds?: string[];
}

function joinPath(base: string, child: string): string {
  return base ? `${base.replace(/\/$/, '')}/${child}` : child;
}

function parseComments(
  content: string,
  options: Pick<
    DocumentParsingOptions,
    | 'decodeRtf'
    | 'extractPlaceholders'
    | 'extractEmbeddedImages'
    | 'extractInlineAnnotations'
    | 'extractLinkedImages'
    | 'extractHyperlinks'
    | 'extractBookmarks'
    | 'extractFields'
    | 'extractTables'
    | 'computeTextCounts'
    | 'tolerant'
    | 'diagnostics'
  >,
  context: { path: string; documentId: string },
): ScrivenerComment[] {
  const xml = tryOptionalParse<any | undefined>(
    options,
    {
      code: 'xml_parse_failed',
      path: context.path,
      documentId: context.documentId,
    },
    undefined,
    () => parseXml<any>(content),
  );
  if (!xml) {
    return [];
  }
  const commentsNode = xml?.Comments ?? xml?.comments ?? xml;
  return parseScrivenerCommentNodes(commentsNode, options, {
    path: context.path,
    documentId: context.documentId,
  });
}

function parseStyleIds(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[;, \r\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function annotateParagraphStyleIds(document: ScrivenerDocumentContent): void {
  const paragraphs = document.paragraphs;
  const spans = document.styleSpans?.filter((span) => span.kind === 'paragraph');
  if (!paragraphs?.length || !spans?.length) {
    return;
  }

  let offset = 0;
  document.paragraphs = paragraphs.map((paragraph) => {
    const start = offset;
    const end = start + paragraph.text.length;
    offset = end + 1;

    const styleId = spans.find((span) => span.end > start && span.start < end)?.id;
    if (!styleId) {
      return paragraph;
    }
    return {
      ...paragraph,
      styleId,
    };
  });
}

function resolveDirectiveStyleId(styleRef: string | undefined, styleIds?: string[]): string | undefined {
  const normalized = String(styleRef ?? '').trim();
  if (!normalized) {
    return undefined;
  }
  const directiveIndex = Number.parseInt(normalized, 10);
  if (Number.isFinite(directiveIndex) && Array.isArray(styleIds) && directiveIndex >= 0) {
    return styleIds[directiveIndex] || undefined;
  }
  return normalized;
}

function annotateInlineAnnotationStyleIds(document: ScrivenerDocumentContent): void {
  if (!document.inlineAnnotations?.length) {
    return;
  }

  document.inlineAnnotations = document.inlineAnnotations.map((annotation) => {
    if (annotation.styleId) {
      return annotation;
    }
    const styleId = resolveDirectiveStyleId(annotation.styleRef, document.styleIds);
    return styleId
      ? {
          ...annotation,
          styleId,
        }
      : annotation;
  });

  if (document.rtfModel) {
    document.rtfModel = {
      ...document.rtfModel,
      annotations: document.inlineAnnotations,
    };
  }
}

function resolveStyleRefs(
  ids: string[],
  definitions?: ScrivenerStyleDefinition[],
) {
  if (!ids.length) return undefined;
  if (!definitions?.length) {
    return ids.map((id) => ({ id }));
  }
  const map = new Map(
    definitions.filter((style) => style.id).map((style) => [String(style.id), style.name]),
  );
  const refs = ids.map((id) => ({ id, name: map.get(id) }));
  return refs;
}

export function parseDocuments(
  archive: ScrivenerArchive,
  options: DocumentParsingOptions,
): Record<string, ScrivenerDocumentContent> {
  const prefix = joinPath(options.basePath, 'Files/Data');
  const requestedIds = new Set((options.documentIds || [])
    .map((id) => String(id || '').trim())
    .map((id) => id.toLowerCase())
    .filter(Boolean));
  const allFiles = archive
    .list(prefix)
    .filter((path) => path.startsWith(`${prefix}/`));
  const files = requestedIds.size
    ? allFiles.filter((file) => {
        const relative = file.slice(prefix.length + 1);
        const [uuid] = relative.split('/', 1);
        return requestedIds.has(String(uuid || '').toLowerCase());
      })
    : allFiles;
  const grouped = new Map<string, string[]>();
  for (const file of files) {
    const relative = file.slice(prefix.length + 1);
    const [uuid, rest] = relative.split('/', 2);
    if (!uuid || !rest) {
      continue;
    }
    if (!grouped.has(uuid)) {
      grouped.set(uuid, []);
    }
    grouped.get(uuid)!.push(rest);
  }

  const documents: Record<string, ScrivenerDocumentContent> = {};
  for (const [uuid, docFiles] of grouped.entries()) {
    const base = joinPath(`${prefix}`, uuid);
    const document: ScrivenerDocumentContent = {
      uuid,
      path: joinPath('Files/Data', uuid),
      hasText: false,
    };
    const knownFiles = new Set<string>();
    const placeholders: ScrivenerPlaceholder[] = [];

    const stylesPath = `${base}/content.styles`;
    if (archive.has(stylesPath)) {
      document.styles = archive.readText(stylesPath);
      if (options.extractStyleIds) {
        const ids = parseStyleIds(document.styles);
        if (ids.length) {
          document.styleIds = ids;
          const refs = resolveStyleRefs(ids, options.styleDefinitions);
          if (refs) {
            document.styleRefs = refs;
          }
        }
      }
      knownFiles.add('content.styles');
    }

    const notesStylesPath = `${base}/notes.styles`;
    if (archive.has(notesStylesPath)) {
      document.notesStyles = archive.readText(notesStylesPath);
      if (options.extractStyleIds) {
        const ids = parseStyleIds(document.notesStyles);
        if (ids.length) {
          document.notesStyleIds = ids;
          const refs = resolveStyleRefs(ids, options.styleDefinitions);
          if (refs) {
            document.notesStyleRefs = refs;
          }
        }
      }
      knownFiles.add('notes.styles');
    }

    const contentPath = `${base}/content.rtf`;
    if (archive.has(contentPath)) {
      const rtfBytes = archive.readRtfBytes(contentPath);
      document.hasText = true;
      const parsedContent = tryOptionalParse<ParsedRtfContent | undefined>(
        options,
        {
          code: 'rtf_parse_failed',
          path: contentPath,
          documentId: uuid,
        },
        undefined,
        () => parseRtfContent(rtfBytes, {
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
      if (parsedContent) {
        const rtf = parsedContent.rtf;
        document.textRtf = rtf;
        document.rtfModel = parsedContent.rtfModel;
        document.paragraphs = parsedContent.paragraphs;
        document.runs = parsedContent.runs;
        if (parsedContent.plainText !== undefined) {
          document.textPlain = parsedContent.plainText;
        }
        if (parsedContent.textWordCount !== undefined) {
          document.textWordCount = parsedContent.textWordCount;
        }
        if (parsedContent.textCharCount !== undefined) {
          document.textCharCount = parsedContent.textCharCount;
        }
        if (parsedContent.placeholders?.length) {
          placeholders.push(...parsedContent.placeholders);
        }
        if (options.extractStyleSpans && options.decodeRtf) {
          document.styleSpans = extractStyleSpans(
            rtf,
            document.textPlain,
            options.styleDefinitions,
            document.styleIds,
          );
          annotateParagraphStyleIds(document);
        }
        if (parsedContent.embeddedImages) {
          document.embeddedImages = parsedContent.embeddedImages;
        }
        if (parsedContent.embeddedPdfs) {
          document.embeddedPdfs = parsedContent.embeddedPdfs;
        }
        if (parsedContent.inlineAnnotations) {
          document.inlineAnnotations = parsedContent.inlineAnnotations;
          annotateInlineAnnotationStyleIds(document);
        }
        if (parsedContent.linkedImages) {
          document.linkedImages = parsedContent.linkedImages;
        }
        if (parsedContent.hyperlinks) {
          document.hyperlinks = parsedContent.hyperlinks;
        }
        if (parsedContent.bookmarks) {
          document.bookmarks = parsedContent.bookmarks;
        }
        if (parsedContent.fields) {
          document.fields = parsedContent.fields;
        }
        if (parsedContent.commentAnchors) {
          document.commentAnchors = parsedContent.commentAnchors;
        }
        if (parsedContent.footnotes) {
          document.footnotes = parsedContent.footnotes;
        }
        if (parsedContent.lists) {
          document.lists = parsedContent.lists;
        }
        if (parsedContent.assets) {
          document.assets = parsedContent.assets;
        }
        if (parsedContent.tables) {
          document.tables = parsedContent.tables;
        }
      }
      knownFiles.add('content.rtf');
    }

    const notesPath = `${base}/notes.rtf`;
    if (archive.has(notesPath)) {
      const parsedNotes = tryOptionalParse<ParsedRtfContent | undefined>(
        options,
        {
          code: 'rtf_parse_failed',
          path: notesPath,
          documentId: uuid,
        },
        undefined,
        () => parseRtfContent(archive.readRtfBytes(notesPath), {
          decodeRtf: options.decodeRtf,
          extractPlaceholders: options.extractPlaceholders,
          computeTextCounts: false,
          placeholderSource: 'notes',
        }),
      );
      if (parsedNotes) {
        const rtf = parsedNotes.rtf;
        document.notesRtf = rtf;
        if (options.decodeRtf) {
          document.notesPlain = parsedNotes.plainText ?? rtfToText(rtf);
        }
        if (options.extractStyleSpans && options.decodeRtf && document.notesPlain) {
          document.notesStyleSpans = extractStyleSpans(
            rtf,
            document.notesPlain,
            options.styleDefinitions,
            document.notesStyleIds,
          );
        }
        if (options.extractPlaceholders) {
          placeholders.push(
            ...(parsedNotes.placeholders || extractPlaceholders(rtf, 'notes', options.decodeRtf ? document.notesPlain : undefined)),
          );
        }
      }
      knownFiles.add('notes.rtf');
    }

    const synopsisPath = `${base}/synopsis.txt`;
    if (archive.has(synopsisPath)) {
      document.synopsis = archive.readText(synopsisPath).trim();
      knownFiles.add('synopsis.txt');
    }

    const commentsPath = `${base}/content.comments`;
    if (archive.has(commentsPath)) {
      const raw = archive.readText(commentsPath);
      document.comments = parseComments(raw, options, {
        path: commentsPath,
        documentId: uuid,
      });
      knownFiles.add('content.comments');
    }

    const attachments: NonNullable<ScrivenerDocumentContent['files']> = [];
    for (const file of docFiles) {
      if (knownFiles.has(file)) {
        continue;
      }
      const fullPath = `${base}/${file}`;
      if (!archive.has(fullPath)) {
        continue;
      }
      if (options.includeBinaryAssets) {
        const data = archive.readBinary(fullPath);
        attachments.push({
          path: file,
          base64: bufferToBase64(data),
          contentType: guessMimeType(file),
        });
      } else {
        attachments.push({ path: file });
      }
    }

    if (attachments.length) {
      document.files = attachments;
    }
    if (placeholders.length) {
      document.placeholders = placeholders;
    }

    linkCommentAnchors(document);

    documents[uuid] = document;
  }

  return documents;
}

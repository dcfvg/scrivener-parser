import type { ScrivenerComment } from '../types.js';
import { toArray } from '../utils/collections.js';
import { yesNo } from '../utils/strings.js';
import { readXmlNodeText as readNodeText } from '../utils/xml.js';
import { tryOptionalParse, type ParserDiagnosticSink } from '../utils/diagnostics.js';
import { parseRtfContent, type ParsedRtfContent } from './rtf-content.js';

export interface ScrivenerCommentParsingOptions extends ParserDiagnosticSink {
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

interface ScrivenerCommentParsingContext {
  path: string;
  documentId?: string;
}

export function hasScrivenerCommentNodes(node: unknown): boolean {
  if (!node || typeof node !== 'object') {
    return false;
  }
  const record = node as Record<string, unknown>;
  return record.Comment !== undefined || record.comment !== undefined;
}

function parseOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseScrivenerCommentNodes(
  commentsNode: unknown,
  options: ScrivenerCommentParsingOptions,
  context: ScrivenerCommentParsingContext,
): ScrivenerComment[] {
  if (!commentsNode || typeof commentsNode === 'string') return [];
  const record = commentsNode as Record<string, unknown>;
  const comments = toArray(record.Comment ?? record.comment ?? []);
  if (!comments.length) return [];
  return comments.map((comment: any) => {
    const rawRtf = readNodeText(comment) ?? '';
    const parsed = rawRtf
      ? tryOptionalParse<ParsedRtfContent | undefined>(
          options,
          {
            code: 'rtf_parse_failed',
            path: context.path,
            documentId: context.documentId,
          },
          undefined,
          () => parseRtfContent(rawRtf, {
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
            placeholderSource: 'comment',
          }),
        )
      : undefined;

    return {
      id: String(comment.ID ?? comment.Id ?? ''),
      author: comment.Author,
      color: comment.Color,
      isFootnote: yesNo(comment.Footnote),
      number: parseOptionalNumber(comment.Number),
      collapsed: yesNo(comment.Collapsed),
      rawRtf,
      text: parsed?.plainText,
      textWordCount: parsed?.textWordCount,
      textCharCount: parsed?.textCharCount,
      paragraphs: parsed?.paragraphs?.length ? parsed.paragraphs : undefined,
      runs: parsed?.runs?.length ? parsed.runs : undefined,
      placeholders: parsed?.placeholders,
      embeddedImages: parsed?.embeddedImages,
      embeddedPdfs: parsed?.embeddedPdfs,
      inlineAnnotations: parsed?.inlineAnnotations,
      linkedImages: parsed?.linkedImages,
      hyperlinks: parsed?.hyperlinks,
      bookmarks: parsed?.bookmarks,
      fields: parsed?.fields,
      commentAnchors: parsed?.commentAnchors,
      footnotes: parsed?.footnotes,
      lists: parsed?.lists,
      assets: parsed?.assets,
      rtfModel: parsed?.rtfModel,
      tables: parsed?.tables,
    };
  });
}

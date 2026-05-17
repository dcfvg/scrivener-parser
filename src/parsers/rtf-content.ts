import type {
  ScrivenerBookmark,
  ScrivenerCommentAnchor,
  ScrivenerEmbeddedImage,
  ScrivenerEmbeddedPdf,
  ScrivenerField,
  ScrivenerFootnote,
  ScrivenerHyperlink,
  ScrivenerInlineAnnotation,
  ScrivenerLinkedImage,
  ScrivenerParagraph,
  ScrivenerPlaceholder,
  ScrivenerRtfAsset,
  ScrivenerRtfList,
  ScrivenerRtfModel,
  ScrivenerTextRun,
} from '../types.js';
import { extractPlaceholders } from '../rtf/extractPlaceholders.js';
import { extractRtfExtras } from '../rtf/extractExtras.js';
import { tokenizeRtfBytes } from '../rtf/byteTokenizer.js';
import { parseRtfPropertiesFromTokens } from '../rtf/properties.js';

export interface ParsedRtfContentOptions {
  decodeRtf?: boolean;
  extractPlaceholders?: boolean;
  extractEmbeddedImages?: boolean;
  extractInlineAnnotations?: boolean;
  extractLinkedImages?: boolean;
  extractHyperlinks?: boolean;
  extractBookmarks?: boolean;
  extractFields?: boolean;
  extractTables?: boolean;
  computeTextCounts?: boolean;
  placeholderSource?: 'text' | 'notes' | 'comment';
}

export interface ParsedRtfContent {
  rtf: string;
  plainText?: string;
  textWordCount?: number;
  textCharCount?: number;
  paragraphs: ScrivenerParagraph[];
  runs: ScrivenerTextRun[];
  rtfModel: ScrivenerRtfModel;
  placeholders?: ScrivenerPlaceholder[];
  embeddedImages?: ScrivenerEmbeddedImage[];
  embeddedPdfs?: ScrivenerEmbeddedPdf[];
  inlineAnnotations?: ScrivenerInlineAnnotation[];
  linkedImages?: ScrivenerLinkedImage[];
  hyperlinks?: ScrivenerHyperlink[];
  bookmarks?: ScrivenerBookmark[];
  fields?: ScrivenerField[];
  commentAnchors?: ScrivenerCommentAnchor[];
  footnotes?: ScrivenerFootnote[];
  lists?: ScrivenerRtfList[];
  assets?: ScrivenerRtfAsset[];
  tables?: Array<{ start: number; end: number }>;
}

function countWords(text: string | undefined): number | undefined {
  if (!text) {
    return undefined;
  }
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  return tokens.length;
}

function shouldParseRtfModel(options: ParsedRtfContentOptions): boolean {
  return (
    options.decodeRtf !== false
    || Boolean(options.extractPlaceholders)
    || Boolean(options.extractEmbeddedImages)
    || Boolean(options.extractInlineAnnotations)
    || Boolean(options.extractLinkedImages)
    || Boolean(options.extractHyperlinks)
    || Boolean(options.extractBookmarks)
    || Boolean(options.extractFields)
    || Boolean(options.extractTables)
    || Boolean(options.computeTextCounts)
  );
}

function emptyRtfModel(
  properties = parseRtfPropertiesFromTokens([]),
): ScrivenerRtfModel {
  return {
    paragraphs: [],
    runs: [],
    properties,
    fields: [],
    commentAnchors: [],
    footnotes: [],
    annotations: [],
    linkedImages: [],
    lists: [],
    assets: [],
    embeddedPdfs: [],
  };
}

export function parseRtfContent(
  rtf: string | Uint8Array,
  options: ParsedRtfContentOptions = {},
): ParsedRtfContent {
  let sourceRtf: string;
  let tokenized: ReturnType<typeof tokenizeRtfBytes> | undefined;
  if (typeof rtf === 'string') {
    sourceRtf = rtf;
  } else {
    tokenized = tokenizeRtfBytes(rtf);
    sourceRtf = tokenized.rtf;
  }
  if (!shouldParseRtfModel(options)) {
    return {
      rtf: sourceRtf,
      paragraphs: [],
      runs: [],
      rtfModel: emptyRtfModel(tokenized?.properties),
    };
  }
  const extras = extractRtfExtras(sourceRtf, tokenized);
  const plainText = options.decodeRtf !== false ? extras.plainText : undefined;

  const parsed: ParsedRtfContent = {
    rtf: sourceRtf,
    plainText,
    textWordCount: options.computeTextCounts ? countWords(plainText) : undefined,
    textCharCount: options.computeTextCounts && plainText ? plainText.length : undefined,
    paragraphs: extras.paragraphs,
    runs: extras.runs,
    rtfModel: {
      paragraphs: extras.paragraphs,
      runs: extras.runs,
      properties: extras.properties,
      fields: extras.fields,
      commentAnchors: extras.commentAnchors,
      footnotes: extras.footnotes,
      annotations: extras.inlineAnnotations,
      linkedImages: extras.linkedImages,
      lists: extras.lists,
      assets: extras.assets,
      embeddedPdfs: extras.embeddedPdfs,
    },
    placeholders: options.extractPlaceholders
      ? extractPlaceholders(sourceRtf, options.placeholderSource ?? 'text', extras.plainText)
      : undefined,
    embeddedImages: options.extractEmbeddedImages && extras.embeddedImages.length
      ? extras.embeddedImages
      : undefined,
    embeddedPdfs: extras.embeddedPdfs.length
      ? extras.embeddedPdfs
      : undefined,
    inlineAnnotations: options.extractInlineAnnotations && extras.inlineAnnotations.length
      ? extras.inlineAnnotations
      : undefined,
    linkedImages: options.extractLinkedImages && extras.linkedImages.length
      ? extras.linkedImages
      : undefined,
    hyperlinks: options.extractHyperlinks && extras.hyperlinks.length
      ? extras.hyperlinks
      : undefined,
    bookmarks: options.extractBookmarks && extras.bookmarks.length
      ? extras.bookmarks
      : undefined,
    fields: options.extractFields && extras.fields.length
      ? extras.fields
      : undefined,
    commentAnchors: extras.commentAnchors.length ? extras.commentAnchors : undefined,
    footnotes: extras.footnotes.length ? extras.footnotes : undefined,
    lists: extras.lists.length ? extras.lists : undefined,
    assets: extras.assets.length ? extras.assets : undefined,
    tables: options.extractTables && extras.tables.length ? extras.tables : undefined,
  };

  return parsed;
}

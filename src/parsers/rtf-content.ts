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
import { decodeRtfBytes } from '../rtf/byteTokenizer.js';

export interface ParsedRtfContentOptions {
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
  placeholderSource?: 'text' | 'notes' | 'comment';
  rtfBytes?: Uint8Array;
}

export interface ParsedRtfContent {
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

export function parseRtfContent(
  rtf: string,
  options: ParsedRtfContentOptions,
): ParsedRtfContent {
  const sourceRtf = options.rtfBytes ? decodeRtfBytes(options.rtfBytes) : rtf;
  const extras = extractRtfExtras(sourceRtf);
  const plainText = options.decodeRtf ? extras.plainText : undefined;

  const parsed: ParsedRtfContent = {
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
      ? extractPlaceholders(sourceRtf, options.placeholderSource ?? 'text', plainText)
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

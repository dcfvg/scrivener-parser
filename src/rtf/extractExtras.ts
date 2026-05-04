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
  ScrivenerRtfAsset,
  ScrivenerRtfList,
  ScrivenerTextRun,
} from '../types.js';
import { parseRtfModel } from './parseRtfModel.js';

export interface RtfExtras {
  plainText: string;
  paragraphs: ScrivenerParagraph[];
  runs: ScrivenerTextRun[];
  embeddedImages: ScrivenerEmbeddedImage[];
  embeddedPdfs: ScrivenerEmbeddedPdf[];
  linkedImages: ScrivenerLinkedImage[];
  inlineAnnotations: ScrivenerInlineAnnotation[];
  hyperlinks: ScrivenerHyperlink[];
  bookmarks: ScrivenerBookmark[];
  fields: ScrivenerField[];
  commentAnchors: ScrivenerCommentAnchor[];
  footnotes: ScrivenerFootnote[];
  lists: ScrivenerRtfList[];
  assets: ScrivenerRtfAsset[];
  tables: Array<{ start: number; end: number }>;
}

function extractBookmarks(rtf: string): ScrivenerBookmark[] {
  const result: ScrivenerBookmark[] = [];
  const regex = /\\bkmkstart ([^\\\s]+)|\\bkmkend ([^\\\s]+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(rtf)) !== null) {
    const name = match[1] ?? match[2];
    if (!name) continue;
    if (result.find((bookmark) => bookmark.name === name)) continue;
    result.push({ name });
  }
  return result;
}

function extractTables(rtf: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const rowRegex = /\\trowd/g;
  let match: RegExpExecArray | null;
  while ((match = rowRegex.exec(rtf)) !== null) {
    const start = match.index;
    const end = rtf.indexOf('\\row', start);
    if (end !== -1) {
      ranges.push({ start, end: end + 4 });
      rowRegex.lastIndex = end + 4;
    } else {
      break;
    }
  }
  return ranges;
}

export function extractRtfExtras(rtf: string): RtfExtras {
  const model = parseRtfModel(rtf);
  const linkedImages = model.linkedImages;
  const hyperlinks = model.fields
    .filter((field) => field.kind === 'hyperlink' && field.url)
    .map((field) => ({
      url: field.url!,
      text: field.result,
    }));
  const assets: ScrivenerRtfAsset[] = [
    ...model.embeddedImages.map((image) => ({
      type: 'embedded-image' as const,
      format: image.format,
      base64: image.base64,
      paragraphIndex: image.paragraphIndex,
    })),
    ...model.embeddedPdfs.map((pdf) => ({
      type: 'embedded-pdf' as const,
      fileName: pdf.fileName,
      paragraphIndex: pdf.paragraphIndex,
      raw: pdf.raw,
    })),
    ...linkedImages.map((image) => ({
      type: 'linked-image' as const,
      path: image.path,
      rawPath: image.rawPath,
      source: image.source,
      targetUuid: image.targetUuid,
      fileExtension: image.fileExtension,
      width: image.width,
      height: image.height,
      paragraphIndex: image.paragraphIndex,
      start: image.start,
      end: image.end,
      raw: image.raw,
    })),
  ];

  return {
    plainText: model.plainText,
    paragraphs: model.paragraphs,
    runs: model.runs,
    embeddedImages: model.embeddedImages,
    embeddedPdfs: model.embeddedPdfs,
    linkedImages,
    inlineAnnotations: model.annotations,
    hyperlinks,
    bookmarks: extractBookmarks(rtf),
    fields: model.fields,
    commentAnchors: model.commentAnchors,
    footnotes: model.footnotes,
    lists: model.lists,
    assets,
    tables: extractTables(rtf),
  };
}

import type {
  ScrivenerCommentAnchor,
  ScrivenerEmbeddedImage,
  ScrivenerEmbeddedPdf,
  ScrivenerField,
  ScrivenerFootnote,
  ScrivenerInlineAnnotation,
  ScrivenerLinkedImage,
  ScrivenerParagraph,
  ScrivenerRtfList,
  ScrivenerRtfProperties,
  ScrivenerTextRun,
  ScrivenerTextRunSource,
} from '../types.js';
import { bufferToBase64 } from '../utils/encoding.js';
import {
  encodeScrivenerFootnoteToken,
  extractInternalScrivenerDirectives,
  replaceEmbeddedScrivenerInlineMarkup,
} from './parseScrivenerInlineMarkup.js';
import { tokenizeRtf, type RtfToken } from './tokenizeRtf.js';
import { extractLeadingScrivenerParagraphDirectiveState } from './parseScrivenerDirectives.js';
import { readScrImageLinkTokenAt } from './parseScrImageLink.js';
import { parseRtfPropertiesFromTokens } from './properties.js';

const IGNORE_DESTINATIONS = new Set([
  'fonttbl',
  'colortbl',
  'expandedcolortbl',
  'stylesheet',
  'info',
  'object',
  'filetbl',
  'datastore',
  'themedata',
  'colorschememapping',
  'generator',
  'header',
  'footer',
  'shppict',
]);

const DESTINATION_WORDS = new Set([
  ...IGNORE_DESTINATIONS,
  'field',
  'fldinst',
  'fldrslt',
  'listtext',
  'pict',
  'scrivenerpdf',
  'pdffilename',
  'Scrv_annot',
  'Scrv_fn',
]);

const INTERNAL_SCRIVENER_MARKUP_RE = /(?:<!?\$Scr(?!vFn:)[^>\n]+>|\{?\$SCRImageLink\[[^\]]*]=[^}\n]+}?)/g;

interface InternalParagraph {
  runs: ScrivenerTextRun[];
  list?: Omit<ScrivenerRtfList, 'paragraphIndex'>;
  pageBreakBefore?: boolean;
}

interface FieldScratch {
  instructionRaw?: string;
  resultRaw?: string;
}

interface PdfScratch {
  fileNameRaw?: string;
}

interface PreprocessedRtf {
  content: string;
  footnotes: ScrivenerFootnote[];
  annotations: ScrivenerInlineAnnotation[];
}

interface GroupState {
  start: number;
  uc: number;
  pending: boolean;
  ignoreVisible: boolean;
  destination?: string;
  sawStar: boolean;
  listId?: number;
  level?: number;
  field?: FieldScratch;
  pdf?: PdfScratch;
}

export interface ParsedRtfModel {
  plainText: string;
  paragraphs: ScrivenerParagraph[];
  runs: ScrivenerTextRun[];
  properties: ScrivenerRtfProperties;
  fields: ScrivenerField[];
  commentAnchors: ScrivenerCommentAnchor[];
  footnotes: ScrivenerFootnote[];
  annotations: ScrivenerInlineAnnotation[];
  linkedImages: ScrivenerLinkedImage[];
  lists: ScrivenerRtfList[];
  embeddedImages: ScrivenerEmbeddedImage[];
  embeddedPdfs: ScrivenerEmbeddedPdf[];
}

export interface ParseRtfModelOptions {
  extractEmbeddedImages?: boolean;
  extractEmbeddedPdfs?: boolean;
}

function createParagraph(): InternalParagraph {
  return { runs: [] };
}

function paragraphText(paragraph: InternalParagraph): string {
  return paragraph.runs.map((run) => run.text).join('');
}

function pushTextRun(paragraph: InternalParagraph, text: string, source: ScrivenerTextRunSource) {
  if (!text) {
    return;
  }
  const previous = paragraph.runs[paragraph.runs.length - 1];
  if (previous && previous.source === source) {
    previous.text += text;
    return;
  }
  paragraph.runs.push({ text, source });
}

function stripIgnoredRtfLineBreaks(value: string): string {
  return String(value ?? '').replace(/[\r\n]+/g, '');
}

function trimParagraph(paragraph: InternalParagraph): InternalParagraph {
  const runs = paragraph.runs.map((run) => ({ ...run }));
  let trailing = paragraphText(paragraph).length - paragraphText(paragraph).trimEnd().length;
  while (trailing > 0 && runs.length) {
    const last = runs[runs.length - 1];
    if (last.text.length <= trailing) {
      trailing -= last.text.length;
      runs.pop();
      continue;
    }
    last.text = last.text.slice(0, last.text.length - trailing);
    trailing = 0;
  }
  return {
    ...paragraph,
    runs,
  };
}

function paragraphHasText(paragraph: InternalParagraph): boolean {
  return Boolean(paragraphText(paragraph));
}

function normalizeParagraphs(
  paragraphs: InternalParagraph[],
): { paragraphs: ScrivenerParagraph[]; runs: ScrivenerTextRun[]; lists: ScrivenerRtfList[]; plainText: string } {
  const trimmed = paragraphs.map((paragraph) => trimParagraph(paragraph));
  while (trimmed.length && !paragraphHasText(trimmed[0])) {
    const removed = trimmed.shift();
    if (removed?.pageBreakBefore && trimmed[0]) {
      trimmed[0].pageBreakBefore = true;
    }
  }
  while (trimmed.length && !paragraphHasText(trimmed[trimmed.length - 1])) {
    trimmed.pop();
  }

  const collapsed: InternalParagraph[] = [];
  let pendingPageBreakBefore = false;
  for (const paragraph of trimmed) {
    if (paragraph.pageBreakBefore) {
      pendingPageBreakBefore = true;
    }
    const isEmpty = !paragraphHasText(paragraph);
    const previous = collapsed[collapsed.length - 1];
    if (isEmpty && previous && !paragraphText(previous)) {
      continue;
    }
    collapsed.push({
      ...paragraph,
      pageBreakBefore: pendingPageBreakBefore || paragraph.pageBreakBefore,
    });
    if (!isEmpty) {
      pendingPageBreakBefore = false;
    }
  }

  const normalizedParagraphs: ScrivenerParagraph[] = [];
  const runs: ScrivenerTextRun[] = [];
  const lists: ScrivenerRtfList[] = [];
  for (const paragraph of collapsed) {
    const outputParagraph: ScrivenerParagraph = {
      text: paragraphText(paragraph),
      runs: paragraph.runs.map((run) => ({ ...run })),
    };
    const directiveState = extractLeadingScrivenerParagraphDirectiveState(outputParagraph.text);
    if (directiveState.keepWithNext !== undefined) {
      outputParagraph.keepWithNext = directiveState.keepWithNext;
    }
    if (directiveState.headerLevel !== undefined) {
      outputParagraph.headerLevel = directiveState.headerLevel;
    }
    if (paragraph.pageBreakBefore) {
      outputParagraph.pageBreakBefore = true;
    }
    if (paragraph.list && outputParagraph.text) {
      lists.push({
        ...paragraph.list,
        paragraphIndex: normalizedParagraphs.length,
      });
    }
    normalizedParagraphs.push(outputParagraph);
    runs.push(...outputParagraph.runs);
  }

  return {
    paragraphs: normalizedParagraphs,
    runs,
    lists,
    plainText: normalizedParagraphs.map((paragraph) => paragraph.text).join('\n'),
  };
}

function decodeVisibleText(tokens: RtfToken[]): string {
  const paragraphs: InternalParagraph[] = [createParagraph()];
  const groupStack: Array<{ uc: number; pending: boolean; ignore: boolean; sawStar: boolean; destination?: string }> = [];
  let uc = 1;
  let skipAscii = 0;

  const append = (value: string) => {
    if (!value) {
      return;
    }
    pushTextRun(paragraphs[paragraphs.length - 1], value, 'body');
  };

  const lineBreak = () => {
    paragraphs.push(createParagraph());
  };

  const currentIgnored = () => groupStack.some((group) => group.ignore || group.destination === 'pict');

  for (const token of tokens) {
    if (token.type === 'group-start') {
      groupStack.push({
        uc,
        pending: true,
        ignore: groupStack.some((group) => group.ignore),
        sawStar: false,
      });
      continue;
    }
    if (token.type === 'group-end') {
      const group = groupStack.pop();
      if (group) {
        uc = group.uc;
      }
      continue;
    }

    const current = groupStack[groupStack.length - 1];
    if (current?.pending) {
      if (token.type === 'control-symbol' && token.symbol === '*') {
        current.ignore = true;
        current.sawStar = true;
        continue;
      }
      if (token.type === 'control-word' && DESTINATION_WORDS.has(token.word)) {
        current.destination = token.word;
        current.pending = false;
        if (IGNORE_DESTINATIONS.has(token.word) || token.word === 'pict') {
          current.ignore = true;
        }
        continue;
      }
      current.pending = false;
    }

    if (currentIgnored()) {
      continue;
    }

    if (token.type === 'control-word') {
      switch (token.word) {
        case 'par':
        case 'line':
          lineBreak();
          break;
        case 'tab':
          append('\t');
          break;
        case 'emdash':
          append('—');
          break;
        case 'endash':
          append('–');
          break;
        case 'lquote':
          append('‘');
          break;
        case 'rquote':
          append('’');
          break;
        case 'ldblquote':
          append('“');
          break;
        case 'rdblquote':
          append('”');
          break;
        case 'bullet':
          append('•');
          break;
        case 'u': {
          const code = Number(token.param);
          if (!Number.isNaN(code)) {
            const normalized = code < 0 ? 0x10000 + code : code;
            try {
              append(String.fromCodePoint(normalized));
            } catch {
              // ignore invalid codepoints
            }
            skipAscii = uc;
          }
          break;
        }
        case 'uc': {
          const next = Math.max(0, Number(token.param));
          uc = Number.isNaN(next) ? 1 : next;
          if (current) {
            current.uc = uc;
          }
          break;
        }
        default:
          break;
      }
      continue;
    }

    if (token.type === 'control-symbol') {
      switch (token.symbol) {
        case '~':
          append('\u00A0');
          break;
        case '-':
          append('—');
          break;
        case '_':
          append('\u2011');
          break;
        default:
          break;
      }
      continue;
    }

    if (token.type === 'text') {
      let value = stripIgnoredRtfLineBreaks(token.value);
      if (skipAscii > 0) {
        if (value.length <= skipAscii) {
          skipAscii -= value.length;
          continue;
        }
        value = value.slice(skipAscii);
        skipAscii = 0;
      }
      append(value);
    }
  }

  return normalizeParagraphs(paragraphs).plainText.trim();
}

function unwrapDestinationGroup(raw: string, destination: string, allowStar = false): string {
  let inner = String(raw ?? '').trim();
  if (inner.startsWith('{') && inner.endsWith('}')) {
    inner = inner.slice(1, -1);
  }
  if (allowStar) {
    inner = inner.replace(/^\s*\\\*\s*/, '');
  }
  inner = inner.replace(new RegExp(`^\\s*\\\\${destination}\\s*`), '');
  return inner;
}

function extractFieldInstruction(raw: string): string | undefined {
  return decodeVisibleText(tokenizeRtf(unwrapDestinationGroup(raw, 'fldinst', true))) || undefined;
}

function extractFieldResult(raw: string): string | undefined {
  return decodeVisibleText(tokenizeRtf(unwrapDestinationGroup(raw, 'fldrslt'))) || undefined;
}

function extractListMarker(raw: string): string | undefined {
  return decodeVisibleText(tokenizeRtf(unwrapDestinationGroup(raw, 'listtext'))) || undefined;
}

function extractFootnoteText(raw: string): string | undefined {
  let inner = unwrapDestinationGroup(raw, 'Scrv_fn');
  inner = inner.replace(/^\s*=\s*/, '');
  inner = inner.replace(/\\end_Scrv_fn\s*$/m, '');
  return cleanExtractedText(decodeVisibleText(tokenizeRtf(inner)));
}

function extractAnnotationColor(raw: string): string | undefined {
  const match = /\\color=\{\\R=([^\\}]+)\\G=([^\\}]+)\\B=([^\\}]+)\}/.exec(raw);
  if (!match) {
    return undefined;
  }
  return `${match[1].trim()} ${match[2].trim()} ${match[3].trim()}`;
}

function extractAnnotationText(raw: string): string | undefined {
  const match = /\\text=([\s\S]*?)\\end_Scrv_annot/.exec(raw);
  if (!match) {
    return undefined;
  }
  return cleanExtractedText(decodeVisibleText(tokenizeRtf(match[1])));
}

function cleanExtractedText(value?: string): string | undefined {
  const normalized = String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(INTERNAL_SCRIVENER_MARKUP_RE, ' ').replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
  return normalized || undefined;
}

const PICT_SIGNATURES: Record<string, string[]> = {
  png: ['89504E470D0A1A0A'],
  jpeg: ['FFD8FF'],
  gif: ['47494638'],
  bmp: ['424D'],
  tiff: ['49492A00', '4D4D002A'],
  emf: ['01000000'],
  wmf: ['D7CDC69A'],
};

function normalizePictHexPayload(hex: string, format?: string): string {
  const signatures = format ? PICT_SIGNATURES[format] || [] : [];
  for (const signature of signatures) {
    const index = hex.indexOf(signature);
    if (index >= 0) {
      return hex.slice(index);
    }
  }
  return hex;
}

function parsePict(raw: string, paragraphIndex: number): ScrivenerEmbeddedImage | undefined {
  const format = raw.includes('\\pngblip')
    ? 'png'
    : raw.includes('\\jpegblip') || raw.includes('\\jpgblip')
      ? 'jpeg'
      : raw.includes('\\emfblip')
        ? 'emf'
        : raw.includes('\\wmetafile')
        ? 'wmf'
          : undefined;
  const hex = tokenizeRtf(raw)
    .filter((token) => token.type === 'text')
    .map((token) => token.value)
    .map((value) => value.replace(/[^0-9A-Fa-f]/g, ''))
    .filter((value) => value.length >= 16)
    .join('');
  if (!hex.length) {
    return undefined;
  }
  const normalizedHex = normalizePictHexPayload(hex, format);
  const evenHex = normalizedHex.length % 2 === 0 ? normalizedHex : normalizedHex.slice(0, -1);
  if (!evenHex.length) {
    return undefined;
  }
  const bytes = new Uint8Array(evenHex.length / 2);
  for (let index = 0; index < evenHex.length; index += 2) {
    bytes[index / 2] = Number.parseInt(evenHex.slice(index, index + 2), 16);
  }
  return {
    format,
    base64: bufferToBase64(bytes),
    paragraphIndex,
  };
}

function extractPdfFileName(raw: string): string | undefined {
  return cleanExtractedText(decodeVisibleText(tokenizeRtf(unwrapDestinationGroup(raw, 'pdffilename', true))));
}

function parseEmbeddedPdf(
  raw: string,
  paragraphIndex: number,
  fileNameRaw?: string,
): ScrivenerEmbeddedPdf | undefined {
  const fileName = fileNameRaw ? extractPdfFileName(fileNameRaw) : undefined;
  if (!fileName && !raw) {
    return undefined;
  }
  return {
    fileName,
    paragraphIndex,
    raw,
  };
}

function extractAnnotationStyleRef(raw: string): string | undefined {
  const match = /\\text=([\s\S]*?)\\end_Scrv_annot/.exec(raw);
  if (!match) {
    return undefined;
  }
  const state = extractLeadingScrivenerParagraphDirectiveState(match[1]);
  return typeof state.styleRef === 'string' && state.styleRef.trim()
    ? state.styleRef.trim()
    : undefined;
}
function extractParagraphLinkedImages(paragraphs: ScrivenerParagraph[]): ScrivenerLinkedImage[] {
  const images: ScrivenerLinkedImage[] = [];

  paragraphs.forEach((paragraph, paragraphIndex) => {
    const text = String(paragraph?.text ?? '');
    for (let index = 0; index < text.length; index += 1) {
      const token = readScrImageLinkTokenAt(text, index);
      if (!token) {
        continue;
      }
      images.push({
        raw: token.raw,
        path: token.path,
        rawPath: token.rawPath,
        source: token.source,
        targetUuid: token.targetUuid,
        fileExtension: token.fileExtension,
        width: token.width,
        height: token.height,
        paragraphIndex,
        start: index,
        end: token.end,
      });
      index = token.end - 1;
    }
  });

  return images;
}

function parseFieldMeta(instruction?: string): Pick<ScrivenerField, 'kind' | 'url' | 'commentId' | 'targetUuid'> {
  const normalized = String(instruction ?? '').trim();
  const hyperlink = /\bHYPERLINK\s+"([^"]+)"/i.exec(normalized);
  if (!hyperlink) {
    return { kind: 'other' };
  }
  const url = hyperlink[1];
  if (url.startsWith('scrivcmt://')) {
    return {
      kind: 'comment-anchor',
      url,
      commentId: url.slice('scrivcmt://'.length),
    };
  }
  if (url.startsWith('scrivlnk://')) {
    return {
      kind: 'scrivener-link',
      url,
      targetUuid: url.slice('scrivlnk://'.length),
    };
  }
  return {
    kind: 'hyperlink',
    url,
  };
}

function currentVisibleSource(groupStack: GroupState[]): ScrivenerTextRunSource {
  for (let index = groupStack.length - 1; index >= 0; index -= 1) {
    const destination = groupStack[index]?.destination;
    if (destination === 'fldrslt') {
      return 'field-result';
    }
    if (destination === 'listtext') {
      return 'list-marker';
    }
  }
  return 'body';
}

function isVisibleSuppressed(groupStack: GroupState[]): boolean {
  return groupStack.some((group) => (
    group.ignoreVisible
    || group.destination === 'pict'
    || group.destination === 'scrivenerpdf'
    || group.destination === 'pdffilename'
    || group.destination === 'Scrv_annot'
    || group.destination === 'Scrv_fn'
    || group.destination === 'fldinst'
  ));
}

function findNearestField(groupStack: GroupState[]): GroupState | undefined {
  for (let index = groupStack.length - 1; index >= 0; index -= 1) {
    if (groupStack[index].destination === 'field') {
      return groupStack[index];
    }
  }
  return undefined;
}

function findNearestPdf(groupStack: GroupState[]): GroupState | undefined {
  for (let index = groupStack.length - 1; index >= 0; index -= 1) {
    if (groupStack[index].destination === 'scrivenerpdf') {
      return groupStack[index];
    }
  }
  return undefined;
}

function preprocessEmbeddedScrivenerMarkup(content: string): PreprocessedRtf {
  const footnotes: ScrivenerFootnote[] = [];
  const annotations: ScrivenerInlineAnnotation[] = [];

  const sanitized = replaceEmbeddedScrivenerInlineMarkup(String(content ?? ''), (match) => {
    if (match.kind === 'Scrv_fn') {
      const text = extractFootnoteText(match.normalizedRaw);
      const token = encodeScrivenerFootnoteToken(text ?? '');
      footnotes.push({
        id: String(footnotes.length + 1),
        token,
        text,
        rawRtf: match.normalizedRaw,
      });
      return `${match.directives}${token}`;
    }

    annotations.push({
      raw: match.normalizedRaw,
      text: extractAnnotationText(match.normalizedRaw),
      color: extractAnnotationColor(match.normalizedRaw),
      styleRef: extractAnnotationStyleRef(match.normalizedRaw),
    });
    return match.directives;
  });

  return {
    content: sanitized,
    footnotes,
    annotations,
  };
}

function parsePreprocessedRtfModel(
  preprocessed: PreprocessedRtf,
  tokens: RtfToken[],
  properties = parseRtfPropertiesFromTokens(tokens),
  options: ParseRtfModelOptions = {},
): ParsedRtfModel {
  const paragraphs: InternalParagraph[] = [createParagraph()];
  const groupStack: GroupState[] = [];
  const fields: ScrivenerField[] = [];
  const commentAnchors: ScrivenerCommentAnchor[] = [];
  const footnotes: ScrivenerFootnote[] = [...preprocessed.footnotes];
  const annotations: ScrivenerInlineAnnotation[] = [...preprocessed.annotations];
  const embeddedImages: ScrivenerEmbeddedImage[] = [];
  const embeddedPdfs: ScrivenerEmbeddedPdf[] = [];
  let uc = 1;
  let skipAscii = 0;
  const shouldExtractEmbeddedImages = options.extractEmbeddedImages !== false;
  const shouldExtractEmbeddedPdfs = options.extractEmbeddedPdfs !== false;

  const appendVisible = (value: string, source = currentVisibleSource(groupStack)) => {
    if (!value) {
      return;
    }
    pushTextRun(paragraphs[paragraphs.length - 1], value, source);
  };

  const pushParagraphBreak = () => {
    paragraphs.push(createParagraph());
  };

  const markNextParagraphPageBreak = () => {
    let current = paragraphs[paragraphs.length - 1];
    if (paragraphHasText(current)) {
      current = createParagraph();
      paragraphs.push(current);
    }
    current.pageBreakBefore = true;
  };

  for (const token of tokens) {
    if (token.type === 'group-start') {
      const parent = groupStack[groupStack.length - 1];
      groupStack.push({
        start: token.start,
        uc,
        pending: true,
        ignoreVisible: parent?.ignoreVisible ?? false,
        sawStar: false,
        listId: parent?.listId,
        level: parent?.level,
      });
      continue;
    }

    if (token.type === 'group-end') {
      const group = groupStack.pop();
      if (!group) {
        continue;
      }
      let raw: string | undefined;
      const readRaw = () => {
        raw ??= preprocessed.content.slice(group.start, token.end);
        return raw;
      };

      if (group.destination === 'fldinst') {
        const field = findNearestField(groupStack);
        if (field?.field) {
          field.field.instructionRaw = readRaw();
        }
      } else if (group.destination === 'fldrslt') {
        const field = findNearestField(groupStack);
        if (field?.field) {
          field.field.resultRaw = readRaw();
        }
      } else if (group.destination === 'pdffilename') {
        const pdf = findNearestPdf(groupStack);
        if (pdf?.pdf) {
          pdf.pdf.fileNameRaw = readRaw();
        }
      } else if (group.destination === 'field') {
        const instruction = group.field?.instructionRaw
          ? extractFieldInstruction(group.field.instructionRaw)
          : undefined;
        const result = group.field?.resultRaw
          ? extractFieldResult(group.field.resultRaw)
          : undefined;
        const meta = parseFieldMeta(instruction);
        const fieldIndex = fields.length;
        fields.push({
          instruction,
          result,
          ...meta,
        });
        if (meta.kind === 'comment-anchor' && meta.commentId) {
          commentAnchors.push({
            commentId: meta.commentId,
            fieldIndex,
            text: result,
          });
        }
      } else if (group.destination === 'Scrv_fn') {
        const rawValue = readRaw();
        const text = extractFootnoteText(rawValue);
        const tokenValue = encodeScrivenerFootnoteToken(text ?? '');
        const directives = extractInternalScrivenerDirectives(rawValue);
        footnotes.push({
          id: String(footnotes.length + 1),
          token: tokenValue,
          text,
          rawRtf: rawValue,
        });
        if (directives) {
          appendVisible(directives);
        }
        appendVisible(tokenValue, 'footnote-token');
      } else if (group.destination === 'Scrv_annot') {
        const rawValue = readRaw();
        const directives = extractInternalScrivenerDirectives(rawValue);
        annotations.push({
          raw: rawValue,
          text: extractAnnotationText(rawValue),
          color: extractAnnotationColor(rawValue),
          styleRef: extractAnnotationStyleRef(rawValue),
        });
        if (directives) {
          appendVisible(directives);
        }
      } else if (group.destination === 'pict' && shouldExtractEmbeddedImages) {
        const image = parsePict(readRaw(), Math.max(0, paragraphs.length - 1));
        if (image) {
          embeddedImages.push(image);
        }
      } else if (group.destination === 'scrivenerpdf' && shouldExtractEmbeddedPdfs) {
        const pdf = parseEmbeddedPdf(readRaw(), Math.max(0, paragraphs.length - 1), group.pdf?.fileNameRaw);
        if (pdf) {
          embeddedPdfs.push(pdf);
        }
      } else if (group.destination === 'listtext') {
        const marker = extractListMarker(readRaw());
        if (marker) {
          paragraphs[paragraphs.length - 1].list = {
            marker,
            listId: group.listId,
            level: group.level,
          };
        }
      }

      uc = group.uc;
      continue;
    }

    const current = groupStack[groupStack.length - 1];
    if (current?.pending) {
      if (token.type === 'control-symbol' && token.symbol === '*') {
        current.ignoreVisible = true;
        current.sawStar = true;
        continue;
      }
      if (token.type === 'control-word' && DESTINATION_WORDS.has(token.word)) {
        current.destination = token.word;
        current.pending = false;
        if (
          IGNORE_DESTINATIONS.has(token.word)
          || token.word === 'pict'
          || token.word === 'scrivenerpdf'
          || token.word === 'pdffilename'
          || token.word === 'Scrv_annot'
          || token.word === 'Scrv_fn'
          || token.word === 'fldinst'
        ) {
          current.ignoreVisible = true;
        }
        if (token.word === 'field') {
          current.field = {};
        }
        if (token.word === 'scrivenerpdf') {
          current.pdf = {};
        }
        continue;
      }
      current.pending = false;
    }

    if (token.type === 'control-word') {
      if (token.word === 'ls') {
        const next = Number(token.param);
        if (!Number.isNaN(next) && current) {
          current.listId = next;
        }
      }
      if (token.word === 'ilvl') {
        const next = Number(token.param);
        if (!Number.isNaN(next) && current) {
          current.level = next;
        }
      }
      if (token.word === 'uc') {
        const next = Math.max(0, Number(token.param));
        uc = Number.isNaN(next) ? 1 : next;
        if (current) {
          current.uc = uc;
        }
      }
    }

    if (isVisibleSuppressed(groupStack)) {
      continue;
    }

    if (token.type === 'control-word') {
      switch (token.word) {
        case 'page':
          markNextParagraphPageBreak();
          break;
        case 'par':
        case 'line':
          pushParagraphBreak();
          break;
        case 'tab':
          appendVisible('\t');
          break;
        case 'emdash':
          appendVisible('—');
          break;
        case 'endash':
          appendVisible('–');
          break;
        case 'lquote':
          appendVisible('‘');
          break;
        case 'rquote':
          appendVisible('’');
          break;
        case 'ldblquote':
          appendVisible('“');
          break;
        case 'rdblquote':
          appendVisible('”');
          break;
        case 'bullet':
          appendVisible('•');
          break;
        case 'u': {
          const code = Number(token.param);
          if (!Number.isNaN(code)) {
            const normalized = code < 0 ? 0x10000 + code : code;
            try {
              appendVisible(String.fromCodePoint(normalized));
            } catch {
              // ignore invalid codepoints
            }
            skipAscii = uc;
          }
          break;
        }
        default:
          break;
      }
      continue;
    }

    if (token.type === 'control-symbol') {
      switch (token.symbol) {
        case '~':
          appendVisible('\u00A0');
          break;
        case '-':
          appendVisible('—');
          break;
        case '_':
          appendVisible('\u2011');
          break;
        default:
          break;
      }
      continue;
    }

    if (token.type === 'text') {
      let value = stripIgnoredRtfLineBreaks(token.value);
      if (skipAscii > 0) {
        if (value.length <= skipAscii) {
          skipAscii -= value.length;
          continue;
        }
        value = value.slice(skipAscii);
        skipAscii = 0;
      }
      appendVisible(value);
    }
  }

  const normalized = normalizeParagraphs(paragraphs);
  const linkedImages = extractParagraphLinkedImages(normalized.paragraphs);
  return {
    plainText: normalized.plainText.trim(),
    paragraphs: normalized.paragraphs,
    runs: normalized.runs,
    properties,
    fields,
    commentAnchors,
    footnotes,
    annotations,
    linkedImages,
    lists: normalized.lists,
    embeddedImages,
    embeddedPdfs,
  };
}

export function parseRtfModelFromTokens(
  content: string,
  tokens: RtfToken[],
  properties?: ScrivenerRtfProperties,
  options: ParseRtfModelOptions = {},
): ParsedRtfModel {
  const preprocessed = preprocessEmbeddedScrivenerMarkup(content);
  if (preprocessed.content === content) {
    return parsePreprocessedRtfModel(preprocessed, tokens, properties, options);
  }
  return parsePreprocessedRtfModel(preprocessed, tokenizeRtf(preprocessed.content), undefined, options);
}

export function parseRtfModel(content: string, options: ParseRtfModelOptions = {}): ParsedRtfModel {
  const preprocessed = preprocessEmbeddedScrivenerMarkup(content);
  return parsePreprocessedRtfModel(preprocessed, tokenizeRtf(preprocessed.content), undefined, options);
}

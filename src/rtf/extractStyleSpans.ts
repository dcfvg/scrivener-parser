import type { ScrivenerStyleDefinition, ScrivenerStyleSpan } from '../types.js';
import { tokenizeRtf, type RtfToken } from './tokenizeRtf.js';
import {
  createScrivenerAnnotationState,
  encodeScrivenerFootnoteToken,
  filterScrivenerAnnotations,
  replaceEmbeddedScrivenerInlineMarkup,
  SCRIVENER_FOOTNOTE_TOKEN_RE,
} from './parseScrivenerInlineMarkup.js';
import { rtfToText } from './rtfToText.js';
import { parseRtfPropertiesFromTokens } from './properties.js';

const SCRIVENER_STYLE_DIRECTIVE_RE = /<!?\$Scr(?!vFn:)[^>\n]+>/g;

function extractFootnoteInnerText(raw: string): string {
  let inner = String(raw ?? '').trim();
  if (inner.startsWith('{') && inner.endsWith('}')) {
    inner = inner.slice(1, -1);
  }
  inner = inner.replace(/^\s*\\Scrv_fn\s*/i, '');
  inner = inner.replace(/^\s*=\s*/, '');
  inner = inner.replace(/\\end_Scrv_fn[\s\S]*$/m, '');
  const decoded = rtfToText(inner);
  return decoded
    .split('\n')
    .map((line) => line.replace(SCRIVENER_STYLE_DIRECTIVE_RE, ' ').replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

interface ParagraphStyleInfo {
  styleId?: string;
  styleName?: string;
}

interface PlainTextParagraphMeta {
  text: string;
  start: number;
  end: number;
  visibleStart: number;
  visibleEnd: number;
  hasExplicitStyleDirective?: boolean;
  style?: {
    id: string;
    name: string;
  };
}

const SCR_PS_DIRECTIVE_RE = /<(!?)\$Scr_Ps::([^>]+)>/g;
const SCR_PS_DIRECTIVE_PREFIX_RE = /<(!?)\$Scr_Ps::([^>]+)>/y;
const SCR_CS_DIRECTIVE_RE = /<(!?)\$Scr_Cs::([^>]+)>/g;
const SCR_CS_DIRECTIVE_PREFIX_RE = /<(!?)\$Scr_Cs::([^>]+)>/y;
const SCR_KEEP_WITH_NEXT_PREFIX_RE = /<!?\$ScrKeepWithNext>/y;
const SCRIVENER_DIRECTIVE_PREFIX_RE = /<!?\$[^>\n]+>/y;

function getPlaceholderBody(value: string): string {
  if (value.startsWith('<!$') && value.endsWith('>')) {
    return value.slice(3, -1);
  }
  if (value.startsWith('<$') && value.endsWith('>')) {
    return value.slice(2, -1);
  }
  return '';
}

function isInternalScrivenerDirective(value: string): boolean {
  const body = getPlaceholderBody(value);
  return body.startsWith('Scr') && !body.startsWith('ScrvFn:');
}

function buildStyleMap(tokens: RtfToken[]): Map<string, string> {
  const map = new Map<string, string>();
  const properties = parseRtfPropertiesFromTokens(tokens);

  for (const style of properties.stylesheet) {
    const controlWord = style.type === 'character'
      ? 'cs'
      : style.type === 'paragraph'
        ? 's'
        : 'ds';
    map.set(`${controlWord}:${style.index}`, style.name);
  }

  return map;
}

function detectDefaultStyleDefinition(
  definitions?: ScrivenerStyleDefinition[],
): ScrivenerStyleDefinition | undefined {
  if (!definitions?.length) {
    return undefined;
  }

  const named = definitions.find((style) => /\(from default\)/i.test(style.name || ''));
  if (named) {
    return named;
  }

  const common = definitions.find((style) => /^(default|normal|body|paragraph|p)$/i.test(style.name || ''));
  if (common) {
    return common;
  }

  const para = definitions.find((style) => (style.type || '').toLowerCase().includes('para'));
  return para ?? definitions[0];
}

function resolveDefaultParagraphStyle(
  definitions?: ScrivenerStyleDefinition[],
): { id: string; name: string } | undefined {
  const definition = detectDefaultStyleDefinition(definitions);
  const id = String(definition?.id ?? '').trim();
  if (!definition || !id) {
    return undefined;
  }
  return {
    id,
    name: definition.name ?? id,
  };
}

function isLikelyDefaultParagraphStyleReference(value: string | undefined): boolean {
  const normalized = String(value ?? '').trim();
  return /^(0|default|normal|body|paragraph|p)$/i.test(normalized);
}

function parseParagraphStyleIds(tokens: RtfToken[]): string[] {
  const ids: string[] = [];
  let current = '0';
  let inStylesheet = false;
  const annotState = createScrivenerAnnotationState();
  for (const token of tokens) {
    if (token.type === 'control-word' && token.word === 'stylesheet') {
      inStylesheet = true;
      continue;
    }
    if (token.type === 'group-end' && inStylesheet) {
      inStylesheet = false;
      continue;
    }
    if (inStylesheet) continue;
    if (token.type === 'text') {
      filterScrivenerAnnotations(token.value, annotState);
      continue;
    }
    if (token.type === 'control-word') {
      if (token.word === 'Scrv_annot') {
        annotState.depth += 1;
        continue;
      }
      if (token.word === 'end_Scrv_annot') {
        annotState.depth = Math.max(0, annotState.depth - 1);
        continue;
      }
      if (annotState.depth > 0) {
        continue;
      }
      if (token.word === 's' && token.param) {
        current = token.param;
      }
      if (token.word === 'par') {
        ids.push(current);
      }
      continue;
    }
    if (annotState.depth > 0) {
      continue;
    }
  }
  // Ensure trailing paragraph captured
  if (!ids.length || tokens[tokens.length - 1]?.type !== 'control-word') {
    ids.push(current);
  }
  return ids;
}

function paragraphsWithOffsets(text: string): Array<{ start: number; end: number }> {
  const result: Array<{ start: number; end: number }> = [];
  let start = 0;
  for (let i = 0; i <= text.length; i += 1) {
    if (i === text.length || text[i] === '\n') {
      result.push({ start, end: i });
      start = i + 1;
    }
  }
  return result;
}

function trimTrailingWhitespace(value: string): string {
  return String(value ?? '').replace(/\s+$/g, '');
}

function buildNormalizedOffsetMapper(rawText: string): {
  text: string;
  mapOffset: (rawOffset: number) => number;
} {
  if (!rawText) {
    return {
      text: '',
      mapOffset: () => 0,
    };
  }

  const offsets = paragraphsWithOffsets(rawText);
  const paragraphs = rawText.split('\n');
  const entries = paragraphs.map((text, index) => {
    const offset = offsets[index] ?? { start: 0, end: 0 };
    const trimmedText = trimTrailingWhitespace(text);
    return {
      text,
      trimmedText,
      rawStart: offset.start,
      rawEnd: offset.end,
      rawTrimEnd: offset.start + trimmedText.length,
      hadNewline: index < paragraphs.length - 1,
    };
  });

  let first = 0;
  while (first < entries.length && !entries[first]?.trimmedText) {
    first += 1;
  }

  let last = entries.length - 1;
  while (last >= first && !entries[last]?.trimmedText) {
    last -= 1;
  }

  if (first > last) {
    return {
      text: '',
      mapOffset: () => 0,
    };
  }

  const kept: typeof entries = [];
  for (let index = first; index <= last; index += 1) {
    const entry = entries[index];
    const previous = kept[kept.length - 1];
    if (!entry.trimmedText && previous && !previous.trimmedText) {
      continue;
    }
    kept.push(entry);
  }

  const segments: Array<{
    rawStart: number;
    rawEnd: number;
    cleanStart: number;
    cleanEnd: number;
  }> = [];
  let normalized = '';

  kept.forEach((entry, index) => {
    const cleanStart = normalized.length;
    if (entry.rawTrimEnd > entry.rawStart) {
      normalized += entry.trimmedText;
      segments.push({
        rawStart: entry.rawStart,
        rawEnd: entry.rawTrimEnd,
        cleanStart,
        cleanEnd: normalized.length,
      });
    }

    if (index < kept.length - 1) {
      const newlineCleanStart = normalized.length;
      normalized += '\n';
      segments.push({
        rawStart: entry.rawEnd,
        rawEnd: entry.rawEnd + 1,
        cleanStart: newlineCleanStart,
        cleanEnd: normalized.length,
      });
    }
  });

  const mapOffset = (rawOffset: number) => {
    if (rawOffset <= 0) {
      return 0;
    }

    for (const segment of segments) {
      if (rawOffset < segment.rawStart) {
        return segment.cleanStart;
      }
      if (rawOffset <= segment.rawEnd) {
        return segment.cleanStart + Math.min(rawOffset - segment.rawStart, segment.cleanEnd - segment.cleanStart);
      }
    }

    return normalized.length;
  };

  return {
    text: normalized,
    mapOffset,
  };
}

function parseLeadingScrivenerParagraphDirectives(
  text: string,
  styleIds: string[] | undefined,
  definitions: ScrivenerStyleDefinition[] | undefined,
  activeStyle: { id: string; name: string } | undefined,
): {
  cursor: number;
  hasExplicitStyleDirective: boolean;
  style: { id: string; name: string } | undefined;
} {
  let cursor = 0;
  let paragraphStyle = activeStyle;
  let hasExplicitStyleDirective = false;

  while (cursor < text.length) {
    const char = text[cursor];
    if (char === ' ' || char === '\t') {
      cursor += 1;
      continue;
    }

    SCR_KEEP_WITH_NEXT_PREFIX_RE.lastIndex = cursor;
    const keepMatch = SCR_KEEP_WITH_NEXT_PREFIX_RE.exec(text);
    if (keepMatch) {
      cursor = SCR_KEEP_WITH_NEXT_PREFIX_RE.lastIndex;
      continue;
    }

    SCRIVENER_DIRECTIVE_PREFIX_RE.lastIndex = cursor;
    const directiveMatch = SCRIVENER_DIRECTIVE_PREFIX_RE.exec(text);
    if (directiveMatch && isInternalScrivenerDirective(directiveMatch[0])) {
      SCR_PS_DIRECTIVE_PREFIX_RE.lastIndex = cursor;
      const match = SCR_PS_DIRECTIVE_PREFIX_RE.exec(text);
      if (match) {
        hasExplicitStyleDirective = true;
        if (match[1] === '!') {
          paragraphStyle = undefined;
        } else {
          const resolved = resolveScrivenerParagraphStyle(match[2], styleIds, definitions);
          if (resolved) {
            paragraphStyle = resolved;
          }
        }
      }
      cursor = SCRIVENER_DIRECTIVE_PREFIX_RE.lastIndex;
      continue;
    }

    SCR_PS_DIRECTIVE_PREFIX_RE.lastIndex = cursor;
    const match = SCR_PS_DIRECTIVE_PREFIX_RE.exec(text);
    if (!match) {
      break;
    }

    hasExplicitStyleDirective = true;
    if (match[1] === '!') {
      paragraphStyle = undefined;
    } else {
      const resolved = resolveScrivenerParagraphStyle(match[2], styleIds, definitions);
      if (resolved) {
        paragraphStyle = resolved;
      }
    }
    cursor = SCR_PS_DIRECTIVE_PREFIX_RE.lastIndex;
  }

  return {
    cursor,
    hasExplicitStyleDirective,
    style: paragraphStyle,
  };
}

function buildPlainTextParagraphMeta(
  plainText: string,
  styleIds: string[] | undefined,
  definitions?: ScrivenerStyleDefinition[],
): PlainTextParagraphMeta[] {
  if (!plainText) {
    return [];
  }

  const offsets = paragraphsWithOffsets(plainText);
  const paragraphs = plainText.split('\n');
  const result: PlainTextParagraphMeta[] = [];
  let activeStyle: { id: string; name: string } | undefined;

  for (let index = 0; index < Math.min(paragraphs.length, offsets.length); index += 1) {
    const text = paragraphs[index] ?? '';
    const { start, end } = offsets[index];
    const parsed = parseLeadingScrivenerParagraphDirectives(text, styleIds, definitions, activeStyle);
    activeStyle = parsed.style;
    result.push({
      text,
      start,
      end,
      visibleStart: Math.min(start + parsed.cursor, end),
      visibleEnd: end,
      hasExplicitStyleDirective: parsed.hasExplicitStyleDirective,
      style: parsed.style,
    });
  }

  return result;
}

function resolveScrivenerStyleReference(
  value: string,
  styleIds: string[] | undefined,
  definitions?: ScrivenerStyleDefinition[],
): { id: string; name: string } | undefined {
  const index = Number.parseInt(value, 10);
  if (!Number.isFinite(index)) {
    return undefined;
  }

  const styleId = styleIds?.[index];
  if (!styleId) {
    return {
      id: value,
      name: value,
    };
  }

  const definition = definitions?.find((item) => String(item.id ?? '') === styleId);
  return {
    id: styleId,
    name: definition?.name ?? styleId,
  };
}

function resolveScrivenerParagraphStyle(
  value: string,
  styleIds: string[] | undefined,
  definitions?: ScrivenerStyleDefinition[],
): { id: string; name: string } | undefined {
  return resolveScrivenerStyleReference(value, styleIds, definitions);
}

function resolveScrivenerCharacterStyle(
  value: string,
  styleIds: string[] | undefined,
  definitions?: ScrivenerStyleDefinition[],
): { id: string; name: string } | undefined {
  return resolveScrivenerStyleReference(value, styleIds, definitions);
}

function resolveParagraphStyleSpans(
  baseSpans: ScrivenerStyleSpan[],
  paragraphMeta: PlainTextParagraphMeta[],
): ScrivenerStyleSpan[] {
  if (!paragraphMeta.length) {
    return baseSpans;
  }

  const spans: ScrivenerStyleSpan[] = [];
  for (const paragraph of paragraphMeta) {
    if (paragraph.visibleEnd <= paragraph.visibleStart) {
      continue;
    }

    if (paragraph.style) {
      spans.push({
        id: paragraph.style.id,
        name: paragraph.style.name,
        kind: 'paragraph',
        start: paragraph.visibleStart,
        end: paragraph.visibleEnd,
      });
      continue;
    }


    const fallback = baseSpans.find((span) => (
      span.end > paragraph.visibleStart
      && span.start < paragraph.visibleEnd
    ));
    if (!fallback) {
      continue;
    }

    spans.push({
      ...fallback,
      start: paragraph.visibleStart,
      end: paragraph.visibleEnd,
    });
  }

  return spans.sort((left, right) => left.start - right.start || left.end - right.end);
}

function parseScrivenerCharacterDirectiveSpans(
  plainText: string,
  styleIds: string[] | undefined,
  definitions?: ScrivenerStyleDefinition[],
): ScrivenerStyleSpan[] {
  if (!plainText) {
    return [];
  }

  const spans: ScrivenerStyleSpan[] = [];
  const styleStack: Array<{ id: string; name: string }> = [];
  let currentStart: number | undefined;
  let cursor = 0;

  const flush = (end: number) => {
    const active = styleStack[styleStack.length - 1];
    if (!active || currentStart === undefined || end <= currentStart) {
      currentStart = undefined;
      return;
    }
    spans.push({
      id: active.id,
      name: active.name,
      kind: 'character',
      start: currentStart,
      end,
    });
    currentStart = undefined;
  };

  while (cursor < plainText.length) {
    SCRIVENER_DIRECTIVE_PREFIX_RE.lastIndex = cursor;
    const directiveMatch = SCRIVENER_DIRECTIVE_PREFIX_RE.exec(plainText);
    if (directiveMatch && directiveMatch.index === cursor && isInternalScrivenerDirective(directiveMatch[0])) {
      flush(cursor);

      SCR_CS_DIRECTIVE_PREFIX_RE.lastIndex = cursor;
      const charMatch = SCR_CS_DIRECTIVE_PREFIX_RE.exec(plainText);
      if (charMatch && charMatch.index === cursor) {
        if (charMatch[1] === '!') {
          if (styleStack.length) {
            styleStack.pop();
          }
        } else {
          const resolved = resolveScrivenerCharacterStyle(charMatch[2], styleIds, definitions);
          if (resolved) {
            styleStack.push(resolved);
          }
        }
      }

      cursor = SCRIVENER_DIRECTIVE_PREFIX_RE.lastIndex;
      continue;
    }

    if (styleStack.length && currentStart === undefined) {
      currentStart = cursor;
    }
    cursor += 1;
  }

  flush(cursor);
  return spans;
}


function mergeParagraphSpans(
  baseSpans: ScrivenerStyleSpan[],
  scrivenerSpans: ScrivenerStyleSpan[],
): ScrivenerStyleSpan[] {
  if (!scrivenerSpans.length) {
    return baseSpans;
  }

  const byRange = new Map(
    baseSpans.map((span) => [`${span.start}:${span.end}`, span] as const),
  );
  for (const span of scrivenerSpans) {
    byRange.set(`${span.start}:${span.end}`, span);
  }
  return [...byRange.values()].sort((left, right) => left.start - right.start);
}

function emitText(
  value: string,
  pos: { index: number },
  current: string | undefined,
  spans: ScrivenerStyleSpan[],
  kind: 'character',
  nameMap?: Map<string, string>,
  styleMap?: Map<string, string>,
) {
  if (!value) return;
  const start = pos.index;
  pos.index += value.length;
  if (!current) return;
  const last = spans[spans.length - 1];
  const resolved = nameMap?.get(current) ?? styleMap?.get(`cs:${current}`) ?? current;
  if (last && last.kind === 'character' && last.id === resolved && last.end === start) {
    last.end = pos.index;
    return;
  }
  spans.push({
    id: resolved,
    name: current,
    kind: 'character',
    start,
    end: pos.index,
  });
}

function controlWordToText(word: string): string | undefined {
  switch (word) {
    case 'par':
    case 'line':
      return '\n';
    case 'tab':
      return '\t';
    case 'emdash':
      return '—';
    case 'endash':
      return '–';
    case 'lquote':
      return '‘';
    case 'rquote':
      return '’';
    case 'ldblquote':
      return '“';
    case 'rdblquote':
      return '”';
    case 'bullet':
      return '•';
    default:
      return undefined;
  }
}

function controlSymbolToText(symbol: string): string | undefined {
  switch (symbol) {
    case '~':
      return '\u00A0';
    case '-':
      return '—';
    case '_':
      return '\u2011';
    default:
      return undefined;
  }
}

function stripIgnoredRtfLineBreaks(value: string): string {
  return String(value ?? '').replace(/[\r\n]+/g, '');
}

type DirectCharacterFormatPart = 'bold' | 'italic' | 'underline';

const DIRECT_CHARACTER_FORMAT_ORDER: Array<[DirectCharacterFormatPart, (state: {
  directBold: boolean;
  directItalic: boolean;
  directUnderline: boolean;
}) => boolean]> = [
  ['bold', (state) => state.directBold],
  ['italic', (state) => state.directItalic],
  ['underline', (state) => state.directUnderline],
];

function buildDirectRtfCharacterStyleName(state: {
  directBold: boolean;
  directItalic: boolean;
  directUnderline: boolean;
}): string | undefined {
  const parts = DIRECT_CHARACTER_FORMAT_ORDER
    .filter(([, isEnabled]) => isEnabled(state))
    .map(([part]) => part);
  return parts.length ? `rtf-${parts.join('-')}` : undefined;
}

const UNDERLINE_ON_CONTROL_WORDS = new Set([
  'ul',
  'uld',
  'uldash',
  'uldashd',
  'uldashdd',
  'uldb',
  'ulhair',
  'ulhwave',
  'ulldash',
  'ulstyle',
  'ulth',
  'ulthd',
  'ulthdash',
  'ulthdashd',
  'ulthdashdd',
  'ulthldash',
  'ululdbwave',
  'ulw',
  'ulwave',
]);

function resolveUnderlineControlWord(word: string, param?: string): boolean | undefined {
  if (word === 'ulnone') {
    return false;
  }
  if (word === 'ulc') {
    return undefined;
  }
  if (UNDERLINE_ON_CONTROL_WORDS.has(word)) {
    return param !== '0';
  }
  return undefined;
}

function resolveCharacterSpan(
  current: string | undefined,
  directItalic: boolean,
  directBold: boolean,
  directUnderline: boolean,
  nameMap?: Map<string, string>,
  idByName?: Map<string, string>,
  styleMap?: Map<string, string>,
): { id?: string; name?: string } {
  if (current) {
    const rtfStyleName = styleMap?.get(`cs:${current}`);
    const definitionName = nameMap?.get(current);
    const resolvedName = rtfStyleName ?? definitionName ?? current;
    return {
      id: (rtfStyleName ? idByName?.get(rtfStyleName) : undefined) ?? rtfStyleName ?? current,
      name: resolvedName,
    };
  }
  const name = buildDirectRtfCharacterStyleName({
    directBold,
    directItalic,
    directUnderline,
  });
  if (name) {
    return { id: name, name };
  }
  return {};
}

const CHARACTER_SPAN_IGNORE_DESTINATIONS = new Set([
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
  'pict',
  'fldinst',
  'Scrv_annot',
  'Scrv_fn',
]);

const CHARACTER_SPAN_DESTINATION_WORDS = new Set([
  ...CHARACTER_SPAN_IGNORE_DESTINATIONS,
  'field',
  'fldrslt',
  'listtext',
]);

function parseCharacterStyleSpans(
  tokens: RtfToken[],
  styleMap: Map<string, string>,
  plainText: string | undefined,
  definitions?: ScrivenerStyleDefinition[],
): ScrivenerStyleSpan[] {
  const spans: ScrivenerStyleSpan[] = [];
  const nameMap = new Map((definitions ?? []).map((def) => [String(def.id ?? def.name ?? ''), def.name ?? String(def.id ?? '')]));
  const idByName = new Map(
    (definitions ?? [])
      .filter((def) => def.name && def.id !== undefined && def.id !== null && def.id !== '')
      .map((def) => [String(def.name), String(def.id)] as const),
  );
  let currentCharStyle: string | undefined;
  const groupStateStack: Array<{
    currentCharStyle: string | undefined;
    directItalic: boolean;
    directBold: boolean;
    directUnderline: boolean;
    uc: number;
    skipAscii: number;
    ignore: boolean;
    pending: boolean;
    destination?: string;
  }> = [];
  const pos = { index: 0 };
  let uc = 1; // number of ASCII chars to skip after \uN
  let skipAscii = 0;
  let directItalic = false;
  let directBold = false;
  let directUnderline = false;
  const annotState = createScrivenerAnnotationState();
  let rawText = '';

  const emitCharacterText = (value: string, current: string | undefined) => {
    if (!value) return;
    const start = pos.index;
    rawText += value;
    pos.index += value.length;
    const resolved = resolveCharacterSpan(
      current,
      directItalic,
      directBold,
      directUnderline,
      nameMap,
      idByName,
      styleMap,
    );
    if (!resolved.id) return;
    const last = spans[spans.length - 1];
    if (last && last.kind === 'character' && last.id === resolved.id && last.end === start) {
      last.end = pos.index;
      return;
    }
    spans.push({
      id: resolved.id,
      name: resolved.name,
      kind: 'character',
      start,
      end: pos.index,
    });
  };

  for (const token of tokens) {
    if (token.type === 'group-start') {
      const parent = groupStateStack[groupStateStack.length - 1];
      groupStateStack.push({
        currentCharStyle,
        directItalic,
        directBold,
        directUnderline,
        uc,
        skipAscii,
        ignore: parent?.ignore ?? false,
        pending: true,
        destination: undefined,
      });
      continue;
    }
    if (token.type === 'group-end') {
      const previous = groupStateStack.pop();
      if (previous) {
        currentCharStyle = previous.currentCharStyle;
        directItalic = previous.directItalic;
        directBold = previous.directBold;
        directUnderline = previous.directUnderline;
        uc = previous.uc;
        skipAscii = previous.skipAscii;
      }
      continue;
    }

    const currentGroup = groupStateStack[groupStateStack.length - 1];
    if (currentGroup?.pending) {
      if (token.type === 'control-symbol' && token.symbol === '*') {
        currentGroup.ignore = true;
        currentGroup.pending = false;
        continue;
      }
      if (token.type === 'control-word' && CHARACTER_SPAN_DESTINATION_WORDS.has(token.word)) {
        currentGroup.destination = token.word;
        currentGroup.pending = false;
        if (CHARACTER_SPAN_IGNORE_DESTINATIONS.has(token.word)) {
          currentGroup.ignore = true;
        }
        continue;
      }
      currentGroup.pending = false;
    }

    if (groupStateStack.some((group) => group.ignore || group.destination === 'pict' || group.destination === 'fldinst')) {
      continue;
    }

    if (token.type === 'control-word') {
      if (token.word === 'plain') {
        currentCharStyle = undefined;
        directItalic = false;
        directBold = false;
        directUnderline = false;
        continue;
      }
      if (token.word === 'cs' && token.param) {
        currentCharStyle = token.param;
        continue;
      }
      if (token.word === 'i') {
        directItalic = token.param !== '0';
        continue;
      }
      if (token.word === 'b') {
        directBold = token.param !== '0';
        continue;
      }
      const underlineState = resolveUnderlineControlWord(token.word, token.param);
      if (underlineState !== undefined) {
        directUnderline = underlineState;
        continue;
      }
      if (token.word === 'uc' && token.param !== undefined) {
        const next = Number(token.param);
        uc = Number.isNaN(next) ? 1 : Math.max(0, next);
        continue;
      }
      if (token.word === 'u' && token.param !== undefined) {
        let code = Number(token.param);
        if (Number.isNaN(code)) {
          code = 0;
        }
        const normalized = code < 0 ? 0x10000 + code : code;
        emitText(
          '',
          pos,
          undefined,
          spans,
          'character',
          nameMap,
          styleMap,
        );
        emitCharacterText(String.fromCodePoint(normalized), currentCharStyle);
        // Skip upcoming ASCII fallback chars (handled on text tokens)
        skipAscii = uc;
        continue;
      }
      const text = controlWordToText(token.word);
      if (text !== undefined) {
        emitCharacterText(text, currentCharStyle);
      }
      continue;
    }
    if (token.type === 'control-symbol') {
      const text = controlSymbolToText(token.symbol);
      if (text !== undefined) {
        emitCharacterText(text, currentCharStyle);
      }
      continue;
    }
    if (token.type === 'text') {
      const filtered = stripIgnoredRtfLineBreaks(filterScrivenerAnnotations(token.value, annotState));
      if (!filtered) {
        continue;
      }
      let value = filtered;
      if (skipAscii > 0) {
        if (value.length <= skipAscii) {
          skipAscii -= value.length;
          continue;
        }
        value = value.slice(skipAscii);
        skipAscii = 0;
      }

      let cursor = 0;
      let match: RegExpExecArray | null;
      SCRIVENER_FOOTNOTE_TOKEN_RE.lastIndex = 0;
      while ((match = SCRIVENER_FOOTNOTE_TOKEN_RE.exec(value)) !== null) {
        if (match.index > cursor) {
          emitCharacterText(value.slice(cursor, match.index), currentCharStyle);
        }
        emitCharacterText(match[0], undefined);
        cursor = match.index + match[0].length;
      }
      if (cursor < value.length) {
        emitCharacterText(value.slice(cursor), currentCharStyle);
      }
    }
  }

  const { text: normalizedText, mapOffset } = buildNormalizedOffsetMapper(rawText);
  const targetLength = plainText?.length ?? normalizedText.length;

  return spans
    .map((span) => ({
      ...span,
      start: Math.min(mapOffset(span.start), targetLength),
      end: Math.min(mapOffset(span.end), targetLength),
    }))
    .filter((span) => span.end > span.start);
}

export function extractStyleSpans(
  rtf: string,
  plainText: string | undefined,
  definitions?: ScrivenerStyleDefinition[],
  styleIds?: string[],
): ScrivenerStyleSpan[] {
  if (!rtf || !plainText) return [];

  const normalizedRtf = replaceEmbeddedScrivenerInlineMarkup(rtf, (match) => {
    if (match.kind === 'Scrv_fn') {
      return `${match.directives}${encodeScrivenerFootnoteToken(extractFootnoteInnerText(match.normalizedRaw))}`;
    }
    return match.directives;
  });
  const tokens = tokenizeRtf(normalizedRtf);
  const styleMap = buildStyleMap(tokens);
  const paraIds = parseParagraphStyleIds(tokens);
  const paragraphMeta = buildPlainTextParagraphMeta(plainText, styleIds, definitions);
  const resolvedDefs = new Map((definitions ?? []).map((def) => [def.name ?? '', def.id]));
  const defaultParagraphStyle = resolveDefaultParagraphStyle(definitions);

  const rtfParagraphSpans: ScrivenerStyleSpan[] = [];
  const count = Math.min(paraIds.length, paragraphMeta.length);
  for (let i = 0; i < count; i += 1) {
    const id = paraIds[i];
    const name = styleMap.get(`s:${id}`) ?? styleMap.get(id);
    const paragraph = paragraphMeta[i];
    if (!paragraph || paragraph.visibleEnd <= paragraph.visibleStart) {
      continue;
    }
    const resolvedId = name && resolvedDefs.has(name) ? resolvedDefs.get(name) : name ?? id;
    const resolvedName = name ?? id;
    const paragraphStyle = (
      (isLikelyDefaultParagraphStyleReference(String(resolvedId ?? ''))
        || isLikelyDefaultParagraphStyleReference(resolvedName))
      && defaultParagraphStyle
    )
      ? defaultParagraphStyle
      : {
          id: String(resolvedId ?? ''),
          name: resolvedName,
        };
    rtfParagraphSpans.push({
      id: paragraphStyle.id,
      name: paragraphStyle.name,
      kind: 'paragraph',
      start: paragraph.visibleStart,
      end: paragraph.visibleEnd,
    });
  }

  const spans: ScrivenerStyleSpan[] = resolveParagraphStyleSpans(
    rtfParagraphSpans,
    paragraphMeta,
  );

  const characterSpans = [
    ...parseCharacterStyleSpans(
      tokens,
      styleMap,
      plainText,
      definitions,
    ),
    ...parseScrivenerCharacterDirectiveSpans(
      plainText,
      styleIds,
      definitions,
    ),
  ].sort((left, right) => left.start - right.start || left.end - right.end);

  spans.push(...characterSpans);

  return spans;
}

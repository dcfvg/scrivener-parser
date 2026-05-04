export type ScrivenerInlineMarkupKind = 'Scrv_annot' | 'Scrv_fn';

export interface ScrivenerInlineMarkupMatch {
  kind: ScrivenerInlineMarkupKind;
  start: number;
  end: number;
  raw: string;
  normalizedRaw: string;
  directives: string;
}

export interface ScrivenerAnnotationState {
  depth: number;
}

const ANNOTATION_START_WITH_BRACE = '{\\Scrv_annot';
const ANNOTATION_START = '\\Scrv_annot';
const ANNOTATION_END = '\\end_Scrv_annot';
const EMBEDDED_INLINE_OPEN_RE = /^(\\)?\{\s*\\+(Scrv_annot|Scrv_fn)(?:=|\b)/;
const END_MARKERS: Record<ScrivenerInlineMarkupKind, string> = {
  Scrv_annot: '\\end_Scrv_annot',
  Scrv_fn: '\\end_Scrv_fn',
};
const INTERNAL_SCRIVENER_DIRECTIVE_RE = /<!?\$Scr(?!vFn:)[^>\n]+>/g;
export const SCRIVENER_FOOTNOTE_TOKEN_RE = /<\$ScrvFn:[^>\n]+>/g;

export function createScrivenerAnnotationState(): ScrivenerAnnotationState {
  return { depth: 0 };
}

export function encodeScrivenerFootnoteToken(text: string): string {
  return `<$ScrvFn:${encodeURIComponent(String(text ?? '').trim())}>`;
}

export function normalizeEmbeddedScrivenerBlock(raw: string): string {
  return String(raw ?? '')
    .replace(/\\\\/g, '\\')
    .replace(/\\([{}])/g, '$1');
}

export function extractInternalScrivenerDirectives(raw: string): string {
  return String(raw ?? '').match(INTERNAL_SCRIVENER_DIRECTIVE_RE)?.join('') || '';
}

function isInlineMarkupWhitespace(value: string | undefined): boolean {
  return value === ' ' || value === '\t' || value === '\n' || value === '\r';
}

function findNextEmbeddedScrivenerInlineMarkup(
  content: string,
  offset: number,
): ScrivenerInlineMarkupMatch | undefined {
  for (let index = offset; index < content.length; index += 1) {
    const char = content[index];
    if (char !== '{' && !(char === '\\' && content[index + 1] === '{')) {
      continue;
    }

    const openMatch = EMBEDDED_INLINE_OPEN_RE.exec(content.slice(index));
    if (!openMatch) {
      continue;
    }

    const kind = openMatch[2] as ScrivenerInlineMarkupKind;
    const endMarker = END_MARKERS[kind];
    let searchFrom = index + openMatch[0].length;

    while (searchFrom < content.length) {
      const markerIndex = content.indexOf(endMarker, searchFrom);
      if (markerIndex === -1) {
        break;
      }

      let end = markerIndex + endMarker.length;
      while (isInlineMarkupWhitespace(content[end])) {
        end += 1;
      }

      if (content[end] === '\\' && content[end + 1] === '}') {
        end += 2;
      } else if (content[end] === '}') {
        end += 1;
      } else {
        searchFrom = markerIndex + endMarker.length;
        continue;
      }

      const raw = content.slice(index, end);
      const normalizedRaw = normalizeEmbeddedScrivenerBlock(raw);
      return {
        kind,
        start: index,
        end,
        raw,
        normalizedRaw,
        directives: extractInternalScrivenerDirectives(normalizedRaw),
      };
    }
  }

  return undefined;
}

export function collectEmbeddedScrivenerInlineMarkup(content: string): ScrivenerInlineMarkupMatch[] {
  const matches: ScrivenerInlineMarkupMatch[] = [];
  let cursor = 0;
  while (cursor < content.length) {
    const match = findNextEmbeddedScrivenerInlineMarkup(content, cursor);
    if (!match) {
      break;
    }
    matches.push(match);
    cursor = match.end;
  }
  return matches;
}

export function replaceEmbeddedScrivenerInlineMarkup(
  content: string,
  replaceMatch: (match: ScrivenerInlineMarkupMatch) => string,
): string {
  if (!content) {
    return '';
  }

  let result = '';
  let cursor = 0;
  while (cursor < content.length) {
    const match = findNextEmbeddedScrivenerInlineMarkup(content, cursor);
    if (!match) {
      result += content.slice(cursor);
      break;
    }
    result += content.slice(cursor, match.start);
    result += replaceMatch(match);
    cursor = match.end;
  }
  return result;
}

export function filterScrivenerAnnotations(
  text: string,
  state: ScrivenerAnnotationState,
): string {
  if (!text) return '';
  let result = '';
  let i = 0;
  while (i < text.length) {
    if (text.startsWith(ANNOTATION_START_WITH_BRACE, i)) {
      state.depth += 1;
      i += ANNOTATION_START_WITH_BRACE.length;
      continue;
    }
    if (text.startsWith(ANNOTATION_START, i)) {
      state.depth += 1;
      i += ANNOTATION_START.length;
      continue;
    }
    if (text.startsWith(ANNOTATION_END, i)) {
      if (state.depth > 0) {
        state.depth -= 1;
      }
      i += ANNOTATION_END.length;
      while (text[i] === '}') {
        i += 1;
      }
      continue;
    }
    if (state.depth === 0) {
      result += text[i];
    }
    i += 1;
  }
  return result;
}

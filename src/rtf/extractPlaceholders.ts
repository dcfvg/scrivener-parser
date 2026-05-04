import type { ScrivenerPlaceholder } from '../types.js';
import { rtfToText } from './rtfToText.js';

function countPrecedingBackslashes(text: string, index: number): number {
  let count = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
    count += 1;
  }
  return count;
}

function isEscapedPlaceholderStart(text: string, index: number): boolean {
  return countPrecedingBackslashes(text, index) % 2 === 1;
}

function readPlaceholderAt(text: string, start: number): { value: string; end: number } | null {
  if (!text.startsWith('<$', start) || isEscapedPlaceholderStart(text, start)) {
    return null;
  }

  let depth = 1;
  let cursor = start + 2;
  while (cursor < text.length) {
    const char = text[cursor];
    if (char === '\n' || char === '\r') {
      return null;
    }
    if (text.startsWith('<$', cursor) && !isEscapedPlaceholderStart(text, cursor)) {
      depth += 1;
      cursor += 2;
      continue;
    }
    if (char === '>' && countPrecedingBackslashes(text, cursor) % 2 === 0) {
      depth -= 1;
      cursor += 1;
      if (depth === 0) {
        return {
          value: text.slice(start, cursor),
          end: cursor,
        };
      }
      continue;
    }
    cursor += 1;
  }

  return null;
}

export function getPlaceholderBody(value: string): string {
  const raw = String(value ?? '');
  if (raw.startsWith('<!$') && raw.endsWith('>')) {
    return raw.slice(3, -1);
  }
  if (raw.startsWith('<$') && raw.endsWith('>')) {
    return raw.slice(2, -1);
  }
  return '';
}

export function isInternalScrivenerPlaceholder(value: string): boolean {
  const body = getPlaceholderBody(value);
  return (
    body.startsWith('Scr')
  );
}

export function isCompilePlaceholderValue(value: string): boolean {
  return Boolean(value) && !isInternalScrivenerPlaceholder(value);
}

function findPlaceholders(text: string, source: ScrivenerPlaceholder['source']): ScrivenerPlaceholder[] {
  const matches: ScrivenerPlaceholder[] = [];

  for (let index = 0; index < text.length; index += 1) {
    const match = readPlaceholderAt(text, index);
    if (!match) {
      continue;
    }
    matches.push({
      value: match.value,
      start: index,
      end: match.end,
      source,
    });
    index = match.end - 1;
  }

  return matches;
}

/**
 * Extract compile placeholders <$...> from plain text or directly from RTF.
 * Handles escaped placeholders like \<$date> and nested placeholders such as
 * <$n:figure:<$parentposition>>.
 * If plainText is not provided, falls back to rtfToText to avoid duplicate parsing.
 */
export function extractPlaceholders(
  rtf: string,
  source: ScrivenerPlaceholder['source'],
  plainText?: string,
): ScrivenerPlaceholder[] {
  const text = plainText ?? rtfToText(rtf);
  if (!text) return [];
  return findPlaceholders(text, source).filter((placeholder) => (
    isCompilePlaceholderValue(placeholder.value)
  ));
}

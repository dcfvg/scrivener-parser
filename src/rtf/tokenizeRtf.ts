import { decodeWindows1252Byte } from '../utils/encoding.js';

function isAlpha(char: string): boolean {
  return /[a-zA-Z]/.test(char);
}

function isControlWordChar(char: string): boolean {
  return /[a-zA-Z_]/.test(char);
}

function isDigit(char: string): boolean {
  return /[0-9]/.test(char);
}

export type RtfToken =
  | { type: 'group-start'; start: number; end: number }
  | { type: 'group-end'; start: number; end: number }
  | { type: 'text'; value: string; start: number; end: number }
  | { type: 'control-symbol'; symbol: string; start: number; end: number }
  | { type: 'control-word'; word: string; param?: string; hasParam: boolean; hasSpace: boolean; start: number; end: number };

/**
 * Tokeniseur RTF minimal qui distingue groupes, mots de contrôle et texte.
 * Suffisant pour des passes d'extraction (placeholders, styles) sans interpréter tout le format.
 */
export function tokenizeRtf(content: string): RtfToken[] {
  const tokens: RtfToken[] = [];
  let buffer = '';

  const flushText = () => {
    if (buffer) {
      const end = lastBufferedIndex + 1;
      tokens.push({ type: 'text', value: buffer, start: bufferStart, end });
      buffer = '';
    }
  };
  let bufferStart = 0;
  let lastBufferedIndex = -1;

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    if (char === '{') {
      flushText();
      tokens.push({ type: 'group-start', start: i, end: i + 1 });
      continue;
    }
    if (char === '}') {
      flushText();
      tokens.push({ type: 'group-end', start: i, end: i + 1 });
      continue;
    }
    if (char !== '\\') {
      if (!buffer) {
        bufferStart = i;
      }
      buffer += char;
      lastBufferedIndex = i;
      continue;
    }

    const next = content[i + 1];
    if (next === undefined) {
      break;
    }

    // Escaped chars
    if (next === '\\' || next === '{' || next === '}') {
      if (!buffer) {
        bufferStart = i;
      }
      buffer += next;
      lastBufferedIndex = i + 1;
      i += 1;
      continue;
    }

    // Scrivener often serializes paragraph breaks as a bare "\" followed by a line ending.
    // Treat that sequence as a paragraph control instead of dropping it as formatting noise.
    if (next === '\n' || next === '\r') {
      flushText();
      let end = i + 2;
      if (next === '\r' && content[i + 2] === '\n') {
        end += 1;
      }
      tokens.push({
        type: 'control-word',
        word: 'par',
        hasParam: false,
        hasSpace: false,
        start: i,
        end,
      });
      i = end - 1;
      continue;
    }

    // Hex-encoded char \'<hex>
    if (next === "'") {
      const hex = content.slice(i + 2, i + 4);
      if (/^[0-9a-fA-F]{2}$/.test(hex)) {
        if (!buffer) {
          bufferStart = i;
        }
        buffer += decodeWindows1252Byte(parseInt(hex, 16));
        lastBufferedIndex = i + 3;
        i += 3;
      }
      continue;
    }

    // Control symbol (single char)
    if (!isAlpha(next)) {
      flushText();
      tokens.push({ type: 'control-symbol', symbol: next, start: i, end: i + 2 });
      i += 1;
      continue;
    }

    // Control word
    flushText();
    let word = next;
    let j = i + 2;
    while (j < content.length && isControlWordChar(content[j])) {
      word += content[j];
      j += 1;
    }

    let param = '';
    if (content[j] === '-' || isDigit(content[j])) {
      param += content[j];
      j += 1;
      while (j < content.length && isDigit(content[j])) {
        param += content[j];
        j += 1;
      }
    }
    const hasSpace = content[j] === ' ';
    tokens.push({
      type: 'control-word',
      word,
      param: param || undefined,
      hasParam: param.length > 0,
      hasSpace,
      start: i,
      end: j + (hasSpace ? 1 : 0),
    });

    i = j + (hasSpace ? 1 : 0) - 1;
  }

  flushText();
  return tokens;
}

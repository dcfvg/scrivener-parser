import { decodeWindows1252Byte } from '../utils/encoding.js';
import type { RtfToken } from './tokenizeRtf.js';
import {
  DEFAULT_RTF_CODE_PAGE,
  parseRtfPropertiesFromBytes,
  type RtfProperties,
} from './properties.js';

export interface ByteTokenizedRtf {
  rtf: string;
  tokens: RtfToken[];
  properties: RtfProperties;
}

type SyntaxTokenInput =
  | { type: 'group-start' }
  | { type: 'group-end' }
  | { type: 'control-symbol'; symbol: string }
  | { type: 'control-word'; word: string; param?: string; hasParam: boolean; hasSpace: boolean };

const CODE_PAGE_LABELS: Record<number, string> = {
  874: 'windows-874',
  932: 'shift_jis',
  936: 'gbk',
  949: 'euc-kr',
  950: 'big5',
  1200: 'utf-16le',
  1250: 'windows-1250',
  1251: 'windows-1251',
  1252: 'windows-1252',
  1253: 'windows-1253',
  1254: 'windows-1254',
  1255: 'windows-1255',
  1256: 'windows-1256',
  1257: 'windows-1257',
  1258: 'windows-1258',
  65001: 'utf-8',
};

function isAlphaByte(byte: number | undefined): boolean {
  return byte !== undefined && ((byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a));
}

function isControlWordByte(byte: number | undefined): boolean {
  return isAlphaByte(byte) || byte === 0x5f;
}

function isDigitByte(byte: number | undefined): boolean {
  return byte !== undefined && byte >= 0x30 && byte <= 0x39;
}

function isHexByte(byte: number | undefined): boolean {
  return (
    byte !== undefined
    && ((byte >= 0x30 && byte <= 0x39)
      || (byte >= 0x41 && byte <= 0x46)
      || (byte >= 0x61 && byte <= 0x66))
  );
}

function isDbcsLeadByte(codePage: number, byte: number | undefined): boolean {
  if (byte === undefined) {
    return false;
  }
  switch (codePage) {
    case 932:
      return (byte >= 0x81 && byte <= 0x9f) || (byte >= 0xe0 && byte <= 0xfc);
    case 936:
    case 949:
    case 950:
      return byte >= 0x81 && byte <= 0xfe;
    default:
      return false;
  }
}

function isDbcsTrailByte(codePage: number, byte: number | undefined): boolean {
  if (byte === undefined) {
    return false;
  }
  switch (codePage) {
    case 932:
      return (byte >= 0x40 && byte <= 0x7e) || (byte >= 0x80 && byte <= 0xfc);
    case 936:
    case 949:
    case 950:
      return byte >= 0x40 && byte <= 0xfe && byte !== 0x7f;
    default:
      return false;
  }
}

function hexValue(byte: number): number {
  if (byte >= 0x30 && byte <= 0x39) {
    return byte - 0x30;
  }
  if (byte >= 0x41 && byte <= 0x46) {
    return byte - 0x41 + 10;
  }
  return byte - 0x61 + 10;
}

function ascii(byte: number): string {
  return String.fromCharCode(byte);
}

function bytesToAscii(bytes: Uint8Array, start: number, end: number): string {
  let result = '';
  for (let index = start; index < end; index += 1) {
    result += ascii(bytes[index]);
  }
  return result;
}

function bytesToHex(bytes: Uint8Array, start: number, end: number): string {
  let result = '';
  for (let index = start; index < end; index += 1) {
    result += bytes[index].toString(16).padStart(2, '0').toUpperCase();
  }
  return result;
}

function parseInteger(value: string | undefined): number | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function needsControlBoundary(byte: number | undefined): boolean {
  return byte === 0x20 || isDigitByte(byte);
}

function skipUnicodeFallback(bytes: Uint8Array, start: number, count: number, codePage: number): number {
  let index = start;
  let remaining = Math.max(0, count);
  while (index < bytes.length && remaining > 0) {
    const byte = bytes[index];
    if (byte === 0x5c) {
      const next = bytes[index + 1];
      if (next === 0x27 && isHexByte(bytes[index + 2]) && isHexByte(bytes[index + 3])) {
        index += 4;
        remaining -= 1;
        continue;
      }
      if (next === 0x5c || next === 0x7b || next === 0x7d) {
        index += 2;
        remaining -= 1;
        continue;
      }
      if (next !== undefined && !isAlphaByte(next)) {
        index += 2;
        remaining -= 1;
        continue;
      }
      break;
    }
    if (isDbcsLeadByte(codePage, byte) && isDbcsTrailByte(codePage, bytes[index + 1])) {
      index += 2;
      remaining = Math.max(0, remaining - 2);
      continue;
    }
    index += 1;
    remaining -= 1;
  }
  return index;
}

export function rtfEncodingLabelForCodePage(codePage: number | undefined): string {
  return CODE_PAGE_LABELS[codePage ?? DEFAULT_RTF_CODE_PAGE] ?? `windows-${codePage}`;
}

export function decodeRtfTextBytes(bytes: Uint8Array, codePage = DEFAULT_RTF_CODE_PAGE): string {
  if (!bytes.length) {
    return '';
  }
  const labels = [
    rtfEncodingLabelForCodePage(codePage),
    codePage === DEFAULT_RTF_CODE_PAGE ? undefined : rtfEncodingLabelForCodePage(DEFAULT_RTF_CODE_PAGE),
  ].filter((label): label is string => Boolean(label));

  for (const label of labels) {
    try {
      return new TextDecoder(label).decode(bytes);
    } catch {
      continue;
    }
  }

  let result = '';
  for (let index = 0; index < bytes.length; index += 1) {
    result += decodeWindows1252Byte(bytes[index]);
  }
  return result;
}

export function tokenizeRtfBytes(bytes: Uint8Array): ByteTokenizedRtf {
  const properties = parseRtfPropertiesFromBytes(bytes);
  const codePage = properties.codePage;
  const tokens: RtfToken[] = [];
  let rtf = '';
  let textBuffer = '';
  let textStart = 0;
  let uc = 1;
  const ucStack: number[] = [];
  let outputUcZero = false;

  const appendText = (value: string) => {
    if (!value) {
      return;
    }
    if (!textBuffer) {
      textStart = rtf.length;
    }
    textBuffer += value;
  };

  const appendTextBytes = (values: number[]) => {
    if (!values.length) {
      return;
    }
    appendText(decodeRtfTextBytes(new Uint8Array(values), codePage));
  };

  const flushText = () => {
    if (!textBuffer) {
      return;
    }
    rtf += textBuffer;
    tokens.push({
      type: 'text',
      value: textBuffer,
      start: textStart,
      end: rtf.length,
    });
    textBuffer = '';
  };

  const pushSyntax = (raw: string, token: SyntaxTokenInput) => {
    flushText();
    const start = rtf.length;
    rtf += raw;
    tokens.push({ ...token, start, end: rtf.length });
  };

  const pushEmptyGroup = () => {
    flushText();
    const start = rtf.length;
    rtf += '{}';
    tokens.push({ type: 'group-start', start, end: start + 1 });
    tokens.push({ type: 'group-end', start: start + 1, end: start + 2 });
  };

  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];

    if (byte === 0x7b) {
      pushSyntax('{', { type: 'group-start' });
      ucStack.push(uc);
      continue;
    }
    if (byte === 0x7d) {
      pushSyntax('}', { type: 'group-end' });
      uc = ucStack.pop() ?? uc;
      continue;
    }

    if (byte !== 0x5c) {
      const values: number[] = [];
      let end = index;
      while (end < bytes.length && bytes[end] !== 0x5c && bytes[end] !== 0x7b && bytes[end] !== 0x7d) {
        if (isDbcsLeadByte(codePage, bytes[end]) && isDbcsTrailByte(codePage, bytes[end + 1])) {
          values.push(bytes[end], bytes[end + 1]);
          end += 2;
          continue;
        }
        values.push(bytes[end]);
        end += 1;
      }
      appendTextBytes(values);
      index = end - 1;
      continue;
    }

    const next = bytes[index + 1];
    if (next === undefined) {
      break;
    }

    if (next === 0x5c || next === 0x7b || next === 0x7d) {
      appendText(ascii(next));
      index += 1;
      continue;
    }

    if (next === 0x0a || next === 0x0d) {
      let end = index + 2;
      if (next === 0x0d && bytes[index + 2] === 0x0a) {
        end += 1;
      }
      pushSyntax(bytesToAscii(bytes, index, end), {
        type: 'control-word',
        word: 'par',
        hasParam: false,
        hasSpace: false,
      });
      index = end - 1;
      continue;
    }

    if (next === 0x27 && isHexByte(bytes[index + 2]) && isHexByte(bytes[index + 3])) {
      const values: number[] = [];
      let end = index;
      while (
        end + 3 < bytes.length
        && bytes[end] === 0x5c
        && bytes[end + 1] === 0x27
        && isHexByte(bytes[end + 2])
        && isHexByte(bytes[end + 3])
      ) {
        values.push((hexValue(bytes[end + 2]) << 4) | hexValue(bytes[end + 3]));
        end += 4;
      }
      appendTextBytes(values);
      index = end - 1;
      continue;
    }

    if (!isAlphaByte(next)) {
      pushSyntax(bytesToAscii(bytes, index, index + 2), {
        type: 'control-symbol',
        symbol: ascii(next),
      });
      index += 1;
      continue;
    }

    let wordEnd = index + 2;
    while (wordEnd < bytes.length && isControlWordByte(bytes[wordEnd])) {
      wordEnd += 1;
    }
    const word = bytesToAscii(bytes, index + 1, wordEnd);

    let paramEnd = wordEnd;
    if (bytes[paramEnd] === 0x2d || isDigitByte(bytes[paramEnd])) {
      paramEnd += 1;
      while (paramEnd < bytes.length && isDigitByte(bytes[paramEnd])) {
        paramEnd += 1;
      }
    }

    const hasSpace = bytes[paramEnd] === 0x20;
    const end = paramEnd + (hasSpace ? 1 : 0);
    const param = paramEnd > wordEnd ? bytesToAscii(bytes, wordEnd, paramEnd) : undefined;
    if (word === 'uc') {
      uc = Math.max(0, parseInteger(param) ?? 1);
      outputUcZero = true;
      pushSyntax(`\\uc0${hasSpace ? ' ' : ''}`, {
        type: 'control-word',
        word,
        param: '0',
        hasParam: true,
        hasSpace,
      });
      index = end - 1;
      continue;
    }
    if (word === 'u' && param !== undefined && !outputUcZero) {
      pushSyntax('\\uc0', {
        type: 'control-word',
        word: 'uc',
        param: '0',
        hasParam: true,
        hasSpace: false,
      });
      outputUcZero = true;
    }
    pushSyntax(bytesToAscii(bytes, index, end), {
      type: 'control-word',
      word,
      param,
      hasParam: param !== undefined,
      hasSpace,
    });
    if (word === 'u' && param !== undefined && uc > 0) {
      const fallbackEnd = skipUnicodeFallback(bytes, end, uc, codePage);
      if (needsControlBoundary(bytes[fallbackEnd])) {
        pushEmptyGroup();
      }
      index = fallbackEnd - 1;
      continue;
    }
    if (word === 'bin') {
      const byteCount = Math.max(0, parseInteger(param) ?? 0);
      if (byteCount > 0) {
        const binaryStart = end;
        const binaryEnd = Math.min(bytes.length, binaryStart + byteCount);
        appendText(bytesToHex(bytes, binaryStart, binaryEnd));
        index = binaryEnd - 1;
        continue;
      }
    }
    index = end - 1;
  }

  flushText();
  return { rtf, tokens, properties };
}

export function decodeRtfBytes(bytes: Uint8Array): string {
  return tokenizeRtfBytes(bytes).rtf;
}

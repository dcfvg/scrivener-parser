import type { ScrivenerLinkedImage } from '../types.js';
import { decodeWindows1252Byte, normalizeMediaPath } from '../utils/encoding.js';

const TOKEN_PREFIX = '$SCRImageLink[';
const ABSOLUTE_PATH_PREFIX_RE = /^(?:\$PROJECT:\/\/|[A-Za-z]+:\/\/|\/|[A-Za-z]:[\/])/;
const PROJECT_REFERENCE_RE = /^\$PROJECT:\/\/([^./?#]+)(?:\.([^/?#]+))?$/i;

export interface ParsedScrImageLinkToken extends ScrivenerLinkedImage {
  attrsRaw: string;
  end: number;
}

function decodeRawPath(value: string): string {
  return String(value ?? '')
    .replace(/\\'([0-9a-fA-F]{2})/g, (_, hex: string) => (
      decodeWindows1252Byte(Number.parseInt(hex, 16))
    ))
    .replace(/\\\\/g, '\\')
    .trim()
    .replace(/\\+$/g, '');
}

function sanitizeRawPath(value: string): string {
  const decoded = decodeRawPath(value);
  return decoded.replace(/^\d+]=(?=(?:\$PROJECT:\/\/|[A-Za-z]+:\/\/|\/|[A-Za-z]:[\/]))/, '');
}

function parseDimension(attrs: string, name: string): number | undefined {
  const match = attrs.match(new RegExp(`(?:^|[;,])\\s*${name}:(\\d+)`, 'i'));
  return match ? Number(match[1]) : undefined;
}

function classifyPath(path: string): Pick<ScrivenerLinkedImage, 'source' | 'targetUuid' | 'fileExtension'> {
  const projectMatch = path.match(PROJECT_REFERENCE_RE);
  if (projectMatch) {
    return {
      source: 'project',
      targetUuid: projectMatch[1],
      fileExtension: projectMatch[2]?.toLowerCase(),
    };
  }
  return { source: 'external' };
}

export function readScrImageLinkTokenAt(text: string, start: number): ParsedScrImageLinkToken | null {
  let cursor = start;
  const hasOuterBrace = text[cursor] === '{';
  if (hasOuterBrace) {
    cursor += 1;
  }

  if (!text.startsWith(TOKEN_PREFIX, cursor)) {
    return null;
  }
  cursor += TOKEN_PREFIX.length;

  const attrsEnd = text.indexOf(']', cursor);
  if (attrsEnd === -1) {
    return null;
  }
  const attrsRaw = text.slice(cursor, attrsEnd);
  cursor = attrsEnd + 1;

  if (text[cursor] !== '=') {
    return null;
  }
  cursor += 1;

  let rawPathEnd = cursor;
  if (hasOuterBrace) {
    rawPathEnd = text.indexOf('}', cursor);
    if (rawPathEnd === -1) {
      return null;
    }
  } else {
    while (rawPathEnd < text.length) {
      const char = text[rawPathEnd];
      if (char === '\n' || char === '\r' || char === '}') {
        break;
      }
      rawPathEnd += 1;
    }
  }

  const rawPath = sanitizeRawPath(text.slice(cursor, rawPathEnd));
  if (!rawPath || !ABSOLUTE_PATH_PREFIX_RE.test(rawPath)) {
    return null;
  }

  const path = normalizeMediaPath(rawPath);
  const classification = classifyPath(path);
  const end = hasOuterBrace ? rawPathEnd + 1 : rawPathEnd;

  return {
    raw: text.slice(start, end),
    attrsRaw,
    rawPath,
    path,
    width: parseDimension(attrsRaw, 'w'),
    height: parseDimension(attrsRaw, 'h'),
    ...classification,
    end,
  };
}

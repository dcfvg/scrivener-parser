import type { RtfToken } from './tokenizeRtf.js';

export type RtfCharacterSet = 'ansi' | 'mac' | 'pc' | 'pca' | 'unknown';

export interface RtfProperties {
  rtfVersion?: number;
  characterSet: RtfCharacterSet;
  codePage: number;
  defaultFont?: number;
}

export const DEFAULT_RTF_CODE_PAGE = 1252;

function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseRtfPropertiesFromTokens(tokens: RtfToken[]): RtfProperties {
  const properties: RtfProperties = {
    characterSet: 'unknown',
    codePage: DEFAULT_RTF_CODE_PAGE,
  };

  for (const token of tokens) {
    if (token.type !== 'control-word') {
      continue;
    }

    switch (token.word) {
      case 'rtf':
        properties.rtfVersion = parseNumber(token.param);
        break;
      case 'ansi':
      case 'mac':
      case 'pc':
      case 'pca':
        properties.characterSet = token.word;
        break;
      case 'ansicpg': {
        const codePage = parseNumber(token.param);
        if (codePage !== undefined && codePage > 0) {
          properties.codePage = codePage;
        }
        break;
      }
      case 'deff':
        properties.defaultFont = parseNumber(token.param);
        break;
      default:
        break;
    }
  }

  return properties;
}

function asciiFromBytes(bytes: Uint8Array): string {
  let result = '';
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    result += byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : ' ';
  }
  return result;
}

export function parseRtfPropertiesFromBytes(bytes: Uint8Array): RtfProperties {
  const head = asciiFromBytes(bytes.slice(0, Math.min(bytes.length, 8192)));
  const properties: RtfProperties = {
    characterSet: 'unknown',
    codePage: DEFAULT_RTF_CODE_PAGE,
  };

  const rtf = /\\rtf(-?\d+)/.exec(head);
  if (rtf) {
    properties.rtfVersion = parseNumber(rtf[1]);
  }

  const characterSet = /\\(ansi|mac|pc|pca)(?![A-Za-z_])/.exec(head);
  if (characterSet) {
    properties.characterSet = characterSet[1] as RtfCharacterSet;
  }

  const codePage = /\\ansicpg(-?\d+)/.exec(head);
  if (codePage) {
    const parsed = parseNumber(codePage[1]);
    if (parsed !== undefined && parsed > 0) {
      properties.codePage = parsed;
    }
  }

  const defaultFont = /\\deff(-?\d+)/.exec(head);
  if (defaultFont) {
    properties.defaultFont = parseNumber(defaultFont[1]);
  }

  return properties;
}

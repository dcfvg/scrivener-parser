import type { RtfToken } from './tokenizeRtf.js';
import type {
  ScrivenerRtfFont,
  ScrivenerRtfFontFamily,
  ScrivenerRtfProperties,
  ScrivenerRtfStyle,
  ScrivenerRtfStyleType,
} from '../types.js';

export type RtfCharacterSet = ScrivenerRtfProperties['characterSet'];
export type RtfProperties = ScrivenerRtfProperties;

export const DEFAULT_RTF_CODE_PAGE = 1252;

interface RtfTokenGroup {
  start: number;
  end: number;
  parent?: number;
  destination?: string;
  isDestination: boolean;
}

function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function createDefaultProperties(): RtfProperties {
  return {
    characterSet: 'unknown',
    codePage: DEFAULT_RTF_CODE_PAGE,
    fontTable: [],
    colorTable: [],
    stylesheet: [],
  };
}

function normalizeName(value: string): string {
  return String(value ?? '').replace(/;$/, '').trim();
}

function getGroupDirectTokens(tokens: RtfToken[], group: RtfTokenGroup, byStart: Map<number, RtfTokenGroup>): RtfToken[] {
  const direct: RtfToken[] = [];
  for (let index = group.start + 1; index < group.end; index += 1) {
    const token = tokens[index];
    if (token.type === 'group-start') {
      const nested = byStart.get(index);
      if (nested) {
        index = nested.end;
        continue;
      }
    }
    direct.push(token);
  }
  return direct;
}

function detectGroupDestination(direct: RtfToken[]): { destination?: string; isDestination: boolean } {
  let isDestination = false;
  for (const token of direct) {
    if (token.type === 'control-symbol' && token.symbol === '*') {
      isDestination = true;
      continue;
    }
    if (token.type === 'control-word') {
      return { destination: token.word, isDestination };
    }
    if (token.type !== 'text' || token.value.trim()) {
      return { isDestination };
    }
  }
  return { isDestination };
}

function collectGroups(tokens: RtfToken[]): { groups: RtfTokenGroup[]; byStart: Map<number, RtfTokenGroup> } {
  const groups: RtfTokenGroup[] = [];
  const stack: number[] = [];

  tokens.forEach((token, index) => {
    if (token.type === 'group-start') {
      const group: RtfTokenGroup = {
        start: index,
        end: index,
        parent: stack[stack.length - 1],
        isDestination: false,
      };
      groups.push(group);
      stack.push(groups.length - 1);
      return;
    }
    if (token.type === 'group-end') {
      const currentIndex = stack.pop();
      if (currentIndex === undefined) {
        return;
      }
      groups[currentIndex].end = index;
    }
  });

  const byStart = new Map(groups.map((group) => [group.start, group] as const));
  for (const group of groups) {
    if (group.end <= group.start) {
      continue;
    }
    Object.assign(group, detectGroupDestination(getGroupDirectTokens(tokens, group, byStart)));
  }

  return { groups, byStart };
}

function findGroupsByDestination(groups: RtfTokenGroup[], destination: string): RtfTokenGroup[] {
  return groups.filter((group) => group.destination === destination);
}

function fontFamilyFromControlWord(word: string): ScrivenerRtfFontFamily | undefined {
  switch (word) {
    case 'fnil':
      return 'default';
    case 'froman':
      return 'roman';
    case 'fswiss':
      return 'swiss';
    case 'fmodern':
      return 'modern';
    case 'fscript':
      return 'script';
    case 'fdecor':
      return 'decor';
    case 'ftech':
      return 'tech';
    case 'fbidi':
      return 'bidi';
    default:
      return undefined;
  }
}

function parseFontEntries(tokens: RtfToken[]): ScrivenerRtfFont[] {
  const fonts: ScrivenerRtfFont[] = [];
  let current: ScrivenerRtfFont | undefined;
  let name = '';

  const flush = () => {
    if (!current) {
      return;
    }
    const normalized = normalizeName(name);
    fonts.push({
      ...current,
      name: normalized || current.name,
    });
    current = undefined;
    name = '';
  };

  for (const token of tokens) {
    if (token.type === 'control-word') {
      if (token.word === 'fonttbl') {
        continue;
      }
      if (token.word === 'f') {
        flush();
        current = {
          index: parseNumber(token.param) ?? 0,
          family: 'default',
          name: '',
        };
        continue;
      }
      if (!current) {
        continue;
      }
      const family = fontFamilyFromControlWord(token.word);
      if (family) {
        current.family = family;
        continue;
      }
      if (token.word === 'fcharset') {
        current.charset = parseNumber(token.param);
      }
      continue;
    }

    if (token.type !== 'text' || !current) {
      continue;
    }

    const chunks = token.value.split(';');
    name += chunks[0] ?? '';
    if (chunks.length > 1) {
      flush();
      for (let index = 1; index < chunks.length - 1; index += 1) {
        name = chunks[index] ?? '';
        flush();
      }
      name = chunks[chunks.length - 1] ?? '';
    }
  }

  flush();
  return fonts.filter((font) => font.name || font.index !== 0 || font.charset !== undefined || font.family !== 'default');
}

function parseFontTable(
  tokens: RtfToken[],
  group: RtfTokenGroup,
  groups: RtfTokenGroup[],
  byStart: Map<number, RtfTokenGroup>,
): ScrivenerRtfFont[] {
  const childGroups = groups.filter((candidate) => candidate.parent !== undefined && groups[candidate.parent] === group);
  if (childGroups.length) {
    return childGroups.flatMap((child) => parseFontEntries(getGroupDirectTokens(tokens, child, byStart)));
  }
  return parseFontEntries(getGroupDirectTokens(tokens, group, byStart));
}

function parseColorTable(tokens: RtfToken[]): ScrivenerRtfProperties['colorTable'] {
  const colors: ScrivenerRtfProperties['colorTable'] = [];
  let red = 0;
  let green = 0;
  let blue = 0;
  let hasComponents = false;

  const flush = () => {
    colors.push({ red, green, blue });
    red = 0;
    green = 0;
    blue = 0;
    hasComponents = false;
  };

  for (const token of tokens) {
    if (token.type === 'control-word') {
      const value = Math.max(0, Math.min(255, parseNumber(token.param) ?? 0));
      if (token.word === 'red') {
        red = value;
        hasComponents = true;
      } else if (token.word === 'green') {
        green = value;
        hasComponents = true;
      } else if (token.word === 'blue') {
        blue = value;
        hasComponents = true;
      }
      continue;
    }
    if (token.type === 'text') {
      for (const char of token.value) {
        if (char === ';') {
          flush();
        }
      }
    }
  }

  if (hasComponents) {
    flush();
  }
  return colors;
}

function styleTypeFromControlWord(word: string): ScrivenerRtfStyleType | undefined {
  if (word === 's') return 'paragraph';
  if (word === 'cs') return 'character';
  if (word === 'ds') return 'section';
  return undefined;
}

function parseStyleTokens(tokens: RtfToken[]): ScrivenerRtfStyle | undefined {
  let style: ScrivenerRtfStyle | undefined;
  let name = '';

  for (const token of tokens) {
    if (token.type === 'control-word') {
      if (token.word === 'stylesheet') {
        continue;
      }
      const type = styleTypeFromControlWord(token.word);
      if (type) {
        style = {
          index: parseNumber(token.param) ?? 0,
          type,
          name: '',
        };
        continue;
      }
      if (!style) {
        continue;
      }
      if (token.word === 'sbasedon') {
        style.basedOn = parseNumber(token.param);
      } else if (token.word === 'snext') {
        style.next = parseNumber(token.param);
      }
      continue;
    }
    if (token.type === 'text' && style) {
      name += token.value;
    }
  }

  if (!style) {
    return undefined;
  }
  style.name = normalizeName(name);
  return style.name || style.index !== 0 ? style : undefined;
}

function parseStylesheet(
  tokens: RtfToken[],
  group: RtfTokenGroup,
  groups: RtfTokenGroup[],
  byStart: Map<number, RtfTokenGroup>,
): ScrivenerRtfStyle[] {
  const childGroups = groups.filter((candidate) => candidate.parent !== undefined && groups[candidate.parent] === group);
  const sourceGroups = childGroups.length ? childGroups : [group];
  return sourceGroups
    .map((child) => parseStyleTokens(getGroupDirectTokens(tokens, child, byStart)))
    .filter((style): style is ScrivenerRtfStyle => Boolean(style));
}

export function parseRtfPropertiesFromTokens(tokens: RtfToken[]): RtfProperties {
  const properties = createDefaultProperties();
  const { groups, byStart } = collectGroups(tokens);
  const root = groups[0];
  const headerTokens = root ? getGroupDirectTokens(tokens, root, byStart) : tokens;

  for (const token of headerTokens) {
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

  const fontTable = findGroupsByDestination(groups, 'fonttbl')[0];
  if (fontTable) {
    properties.fontTable = parseFontTable(tokens, fontTable, groups, byStart);
  }

  const colorTable = findGroupsByDestination(groups, 'colortbl')[0];
  if (colorTable) {
    properties.colorTable = parseColorTable(getGroupDirectTokens(tokens, colorTable, byStart));
  }

  const stylesheet = findGroupsByDestination(groups, 'stylesheet')[0];
  if (stylesheet) {
    properties.stylesheet = parseStylesheet(tokens, stylesheet, groups, byStart);
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
  const properties = createDefaultProperties();

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

import { readXmlNodeText } from './xml.js';

export function yesNo(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'object') {
    return yesNo(readXmlNodeText(value));
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return undefined;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'yes') return true;
    if (normalized === 'no') return false;
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    if (normalized === '1') return true;
    if (normalized === '0') return false;
  }
  return undefined;
}

export function normalizeWhitespace(value: string | undefined): string | undefined {
  return value ? value.replace(/\r\n/g, '\n').replace(/\r/g, '\n') : undefined;
}

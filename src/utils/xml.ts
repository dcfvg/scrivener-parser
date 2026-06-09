import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  trimValues: false,
  allowBooleanAttributes: true,
  preserveOrder: false,
});

export function parseXml<T = any>(content: string): T {
  return parser.parse(content) as T;
}

export function readXmlNodeText(node: unknown): string | undefined {
  if (node === undefined || node === null) {
    return undefined;
  }
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
    return String(node);
  }
  if (typeof node === 'object') {
    const record = node as Record<string, unknown>;
    const text = record['#text'] ?? record._cdata ?? record.CDATA ?? record.text;
    if (typeof text === 'string' || typeof text === 'number' || typeof text === 'boolean') {
      return String(text);
    }
  }
  return undefined;
}

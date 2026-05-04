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

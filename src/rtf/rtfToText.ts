import { parseRtfModel } from './parseRtfModel.js';

export function rtfToText(content: string): string {
  return parseRtfModel(content).plainText;
}

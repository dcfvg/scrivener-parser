import { parseRtfModel } from './parseRtfModel.js';
import { decodeRtfBytes } from './byteTokenizer.js';

export function rtfToText(content: string | Uint8Array): string {
  const rtf = typeof content === 'string' ? content : decodeRtfBytes(content);
  return parseRtfModel(rtf, {
    extractEmbeddedImages: false,
    extractEmbeddedPdfs: false,
  }).plainText;
}

const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
const WINDOWS_1252_EXTENDED = new Map<number, string>([
  [0x80, '€'],
  [0x82, '‚'],
  [0x83, 'ƒ'],
  [0x84, '„'],
  [0x85, '…'],
  [0x86, '†'],
  [0x87, '‡'],
  [0x88, 'ˆ'],
  [0x89, '‰'],
  [0x8a, 'Š'],
  [0x8b, '‹'],
  [0x8c, 'Œ'],
  [0x8e, 'Ž'],
  [0x91, '‘'],
  [0x92, '’'],
  [0x93, '“'],
  [0x94, '”'],
  [0x95, '•'],
  [0x96, '–'],
  [0x97, '—'],
  [0x98, '˜'],
  [0x99, '™'],
  [0x9a, 'š'],
  [0x9b, '›'],
  [0x9c, 'œ'],
  [0x9e, 'ž'],
  [0x9f, 'Ÿ'],
]);

export function bufferToBase64(data: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(data).toString('base64');
  }
  if (typeof btoa !== 'undefined') {
    let binary = '';
    data.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }
  let result = '';
  let i: number;
  for (i = 0; i < data.length; i += 3) {
    const byte1 = data[i];
    const byte2 = i + 1 < data.length ? data[i + 1] : 0;
    const byte3 = i + 2 < data.length ? data[i + 2] : 0;
    const enc1 = byte1 >> 2;
    const enc2 = ((byte1 & 3) << 4) | (byte2 >> 4);
    const enc3 = ((byte2 & 15) << 2) | (byte3 >> 6);
    const enc4 = byte3 & 63;
    result += base64Chars.charAt(enc1);
    result += base64Chars.charAt(enc2);
    result += i + 1 < data.length ? base64Chars.charAt(enc3) : '=';
    result += i + 2 < data.length ? base64Chars.charAt(enc4) : '=';
  }
  return result;
}

export function decodeWindows1252Byte(byte: number): string {
  if (WINDOWS_1252_EXTENDED.has(byte)) {
    return WINDOWS_1252_EXTENDED.get(byte) ?? '';
  }
  return String.fromCharCode(byte);
}

function safeDecodePercentEscapes(value: string): string {
  return String(value ?? '').replace(/%(?:[0-9A-Fa-f]{2})+/g, (chunk) => {
    try {
      return decodeURIComponent(chunk);
    } catch {
      return chunk;
    }
  });
}

export function normalizeMediaPath(value: string): string {
  let normalized = String(value ?? '')
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
    .replace(/^"+|"+$/g, '');

  normalized = safeDecodePercentEscapes(normalized);

  if (/^file:\/\/?/i.test(normalized)) {
    normalized = normalized.replace(/^file:\/\/(?:localhost)?/i, '');
    normalized = safeDecodePercentEscapes(normalized);
  }

  normalized = normalized.replace(/\\/g, '/');

  if (/^\/[A-Za-z]:\//.test(normalized)) {
    normalized = normalized.slice(1);
  }

  return normalized.normalize('NFC');
}

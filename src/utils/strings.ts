export function yesNo(value: string | undefined): boolean | undefined {
  if (!value) {
    return undefined;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'yes') return true;
    if (normalized === 'no') return false;
  }
  return undefined;
}

export function normalizeWhitespace(value: string | undefined): string | undefined {
  return value ? value.replace(/\r\n/g, '\n').replace(/\r/g, '\n') : undefined;
}

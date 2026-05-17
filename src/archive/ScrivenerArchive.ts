import { unzipSync } from 'fflate';

const textDecoder = new TextDecoder('utf-8');
const textEncoder = new TextEncoder();

/**
 * Normalize archive paths so lookups remain deterministic across OSes.
 */
function normalizePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+/g, '/')
    .replace(/\/*$/, '');
}

/**
 * Lightweight, browser-friendly representation of a Scrivener project archive.
 * Consumers can build it from an in-memory ZIP, a map of files, or the Node loader.
 */
export class ScrivenerArchive {
  private files = new Map<string, Uint8Array>();

  private caseInsensitive = new Map<string, string>();

  private sortedPaths?: string[];

  private listCache = new Map<string, string[]>();

  private suffixResolutionCache = new Map<string, string | undefined>();

  constructor(entries: Iterable<[string, Uint8Array]>) {
    for (const [rawPath, data] of entries) {
      const normalized = normalizePath(rawPath);
      this.files.set(normalized, data);
      this.caseInsensitive.set(normalized.toLowerCase(), normalized);
    }
  }

  /**
   * Inflate a `.scriv` ZIP/Flat package into an archive instance.
   */
  static fromZip(buffer: ArrayBuffer | Uint8Array): ScrivenerArchive {
    const binary = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const unpacked = unzipSync(binary);
    return new ScrivenerArchive(
      Object.entries(unpacked).map(([path, data]) => [normalizePath(path), data]) as Array<[
        string,
        Uint8Array,
      ]>,
    );
  }

  /**
   * Build an archive from a pre-loaded file map. Useful for tests or custom loaders.
   */
  static fromFileMap(fileMap: Record<string, Uint8Array | string>): ScrivenerArchive {
    const entries = Object.entries(fileMap).map(([path, value]) => [
      path,
      typeof value === 'string' ? textEncoder.encode(value) : value,
    ] as [string, Uint8Array]);
    return new ScrivenerArchive(entries);
  }

  /**
   * Iterate over all archive entries (normalized path + binary content).
   */
  entries(): IterableIterator<[string, Uint8Array]> {
    return this.files.entries();
  }

  /**
    * List every path inside the archive, optionally scoped to a prefix.
    */
  list(prefix = ''): string[] {
    const normalizedPrefix = normalizePath(prefix);
    const cached = this.listCache.get(normalizedPrefix);
    if (cached) {
      return [...cached];
    }

    const paths = this.getSortedPaths()
      .filter((path) => !normalizedPrefix || path.startsWith(normalizedPrefix));
    this.listCache.set(normalizedPrefix, paths);
    return [...paths];
  }

  /**
   * Check if a path exists (case-insensitive) within the archive.
   */
  has(path: string): boolean {
    return Boolean(this.resolve(path));
  }

  /**
   * Read a file as raw bytes. Throws if the entry cannot be resolved.
   */
  readBinary(path: string): Uint8Array {
    const resolved = this.resolve(path);
    if (!resolved) {
      throw new Error(`Missing file in Scrivener archive: ${path}`);
    }
    return this.files.get(resolved)!;
  }

  /**
   * Read an RTF file as raw bytes so callers can decode it with its RTF code page.
   */
  readRtfBytes(path: string): Uint8Array {
    return this.readBinary(path);
  }

  /**
   * Read a file as UTF-8 text.
   */
  readText(path: string): string {
    const data = this.readBinary(path);
    return textDecoder.decode(data);
  }

  /**
   * Resolve a path using exact, case-insensitive, or suffix matching.
   */
  private resolve(path: string): string | undefined {
    const normalized = normalizePath(path);
    if (this.files.has(normalized)) {
      return normalized;
    }
    const lower = normalized.toLowerCase();
    if (this.caseInsensitive.has(lower)) {
      return this.caseInsensitive.get(lower);
    }
    // Try suffix match to support archives that include a root folder
    if (this.suffixResolutionCache.has(normalized)) {
      return this.suffixResolutionCache.get(normalized);
    }
    const matches = this.getSortedPaths().filter(
      (entry) => entry === normalized || entry.endsWith(`/${normalized}`),
    );
    if (matches.length === 1) {
      const match = matches[0];
      this.suffixResolutionCache.set(normalized, match);
      return match;
    }
    this.suffixResolutionCache.set(normalized, undefined);
    return undefined;
  }

  private getSortedPaths(): string[] {
    if (!this.sortedPaths) {
      this.sortedPaths = Array.from(this.files.keys()).sort();
    }
    return this.sortedPaths;
  }
}

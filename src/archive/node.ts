import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import { ScrivenerArchive } from './ScrivenerArchive.js';

const textDecoder = new TextDecoder('utf-8');

export interface LoadDirectoryArchiveOptions {
  lazy?: boolean;
}

function normalizeArchivePath(value: string): string {
  return value
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+/g, '/')
    .replace(/\/*$/, '');
}

function normalizeRelative(root: string, target: string): string {
  return normalizeArchivePath(path.relative(root, target));
}

class LazyDirectoryArchive extends ScrivenerArchive {
  private pathSet: Set<string>;

  private caseInsensitivePaths = new Map<string, string>();

  private lazySortedPaths?: string[];

  private lazyListCache = new Map<string, string[]>();

  private lazySuffixResolutionCache = new Map<string, string | undefined>();

  private binaryCache = new Map<string, Uint8Array>();

  constructor(
    private root: string,
    paths: string[],
  ) {
    super([]);
    this.pathSet = new Set(paths);
    for (const archivePath of paths) {
      this.caseInsensitivePaths.set(archivePath.toLowerCase(), archivePath);
    }
  }

  *entries(): IterableIterator<[string, Uint8Array]> {
    for (const archivePath of this.getLazySortedPaths()) {
      yield [archivePath, this.readBinary(archivePath)];
    }
  }

  list(prefix = ''): string[] {
    const normalizedPrefix = normalizeArchivePath(prefix);
    const cached = this.lazyListCache.get(normalizedPrefix);
    if (cached) {
      return [...cached];
    }
    const paths = this.getLazySortedPaths()
      .filter((archivePath) => !normalizedPrefix || archivePath.startsWith(normalizedPrefix));
    this.lazyListCache.set(normalizedPrefix, paths);
    return [...paths];
  }

  has(archivePath: string): boolean {
    return Boolean(this.resolveLazy(archivePath));
  }

  readBinary(archivePath: string): Uint8Array {
    const resolved = this.resolveLazy(archivePath);
    if (!resolved) {
      throw new Error(`Missing file in Scrivener archive: ${archivePath}`);
    }
    const cached = this.binaryCache.get(resolved);
    if (cached) {
      return cached;
    }
    const data = new Uint8Array(readFileSync(path.join(this.root, resolved)));
    this.binaryCache.set(resolved, data);
    return data;
  }

  readRtfBytes(archivePath: string): Uint8Array {
    return this.readBinary(archivePath);
  }

  readText(archivePath: string): string {
    return textDecoder.decode(this.readBinary(archivePath));
  }

  private resolveLazy(archivePath: string): string | undefined {
    const normalized = normalizeArchivePath(archivePath);
    if (this.pathSet.has(normalized)) {
      return normalized;
    }

    const lower = normalized.toLowerCase();
    const caseInsensitive = this.caseInsensitivePaths.get(lower);
    if (caseInsensitive) {
      return caseInsensitive;
    }

    if (this.lazySuffixResolutionCache.has(normalized)) {
      return this.lazySuffixResolutionCache.get(normalized);
    }

    const matches = this.getLazySortedPaths().filter(
      (entry) => entry === normalized || entry.endsWith(`/${normalized}`),
    );
    const match = matches.length === 1 ? matches[0] : undefined;
    this.lazySuffixResolutionCache.set(normalized, match);
    return match;
  }

  private getLazySortedPaths(): string[] {
    if (!this.lazySortedPaths) {
      this.lazySortedPaths = [...this.pathSet].sort();
    }
    return this.lazySortedPaths;
  }
}

export async function loadDirectoryAsArchive(
  root: string,
  options: LoadDirectoryArchiveOptions = {},
): Promise<ScrivenerArchive> {
  const resolvedRoot = path.resolve(root);
  const entries: Array<[string, Uint8Array]> = [];
  const paths: string[] = [];

  async function walk(current: string): Promise<void> {
    const dirents = await fs.readdir(current, { withFileTypes: true });
    for (const dirent of dirents) {
      const absolute = path.join(current, dirent.name);
      if (dirent.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!dirent.isFile()) {
        continue;
      }
      const relative = normalizeRelative(resolvedRoot, absolute);
      paths.push(relative);
      if (options.lazy) {
        continue;
      }
      const data = new Uint8Array(await fs.readFile(absolute));
      entries.push([relative, data]);
    }
  }

  await walk(resolvedRoot);
  if (options.lazy) {
    return new LazyDirectoryArchive(resolvedRoot, paths);
  }
  return new ScrivenerArchive(entries);
}

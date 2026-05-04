import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ScrivenerArchive } from './ScrivenerArchive.js';

function normalizeRelative(root: string, target: string): string {
  return path.relative(root, target).replace(/\\/g, '/');
}

export async function loadDirectoryAsArchive(root: string): Promise<ScrivenerArchive> {
  const resolvedRoot = path.resolve(root);
  const entries: Array<[string, Uint8Array]> = [];

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
      const data = new Uint8Array(await fs.readFile(absolute));
      entries.push([relative, data]);
    }
  }

  await walk(resolvedRoot);
  return new ScrivenerArchive(entries);
}

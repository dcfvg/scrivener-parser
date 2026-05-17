import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadDirectoryAsArchive } from '../src/archive/node.js';

test('loadDirectoryAsArchive can lazily read directory-backed archives', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'scrivener-parser-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  await mkdir(path.join(root, 'Files', 'Data', 'DOC-1'), { recursive: true });
  await writeFile(path.join(root, 'Project.scrivx'), '<ScrivenerProject/>');
  await writeFile(path.join(root, 'Files', 'Data', 'DOC-1', 'content.rtf'), String.raw`{\rtf1\ansi Lazy}`);

  const archive = await loadDirectoryAsArchive(root, { lazy: true });

  assert.deepEqual(archive.list('Files/Data'), ['Files/Data/DOC-1/content.rtf']);
  assert.equal(archive.readText('project.scrivx'), '<ScrivenerProject/>');
  assert.equal(archive.readText('content.rtf'), String.raw`{\rtf1\ansi Lazy}`);
});

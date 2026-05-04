import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import { loadDirectoryAsArchive } from '../src/archive/node.js';
import { parseProject } from '../src/parsers/project.js';
import type { ScrivenerBinderNode, ScrivenerDocumentContent } from '../src/types.js';

const samplePath = fileURLToPath(new URL('../sample/Tutorial.scriv', import.meta.url));
const hasSample = existsSync(samplePath);

test('parses the Tutorial sample without dropping binder bookmarks or tutorial metadata', { skip: !hasSample ? 'sample/Tutorial.scriv not found — copy the Scrivener Tutorial there to enable this test' : false }, async () => {
  const archive = await loadDirectoryAsArchive(samplePath);
  const project = parseProject(archive, {
    decodeRtf: true,
    loadSnapshots: true,
    extractPlaceholders: true,
    extractStyleIds: true,
    extractStyleSpans: true,
    extractEmbeddedImages: true,
    extractInlineAnnotations: true,
    extractLinkedImages: true,
    extractHyperlinks: true,
    extractBookmarks: true,
    extractFields: true,
    extractTables: true,
    computeTextCounts: true,
    normalizeBinderSections: true,
    attachBinderMetaToDocs: true,
  });

  assert.equal(project.settings.tutorial?.id, 'TUTORIAL');
  assert.equal(project.settings.projectPreferences?.useProjectPreferences, true);
  assert.ok((project.settings.uiCommon?.binderExpandedItems?.length ?? 0) > 0);
  assert.ok((project.settings.ui?.binderState?.length ?? 0) > 0);
  assert.equal(project.metadata.defaults?.labelId, -1);
  assert.equal(project.metadata.defaults?.statusId, -1);
  assert.deepEqual(project.metadata.sectionTypeLevels, {
    folders: ['BBF3A4E6-0D2F-49D3-91BC-58C5B8C04180'],
    containers: ['D9BEEC29-180D-451E-BCB0-754DE7C64C49'],
    files: ['D9BEEC29-180D-451E-BCB0-754DE7C64C49'],
  });

  const keyConcepts = project.binder.find(
    (node: ScrivenerBinderNode) => node.uuid === 'B670E26B-2CFC-4870-936E-C3A94D4242A4',
  );
  assert.equal(keyConcepts?.bookmarks?.[0]?.binderUuid, 'E7DB0738-0BBB-4E6B-B7FB-64227742B570');

  const internalLinkDoc = JSON.stringify(project.binder).includes('[Internal Link]');
  assert.equal(internalLinkDoc, true);

  const docs = Object.values(project.documents) as ScrivenerDocumentContent[];
  assert.ok(docs.some((doc) => (doc.comments?.length ?? 0) > 0));
  assert.ok(docs.some((doc) => (doc.embeddedImages?.length ?? 0) > 0));
  assert.ok(docs.some((doc) => (doc.footnotes?.length ?? 0) > 0));
  assert.ok(docs.some((doc) => (doc.tables?.length ?? 0) > 0));
  assert.ok(docs.some((doc) => (doc.files?.length ?? 0) > 0));
  assert.equal(Object.values(project.snapshots).flat().length, 1);
});

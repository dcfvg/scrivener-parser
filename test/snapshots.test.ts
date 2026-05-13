import test from 'node:test';
import assert from 'node:assert/strict';

import { ScrivenerArchive } from '../src/archive/ScrivenerArchive.js';
import { parseSnapshots } from '../src/parsers/snapshots.js';

function asciiBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

test('deduplicates snapshot metadata and parses snapshots through the shared RTF pipeline', () => {
  const archive = ScrivenerArchive.fromFileMap({
    'Snapshots/DOC-1.snapshots/index.xml': `<?xml version="1.0" encoding="UTF-8"?>
<Snapshots Version="1.0">
  <Snapshot>
    <Title>v0</Title>
    <Date>2025-01-01 12:00:00 +0100</Date>
  </Snapshot>
</Snapshots>`,
    'Snapshots/DOC-1.snapshots/snapshot.indexes': `<?xml version="1.0" encoding="UTF-8"?>
<SnapshotIndexes Version="1.0" BinderUUID="DOC-1">
  <Snapshot Date="2025-01-01 12:00:00 +0100">
    <Title>v0</Title>
    <Text>Placeholder snapshot text.</Text>
  </Snapshot>
</SnapshotIndexes>`,
    'Snapshots/DOC-1.snapshots/2025-01-01-12-00-00+0100.rtf': String.raw`{\rtf1\ansi Snapshot <$projecttitle>\par Second line}`,
  });

  const snapshots = parseSnapshots(archive, {
    basePath: '',
    decodeRtf: true,
    extractPlaceholders: true,
    computeTextCounts: true,
  });

  assert.equal(snapshots['DOC-1']?.length, 1);
  const snapshot = snapshots['DOC-1']?.[0];
  assert.equal(snapshot?.title, 'v0');
  assert.equal(snapshot?.date, '2025-01-01 12:00:00 +0100');
  assert.equal(snapshot?.sourceFile, '2025-01-01-12-00-00+0100.rtf');
  assert.equal(snapshot?.hasText, true);
  assert.equal(snapshot?.hasIndexText, true);
  assert.equal(snapshot?.indexText, 'Placeholder snapshot text.');
  assert.match(snapshot?.plainText ?? '', /Snapshot/);
  assert.ok((snapshot?.textWordCount ?? 0) >= 3);
  assert.ok((snapshot?.textCharCount ?? 0) >= 10);
  assert.equal(snapshot?.paragraphs?.length, 2);
  assert.ok((snapshot?.runs?.length ?? 0) >= 2);
  assert.equal(snapshot?.rtfModel?.paragraphs.length, 2);
  assert.deepEqual(snapshot?.placeholders?.map((placeholder) => placeholder.value), ['<$projecttitle>']);
});

test('decodes snapshot RTF from bytes before parsing', () => {
  const archive = ScrivenerArchive.fromFileMap({
    'Snapshots/DOC-2.snapshots/2025-01-02-12-00-00+0100.rtf': asciiBytes(
      String.raw`{\rtf1\ansi\ansicpg932 \'83\'65\'83\'58\'83\'67}`,
    ),
  });

  const snapshots = parseSnapshots(archive, {
    basePath: '',
    decodeRtf: true,
  });

  const snapshot = snapshots['DOC-2']?.[0];
  assert.equal(snapshot?.plainText, 'テスト');
  assert.equal(snapshot?.paragraphs?.[0].text, 'テスト');
});

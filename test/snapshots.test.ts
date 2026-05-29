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

test('extracts snapshot style spans with snapshot StyleIDs before falling back to current content.styles', () => {
  const archive = ScrivenerArchive.fromFileMap({
    'Snapshots/DOC-3.snapshots/index.xml': `<?xml version="1.0" encoding="UTF-8"?>
<Snapshots Version="1.0">
  <Snapshot>
    <Title>styled</Title>
    <Date>2025-01-03 12:00:00 +0100</Date>
    <StyleIDs>STYLE-CAPTION,STYLE-BODY</StyleIDs>
  </Snapshot>
</Snapshots>`,
    'Snapshots/DOC-3.snapshots/2025-01-03-12-00-00+0100.rtf': String.raw`{\rtf1\ansi <$Scr_Ps::0>Caption\par <$Scr_Ps::1>Body}`,
  });

  const snapshots = parseSnapshots(archive, {
    basePath: '',
    decodeRtf: true,
    extractStyleSpans: true,
    styleDefinitions: [
      { id: 'STYLE-CAPTION', name: 'caption', type: 'paragraph' },
      { id: 'STYLE-BODY', name: 'body', type: 'paragraph' },
    ],
    documentStyleIdsByUuid: {
      'DOC-3': ['WRONG-CURRENT-STYLE'],
    },
  });

  assert.deepEqual(snapshots['DOC-3']?.[0]?.styleIds, ['STYLE-CAPTION', 'STYLE-BODY']);
  assert.deepEqual(
    snapshots['DOC-3']?.[0]?.styleSpans?.filter((span) => span.kind === 'paragraph').map((span) => span.id),
    ['STYLE-CAPTION', 'STYLE-BODY'],
  );
});

test('falls back to source document content.styles for old snapshots without StyleIDs', () => {
  const archive = ScrivenerArchive.fromFileMap({
    'Snapshots/DOC-4.snapshots/2025-01-04-12-00-00+0100.rtf': String.raw`{\rtf1\ansi <$Scr_Ps::0>Caption\par <$Scr_Ps::1>Body}`,
  });

  const snapshots = parseSnapshots(archive, {
    basePath: '',
    decodeRtf: true,
    extractStyleSpans: true,
    styleDefinitions: [
      { id: 'STYLE-CAPTION', name: 'caption', type: 'paragraph' },
      { id: 'STYLE-BODY', name: 'body', type: 'paragraph' },
    ],
    documentStyleIdsByUuid: {
      'DOC-4': ['STYLE-CAPTION', 'STYLE-BODY'],
    },
  });

  assert.equal(snapshots['DOC-4']?.[0]?.styleIds, undefined);
  assert.deepEqual(
    snapshots['DOC-4']?.[0]?.styleSpans?.filter((span) => span.kind === 'paragraph').map((span) => span.id),
    ['STYLE-CAPTION', 'STYLE-BODY'],
  );
});

test('parses non-inline comments and footnotes stored in snapshot index.xml', () => {
  const archive = ScrivenerArchive.fromFileMap({
    'Snapshots/DOC-5.snapshots/index.xml': String.raw`<?xml version="1.0" encoding="UTF-8"?>
<Snapshots Version="1.0">
  <Snapshot>
    <Title>with comments</Title>
    <Date>2025-01-05 12:00:00 +0100</Date>
    <Comments>
      <Comment ID="NOTE-1" Author="Anon" Footnote="Yes" Number="4" Color="0.9 0.9 0.9"><![CDATA[{\rtf1\ansi Snapshot footnote <$projecttitle>.}]]></Comment>
    </Comments>
  </Snapshot>
</Snapshots>`,
    'Snapshots/DOC-5.snapshots/2025-01-05-12-00-00+0100.rtf': String.raw`{\rtf1\ansi Body}`,
  });

  const snapshots = parseSnapshots(archive, {
    basePath: '',
    decodeRtf: true,
    extractPlaceholders: true,
    computeTextCounts: true,
  });

  const comment = snapshots['DOC-5']?.[0]?.comments?.[0];
  assert.equal(comment?.id, 'NOTE-1');
  assert.equal(comment?.isFootnote, true);
  assert.equal(comment?.number, 4);
  assert.match(comment?.text ?? '', /Snapshot footnote/);
  assert.equal(comment?.placeholders?.[0]?.value, '<$projecttitle>');
});

test('exposes plain snapshot index comments separately from structured comments', () => {
  const archive = ScrivenerArchive.fromFileMap({
    'Snapshots/DOC-6.snapshots/snapshot.indexes': `<?xml version="1.0" encoding="UTF-8"?>
<SnapshotIndexes Version="1.0" BinderUUID="DOC-6">
  <Snapshot Date="2025-01-06 12:00:00 +0100">
    <Title>plain index comments</Title>
    <Text>Snapshot text.</Text>
    <Comments>Plain snapshot index comments.
Second line.</Comments>
  </Snapshot>
</SnapshotIndexes>`,
    'Snapshots/DOC-6.snapshots/2025-01-06-12-00-00+0100.rtf': String.raw`{\rtf1\ansi Body}`,
  });

  const snapshots = parseSnapshots(archive, {
    basePath: '',
    decodeRtf: true,
  });

  const snapshot = snapshots['DOC-6']?.[0];
  assert.equal(snapshot?.comments, undefined);
  assert.equal(snapshot?.indexComments, 'Plain snapshot index comments.\nSecond line.');
  assert.equal(snapshot?.hasIndexComments, true);
});

test('accepts lowercase comments parent for structured snapshot comments', () => {
  const archive = ScrivenerArchive.fromFileMap({
    'Snapshots/DOC-7.snapshots/index.xml': String.raw`<?xml version="1.0" encoding="UTF-8"?>
<Snapshots Version="1.0">
  <Snapshot>
    <Title>lowercase comments</Title>
    <Date>2025-01-07 12:00:00 +0100</Date>
    <comments>
      <comment ID="COMMENT-LOWER" Author="Anon"><![CDATA[{\rtf1\ansi Lowercase comment.}]]></comment>
    </comments>
  </Snapshot>
</Snapshots>`,
    'Snapshots/DOC-7.snapshots/2025-01-07-12-00-00+0100.rtf': String.raw`{\rtf1\ansi Body}`,
  });

  const snapshots = parseSnapshots(archive, {
    basePath: '',
    decodeRtf: true,
  });

  const comment = snapshots['DOC-7']?.[0]?.comments?.[0];
  assert.equal(comment?.id, 'COMMENT-LOWER');
  assert.match(comment?.text ?? '', /Lowercase comment/);
  assert.equal(snapshots['DOC-7']?.[0]?.indexComments, undefined);
});

test('links snapshot comments to scrivcmt field anchors in snapshot RTF', () => {
  const archive = ScrivenerArchive.fromFileMap({
    'Snapshots/DOC-8.snapshots/index.xml': String.raw`<?xml version="1.0" encoding="UTF-8"?>
<Snapshots Version="1.0">
  <Snapshot>
    <Title>anchored comments</Title>
    <Date>2025-01-08 12:00:00 +0100</Date>
    <Comments>
      <Comment ID="COMMENT-1" Author="Anon"><![CDATA[{\rtf1\ansi Anchored comment.}]]></Comment>
      <Comment ID="COMMENT-2" Author="Anon"><![CDATA[{\rtf1\ansi Unanchored comment.}]]></Comment>
    </Comments>
  </Snapshot>
</Snapshots>`,
    'Snapshots/DOC-8.snapshots/2025-01-08-12-00-00+0100.rtf': String.raw`{\rtf1\ansi Body {\field{\*\fldinst{HYPERLINK "scrivcmt://COMMENT-1"}}{\fldrslt [1]}}}`,
  });

  const snapshots = parseSnapshots(archive, {
    basePath: '',
    decodeRtf: true,
    extractFields: true,
  });

  const snapshot = snapshots['DOC-8']?.[0];
  assert.equal(snapshot?.commentAnchors?.length, 1);
  assert.equal(snapshot?.commentAnchors?.[0]?.commentId, 'COMMENT-1');
  assert.equal(snapshot?.commentAnchors?.[0]?.commentIndex, 0);
  assert.equal(snapshot?.commentAnchors?.[0]?.textStart, 5);
  assert.equal(snapshot?.commentAnchors?.[0]?.textEnd, 8);
  assert.equal(snapshot?.rtfModel?.commentAnchors?.[0]?.commentIndex, 0);
  assert.equal(snapshot?.comments?.[0]?.hasAnchors, true);
  assert.deepEqual(snapshot?.comments?.[0]?.anchorFieldIndexes, [0]);
  assert.equal(snapshot?.comments?.[1]?.hasAnchors, false);
});

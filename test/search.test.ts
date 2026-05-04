import test from 'node:test';
import assert from 'node:assert/strict';

import { ScrivenerArchive } from '../src/archive/ScrivenerArchive.js';
import { parseSearchIndex } from '../src/parsers/search.js';

test('parses search.indexes with synopsis, comments and notes', () => {
  const archive = ScrivenerArchive.fromFileMap({
    'Files/search.indexes': `<?xml version="1.0" encoding="UTF-8"?>
<SearchIndexes Version="1.0">
  <Documents>
    <Document ID="DOC-1">
      <Title>Doc title</Title>
      <Synopsis>Doc synopsis</Synopsis>
      <Text>Body text</Text>
      <Comments>Comment text</Comments>
      <Notes>Note text</Notes>
    </Document>
  </Documents>
</SearchIndexes>`,
  });

  const search = parseSearchIndex(archive, '');

  assert.equal(search.version, '1.0');
  assert.equal(search.documents[0]?.id, 'DOC-1');
  assert.equal(search.documents[0]?.synopsis, 'Doc synopsis');
  assert.equal(search.documents[0]?.comments, 'Comment text');
  assert.equal(search.documents[0]?.notes, 'Note text');
});

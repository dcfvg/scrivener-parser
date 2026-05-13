import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  collectEmbeddedScrivenerInlineMarkup,
  replaceEmbeddedScrivenerInlineMarkup,
} from '../src/rtf/parseScrivenerInlineMarkup.js';

const ROOT = path.resolve(import.meta.dirname, '..');

function readFixture(...segments: string[]): string {
  return fs.readFileSync(path.join(ROOT, ...segments), 'utf8');
}

test('collects embedded Scrivener inline markup blocks from raw RTF fixtures', () => {
  const rtf = readFixture('test', 'fixtures', 'inline-markup.rtf');
  const matches = collectEmbeddedScrivenerInlineMarkup(rtf);

  assert.deepEqual(matches.map((match) => match.kind), ['Scrv_annot', 'Scrv_fn']);
  assert.equal(matches[0]?.directives, '<$ScrKeepWithNext><$Scr_Ps::0>');
  assert.equal(matches[1]?.directives, '<$ScrKeepWithNext><$Scr_Ps::0>');
  assert.match(matches[0]?.normalizedRaw ?? '', /Anonymous test annotation/);
  assert.match(matches[1]?.normalizedRaw ?? '', /HYPERLINK "https:\/\/example\.invalid\/reference"/);
});

test('rewrites embedded Scrivener inline markup without leaking raw control words', () => {
  const rtf = readFixture('test', 'fixtures', 'inline-markup.rtf');
  const rewritten = replaceEmbeddedScrivenerInlineMarkup(rtf, (match) => (
    match.kind === 'Scrv_fn'
      ? `${match.directives}<FOOTNOTE>`
      : match.directives
  ));

  assert.ok(rewritten.includes('Neutral text before the note.'));
  assert.ok(rewritten.includes('Neutral text after the note.'));
  assert.ok(rewritten.includes('<$ScrKeepWithNext><$Scr_Ps::0><FOOTNOTE>'));
  assert.ok(!rewritten.includes('Scrv_fn'));
  assert.ok(!rewritten.includes('Scrv_annot'));
});

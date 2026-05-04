import test from 'node:test';
import assert from 'node:assert/strict';

import { ScrivenerArchive } from '../src/archive/ScrivenerArchive.js';
import { parseDocuments } from '../src/parsers/documents.js';

test('links comment anchors to parsed comments without circular references', () => {
  const archive = ScrivenerArchive.fromFileMap({
    'Files/Data/DOC-1/content.rtf':
      '{\\rtf1\\ansi Avant {\\field{\\*\\fldinst{HYPERLINK "scrivcmt://COMMENT-1"}}{\\fldrslt [1]}} apres.}',
    'Files/Data/DOC-1/content.comments':
      '<Comments><Comment ID="COMMENT-1" Author="Anon" Number="3" Collapsed="Yes"><![CDATA[{\\rtf1\\ansi Commentaire anonymise.}]]></Comment></Comments>',
  });

  const documents = parseDocuments(archive, {
    basePath: '',
    decodeRtf: true,
    includeBinaryAssets: false,
    extractPlaceholders: false,
    extractStyleIds: false,
    extractStyleSpans: false,
    extractEmbeddedImages: false,
    extractInlineAnnotations: false,
    extractLinkedImages: false,
    extractHyperlinks: false,
    extractBookmarks: false,
    extractFields: true,
    extractTables: false,
    computeTextCounts: false,
  });

  const document = documents['DOC-1'];

  assert.equal(document.commentAnchors?.length, 1);
  assert.equal(document.commentAnchors?.[0]?.commentId, 'COMMENT-1');
  assert.equal(document.commentAnchors?.[0]?.commentIndex, 0);
  assert.deepEqual(document.comments?.[0]?.anchorFieldIndexes, [0]);
  assert.equal(document.comments?.[0]?.number, 3);
  assert.equal(document.comments?.[0]?.collapsed, true);
  assert.equal(document.comments?.[0]?.hasAnchors, true);
  assert.match(document.comments?.[0]?.text ?? '', /Commentaire anonymise/);
  assert.equal(document.rtfModel?.commentAnchors?.[0]?.commentIndex, 0);
});

test('parses structured RTF content inside content.comments', () => {
  const archive = ScrivenerArchive.fromFileMap({
    'Files/Data/DOC-C/content.comments': String.raw`<Comments><Comment ID="COMMENT-C" Author="Anon" Color="0.85 0.85 0.85"><![CDATA[{\rtf1\ansi Voir {\field{\*\fldinst{HYPERLINK "https://example.invalid/ref"}}{\fldrslt source}} <$projecttitle>.}]]></Comment></Comments>`,
  });

  const documents = parseDocuments(archive, {
    basePath: '',
    decodeRtf: true,
    includeBinaryAssets: false,
    extractPlaceholders: true,
    extractStyleIds: false,
    extractStyleSpans: false,
    extractEmbeddedImages: false,
    extractInlineAnnotations: false,
    extractLinkedImages: false,
    extractHyperlinks: true,
    extractBookmarks: false,
    extractFields: true,
    extractTables: false,
    computeTextCounts: true,
  });

  const comment = documents['DOC-C']?.comments?.[0];

  assert.equal(comment?.id, 'COMMENT-C');
  assert.match(comment?.text ?? '', /Voir source/);
  assert.ok((comment?.textWordCount ?? 0) > 0);
  assert.ok((comment?.textCharCount ?? 0) > 0);
  assert.equal(comment?.hyperlinks?.[0]?.url, 'https://example.invalid/ref');
  assert.equal(comment?.fields?.[0]?.kind, 'hyperlink');
  assert.equal(comment?.placeholders?.[0]?.value, '<$projecttitle>');
  assert.equal(comment?.placeholders?.[0]?.source, 'comment');
  assert.equal(comment?.paragraphs?.length, 1);
  assert.equal(comment?.runs?.length ? comment.runs.length > 0 : false, true);
  assert.equal(comment?.rtfModel?.fields?.[0]?.kind, 'hyperlink');
});

test('loads notes.styles and derives note style spans', () => {
  const archive = ScrivenerArchive.fromFileMap({
    'Files/Data/DOC-2/notes.rtf': String.raw`{\rtf1\ansi <$Scr_Cs::0>Note styled<!$Scr_Cs::0> fin}`,
    'Files/Data/DOC-2/notes.styles': 'STYLE-NOTE',
  });

  const documents = parseDocuments(archive, {
    basePath: '',
    decodeRtf: true,
    includeBinaryAssets: false,
    extractPlaceholders: false,
    extractStyleIds: true,
    extractStyleSpans: true,
    extractEmbeddedImages: false,
    extractInlineAnnotations: false,
    extractLinkedImages: false,
    extractHyperlinks: false,
    extractBookmarks: false,
    extractFields: false,
    extractTables: false,
    computeTextCounts: false,
    styleDefinitions: [
      { id: 'STYLE-NOTE', name: 'Note emphasis' },
    ],
  });

  const document = documents['DOC-2'];

  assert.equal(document.notesStyleIds?.[0], 'STYLE-NOTE');
  assert.equal(document.notesStyleRefs?.[0]?.name, 'Note emphasis');
  assert.equal(document.notesPlain, '<$Scr_Cs::0>Note styled<!$Scr_Cs::0> fin');
  assert.deepEqual(
    document.notesStyleSpans
      ?.filter((span) => span.kind === 'character')
      .map((span) => ({
        id: span.id,
        text: document.notesPlain?.slice(span.start, span.end),
      })),
    [
      {
        id: 'STYLE-NOTE',
        text: 'Note styled',
      },
    ],
  );
});


test('annotates parsed paragraphs with their effective style ids', () => {
  const archive = ScrivenerArchive.fromFileMap({
    'Files/Data/DOC-3/content.rtf': String.raw`{\rtf1\ansi <$Scr_Ps::0>Mai 2018\par <!$Scr_Ps::0>Corps}`,
    'Files/Data/DOC-3/content.styles': 'STYLE-DATE',
  });

  const documents = parseDocuments(archive, {
    basePath: '',
    decodeRtf: true,
    includeBinaryAssets: false,
    extractPlaceholders: false,
    extractStyleIds: true,
    extractStyleSpans: true,
    extractEmbeddedImages: false,
    extractInlineAnnotations: false,
    extractLinkedImages: false,
    extractHyperlinks: false,
    extractBookmarks: false,
    extractFields: false,
    extractTables: false,
    computeTextCounts: false,
    styleDefinitions: [
      { id: 'STYLE-DATE', name: 'date' },
    ],
  });

  const document = documents['DOC-3'];

  assert.equal(document.paragraphs?.[0]?.styleId, 'STYLE-DATE');
  assert.equal(document.paragraphs?.[1]?.styleId, 'STYLE-DATE');
});


test('resolves inline annotation style ids from parser directives and preserves linked image placements', () => {
  const token = '{$SCRImageLink[w:120,h:90]=$PROJECT://ABCDEF12-3456-7890-ABCD-EF1234567890.JPG}';
  const archive = ScrivenerArchive.fromFileMap({
    'Files/Data/DOC-4/content.rtf': String.raw`{\rtf1\ansi Avant ${token} apres\par {\Scrv_annot \text=<$Scr_Ps::0>Mai 2018<!$Scr_Ps::0>\end_Scrv_annot}}`,
    'Files/Data/DOC-4/content.styles': 'STYLE-DATE',
  });

  const documents = parseDocuments(archive, {
    basePath: '',
    decodeRtf: true,
    includeBinaryAssets: false,
    extractPlaceholders: false,
    extractStyleIds: true,
    extractStyleSpans: false,
    extractEmbeddedImages: false,
    extractInlineAnnotations: true,
    extractLinkedImages: true,
    extractHyperlinks: false,
    extractBookmarks: false,
    extractFields: false,
    extractTables: false,
    computeTextCounts: false,
  });

  const document = documents['DOC-4'];

  assert.equal(document.inlineAnnotations?.[0]?.styleRef, '0');
  assert.equal(document.inlineAnnotations?.[0]?.styleId, 'STYLE-DATE');
  assert.equal(document.linkedImages?.[0]?.paragraphIndex, 0);
  assert.equal(typeof document.linkedImages?.[0]?.start, 'number');
  assert.equal(typeof document.linkedImages?.[0]?.end, 'number');
  assert.equal(document.rtfModel?.annotations?.[0]?.styleId, 'STYLE-DATE');
});

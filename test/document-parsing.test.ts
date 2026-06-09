import test from 'node:test';
import assert from 'node:assert/strict';

import { ScrivenerArchive } from '../src/archive/ScrivenerArchive.js';
import { parseDocuments } from '../src/parsers/documents.js';
import { parseProject, parseProjectBinder } from '../src/parsers/project.js';
import type { ScrivenerParserDiagnostic } from '../src/types.js';

const BASE_PARSE_OPTIONS = {
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
  extractFields: false,
  extractTables: false,
  computeTextCounts: false,
};

function asciiBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

test('parseDocuments can limit parsing to selected document ids', () => {
  const archive = ScrivenerArchive.fromFileMap({
    'Files/Data/DOC-1/content.rtf': '{\\rtf1\\ansi One.}',
    'Files/Data/DOC-2/content.rtf': '{\\rtf1\\ansi Two.}',
  });

  const documents = parseDocuments(archive, {
    ...BASE_PARSE_OPTIONS,
    documentIds: ['DOC-2'],
  });

  assert.deepEqual(Object.keys(documents), ['DOC-2']);
  assert.equal(documents['DOC-2']?.textPlain, 'Two.');
});

test('links comment anchors to parsed comments without circular references', () => {
  const archive = ScrivenerArchive.fromFileMap({
    'Files/Data/DOC-1/content.rtf':
      '{\\rtf1\\ansi Before {\\field{\\*\\fldinst{HYPERLINK "scrivcmt://COMMENT-1"}}{\\fldrslt [1]}} after.}',
    'Files/Data/DOC-1/content.comments':
      '<Comments><Comment ID="COMMENT-1" Author="Anon" Number="3" Collapsed="Yes"><![CDATA[{\\rtf1\\ansi Anonymized comment.}]]></Comment></Comments>',
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
  assert.equal(document.commentAnchors?.[0]?.textStart, 7);
  assert.equal(document.commentAnchors?.[0]?.textEnd, 10);
  assert.deepEqual(document.comments?.[0]?.anchorFieldIndexes, [0]);
  assert.equal(document.comments?.[0]?.number, 3);
  assert.equal(document.comments?.[0]?.collapsed, true);
  assert.equal(document.comments?.[0]?.hasAnchors, true);
  assert.match(document.comments?.[0]?.text ?? '', /Anonymized comment/);
  assert.equal(document.rtfModel?.commentAnchors?.[0]?.commentIndex, 0);
});

test('parses structured RTF content inside content.comments', () => {
  const archive = ScrivenerArchive.fromFileMap({
    'Files/Data/DOC-C/content.comments': String.raw`<Comments><Comment ID="COMMENT-C" Author="Anon" Color="0.85 0.85 0.85"><![CDATA[{\rtf1\ansi See {\field{\*\fldinst{HYPERLINK "https://example.invalid/ref"}}{\fldrslt source}} <$projecttitle>.}]]></Comment></Comments>`,
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
  assert.match(comment?.text ?? '', /See source/);
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
    'Files/Data/DOC-2/notes.rtf': String.raw`{\rtf1\ansi <$Scr_Cs::0>Note styled<!$Scr_Cs::0> end}`,
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
  assert.equal(document.notesPlain, 'Note styled end');
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
    'Files/Data/DOC-3/content.rtf': String.raw`{\rtf1\ansi <$Scr_Ps::0>May 2018\par <!$Scr_Ps::0>Body}`,
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
    'Files/Data/DOC-4/content.rtf': String.raw`{\rtf1\ansi Before ${token} after\par {\Scrv_annot \text=<$Scr_Ps::0>May 2018<!$Scr_Ps::0>\end_Scrv_annot}}`,
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

test('parseProject resolves RTF stylesheet spans to Scrivener style ids after byte decoding', () => {
  const archive = ScrivenerArchive.fromFileMap({
    'Mini.scrivx': String.raw`<ScrivenerProject>
  <Binder>
    <BinderItem UUID="DRAFT" Type="DraftFolder">
      <Title>Draft</Title>
      <Children>
        <BinderItem UUID="DOC-BYTE" Type="Text"><Title>Byte styled text</Title></BinderItem>
      </Children>
    </BinderItem>
  </Binder>
</ScrivenerProject>`,
    'Files/styles.xml': String.raw`<Styles>
  <Style><ID>STYLE-ACCENT</ID><Name>Accent</Name><Type>Char</Type></Style>
</Styles>`,
    'Files/Data/DOC-BYTE/content.rtf': asciiBytes(String.raw`{\rtf1\ansi\ansicpg950{\stylesheet{\cs1 Accent;}}Before {\cs1 \'b4\'fa\'b8\'d5} after}`),
  });

  const project = parseProject(archive, {
    decodeRtf: true,
    loadSnapshots: false,
    extractStyleSpans: true,
  });
  const document = project.documents['DOC-BYTE'];
  const accentSpan = document?.styleSpans?.find((span) => span.kind === 'character');

  assert.equal(document?.textPlain, 'Before 測試 after');
  assert.deepEqual(accentSpan, {
    id: 'STYLE-ACCENT',
    name: 'Accent',
    kind: 'character',
    start: 7,
    end: 9,
  });
});

test('parseProject keeps unmatched RTF stylesheet spans as canonical names', () => {
  const archive = ScrivenerArchive.fromFileMap({
    'Mini.scrivx': String.raw`<ScrivenerProject>
  <Binder>
    <BinderItem UUID="DRAFT" Type="DraftFolder">
      <Title>Draft</Title>
      <Children>
        <BinderItem UUID="DOC-RTF" Type="Text"><Title>RTF styled text</Title></BinderItem>
      </Children>
    </BinderItem>
  </Binder>
</ScrivenerProject>`,
    'Files/styles.xml': '<Styles/>',
    'Files/Data/DOC-RTF/content.rtf': String.raw`{\rtf1\ansi{\stylesheet{\cs2 Template Character;}}Before {\cs2 fallback} after}`,
  });

  const project = parseProject(archive, {
    decodeRtf: true,
    loadSnapshots: false,
    extractStyleSpans: true,
  });
  const document = project.documents['DOC-RTF'];
  const fallbackSpan = document?.styleSpans?.find((span) => span.kind === 'character');

  assert.deepEqual(fallbackSpan, {
    id: 'Template Character',
    name: 'Template Character',
    kind: 'character',
    start: 7,
    end: 15,
  });
});

test('parseProject defaults to lightweight parsing without RTF decoding or snapshots', () => {
  const archive = ScrivenerArchive.fromFileMap({
    'Mini.scrivx': String.raw`<ScrivenerProject>
  <Binder>
    <BinderItem UUID="DOC-DEFAULT" Type="Text"><Title>Default doc</Title></BinderItem>
  </Binder>
</ScrivenerProject>`,
    'Files/Data/DOC-DEFAULT/content.rtf': String.raw`{\rtf1\ansi Body}`,
    'Snapshots/DOC-DEFAULT.snapshots/2025-01-01-12-00-00+0100.rtf': String.raw`{\rtf1\ansi Snapshot}`,
  });

  const project = parseProject(archive);
  const document = project.documents['DOC-DEFAULT'];

  assert.equal(document?.hasText, true);
  assert.equal(document?.textPlain, undefined);
  assert.equal(document?.paragraphs?.length, 0);
  assert.deepEqual(project.snapshots, {});
});

test('parseProject derives binder display titles only when requested', () => {
  const archive = ScrivenerArchive.fromFileMap({
    'Mini.scrivx': String.raw`<ScrivenerProject>
  <Binder>
    <BinderItem UUID="DOC-TITLE" Type="Text" />
  </Binder>
</ScrivenerProject>`,
    'Files/Data/DOC-TITLE/content.rtf': String.raw`{\rtf1\ansi First sentence. Second sentence.}`,
  });

  const neutral = parseProject(archive, {
    decodeRtf: true,
  });
  assert.equal('displayTitle' in neutral.binder[0]!, false);
  assert.equal('displayTitleIsDerived' in neutral.binder[0]!, false);

  const derived = parseProject(archive, {
    decodeRtf: true,
    deriveDisplayTitles: true,
  });
  assert.equal(derived.binder[0]?.displayTitle, 'First sentence.');
  assert.equal(derived.binder[0]?.displayTitleIsDerived, true);
});

test('parseProject can continue past corrupt optional files in tolerant mode', () => {
  const diagnostics: ScrivenerParserDiagnostic[] = [];
  const archive = ScrivenerArchive.fromFileMap({
    'Mini.scrivx': String.raw`<ScrivenerProject>
  <Binder>
    <BinderItem UUID="DOC-1" Type="Text"><Title>Doc one</Title></BinderItem>
  </Binder>
</ScrivenerProject>`,
    'Files/Data/DOC-1/content.rtf': String.raw`{\rtf1\ansi Body}`,
    'Files/Data/DOC-1/content.comments': '<',
    'Files/search.indexes': '<',
    'Settings/templateinfo.xml': '<',
  });

  const project = parseProject(archive, {
    decodeRtf: true,
    loadSnapshots: false,
    tolerant: true,
    diagnostics,
  });

  assert.equal(project.documents['DOC-1']?.textPlain, 'Body');
  assert.equal(project.documents['DOC-1']?.comments?.length, 0);
  assert.equal(project.search.documents.length, 0);
  assert.equal(project.diagnostics, diagnostics);
  assert.ok(diagnostics.length >= 3);
  assert.ok(diagnostics.every((diagnostic) => diagnostic.code === 'xml_parse_failed'));
});

test('parseProjectBinder reads binder metadata without parsing documents', () => {
  const archive = ScrivenerArchive.fromFileMap({
    'Mini.scrivx': String.raw`<ScrivenerProject Identifier="P1" Version="2.0">
  <Binder>
    <BinderItem UUID="DRAFT" Type="DraftFolder">
      <Title>Draft</Title>
      <Children>
        <BinderItem UUID="DOC-1" Type="Text"><Title>Doc one</Title></BinderItem>
      </Children>
    </BinderItem>
  </Binder>
</ScrivenerProject>`,
    'Files/Data/DOC-1/content.rtf': String.raw`{\rtf1\ansi Body}`,
  });

  const project = parseProjectBinder(archive, {
    normalizeBinderSections: true,
  });

  assert.equal(project.info.identifier, 'P1');
  assert.equal(project.binder[0]?.children[0]?.uuid, 'DOC-1');
  assert.equal(project.binderSections?.draft?.uuid, 'DRAFT');
  assert.equal('documents' in project, false);
});

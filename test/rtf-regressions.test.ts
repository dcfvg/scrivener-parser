import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { extractRtfExtras } from '../src/rtf/extractExtras.js';
import { extractPlaceholders } from '../src/rtf/extractPlaceholders.js';
import { extractStyleSpans } from '../src/rtf/extractStyleSpans.js';
import { rtfToText } from '../src/rtf/rtfToText.js';

const ROOT = path.resolve(import.meta.dirname, '..');

function readFixture(...segments: string[]): string {
  return fs.readFileSync(path.join(ROOT, ...segments), 'utf8');
}

test('extracts Scrivener comment anchors from hyperlink fields', () => {
  const rtf = readFixture('test', 'fixtures', 'comment-anchors.rtf');

  const extras = extractRtfExtras(rtf);

  assert.equal(extras.fields.length, 2);
  assert.deepEqual(
    extras.commentAnchors.map((anchor) => anchor.commentId),
    [
      'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
      'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB',
    ],
  );
  assert.ok(extras.fields.every((field) => field.kind === 'comment-anchor'));
  assert.equal(extras.plainText, 'Bloc neutre [A] suite neutre [B] fin.');
});

test('extracts inline footnotes and annotations from embedded Scrivener markup', () => {
  const rtf = readFixture('test', 'fixtures', 'inline-markup.rtf');

  const extras = extractRtfExtras(rtf);

  assert.equal(extras.inlineAnnotations.length, 1);
  assert.match(extras.inlineAnnotations[0].text ?? '', /Annotation anonyme de test/);
  assert.equal(extras.inlineAnnotations[0].color, '0.100000 0.200000 0.300000');
  assert.equal(extras.inlineAnnotations[0].styleRef, '0');
  assert.equal(extras.footnotes.length, 1);
  assert.match(extras.footnotes[0].text ?? '', /Reference anonyme 2024/);
  assert.match(extras.footnotes[0].text ?? '', /https:\/\/example\.invalid\/reference/);
  assert.ok(extras.plainText.includes(extras.footnotes[0].token));
  assert.ok(!extras.plainText.includes('Scrv_fn'));
  assert.ok(!extras.plainText.includes('Scrv_annot'));
  assert.ok(!extras.footnotes[0].text?.includes('<$ScrKeepWithNext>'));
  assert.ok(!extras.inlineAnnotations[0].text?.includes('<$Scr_Ps::0>'));
});

test('extractPlaceholders keeps only real compile placeholders', () => {
  const plainText = String.raw`<$ScrKeepWithNext><$ScrKeepWithNextSplittable><$Scr_H::2><$Scr_Ps::0>Titre <$n:figure> \<$date> <$ScrvFn:note> <!$Scr_Ps::0>`;

  const placeholders = extractPlaceholders('', 'text', plainText);

  assert.deepEqual(
    placeholders.map((placeholder) => placeholder.value),
    ['<$n:figure>'],
  );
});

test('preserves style directives hidden inside inline annotations and footnotes', () => {
  const rtf = String.raw`{\rtf1\ansi <$Scr_Ps::0>Date test\
{\Scrv_annot \text=<!$Scr_Ps::0>Annotation masquee \end_Scrv_annot}\
Texte courant\
{\Scrv_fn=<$ScrKeepWithNext>Note invisible\end_Scrv_fn}Suite}`;

  const plainText = rtfToText(rtf);
  const spans = extractStyleSpans(
    rtf,
    plainText,
    [
      { id: 'STYLE-DATE', name: 'date' },
    ],
    ['STYLE-DATE'],
  ).filter((span) => span.kind === 'paragraph');

  assert.match(plainText, /<!\$Scr_Ps::0>/);
  assert.match(plainText, /<\$ScrKeepWithNext><\$ScrvFn:/);
  assert.deepEqual(
    spans.map((span) => ({
      id: span.id,
      text: plainText.slice(span.start, span.end),
    })),
    [
      {
        id: 'STYLE-DATE',
        text: 'Date test',
      },
      {
        id: 'STYLE-DATE',
        text: 'Texte courant',
      },
      {
        id: 'STYLE-DATE',
        text: '<$ScrvFn:Note%20invisible>Suite',
      },
    ],
  );
});

test('extracts list markers from listtext groups', () => {
  const rtf = readFixture('test', 'fixtures', 'listtext.rtf');

  const extras = extractRtfExtras(rtf);

  assert.ok(extras.lists.length >= 1);
  assert.equal(extras.lists[0].marker, '1.');
  assert.equal(extras.lists[0].listId, 7);
  assert.equal(extras.lists[0].level, 2);
});

test('extracts embedded images from pict groups', () => {
  const rtf = readFixture('test', 'fixtures', 'pict.rtf');

  const extras = extractRtfExtras(rtf);

  assert.ok(extras.embeddedImages.length >= 1);
  assert.equal(extras.assets[0]?.type, 'embedded-image');
  assert.equal(extras.embeddedImages[0]?.format, 'png');
  assert.match(extras.embeddedImages[0]?.base64 ?? '', /^iVBOR/);
  assert.ok(extras.assets.filter((asset) => asset.type === 'embedded-image').length >= 1);
  assert.ok((extras.embeddedImages[0]?.base64?.length ?? 0) > 10);
});

test('annotates paragraph metadata from leading Scrivener directives', () => {
  const rtf = String.raw`{\rtf1\ansi <$ScrKeepWithNext><$Scr_H::2><$Scr_Ps::0>Titre\
<!$Scr_H::2><!$Scr_Ps::0>Corps}`;

  const extras = extractRtfExtras(rtf);

  assert.equal(extras.paragraphs.length, 2);
  assert.equal(extras.paragraphs[0]?.keepWithNext, true);
  assert.equal(extras.paragraphs[0]?.headerLevel, 2);
  assert.equal(extras.paragraphs[1]?.keepWithNext, undefined);
  assert.equal(extras.paragraphs[1]?.headerLevel, undefined);
});

test('annotates the paragraph after an RTF page break', () => {
  const rtf = String.raw`{\rtf1\ansi Avant\
\page \pard {$SCRImageLink[w:3840;h:2160]=/tmp/figure.jpg}\
Apres}`;

  const extras = extractRtfExtras(rtf);

  assert.equal(extras.paragraphs.length, 3);
  assert.equal(extras.paragraphs[0]?.text, 'Avant');
  assert.equal(extras.paragraphs[1]?.text, '$SCRImageLink[w:3840;h:2160]=/tmp/figure.jpg');
  assert.equal(extras.paragraphs[1]?.pageBreakBefore, true);
  assert.equal(extras.paragraphs[2]?.pageBreakBefore, undefined);
});

test('extracts embedded Scrivener pdf assets without leaking filename text', () => {
  const rtf = String.raw`{\rtf1\ansi Avant {\*\scrivenerpdf {\*\pdffilename sample.pdf}} apres}`;

  const extras = extractRtfExtras(rtf);
  const pdfAsset = extras.assets.find((asset) => asset.type === 'embedded-pdf');

  assert.equal(extras.embeddedPdfs.length, 1);
  assert.equal(extras.embeddedPdfs[0]?.fileName, 'sample.pdf');
  assert.equal(extras.embeddedPdfs[0]?.paragraphIndex, 0);
  assert.equal(pdfAsset?.fileName, 'sample.pdf');
  assert.equal(pdfAsset?.type, 'embedded-pdf');
  assert.match(extras.plainText, /Avant/);
  assert.match(extras.plainText, /apres/);
  assert.equal(extras.plainText.includes('sample.pdf'), false);
});

test('extracts embedded pict payloads even when metadata groups precede the hex payload', () => {
  const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==';
  const pngHex = Buffer.from(pngBase64, 'base64').toString('hex').toUpperCase();
  const rtf = `{
\\rtf1\\ansi
{\\pict {\\*\\nisusfilename Pasted Graphic 4}\\pngblip
${pngHex}}
}`;

  const extras = extractRtfExtras(rtf);

  assert.equal(extras.embeddedImages.length, 1);
  assert.equal(extras.embeddedImages[0]?.format, 'png');
  assert.match(extras.embeddedImages[0]?.base64 ?? '', /^iVBOR/);
});

test('normalizes linked image paths inside the library', () => {
  const rtf = String.raw`{\rtf1\ansi {$SCRImageLink[w:640,h:480]=file://localhost/tmp/2017-04%20\'97%20(sample)/image%20one.jpg}}`;

  const extras = extractRtfExtras(rtf);

  assert.equal(extras.linkedImages.length, 1);
  assert.equal(
    extras.linkedImages[0]?.path,
    '/tmp/2017-04 — (sample)/image one.jpg',
  );
  assert.equal(
    extras.linkedImages[0]?.rawPath,
    'file://localhost/tmp/2017-04%20—%20(sample)/image%20one.jpg',
  );
  assert.equal(extras.linkedImages[0]?.source, 'external');
  assert.equal(extras.linkedImages[0]?.paragraphIndex, 0);
  assert.equal(typeof extras.linkedImages[0]?.start, 'number');
  assert.equal(typeof extras.linkedImages[0]?.end, 'number');
  assert.equal(extras.assets[0]?.type, 'linked-image');
  assert.equal(extras.assets[0]?.path, '/tmp/2017-04 — (sample)/image one.jpg');
  assert.equal(
    extras.assets[0]?.rawPath,
    'file://localhost/tmp/2017-04%20—%20(sample)/image%20one.jpg',
  );
  assert.equal(extras.assets[0]?.source, 'external');
});

test('distinguishes $PROJECT linked images and tolerates malformed duplicated path prefixes', () => {
  const rtf = String.raw`{\rtf1\ansi {$SCRImageLink[w:450;h:636]=1066]=$PROJECT://ABCDEF12-3456-7890-ABCD-EF1234567890.JPG}}`;

  const extras = extractRtfExtras(rtf);

  assert.equal(extras.linkedImages.length, 1);
  assert.equal(extras.linkedImages[0]?.path, '$PROJECT://ABCDEF12-3456-7890-ABCD-EF1234567890.JPG');
  assert.equal(extras.linkedImages[0]?.rawPath, '$PROJECT://ABCDEF12-3456-7890-ABCD-EF1234567890.JPG');
  assert.equal(extras.linkedImages[0]?.source, 'project');
  assert.equal(extras.linkedImages[0]?.targetUuid, 'ABCDEF12-3456-7890-ABCD-EF1234567890');
  assert.equal(extras.linkedImages[0]?.fileExtension, 'jpg');
  assert.equal(extras.assets[0]?.type, 'linked-image');
  assert.equal(extras.assets[0]?.source, 'project');
  assert.equal(extras.assets[0]?.targetUuid, 'ABCDEF12-3456-7890-ABCD-EF1234567890');
  assert.equal(extras.assets[0]?.fileExtension, 'jpg');
});

test('keeps character style spans scoped to their RTF group', () => {
  const rtf = '{\\rtf1\\ansi{\\stylesheet{\\cs1 Italic;}}Debut {\\cs1 italique} fin normal}';
  const plainText = rtfToText(rtf);
  const spans = extractStyleSpans(rtf, plainText, []);
  const italicSpan = spans.find((span) => span.kind === 'character');

  assert.equal(plainText, 'Debut italique fin normal');
  assert.deepEqual(italicSpan, {
    id: '1',
    name: '1',
    kind: 'character',
    start: 6,
    end: 14,
  });
});

test('ignores formatting line breaks and captures direct italic runs', () => {
  const rtf = '{\\rtf1\\ansi Texte avant \\n\\i Guests\\n\\i0  apres}';
  const plainText = rtfToText(rtf);
  const italicSpan = extractStyleSpans(rtf, plainText, []).find((span) => span.kind === 'character');

  assert.equal(plainText, 'Texte avant Guests apres');
  assert.deepEqual(italicSpan, {
    id: 'rtf-italic',
    name: 'rtf-italic',
    kind: 'character',
    start: 12,
    end: 18,
  });
});

test('keeps direct italic offsets aligned after embedded Scrivener annotations', () => {
  const rtf = String.raw`{\rtf1\ansi {\Scrv_annot \text=<$ScrKeepWithNext><$Scr_Ps::0>Annotation interne \end_Scrv_annot}\i Floating University \i0 suite}`;
  const plainText = rtfToText(rtf);
  const italicSpan = extractStyleSpans(rtf, plainText, []).find(
    (span) => span.kind === 'character' && span.id === 'rtf-italic',
  );
  const italicText = 'Floating University ';

  assert.equal(plainText.indexOf('Floating University') >= 0, true);
  assert.deepEqual(italicSpan, {
    id: 'rtf-italic',
    name: 'rtf-italic',
    kind: 'character',
    start: plainText.indexOf('Floating University'),
    end: plainText.indexOf('Floating University') + italicText.length,
  });
});

test('treats bare backslash line endings as paragraph breaks', () => {
  const rtf = `{\\rtf1\\ansi{\\stylesheet{\\s0 Normal;}{\\s1 fig;}{\\s2 fig caption;}}\\s1 Figure bloc \\
\\s2 Legende bloc}`;
  const plainText = rtfToText(rtf);
  const paragraphSpans = extractStyleSpans(rtf, plainText, []).filter(
    (span) => span.kind === 'paragraph',
  );

  assert.equal(plainText, 'Figure bloc\nLegende bloc');
  assert.deepEqual(
    paragraphSpans.map((span) => ({
      kind: span.kind,
      start: span.start,
      end: span.end,
    })),
    [
      {
        kind: 'paragraph',
        start: 0,
        end: 11,
      },
      {
        kind: 'paragraph',
        start: 12,
        end: 24,
      },
    ],
  );
});

test('maps Scrivener paragraph-style markers to paragraph style spans without leaking after closing markers', () => {
  const rtf = '{\\rtf1\\ansi <$Scr_Ps::1>Figure A\\\nFigure B\\\n<!$Scr_Ps::1>Texte courant\\\n<$Scr_Ps::0>Retour normal}';
  const plainText = rtfToText(rtf);
  const spans = extractStyleSpans(
    rtf,
    plainText,
    [
      { id: 'STYLE-BASE', name: 'normal' },
      { id: 'STYLE-FIG', name: 'fig' },
    ],
    ['STYLE-BASE', 'STYLE-FIG'],
  ).filter((span) => span.kind === 'paragraph');

  assert.equal(
    plainText,
    '<$Scr_Ps::1>Figure A\nFigure B\n<!$Scr_Ps::1>Texte courant\n<$Scr_Ps::0>Retour normal',
  );
  assert.deepEqual(
    spans.map((span) => ({
      id: span.id,
      name: span.name,
      text: plainText.slice(span.start, span.end),
    })),
    [
      {
        id: 'STYLE-FIG',
        name: 'fig',
        text: 'Figure A',
      },
      {
        id: 'STYLE-FIG',
        name: 'fig',
        text: 'Figure B',
      },
      {
        id: 'STYLE-BASE',
        name: 'normal',
        text: 'Texte courant',
      },
      {
        id: 'STYLE-BASE',
        name: 'normal',
        text: 'Retour normal',
      },
    ],
  );
});

test('maps bare rtf s0 paragraphs to the detected default style definition', () => {
  const rtf = '{\\rtf1\\ansi{\\stylesheet{\\s0 Normal;}{\\s1 Citation;}}\\s0 Texte courant\\par\\s1 Bloc cite}';
  const plainText = rtfToText(rtf);
  const spans = extractStyleSpans(
    rtf,
    plainText,
    [
      { id: 'STYLE-BASE', name: 'P (from default)', type: 'Para+Char' },
      { id: 'STYLE-CIT', name: 'Citation', type: 'Para+Char' },
    ],
  ).filter((span) => span.kind === 'paragraph');

  assert.equal(spans[0]?.id, 'STYLE-BASE');
  assert.equal(spans[0]?.name, 'P (from default)');
  assert.equal(plainText.slice(spans[0]?.start, spans[0]?.end), 'Texte courant');
  assert.equal(plainText.slice(spans[1]?.start, spans[1]?.end), 'Bloc cite');
});

test('skips non-style Scrivener directives before paragraph style markers', () => {
  const rtf = '{\\rtf1\\ansi <$ScrKeepWithNext><$Scr_H::2><$Scr_Cs::0><$Scr_Ps::0>Titre lisible}';
  const plainText = rtfToText(rtf);
  const spans = extractStyleSpans(
    rtf,
    plainText,
    [
      { id: 'STYLE-TITLE', name: 'Titre' },
    ],
    ['STYLE-TITLE'],
  ).filter((span) => span.kind === 'paragraph');

  assert.deepEqual(
    spans.map((span) => ({
      id: span.id,
      text: plainText.slice(span.start, span.end),
    })),
    [
      {
        id: 'STYLE-TITLE',
        text: 'Titre lisible',
      },
    ],
  );
});


test('maps Scrivener character-style directives to character spans', () => {
  const rtf = '{\rtf1\ansi <$Scr_Cs::0>Accent<!$Scr_Cs::0> normal}';
  const plainText = rtfToText(rtf);
  const spans = extractStyleSpans(
    rtf,
    plainText,
    [
      { id: 'STYLE-ACCENT', name: 'Accent' },
    ],
    ['STYLE-ACCENT'],
  ).filter((span) => span.kind === 'character' && span.id === 'STYLE-ACCENT');

  assert.deepEqual(
    spans.map((span) => ({
      id: span.id,
      text: plainText.slice(span.start, span.end),
    })),
    [
      {
        id: 'STYLE-ACCENT',
        text: 'Accent',
      },
    ],
  );
});

test('types Scrivener document links separately from web hyperlinks', () => {
  const rtf = String.raw`{\rtf1\ansi Avant {\field{\*\fldinst{HYPERLINK "scrivlnk://AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"}}{\fldrslt Cible interne}} apres.}`;
  const extras = extractRtfExtras(rtf);

  assert.equal(extras.fields.length, 1);
  assert.equal(extras.fields[0]?.kind, 'scrivener-link');
  assert.equal(extras.fields[0]?.targetUuid, 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA');
  assert.equal(extras.hyperlinks.length, 0);
});

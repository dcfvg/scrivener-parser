import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { extractRtfExtras } from '../src/rtf/extractExtras.js';
import { extractPlaceholders } from '../src/rtf/extractPlaceholders.js';
import { extractStyleSpans } from '../src/rtf/extractStyleSpans.js';
import { rtfToText } from '../src/rtf/rtfToText.js';
import { decodeRtfBytes, tokenizeRtfBytes } from '../src/rtf/byteTokenizer.js';
import { parseRtfContent } from '../src/parsers/rtf-content.js';
import {
  decodeRtfBytes as publicDecodeRtfBytes,
  parseRtfPropertiesFromBytes as publicParseRtfPropertiesFromBytes,
  rtfToText as publicRtfToText,
  tokenizeRtfBytes as publicTokenizeRtfBytes,
} from '../src/index.js';

const ROOT = path.resolve(import.meta.dirname, '..');

function readFixture(...segments: string[]): string {
  return fs.readFileSync(path.join(ROOT, ...segments), 'utf8');
}

function asciiBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((size, chunk) => size + chunk.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
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
  assert.equal(extras.plainText, 'Neutral block [A] neutral continuation [B] end.');
});

test('public API exposes byte-aware RTF helpers', () => {
  const bytes = asciiBytes(String.raw`{\rtf1\ansi\ansicpg1252 Caf\'e9}`);

  const tokenized = publicTokenizeRtfBytes(bytes);
  const properties = publicParseRtfPropertiesFromBytes(bytes);

  assert.equal(publicDecodeRtfBytes(bytes), String.raw`{\rtf1\ansi\ansicpg1252 Café}`);
  assert.equal(publicRtfToText(bytes), 'Café');
  assert.equal(tokenized.properties.codePage, 1252);
  assert.equal(properties.codePage, 1252);
});

test('extracts inline footnotes and annotations from embedded Scrivener markup', () => {
  const rtf = readFixture('test', 'fixtures', 'inline-markup.rtf');

  const extras = extractRtfExtras(rtf);

  assert.equal(extras.inlineAnnotations.length, 1);
  assert.match(extras.inlineAnnotations[0].text ?? '', /Anonymous test annotation/);
  assert.equal(extras.inlineAnnotations[0].color, '0.100000 0.200000 0.300000');
  assert.equal(extras.inlineAnnotations[0].styleRef, '0');
  assert.equal(extras.footnotes.length, 1);
  assert.match(extras.footnotes[0].text ?? '', /Anonymous reference 2024/);
  assert.match(extras.footnotes[0].text ?? '', /https:\/\/example\.invalid\/reference/);
  assert.ok(extras.plainText.includes(extras.footnotes[0].token));
  assert.ok(!extras.plainText.includes('Scrv_fn'));
  assert.ok(!extras.plainText.includes('Scrv_annot'));
  assert.ok(!extras.footnotes[0].text?.includes('<$ScrKeepWithNext>'));
  assert.ok(!extras.inlineAnnotations[0].text?.includes('<$Scr_Ps::0>'));
});

test('extractPlaceholders keeps only real compile placeholders', () => {
  const plainText = String.raw`<$ScrKeepWithNext><$ScrKeepWithNextSplittable><$Scr_H::2><$Scr_Ps::0>Title <$n:figure> \<$date> <$ScrvFn:note> <!$Scr_Ps::0>`;

  const placeholders = extractPlaceholders('', 'text', plainText);

  assert.deepEqual(
    placeholders.map((placeholder) => placeholder.value),
    ['<$n:figure>'],
  );
});

test('preserves style directives hidden inside inline annotations and footnotes', () => {
  const rtf = String.raw`{\rtf1\ansi <$Scr_Ps::0>Test date\
{\Scrv_annot \text=<!$Scr_Ps::0>Hidden annotation \end_Scrv_annot}\
Current text\
{\Scrv_fn=<$ScrKeepWithNext>Hidden note\end_Scrv_fn}After}`;

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
        text: 'Test date',
      },
      {
        id: 'STYLE-DATE',
        text: 'Current text',
      },
      {
        id: 'STYLE-DATE',
        text: '<$ScrvFn:Hidden%20note>After',
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

test('extracts RTF document properties from font, color and style tables', () => {
  const rtf = String.raw`{\rtf1\ansi\ansicpg950\deff1
{\fonttbl{\f0\froman\fcharset0 Times New Roman;}{\f1\fswiss Helvetica;}}
{\colortbl;\red255\green0\blue0;\red0\green128\blue64;}
{\stylesheet{\s0\sbasedon0\snext1 Normal;}{\cs2 Character Accent;}{\ds3 Section Style;}}
\s0 Text}`;

  const extras = extractRtfExtras(rtf);

  assert.equal(extras.properties.rtfVersion, 1);
  assert.equal(extras.properties.characterSet, 'ansi');
  assert.equal(extras.properties.codePage, 950);
  assert.equal(extras.properties.defaultFont, 1);
  assert.deepEqual(extras.properties.fontTable, [
    { index: 0, family: 'roman', charset: 0, name: 'Times New Roman' },
    { index: 1, family: 'swiss', name: 'Helvetica' },
  ]);
  assert.deepEqual(extras.properties.colorTable, [
    { red: 0, green: 0, blue: 0 },
    { red: 255, green: 0, blue: 0 },
    { red: 0, green: 128, blue: 64 },
  ]);
  assert.deepEqual(extras.properties.stylesheet, [
    { index: 0, type: 'paragraph', basedOn: 0, next: 1, name: 'Normal' },
    { index: 2, type: 'character', name: 'Character Accent' },
    { index: 3, type: 'section', name: 'Section Style' },
  ]);
});

test('extracts inline RTF font table entries', () => {
  const rtf = String.raw`{\rtf1\ansi{\fonttbl\f0\fnil\fcharset0 Cochin;}\f0 Text}`;

  const extras = extractRtfExtras(rtf);

  assert.deepEqual(extras.properties.fontTable, [
    { index: 0, family: 'default', charset: 0, name: 'Cochin' },
  ]);
});

test('ignores Cocoa expanded color table destination text', () => {
  const rtf = String.raw`{\rtf1\ansi{\expandedcolortbl;;\cssrgb\c0\c0\c0;}Visible}`;

  const extras = extractRtfExtras(rtf);

  assert.equal(extras.plainText, 'Visible');
});

test('decodes RTF hex byte runs with ansicpg950 Big5', () => {
  const bytes = asciiBytes(String.raw`{\rtf1\ansi\ansicpg950 \'b4\'fa\'b8\'d5}`);

  const tokenized = tokenizeRtfBytes(bytes);

  assert.equal(tokenized.properties.codePage, 950);
  assert.equal(decodeRtfBytes(bytes), String.raw`{\rtf1\ansi\ansicpg950 ` + '測試}');
  assert.equal(rtfToText(bytes), '測試');
});

test('decodes RTF hex byte runs with ansicpg932 Shift-JIS', () => {
  const bytes = asciiBytes(String.raw`{\rtf1\ansi\ansicpg932 \'83\'65\'83\'58\'83\'67}`);

  const parsed = parseRtfContent(bytes);

  assert.equal(parsed.plainText, 'テスト');
  assert.equal(parsed.paragraphs[0].text, 'テスト');
});

test('does not treat Shift-JIS trail byte 0x5c as an RTF control prefix', () => {
  const bytes = concatBytes(
    asciiBytes(String.raw`{\rtf1\ansi\ansicpg932 `),
    new Uint8Array([0x83, 0x5c]),
    asciiBytes(' test}'),
  );

  const parsed = parseRtfContent(bytes);

  assert.equal(parsed.plainText, 'ソ test');
});

test('honors uc fallback length after unicode control words', () => {
  const bytes = asciiBytes(String.raw`{\rtf1\ansi\uc2\u233?? after}`);

  const parsed = parseRtfContent(bytes);

  assert.equal(parsed.plainText, 'é after');
});

test('removes multibyte unicode fallbacks without shifting following text', () => {
  const bytes = asciiBytes(String.raw`{\rtf1\ansi\ansicpg932\uc2\u12477\'83\'5c after}`);

  const parsed = parseRtfContent(bytes);

  assert.equal(decodeRtfBytes(bytes), String.raw`{\rtf1\ansi\ansicpg932\uc0\u12477{} after}`);
  assert.equal(parsed.plainText, 'ソ after');
});

test('combines unicode surrogate pairs for emoji escapes', () => {
  const rtf = String.raw`{\rtf1\ansi Emoji \u-10179?\u-8704? end}`;
  const bytes = asciiBytes(rtf);

  const parsed = parseRtfContent(bytes);

  assert.equal(rtfToText(rtf), 'Emoji 😀 end');
  assert.equal(parsed.plainText, 'Emoji 😀 end');
});

test('keeps RTF groups stable across bin payload bytes', () => {
  const bytes = concatBytes(
    asciiBytes(String.raw`{\rtf1\ansi Before {\*\unknown\bin4 `),
    new Uint8Array([0x7b, 0x7d, 0x5c, 0x00]),
    asciiBytes(String.raw`} After}`),
  );

  const parsed = parseRtfContent(bytes);

  assert.equal(parsed.plainText, 'Before  After');
});

test('normalizes pict bin payloads to hex for embedded image extraction', () => {
  const bytes = concatBytes(
    asciiBytes(String.raw`{\rtf1\ansi{\pict\pngblip\bin8 `),
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    asciiBytes('}}'),
  );

  const parsed = parseRtfContent(bytes, {
    extractEmbeddedImages: true,
  });

  assert.equal(parsed.embeddedImages?.length, 1);
  assert.equal(parsed.embeddedImages?.[0].format, 'png');
  assert.match(parsed.embeddedImages?.[0].base64 ?? '', /^iVBOR/);
});

test('annotates paragraph metadata from leading Scrivener directives', () => {
  const rtf = String.raw`{\rtf1\ansi <$ScrKeepWithNext><$Scr_H::2><$Scr_Ps::0>Title\
<!$Scr_H::2><!$Scr_Ps::0>Body}`;

  const extras = extractRtfExtras(rtf);

  assert.equal(extras.paragraphs.length, 2);
  assert.equal(extras.paragraphs[0]?.keepWithNext, true);
  assert.equal(extras.paragraphs[0]?.headerLevel, 2);
  assert.equal(extras.paragraphs[1]?.keepWithNext, undefined);
  assert.equal(extras.paragraphs[1]?.headerLevel, undefined);
});

test('annotates the paragraph after an RTF page break', () => {
  const rtf = String.raw`{\rtf1\ansi Before\
\page \pard {$SCRImageLink[w:3840;h:2160]=/tmp/figure.jpg}\
After}`;

  const extras = extractRtfExtras(rtf);

  assert.equal(extras.paragraphs.length, 3);
  assert.equal(extras.paragraphs[0]?.text, 'Before');
  assert.equal(extras.paragraphs[1]?.text, '$SCRImageLink[w:3840;h:2160]=/tmp/figure.jpg');
  assert.equal(extras.paragraphs[1]?.pageBreakBefore, true);
  assert.equal(extras.paragraphs[2]?.pageBreakBefore, undefined);
});

test('extracts embedded Scrivener pdf assets without leaking filename text', () => {
  const rtf = String.raw`{\rtf1\ansi Before {\*\scrivenerpdf {\*\pdffilename sample.pdf}} after}`;

  const extras = extractRtfExtras(rtf);
  const pdfAsset = extras.assets.find((asset) => asset.type === 'embedded-pdf');

  assert.equal(extras.embeddedPdfs.length, 1);
  assert.equal(extras.embeddedPdfs[0]?.fileName, 'sample.pdf');
  assert.equal(extras.embeddedPdfs[0]?.paragraphIndex, 0);
  assert.equal(pdfAsset?.fileName, 'sample.pdf');
  assert.equal(pdfAsset?.type, 'embedded-pdf');
  assert.match(extras.plainText, /Before/);
  assert.match(extras.plainText, /after/);
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

test('splits consecutive unbraced Scrivener image links before following markup', () => {
  const rtf = String.raw`{\rtf1\ansi $SCRImageLink[w:10;h:20]=/tmp/one.jpg$SCRImageLink[w:30;h:40]=/tmp/two.jpg<!$Scr_Ps::0>}`;

  const extras = extractRtfExtras(rtf);

  assert.equal(extras.linkedImages.length, 2);
  assert.deepEqual(
    extras.linkedImages.map((image) => ({
      path: image.path,
      rawPath: image.rawPath,
      width: image.width,
      height: image.height,
    })),
    [
      {
        path: '/tmp/one.jpg',
        rawPath: '/tmp/one.jpg',
        width: 10,
        height: 20,
      },
      {
        path: '/tmp/two.jpg',
        rawPath: '/tmp/two.jpg',
        width: 30,
        height: 40,
      },
    ],
  );
  assert.equal(extras.assets.filter((asset) => asset.type === 'linked-image').length, 2);
  assert.ok(extras.linkedImages.every((image) => !image.path.includes('$SCRImageLink')));
  assert.ok(extras.linkedImages.every((image) => !image.path.includes('<$Scr')));
});

test('stops unbraced Scrivener image links at media extensions before caption text', () => {
  const rtf = String.raw`{\rtf1\ansi $SCRImageLink[w:595;h:200]=/tmp/FICO.psdFig. Caption text}`;

  const extras = extractRtfExtras(rtf);

  assert.equal(extras.linkedImages.length, 1);
  assert.equal(extras.linkedImages[0]?.path, '/tmp/FICO.psd');
  assert.equal(extras.linkedImages[0]?.rawPath, '/tmp/FICO.psd');
  assert.equal(extras.linkedImages[0]?.raw, '$SCRImageLink[w:595;h:200]=/tmp/FICO.psd');
  assert.match(extras.plainText, /Fig\. Caption text/);
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
  const rtf = '{\\rtf1\\ansi{\\stylesheet{\\cs1 Italic;}}Start {\\cs1 italic} end normal}';
  const plainText = rtfToText(rtf);
  const spans = extractStyleSpans(rtf, plainText, []);
  const italicSpan = spans.find((span) => span.kind === 'character');

  assert.equal(plainText, 'Start italic end normal');
  assert.deepEqual(italicSpan, {
    id: 'Italic',
    name: 'Italic',
    kind: 'character',
    start: 6,
    end: 12,
  });
});

test('maps RTF stylesheet character styles to Scrivener style definitions by name', () => {
  const rtf = '{\\rtf1\\ansi{\\stylesheet{\\cs1 Accent;}}Before {\\cs1 accent} after}';
  const plainText = rtfToText(rtf);
  const spans = extractStyleSpans(
    rtf,
    plainText,
    [{ id: 'STYLE-ACCENT', name: 'Accent' }],
  );
  const accentSpan = spans.find((span) => span.kind === 'character');

  assert.deepEqual(accentSpan, {
    id: 'STYLE-ACCENT',
    name: 'Accent',
    kind: 'character',
    start: 7,
    end: 13,
  });
});

test('uses canonical RTF style names when stylesheet entries are missing', () => {
  const rtf = '{\\rtf1\\ansi\\s3 Before {\\cs1 styled} after}';
  const plainText = rtfToText(rtf);
  const spans = extractStyleSpans(rtf, plainText, []);

  assert.equal(plainText, 'Before styled after');
  assert.deepEqual(
    spans.map((span) => ({
      id: span.id,
      name: span.name,
      kind: span.kind,
      text: plainText.slice(span.start, span.end),
    })),
    [
      {
        id: 'rtf-s3',
        name: 'rtf-s3',
        kind: 'paragraph',
        text: 'Before styled after',
      },
      {
        id: 'rtf-cs1',
        name: 'rtf-cs1',
        kind: 'character',
        text: 'styled',
      },
    ],
  );
});

test('ignores formatting line breaks and captures direct italic runs', () => {
  const rtf = '{\\rtf1\\ansi Text before \\n\\i Guests\\n\\i0  after}';
  const plainText = rtfToText(rtf);
  const italicSpan = extractStyleSpans(rtf, plainText, []).find((span) => span.kind === 'character');

  assert.equal(plainText, 'Text before Guests after');
  assert.deepEqual(italicSpan, {
    id: 'rtf-italic',
    name: 'rtf-italic',
    kind: 'character',
    start: 12,
    end: 18,
  });
});

test('captures direct underline runs and combines them with bold and italic', () => {
  const rtf = '{\\rtf1\\ansi A \\ul mark\\ulnone  then \\b\\i\\ul all\\ulnone\\i0\\b0 .}';
  const plainText = rtfToText(rtf);
  const spans = extractStyleSpans(rtf, plainText, []).filter((span) => span.kind === 'character');

  assert.equal(plainText, 'A mark then all.');
  assert.deepEqual(spans, [
    {
      id: 'rtf-underline',
      name: 'rtf-underline',
      kind: 'character',
      start: 2,
      end: 6,
    },
    {
      id: 'rtf-bold-italic-underline',
      name: 'rtf-bold-italic-underline',
      kind: 'character',
      start: 12,
      end: 15,
    },
  ]);
});

test('normalizes RTF underline variants and ignores underline color controls', () => {
  const rtf = '{\\rtf1\\ansi A {\\uldb double} B\\ulc1{} color C {\\ulwave wave} D {\\ulstyle1 style} E {\\ulfoo unknown} end}';
  const plainText = rtfToText(rtf);
  const spans = extractStyleSpans(rtf, plainText, []).filter((span) => span.kind === 'character');

  assert.equal(plainText, 'A double B color C wave D style E unknown end');
  assert.deepEqual(
    spans.map((span) => ({
      id: span.id,
      text: plainText.slice(span.start, span.end),
    })),
    [
      { id: 'rtf-underline', text: 'double' },
      { id: 'rtf-underline', text: 'wave' },
      { id: 'rtf-underline', text: 'style' },
    ],
  );
});

test('keeps direct italic offsets aligned after embedded Scrivener annotations', () => {
  const rtf = String.raw`{\rtf1\ansi {\Scrv_annot \text=<$ScrKeepWithNext><$Scr_Ps::0>Internal annotation \end_Scrv_annot}\i Floating University \i0 after}`;
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
  const rtf = `{\\rtf1\\ansi{\\stylesheet{\\s0 Normal;}{\\s1 fig;}{\\s2 fig caption;}}\\s1 Figure block \\
\\s2 Caption block}`;
  const plainText = rtfToText(rtf);
  const paragraphSpans = extractStyleSpans(rtf, plainText, []).filter(
    (span) => span.kind === 'paragraph',
  );

  assert.equal(plainText, 'Figure block\nCaption block');
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
        end: 12,
      },
      {
        kind: 'paragraph',
        start: 13,
        end: 26,
      },
    ],
  );
});

test('maps Scrivener paragraph-style markers to paragraph style spans without leaking after closing markers', () => {
  const rtf = '{\\rtf1\\ansi <$Scr_Ps::1>Figure A\\\nFigure B\\\n<!$Scr_Ps::1>Current text\\\n<$Scr_Ps::0>Back to normal}';
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
    '<$Scr_Ps::1>Figure A\nFigure B\n<!$Scr_Ps::1>Current text\n<$Scr_Ps::0>Back to normal',
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
        text: 'Current text',
      },
      {
        id: 'STYLE-BASE',
        name: 'normal',
        text: 'Back to normal',
      },
    ],
  );
});

test('maps bare rtf s0 paragraphs to the detected default style definition', () => {
  const rtf = '{\\rtf1\\ansi{\\stylesheet{\\s0 Normal;}{\\s1 Citation;}}\\s0 Current text\\par\\s1 Quoted block}';
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
  assert.equal(plainText.slice(spans[0]?.start, spans[0]?.end), 'Current text');
  assert.equal(plainText.slice(spans[1]?.start, spans[1]?.end), 'Quoted block');
});

test('skips non-style Scrivener directives before paragraph style markers', () => {
  const rtf = '{\\rtf1\\ansi <$ScrKeepWithNext><$Scr_H::2><$Scr_Cs::0><$Scr_Ps::0>Readable title}';
  const plainText = rtfToText(rtf);
  const spans = extractStyleSpans(
    rtf,
    plainText,
    [
      { id: 'STYLE-TITLE', name: 'Title' },
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
        text: 'Readable title',
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
  const rtf = String.raw`{\rtf1\ansi Before {\field{\*\fldinst{HYPERLINK "scrivlnk://AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"}}{\fldrslt Internal target}} after.}`;
  const extras = extractRtfExtras(rtf);

  assert.equal(extras.fields.length, 1);
  assert.equal(extras.fields[0]?.kind, 'scrivener-link');
  assert.equal(extras.fields[0]?.targetUuid, 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA');
  assert.equal(extras.hyperlinks.length, 0);
});

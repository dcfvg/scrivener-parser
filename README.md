# scrivener-parser

Unofficial TypeScript parser for Scrivener `.scriv` projects.

> This is an independent implementation, not affiliated with or endorsed by Literature & Latte.  
> Based on the *Scrivener File Format Specification — Scrivener Version 3.0, File Format Version 2.0* (23 January 2018).

Parses a `.scriv` project directory and exposes its contents as plain JavaScript structures:

- Binder tree (documents, folders, hierarchy)
- RTF document content (plain text, style spans, annotations, footnotes, tables, images)
- Project metadata (labels, statuses, section types, custom fields, collections)
- Compile settings and formats
- Snapshots
- Project resources (styles, search index)

## Installation

```bash
npm install scrivener-parser
```

## Usage

```ts
import { parseScrivenerProject } from 'scrivener-parser';
import { loadDirectoryAsArchive } from 'scrivener-parser/archive/node';

const archive = await loadDirectoryAsArchive('./my-project.scriv');
const project = parseScrivenerProject(archive, {
  decodeRtf: true,
  loadSnapshots: true,
});

console.log(project.info.title);
console.log(project.binder.length, 'root items');
console.log(Object.keys(project.documents).length, 'documents');
```

The `loadDirectoryAsArchive` helper is Node.js / CLI only. In a browser context, construct a `ScrivenerArchive` directly from `File` or `FileSystemDirectoryHandle` entries.

## API

### `parseScrivenerProject(archive, options?)`

Returns a `ParsedScrivenerProject` with the following fields:

| Field | Description |
|---|---|
| `info` | Project title, identifier, and version |
| `binder` | Binder tree (`ScrivenerBinderNode[]`) |
| `documents` | Document content keyed by UUID |
| `metadata` | Labels, statuses, section types, custom metadata, collections |
| `settings` | Compile settings, project preferences, UI state |
| `compileFormats` | Compile format definitions |
| `resources` | Styles, search index, checksums |
| `snapshots` | Snapshots keyed by document UUID |
| `stats` | Writing history and word count targets |
| `compilePlan` | Resolved compile layout per binder node |

### Parser options

```ts
{
  decodeRtf?: boolean;            // Parse RTF content (default: false)
  loadSnapshots?: boolean;        // Load snapshot files
  includeBinaryAssets?: boolean;  // Include raw binary data (icons, images)
  extractStyleSpans?: boolean;    // Extract style span positions
  extractInlineAnnotations?: boolean;
  extractLinkedImages?: boolean;
  extractEmbeddedImages?: boolean;
  extractHyperlinks?: boolean;
  extractBookmarks?: boolean;
  extractFields?: boolean;
  extractTables?: boolean;
  extractPlaceholders?: boolean;  // Collect compile placeholders used
  computeTextCounts?: boolean;    // Word and character counts
  normalizeBinderSections?: boolean;
  attachBinderMetaToDocs?: boolean;
}
```

### RTF bytes

RTF files are decoded from bytes so `\ansicpgN` code pages and consecutive `\'xx` escapes are handled before text extraction. For direct RTF use, `rtfToText()` accepts either a string or `Uint8Array`; `decodeRtfBytes()` returns a normalized RTF string.

```ts
import {
  decodeRtfBytes,
  parseRtfContent,
  parseRtfPropertiesFromBytes,
  rtfToText,
  tokenizeRtfBytes,
} from 'scrivener-parser';

const tokenized = tokenizeRtfBytes(rtfBytes);
const properties = parseRtfPropertiesFromBytes(rtfBytes);
const parsed = parseRtfContent(rtfBytes);
const text = rtfToText(rtfBytes);
```

### Style spans

`styleSpans` use stable semantic ids. When an RTF stylesheet entry matches a Scrivener style definition by name, `span.id` is the Scrivener style id and `span.name` is the Scrivener style name. When no Scrivener definition is available, `span.id` and `span.name` fall back to the canonical RTF stylesheet name. Direct RTF formatting keeps renderer-neutral ids such as `rtf-bold`, `rtf-italic`, `rtf-underline`, or combined variants.

## Exports

| Entry point | Contents |
|---|---|
| `scrivener-parser` | Parser, types, and query utilities |
| `scrivener-parser/archive/node` | Node.js directory loader |

## Examples

The [`examples/`](examples/) directory contains ready-to-run scripts:

- **`inspect-sample.ts`** — Print a project summary (binder, documents, labels)
- **`export-writing-history.ts`** — Export writing statistics to CSV
- **`filter-custom-metadata.ts`** — Extract binder nodes by custom metadata field

```bash
pnpm tsx examples/inspect-sample.ts path/to/project.scriv
pnpm tsx examples/export-writing-history.ts path/to/project.scriv --out history.csv
pnpm tsx examples/filter-custom-metadata.ts path/to/project.scriv --field date
```

## Development

```bash
pnpm test        # Run test suite
pnpm run lint    # Type-check
pnpm run build   # Build dist/
```

The integration test in `test/tutorial-sample.test.ts` requires the Scrivener Tutorial project at `sample/Tutorial.scriv`. Copy your Scrivener Tutorial there to enable it; all other tests use self-contained synthetic fixtures.

## License

GPL-3.0-or-later — see [LICENSE](LICENSE).

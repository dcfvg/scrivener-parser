import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { parseScrivenerProject } from '../src/index.js';
import { loadDirectoryAsArchive } from '../src/archive/node.js';

interface CliOptions {
  inputPath?: string;
  outFile?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out' && i + 1 < argv.length) {
      options.outFile = argv[i + 1];
      i += 1;
      continue;
    }
    if (!arg.startsWith('-')) {
      options.inputPath = arg;
    }
  }
  return options;
}

function toCsvRow(values: Array<string | number | undefined>): string {
  return values
    .map((value) => {
      if (value === undefined || value === null) {
        return '';
      }
      const str = String(value);
      return str.includes(',') ? `"${str.replace(/"/g, '""')}"` : str;
    })
    .join(',');
}

function zero(value: number | undefined): number {
  return typeof value === 'number' && !Number.isNaN(value) ? value : 0;
}

async function main() {
  const { inputPath, outFile } = parseArgs(process.argv.slice(2));
  if (!inputPath) {
    console.error('Usage: pnpm tsx examples/export-writing-history.ts <path-to-scriv-file> [--out writing-history.csv]');
    process.exit(1);
  }
  const archive = await loadDirectoryAsArchive(path.resolve(inputPath));
  const project = parseScrivenerProject(archive, {
    decodeRtf: true,
    loadSnapshots: true,
    includeBinaryAssets: false,
  });
  const rows: string[] = [];
  rows.push(
    toCsvRow([
      'Date',
      'Words (Draft)',
      'Words (Elsewhere)',
      'Words (Total)',
      'Characters (Draft)',
      'Characters (Elsewhere)',
      'Characters (Total)',
      'Session Target',
    ]),
  );
  for (const entry of project.stats.writingHistory) {
    const draftWords = zero(entry.draftWordCount);
    const elsewhereWords = zero(entry.otherWordCount);
    const draftChars = zero(entry.draftCharCount);
    const elsewhereChars = zero(entry.otherCharCount);
    const row = toCsvRow([
      entry.date,
      draftWords,
      elsewhereWords,
      draftWords + elsewhereWords,
      draftChars,
      elsewhereChars,
      draftChars + elsewhereChars,
      entry.draftTargetWordCount ?? entry.sessionWordCount ?? '',
    ]);
    rows.push(row);
  }
  const csv = `${rows.join('\n')}\n`;
  if (outFile) {
    await fs.writeFile(outFile, csv, 'utf8');
    console.log(`Writing history exported to ${outFile}`);
  } else {
    console.log(csv);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

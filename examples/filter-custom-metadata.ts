import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { parseScrivenerProject } from '../src/index.js';
import { loadDirectoryAsArchive } from '../src/archive/node.js';
import type { ScrivenerBinderNode } from '../src/types.js';

interface CliOptions {
  inputPath?: string;
  field: string;
  outFile?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    field: 'date',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--field' && i + 1 < argv.length) {
      options.field = argv[i + 1];
      i += 1;
      continue;
    }
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

interface CustomMetaResult {
  uuid: string;
  title?: string;
  value?: string;
  children: CustomMetaResult[];
}

function mapSubtree(node: ScrivenerBinderNode, fieldId: string): CustomMetaResult {
  return {
    uuid: node.uuid,
    title: node.title,
    value: node.meta?.custom?.[fieldId],
    children: node.children.map((child) => mapSubtree(child, fieldId)),
  };
}

function collectMatches(nodes: ScrivenerBinderNode[], fieldId: string, results: CustomMetaResult[]): void {
  for (const node of nodes) {
    const value = node.meta?.custom?.[fieldId];
    if (value !== undefined) {
      results.push(mapSubtree(node, fieldId));
      continue;
    }
    collectMatches(node.children, fieldId, results);
  }
}

async function main() {
  const { inputPath, field, outFile } = parseArgs(process.argv.slice(2));
  if (!inputPath) {
    console.error('Usage: pnpm tsx examples/filter-custom-metadata.ts <path-to-scriv-file> --field <field-id-or-title> [--out meta.json]');
    process.exit(1);
  }
  const archive = await loadDirectoryAsArchive(path.resolve(inputPath));
  const project = parseScrivenerProject(archive, { includeBinaryAssets: false });

  const normalizedField = field.toLowerCase();
  const fieldDefinition = project.metadata.customMeta.find(
    (meta) => meta.id?.toLowerCase() === normalizedField || meta.title?.toLowerCase() === normalizedField,
  );
  const fieldId = fieldDefinition?.id ?? field;
  const matches: CustomMetaResult[] = [];
  collectMatches(project.binder, fieldId, matches);

  if (!matches.length) {
    console.warn(`No documents found with custom metadata field "${field}"`);
  }

  const payload = { field: fieldDefinition ?? { id: fieldId }, matches };
  const json = `${JSON.stringify(payload, null, 2)}\n`;
  if (outFile) {
    await fs.writeFile(outFile, json, 'utf8');
    console.log(`Custom metadata export written to ${outFile}`);
  } else {
    console.log(json);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

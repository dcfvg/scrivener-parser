import path from 'node:path';
import { parseScrivenerProject } from '../src/index.js';
import { loadDirectoryAsArchive } from '../src/archive/node.js';

async function main() {
  const root = path.resolve(process.argv[2] ?? 'sample/example.scriv');
  const archive = await loadDirectoryAsArchive(root);
  const project = parseScrivenerProject(archive, { includeBinaryAssets: false });
  console.log('Project:', project.info.title ?? project.info.identifier);
  console.log('Binder roots:', project.binder.length);
  console.log('Documents parsed:', Object.keys(project.documents).length);
  console.log('Labels:', project.metadata.labels.map((label) => label.title).join(', '));
  const draft = project.binder[0];
  console.log('First binder root:', draft?.title, 'children', draft?.children.length);
  const sampleDoc = Object.values(project.documents)[0];
  if (sampleDoc) {
    console.log('Sample document:', sampleDoc.uuid);
    console.log((sampleDoc.textPlain ?? '').slice(0, 200));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { ScrivenerArchive } from '../src/archive/ScrivenerArchive.js';
import { parseResources } from '../src/parsers/resources.js';

test('converts Scrivener style box colors from Apple Generic RGB to sRGB', () => {
  const archive = ScrivenerArchive.fromFileMap({
    'Files/styles.xml': [
      '<Styles>',
      '  <Style ID="STYLE-1" Name="citation" Type="paragraph"',
      '    Box="0.090837 0.698154 0.385743"',
      '    Format="{\\\\rtf1\\\\ansi}" />',
      '</Styles>',
    ].join('\n'),
  });

  const resources = parseResources(archive, {
    basePath: '',
    includeBinaryAssets: false,
  });

  assert.equal(resources.styles.length, 1);
  assert.equal(resources.styles[0]?.uiColorRaw, '0.090837 0.698154 0.385743');
  assert.equal(resources.styles[0]?.uiColor, 'rgb(0, 188, 118)');
});


test('parses Files/user.lock into a structured lock descriptor', () => {
  const archive = ScrivenerArchive.fromFileMap({
    'Files/user.lock': [
      'platform=mac',
      'host=machine',
      'user=User Placeholder',
      'uuid=LOCK-UUID',
      'app=Scrivener',
      'project_path=/Projects/example.scriv',
      'app_path=/Applications/Scrivener.app',
    ].join('\n'),
  });

  const resources = parseResources(archive, {
    basePath: '',
    includeBinaryAssets: false,
  });

  assert.equal(resources.userLock?.platform, 'mac');
  assert.equal(resources.userLock?.host, 'machine');
  assert.equal(resources.userLock?.uuid, 'LOCK-UUID');
  assert.equal(resources.userLock?.projectPath, '/Projects/example.scriv');
  assert.equal(resources.userLock?.entries.app, 'Scrivener');
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { extractLeadingScrivenerParagraphDirectiveState } from '../src/rtf/parseScrivenerDirectives.js';

test('extracts keep-with-next and header level from leading Scrivener directives', () => {
  assert.deepEqual(
    extractLeadingScrivenerParagraphDirectiveState('<$ScrKeepWithNext><$Scr_H::2><$Scr_Ps::0>Titre'),
    {
      keepWithNext: true,
      headerLevel: 2,
      styleRef: '0',
    },
  );
});

test('ignores trailing or closing-only directives when deriving paragraph state', () => {
  assert.deepEqual(
    extractLeadingScrivenerParagraphDirectiveState('<!$Scr_H::2><!$Scr_Ps::0>Texte courant'),
    {},
  );
  assert.deepEqual(
    extractLeadingScrivenerParagraphDirectiveState('Texte <$ScrKeepWithNext>suite'),
    {},
  );
});

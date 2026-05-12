import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCompilePlan } from '../src/parsers/compile-plan.js';
import type { ScrivenerBinderNode, ScrivenerSettingsData } from '../src/types.js';

test('buildCompilePlan resolves the selected compile layout for each binder node', () => {
  const binder: ScrivenerBinderNode[] = [
    {
      uuid: 'draft-root',
      type: 'DraftFolder',
      title: 'Draft',
      children: [
        {
          uuid: 'doc-1',
          type: 'Text',
          title: 'Chapitre 1',
          meta: {
            sectionTypeId: 'SECTION-1',
            sectionTypeTitle: 'Chapitre',
            effectiveIncludeInCompile: true,
          },
          children: [],
        },
        {
          uuid: 'doc-2',
          type: 'Text',
          title: 'Notes de travail',
          meta: {
            sectionTypeId: 'SECTION-2',
            sectionTypeTitle: 'Notes',
            effectiveIncludeInCompile: false,
          },
          children: [],
        },
        {
          uuid: 'doc-3',
          type: 'Text',
          title: 'Sans layout',
          meta: {
            sectionTypeId: 'SECTION-3',
            sectionTypeTitle: 'Libre',
            effectiveIncludeInCompile: true,
          },
          children: [],
        },
      ],
    },
  ];

  const settings = {
    compile: {
      currentFileType: 'pdf',
      formats: {
        'FMT-1': {
          id: 'FMT-1',
          name: 'Format de test',
          sectionLayouts: {
            'SECTION-1': 'LAYOUT-1',
            'SECTION-2': 'LAYOUT-2',
          },
        },
      },
      selectedFormatId: 'FMT-1',
      selectedFormat: {
        id: 'FMT-1',
        name: 'Format de test',
        sectionLayouts: {
          'SECTION-1': 'LAYOUT-1',
          'SECTION-2': 'LAYOUT-2',
        },
      },
      lastUsedFormats: {
        pdf: 'FMT-1',
      },
      placeholdersUsed: [],
    },
    compileFormats: {
      'FMT-1': {
        id: 'FMT-1',
        name: 'Format de test',
        supportedTypes: ['pdf'],
        sectionLayouts: [
          {
            id: 'LAYOUT-1',
            name: 'Chapitre',
            include: {
              titles: true,
              text: true,
            },
            separators: {
              before: {
                type: 'PageBreak',
                use: true,
              },
            },
            includeTitles: true,
            placeholdersUsed: [],
          },
          {
            id: 'LAYOUT-2',
            name: 'Notes seulement',
            include: {
              notes: true,
            },
            placeholdersUsed: [],
          },
        ],
        placeholdersUsed: [],
      },
    },
    recents: [],
  } satisfies ScrivenerSettingsData;

  const plan = buildCompilePlan(binder, settings);

  assert.equal(plan?.currentFileType, 'pdf');
  assert.equal(plan?.selectedFormatId, 'FMT-1');
  assert.equal(plan?.selectedFormatName, 'Format de test');

  assert.deepEqual(plan?.byBinderUuid['draft-root'], {
    binderUuid: 'draft-root',
    title: 'Draft',
    included: true,
    sectionTypeId: undefined,
    sectionTypeTitle: undefined,
    layoutId: undefined,
    layoutName: undefined,
    hasMappedLayout: false,
    hasLayoutDefinition: false,
    includeTitles: undefined,
    includeSynopses: undefined,
    includeNotes: undefined,
    includeText: undefined,
    separators: undefined,
  });

  assert.deepEqual(plan?.byBinderUuid['doc-1'], {
    binderUuid: 'doc-1',
    title: 'Chapitre 1',
    included: true,
    sectionTypeId: 'SECTION-1',
    sectionTypeTitle: 'Chapitre',
    layoutId: 'LAYOUT-1',
    layoutName: 'Chapitre',
    hasMappedLayout: true,
    hasLayoutDefinition: true,
    includeTitles: true,
    includeSynopses: undefined,
    includeNotes: undefined,
    includeText: true,
    separators: {
      before: {
        type: 'PageBreak',
        use: true,
      },
    },
  });

  assert.deepEqual(plan?.byBinderUuid['doc-2'], {
    binderUuid: 'doc-2',
    title: 'Notes de travail',
    included: false,
    sectionTypeId: 'SECTION-2',
    sectionTypeTitle: 'Notes',
    layoutId: 'LAYOUT-2',
    layoutName: 'Notes seulement',
    hasMappedLayout: true,
    hasLayoutDefinition: true,
    includeTitles: undefined,
    includeSynopses: undefined,
    includeNotes: true,
    includeText: undefined,
    separators: undefined,
  });

  assert.deepEqual(plan?.byBinderUuid['doc-3'], {
    binderUuid: 'doc-3',
    title: 'Sans layout',
    included: true,
    sectionTypeId: 'SECTION-3',
    sectionTypeTitle: 'Libre',
    layoutId: undefined,
    layoutName: undefined,
    hasMappedLayout: false,
    hasLayoutDefinition: false,
    includeTitles: undefined,
    includeSynopses: undefined,
    includeNotes: undefined,
    includeText: undefined,
    separators: undefined,
  });
});

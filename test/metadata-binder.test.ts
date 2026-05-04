import test from 'node:test';
import assert from 'node:assert/strict';

import { parseMetaSettings } from '../src/parsers/metadata.js';
import { parseBinder } from '../src/parsers/binder.js';

test('parses project defaults, section type levels, and binder separators', () => {
  const metadata = parseMetaSettings({
    LabelSettings: {
      DefaultLabelID: '-1',
      Labels: {
        Label: [{ ID: '1', '#text': 'Label A', Color: '1 0 0' }],
      },
    },
    StatusSettings: {
      DefaultStatusID: '9',
      StatusItems: {
        Status: [{ ID: '9', '#text': 'Situation' }],
      },
    },
    SectionTypes: {
      TypeDefinitions: {
        Type: [{ ID: 'TYPE-1', '#text': 'Partie' }],
      },
      LevelTypes: {
        Folders: { Type: ['TYPE-1'] },
        Containers: { Type: ['TYPE-2', 'TYPE-3'] },
        Files: { Type: ['TYPE-4'] },
      },
    },
    Collections: {
      Collection: [{
        ID: 'COL-1',
        Type: 'Search',
        SearchSettings: {
          Operator: 'Any',
          ExcludeTrash: 'Yes',
          ExcludeTemplates: 'No',
          '#text': 'wolf',
        },
      }],
    },
  });

  assert.equal(metadata.defaults?.labelId, -1);
  assert.equal(metadata.defaults?.statusId, 9);
  assert.deepEqual(metadata.sectionTypeLevels, {
    folders: ['TYPE-1'],
    containers: ['TYPE-2', 'TYPE-3'],
    files: ['TYPE-4'],
  });
  assert.equal(metadata.collections[0]?.search?.excludeTemplates, false);

  const binder = parseBinder({
    BinderItem: {
      UUID: 'NODE-1',
      Type: 'TrashFolder',
      Title: 'Corbeille',
      BinderSeparator: 'Yes',
      Bookmarks: {
        Bookmark: [
          { BinderUUID: 'NODE-2', Destination: '[Internal Link]', '#text': 'Texte lié' },
        ],
      },
      Children: {
        BinderItem: {
          UUID: 'NODE-2',
          Type: 'Text',
          Title: 'Texte',
        },
      },
    },
  });

  assert.equal(binder.length, 1);
  assert.equal(binder[0]?.isBinderSeparator, true);
  assert.equal(binder[0]?.bookmarks?.[0]?.binderUuid, 'NODE-2');
  assert.equal(binder[0]?.bookmarks?.[0]?.destination, '[Internal Link]');
  assert.equal(binder[0]?.bookmarks?.[0]?.title, 'Texte lié');
  assert.equal(binder[0]?.children[0]?.uuid, 'NODE-2');
});

test('allows children to override a parent excluded from compile', () => {
  const binder = parseBinder({
    BinderItem: {
      UUID: 'DRAFT-ROOT',
      Type: 'DraftFolder',
      Title: 'Draft',
      Children: {
        BinderItem: [
          {
            UUID: 'TOP-DEFAULT-OUT',
            Type: 'Folder',
            Title: 'Annexes',
          },
          {
            UUID: 'PARENT-OUT',
            Type: 'Folder',
            Title: 'Parent hors compile',
            MetaData: {
              IncludeInCompile: 'No',
            },
            Children: {
              BinderItem: [
                {
                  UUID: 'CHILD-IN',
                  Type: 'Text',
                  Title: 'Enfant recompilé',
                  MetaData: {
                    IncludeInCompile: 'Yes',
                  },
                },
                {
                  UUID: 'CHILD-INHERIT',
                  Type: 'Text',
                  Title: 'Enfant hérité hors compile',
                },
                {
                  UUID: 'FOLDER-IN',
                  Type: 'Folder',
                  Title: 'Dossier recompilé',
                  MetaData: {
                    IncludeInCompile: 'Yes',
                  },
                  Children: {
                    BinderItem: {
                      UUID: 'GRANDCHILD-INHERIT',
                      Type: 'Text',
                      Title: 'Petit-enfant hérité recompilé',
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    },
  });

  const topDefaultOut = binder[0]?.children[0];
  const parent = binder[0]?.children[1];
  const childIn = parent?.children[0];
  const childInherit = parent?.children[1];
  const folderIn = parent?.children[2];
  const grandchildInherit = folderIn?.children[0];

  assert.equal(topDefaultOut?.meta?.effectiveIncludeInCompile, false);
  assert.equal(parent?.meta?.effectiveIncludeInCompile, false);
  assert.equal(childIn?.meta?.effectiveIncludeInCompile, true);
  assert.equal(childInherit?.meta?.effectiveIncludeInCompile, false);
  assert.equal(folderIn?.meta?.effectiveIncludeInCompile, true);
  assert.equal(grandchildInherit?.meta?.effectiveIncludeInCompile, false);
});

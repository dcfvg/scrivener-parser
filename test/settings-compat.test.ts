import test from 'node:test';
import assert from 'node:assert/strict';

import { ScrivenerArchive } from '../src/archive/ScrivenerArchive.js';
import { parseSettings } from '../src/parsers/settings.js';
import { yesNo } from '../src/utils/strings.js';
import { readXmlNodeText } from '../src/utils/xml.js';

test('shared XML helpers read node text and Scrivener boolean variants', () => {
  assert.equal(readXmlNodeText({ '#text': 'Node text' }), 'Node text');
  assert.equal(readXmlNodeText({ text: 42 }), '42');
  assert.equal(yesNo('yes'), true);
  assert.equal(yesNo('NO'), false);
  assert.equal(yesNo('true'), true);
  assert.equal(yesNo('false'), false);
  assert.equal(yesNo('1'), true);
  assert.equal(yesNo('0'), false);
  assert.equal(yesNo(true), true);
  assert.equal(yesNo(false), false);
  assert.equal(yesNo({ '#text': 'Yes' }), true);
  assert.equal(yesNo({ text: 'No' }), false);
});

test('parses template, script format, legacy compile, and ini compatibility files', () => {
  const archive = ScrivenerArchive.fromFileMap({
    'Settings/templateinfo.xml': `<?xml version="1.0" encoding="UTF-8"?>
<TemplateSettings Version="1.0">
  <Title>Synthetic template</Title>
  <Description>Desc</Description>
  <Category>Research</Category>
  <CustomImageData>ABC123</CustomImageData>
</TemplateSettings>`,
    'Settings/scriptformat.xml': `<?xml version="1.0" encoding="UTF-8"?>
<ScrivenerScriptFormat>
  <Title>Synthetic script</Title>
  <ScriptElements>
    <Element>
      <Title>Scene Heading</Title>
      <NextElement>Action</NextElement>
    </Element>
  </ScriptElements>
</ScrivenerScriptFormat>`,
    'Settings/LegacyCompile/2/compile.plist': `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>SCRTemplateCompileSettingsTitle</key>
    <string>Synthetic preset</string>
    <key>SCRCompileDocumentTitleKey</key>
    <string>Project</string>
  </dict>
</plist>`,
    'Settings/favorites.xml': `<?xml version="1.0" encoding="UTF-8"?>
<Favorites Version="1.0">
  <MoveTo>
    <Recent><UUID Date="2024-03-11 12:55:07 +0100">UUID-A</UUID></Recent>
    <Popular><UUID Used="2" Date="2024-03-10 10:00:00 +0100">UUID-B</UUID></Popular>
  </MoveTo>
</Favorites>`,
    'Settings/projectpreferences.xml': `<?xml version="1.0" encoding="UTF-8"?>
<ProjectPreferences Version="1.0">
  <UseProjectPreferences>Yes</UseProjectPreferences>
  <TextFormatRTFData><![CDATA[{\rtf1\ansi Attributes}]]></TextFormatRTFData>
  <UseCustomFootnotesFont>No</UseCustomFootnotesFont>
  <FootnotesFont Size="10.0">TimesNewRomanPSMT</FootnotesFont>
  <FootnoteMarker UseMarker="Yes">*</FootnoteMarker>
</ProjectPreferences>`,
    'Settings/ui-common.xml': `<?xml version="1.0" encoding="UTF-8"?>
<UIStates>
  <Binder Show="Yes">
    <SelectedCollection>0</SelectedCollection>
    <ExpandedItems><ItemID>NODE-1</ItemID></ExpandedItems>
    <Selection><ItemID>NODE-2</ItemID></Selection>
  </Binder>
  <Inspector Show="No" View="Notes" />
  <Split>None</Split>
  <BinderAffects>Current</BinderAffects>
  <ProjectKeywords><ExpandedItems><ItemID>KEYWORD-1</ItemID></ExpandedItems></ProjectKeywords>
  <Editors>
    <Editor1>
      <View>
        <GroupsViewMode>Corkboard</GroupsViewMode>
        <CurrentViewMode>Single</CurrentViewMode>
        <SelectionAffects>None</SelectionAffects>
        <Content><ItemID>NODE-2</ItemID></Content>
        <NavigationHistory CurrentIndex="0">
          <HistoryItem Type="BinderItems" ViewMode="Single">NODE-2</HistoryItem>
        </NavigationHistory>
      </View>
    </Editor1>
  </Editors>
</UIStates>`,
    'Settings/ui.plist': `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>MainWindowShowsFormatBar</key><true/>
    <key>binderIsCollapsed</key><false/>
    <key>binderWidth</key><real>272</real>
    <key>binderState</key><array><string>NODE-1</string></array>
    <key>binderSelection</key><array><integer>0</integer></array>
    <key>CommentsScaleFactor</key><real>1</real>
    <key>NotesScaleFactor</key><real>1</real>
    <key>CollectionSelections</key><dict><key>COL-1</key><array><string>NODE-1</string></array></dict>
    <key>SCRSelectedCompileOptionsInfoSaveName</key><dict><key>Tag</key><integer>1</integer><key>Title</key><string>Original</string></dict>
  </dict>
</plist>`,
    'Settings/compile.ini': `[Compile]\nFormat=1\naddFrontMatter=true\n`,
    'Settings/ui.ini': `[Inspector]\nmode=0\n`,
    'Settings/tutorial': `ID:TUTORIAL\n// Used by Scrivener to identify a tutorial project.`,
  });

  const settings = parseSettings(archive, '');

  assert.equal(settings.templateInfo?.title, 'Synthetic template');
  assert.equal(settings.templateInfo?.category, 'Research');
  assert.equal(settings.templateInfo?.fields.CustomImageData, 'ABC123');
  assert.equal(settings.scriptFormat?.title, 'Synthetic script');
  assert.equal((settings.scriptFormat?.scriptElements?.[0] as any)?.Title, 'Scene Heading');
  assert.equal(settings.legacyCompile?.['2']?.title, 'Synthetic preset');
  assert.equal(settings.legacyCompile?.['2']?.files['compile.plist']?.SCRCompileDocumentTitleKey, 'Project');
  assert.equal(settings.favorites?.moveTo?.recent[0]?.uuid, 'UUID-A');
  assert.equal(settings.favorites?.moveTo?.popular[0]?.used, 2);
  assert.equal(settings.projectPreferences?.useProjectPreferences, true);
  assert.equal(settings.projectPreferences?.footnotesFont?.name, 'TimesNewRomanPSMT');
  assert.equal(settings.projectPreferences?.footnoteMarker?.useMarker, true);
  assert.equal(settings.uiCommon?.split, 'None');
  assert.equal(settings.uiCommon?.binderExpandedItems?.[0], 'NODE-1');
  assert.equal(settings.uiCommon?.editors?.Editor1?.navigationHistory?.[0]?.value, 'NODE-2');
  assert.equal(settings.ui?.binderState?.[0], 'NODE-1');
  assert.equal(settings.ui?.selectedCompileOption?.title, 'Original');
  assert.equal(settings.compileIni?.sections.Compile?.Format, '1');
  assert.equal(settings.uiIni?.sections.Inspector?.mode, '0');
  assert.equal(settings.tutorial?.id, 'TUTORIAL');
});

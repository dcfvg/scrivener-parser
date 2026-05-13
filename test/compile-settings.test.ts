import test from 'node:test';
import assert from 'node:assert/strict';

import { ScrivenerArchive } from '../src/archive/ScrivenerArchive.js';
import { parseSettings } from '../src/parsers/settings.js';

test('parses structured compile settings and compile formats', () => {
  const archive = ScrivenerArchive.fromFileMap({
    'Settings/compile.xml': `<?xml version="1.0" encoding="UTF-8"?>
<CompileSettings>
  <ProjectSettings>
    <Content Scope="All" IncludeSelectionDescendants="Yes">
      <CompileGroup Type="Selection"/>
      <Filter State="Off" Exclude="No" Type="Label">
        <CollectionID>COL-1</CollectionID>
        <Label>2</Label>
        <Status>3</Status>
      </Filter>
    </Content>
    <Options>
      <RemoveComments>Yes</RemoveComments>
      <RemoveAnnotations>No</RemoveAnnotations>
      <ResampleImages DPI="72">No</ResampleImages>
      <ReduceImageWidth DPI="150">Yes</ReduceImageWidth>
      <Scriptwriting>
        <IncludeTitles>Yes</IncludeTitles>
        <IncludeSynopses>No</IncludeSynopses>
        <CommentsAsScriptNotes>Yes</CommentsAsScriptNotes>
      </Scriptwriting>
      <Ebook>
        <StartAfterFrontMatter>Yes</StartAfterFrontMatter>
        <Cover>
          <ImageDocument Source="FrontMatter"/>
          <Title>Synthetic cover</Title>
          <SVG Width="600" Height="800"><![CDATA[<svg/>]]></SVG>
        </Cover>
        <TOC PandocDepth="2">
          <HTML Generate="Yes">
            <Title>Contents</Title>
          </HTML>
        </TOC>
      </Ebook>
    </Options>
    <MetaData>
      <ProjectTitle>Synthetic project</ProjectTitle>
      <Authors>
        <Author FileAs="DOE, Jane" Role="aut">Jane Doe</Author>
      </Authors>
      <FountainTitlePageMetaData>
        <Value Key="Title"><![CDATA[<$projecttitle>]]></Value>
      </FountainTitlePageMetaData>
      <MMDMetaData>
        <Value Key="Author"><![CDATA[<$author>]]></Value>
      </MMDMetaData>
    </MetaData>
  </ProjectSettings>
  <CurrentFileType>pdf</CurrentFileType>
  <FormatSettings>
    <Format ID="FMT-1">
      <SectionLayouts>
        <Type ID="SECTION-1">LAYOUT-1</Type>
      </SectionLayouts>
      <Font>BodyFont</Font>
    </Format>
  </FormatSettings>
  <LastUsedFormats>
    <pdf>FMT-1</pdf>
  </LastUsedFormats>
</CompileSettings>`,
    'Settings/Compile Formats/Synthetic format.scrformat': String.raw`<?xml version="1.0" encoding="UTF-8"?>
<CompileFormat Name="Synthetic format" ID="FMT-1">
  <SupportedTypes>
    <Type>pdf</Type>
    <Type>docx</Type>
  </SupportedTypes>
  <SectionLayouts>
    <Layout Name="Chapter" ID="LAYOUT-1">
      <Include Titles="Yes"/>
      <RTFBookmark>Yes</RTFBookmark>
      <BlankLineSeparator SkipStyles="Yes"><![CDATA[<$separator>]]></BlankLineSeparator>
      <Titles>
        <Prefix Case="Uppercase"><![CDATA[<$hn> ]]></Prefix>
      </Titles>
      <Formatting Override="No" EbooksUseBaseFormatting="Yes">
        <Title><![CDATA[{\rtf1\ansi Title <$projecttitle>}]]></Title>
        <TitlePrefix><![CDATA[{\rtf1\ansi Prefix <$hn>}]]></TitlePrefix>
        <TitleSuffix><![CDATA[{\rtf1\ansi Suffix <$sectiontitle>}]]></TitleSuffix>
        <Text><![CDATA[{\rtf1\ansi Body <$text>}]]></Text>
        <PreserveUncommonAlignment>Yes</PreserveUncommonAlignment>
        <PreserveTabsAndIndents>No</PreserveTabsAndIndents>
      </Formatting>
      <Separators>
        <Before Type="Single"/>
        <Between Type="Empty"/>
        <AfterOverride Use="No" Type="Single"/>
      </Separators>
    </Layout>
  </SectionLayouts>
  <Styles>
    <Style Name="Body" ID="STYLE-1">
      <Format><![CDATA[{\rtf1\ansi Body <$projecttitle>}]]></Format>
    </Style>
  </Styles>
  <FormattingOptions>
    <OverrideFonts>Yes</OverrideFonts>
  </FormattingOptions>
  <TitleLinks>
    <UpdateLinksWithPrefixAndSuffix>Yes</UpdateLinksWithPrefixAndSuffix>
    <PrefixSeparator NewlinesOnly="Yes"><![CDATA[ - ]]></PrefixSeparator>
  </TitleLinks>
  <Layout>
    <Hyphenate>Yes</Hyphenate>
    <WidowAndOrphanControl>Yes</WidowAndOrphanControl>
  </Layout>
  <Transformations>
    <PlainTextConversion State="Off">Spacing+Indents</PlainTextConversion>
    <UnderlineHyperlinks>Yes</UnderlineHyperlinks>
  </Transformations>
  <Statistics>
    <ExcludeFrontMatter>Yes</ExcludeFrontMatter>
  </Statistics>
  <Tables>
    <ConvertToImages MaxWidth="600.0">No</ConvertToImages>
  </Tables>
  <FootnotesAndComments>
    <Comments>
      <AnnotationsRTFType>Comments</AnnotationsRTFType>
    </Comments>
  </FootnotesAndComments>
  <PageSettings UseDefaultPaperSize="Yes">
    <Margins Units="CM">
      <Top>2.0</Top>
    </Margins>
    <HeadersAndFooters>
      <StandardFooter>
        <Right><![CDATA[<$p>/<$pagecount>]]></Right>
      </StandardFooter>
    </HeadersAndFooters>
  </PageSettings>
  <PrintPDF>
    <GeneratePDFOutline>Yes</GeneratePDFOutline>
  </PrintPDF>
  <RTF>
    <IncludeStyles>Yes</IncludeStyles>
  </RTF>
  <ScriptFormats>
    <BreakDialogueAndActionAtSentences>Yes</BreakDialogueAndActionAtSentences>
  </ScriptFormats>
  <HTML>
    <UseCenteredBodyTable Width="600">Yes</UseCenteredBodyTable>
  </HTML>
  <PlainText>
    <Extension>txt</Extension>
  </PlainText>
  <MMD>
    <AddClosingHashesToTitles>Yes</AddClosingHashesToTitles>
  </MMD>
  <EBookSettings>
    <EndnotesTitle>Notes</EndnotesTitle>
  </EBookSettings>
  <PostProcessing Enabled="No" Type="Script"/>
</CompileFormat>`,
  });

  const settings = parseSettings(archive, '');

  assert.equal(settings.compile?.currentFileType, 'pdf');
  assert.equal(settings.compile?.content?.scope, 'All');
  assert.equal(settings.compile?.content?.includeSelectionDescendants, true);
  assert.equal(settings.compile?.content?.compileGroupType, 'Selection');
  assert.equal(settings.compile?.content?.filter?.collectionId, 'COL-1');
  assert.equal(settings.compile?.options?.removeComments, true);
  assert.equal(settings.compile?.options?.removeAnnotations, false);
  assert.equal(settings.compile?.options?.resampleImages?.dpi, 72);
  assert.equal(settings.compile?.options?.reduceImageWidth?.enabled, true);
  assert.equal(settings.compile?.options?.scriptwriting?.commentsAsScriptNotes, true);
  assert.equal(settings.compile?.options?.ebook?.toc?.html?.generate, true);
  assert.equal(settings.compile?.metadata?.authors[0]?.name, 'Jane Doe');
  assert.deepEqual(settings.compile?.metadata?.placeholdersUsed, ['<$projecttitle>', '<$author>']);
  assert.equal(settings.compile?.formats['FMT-1']?.name, 'Synthetic format');
  assert.equal(settings.compile?.formats['FMT-1']?.sectionLayouts['SECTION-1'], 'LAYOUT-1');
  assert.equal(settings.compile?.formats['FMT-1']?.font, 'BodyFont');
  assert.equal(settings.compile?.selectedFormatId, 'FMT-1');
  assert.equal(settings.compile?.selectedFormat?.id, 'FMT-1');
  assert.equal(settings.compile?.lastUsedFormats.pdf, 'FMT-1');

  const compileFormat = settings.compileFormats['FMT-1'];
  assert.equal(compileFormat?.name, 'Synthetic format');
  assert.deepEqual(compileFormat?.supportedTypes, ['pdf', 'docx']);
  assert.equal(compileFormat?.sectionLayouts[0]?.include?.titles, true);
  assert.equal(compileFormat?.sectionLayouts[0]?.include?.synopses, undefined);
  assert.equal(compileFormat?.sectionLayouts[0]?.include?.notes, undefined);
  assert.equal(compileFormat?.sectionLayouts[0]?.include?.text, undefined);
  assert.equal(compileFormat?.sectionLayouts[0]?.titles?.prefix?.case, 'Uppercase');
  assert.equal(compileFormat?.sectionLayouts[0]?.titles?.prefix?.text, '<$hn> ');
  assert.equal(compileFormat?.sectionLayouts[0]?.formatting?.title?.text, 'Title <$projecttitle>');
  assert.equal(
    compileFormat?.sectionLayouts[0]?.formatting?.titleSuffix?.placeholdersUsed[0],
    '<$sectiontitle>',
  );
  assert.equal((compileFormat?.styles?.Style as any)?.Name, 'Body');
  assert.equal(compileFormat?.formattingOptions?.OverrideFonts, 'Yes');
  assert.equal(compileFormat?.titleLinks?.UpdateLinksWithPrefixAndSuffix, 'Yes');
  assert.equal((compileFormat?.titleLinks?.PrefixSeparator as any)?.text, ' - ');
  assert.equal(compileFormat?.layoutOptions?.Hyphenate, 'Yes');
  assert.equal((compileFormat?.transformations?.PlainTextConversion as any)?.text, 'Spacing+Indents');
  assert.equal(compileFormat?.statistics?.ExcludeFrontMatter, 'Yes');
  assert.equal((compileFormat?.tablesOptions?.ConvertToImages as any)?.MaxWidth, '600.0');
  assert.equal((compileFormat?.footnotesAndComments?.Comments as any)?.AnnotationsRTFType, 'Comments');
  assert.equal((compileFormat?.pageSettings?.Margins as any)?.Units, 'CM');
  assert.equal(
    ((compileFormat?.pageSettings?.HeadersAndFooters as any)?.StandardFooter as any)?.Right,
    '<$p>/<$pagecount>',
  );
  assert.equal(compileFormat?.printPdf?.GeneratePDFOutline, 'Yes');
  assert.equal(compileFormat?.rtfOptions?.IncludeStyles, 'Yes');
  assert.equal(compileFormat?.scriptFormats?.BreakDialogueAndActionAtSentences, 'Yes');
  assert.equal((compileFormat?.html?.UseCenteredBodyTable as any)?.text, 'Yes');
  assert.equal(compileFormat?.plainText?.Extension, 'txt');
  assert.equal(compileFormat?.multiMarkdown?.AddClosingHashesToTitles, 'Yes');
  assert.equal(compileFormat?.ebookSettings?.EndnotesTitle, 'Notes');
  assert.equal((compileFormat?.postProcessing as any)?.Enabled, 'No');
  assert.ok(compileFormat?.placeholdersUsed.includes('<$separator>'));
  assert.ok(compileFormat?.placeholdersUsed.includes('<$projecttitle>'));
  assert.ok(compileFormat?.placeholdersUsed.includes('<$pagecount>'));
  assert.equal(settings.compileRaw !== undefined, true);
  assert.equal(settings.compileFormatsRaw?.['Synthetic format'] !== undefined, true);
});

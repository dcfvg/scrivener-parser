export interface ScrivenerProjectInfo {
  identifier: string;
  version: string;
  creator?: string;
  device?: string;
  author?: string;
  modified?: string;
  modId?: string;
  title?: string;
}

export interface ScrivenerBinderMeta {
  labelId?: number;
  statusId?: number;
  sectionTypeId?: string;
  sectionTypeTitle?: string;
  includeInCompile?: boolean;
  effectiveIncludeInCompile?: boolean;
  iconFileName?: string;
  fileExtension?: string;
  showSynopsisImage?: boolean;
  notesTextSelection?: string;
  keywords?: string[];
  custom?: Record<string, string>;
  customFields?: ScrivenerCustomMetaValue[];
  target?: {
    type?: string;
    notify?: boolean;
    value?: number;
  };
}

export interface ScrivenerTextSettings {
  selection?: string;
  notesSelection?: string;
  scriptElement?: string;
  target?: ScrivenerBinderMeta['target'];
}

export interface ScrivenerCorkboardSettings {
  selected?: string[];
  expanded?: string[];
  freeform?: Array<{
    uuid: string;
    position?: string;
    timeStamp?: string;
  }>;
  arrangement?: string;
}

export interface ScrivenerBinderBookmark {
  binderUuid?: string;
  destination?: string;
  title?: string;
}

export interface ScrivenerBinderNode {
  uuid: string;
  type: string;
  created?: string;
  modified?: string;
  title?: string;
  displayTitle?: string;
  displayTitleIsDerived?: boolean;
  textId?: string;
  meta?: ScrivenerBinderMeta;
  textSettings?: ScrivenerTextSettings;
  corkboard?: ScrivenerCorkboardSettings;
  mediaSettings?: ScrivenerMediaSettings;
  bookmarks?: ScrivenerBinderBookmark[];
  isBinderSeparator?: boolean;
  children: ScrivenerBinderNode[];
}

export interface ScrivenerComment {
  id: string;
  author?: string;
  color?: string;
  isFootnote?: boolean;
  number?: number;
  collapsed?: boolean;
  rawRtf: string;
  text?: string;
  textWordCount?: number;
  textCharCount?: number;
  paragraphs?: ScrivenerParagraph[];
  runs?: ScrivenerTextRun[];
  placeholders?: ScrivenerPlaceholder[];
  embeddedImages?: ScrivenerEmbeddedImage[];
  embeddedPdfs?: ScrivenerEmbeddedPdf[];
  inlineAnnotations?: ScrivenerInlineAnnotation[];
  linkedImages?: ScrivenerLinkedImage[];
  hyperlinks?: ScrivenerHyperlink[];
  bookmarks?: ScrivenerBookmark[];
  fields?: ScrivenerField[];
  commentAnchors?: ScrivenerCommentAnchor[];
  footnotes?: ScrivenerFootnote[];
  lists?: ScrivenerRtfList[];
  assets?: ScrivenerRtfAsset[];
  rtfModel?: ScrivenerRtfModel;
  tables?: Array<{ start: number; end: number }>;
  anchorFieldIndexes?: number[];
  hasAnchors?: boolean;
}

export interface ScrivenerDocumentContent {
  uuid: string;
  path: string;
  hasText: boolean;
  textRtf?: string;
  textPlain?: string;
  textWordCount?: number;
  textCharCount?: number;
  paragraphs?: ScrivenerParagraph[];
  runs?: ScrivenerTextRun[];
  synopsis?: string;
  notesRtf?: string;
  notesPlain?: string;
  styles?: string;
  styleIds?: string[];
  styleRefs?: ScrivenerStyleRef[];
  styleSpans?: ScrivenerStyleSpan[];
  notesStyles?: string;
  notesStyleIds?: string[];
  notesStyleRefs?: ScrivenerStyleRef[];
  notesStyleSpans?: ScrivenerStyleSpan[];
  comments?: ScrivenerComment[];
  placeholders?: ScrivenerPlaceholder[];
  binderMeta?: ScrivenerBinderMeta;
  embeddedImages?: ScrivenerEmbeddedImage[];
  embeddedPdfs?: ScrivenerEmbeddedPdf[];
  inlineAnnotations?: ScrivenerInlineAnnotation[];
  linkedImages?: ScrivenerLinkedImage[];
  hyperlinks?: ScrivenerHyperlink[];
  bookmarks?: ScrivenerBookmark[];
  fields?: ScrivenerField[];
  commentAnchors?: ScrivenerCommentAnchor[];
  footnotes?: ScrivenerFootnote[];
  lists?: ScrivenerRtfList[];
  assets?: ScrivenerRtfAsset[];
  rtfModel?: ScrivenerRtfModel;
  tables?: Array<{ start: number; end: number }>;
  files?: Array<{
    path: string;
    base64?: string;
    contentType?: string;
  }>;
}

export interface ScrivenerPlaceholder {
  value: string;
  start: number;
  end: number;
  source: 'text' | 'notes' | 'comment';
}

export interface ScrivenerPlaceholderLocation extends ScrivenerPlaceholder {
  uuid: string;
  binderTitle?: string;
}

export type ScrivenerTextRunSource =
  | 'body'
  | 'field-result'
  | 'footnote-token'
  | 'list-marker';

export interface ScrivenerTextRun {
  text: string;
  source: ScrivenerTextRunSource;
}

export interface ScrivenerParagraph {
  text: string;
  runs: ScrivenerTextRun[];
  styleId?: string;
  keepWithNext?: boolean;
  headerLevel?: number;
  pageBreakBefore?: boolean;
}

export interface ScrivenerInlineAnnotation {
  raw: string;
  text?: string;
  color?: string;
  styleRef?: string;
  styleId?: string;
}

export interface ScrivenerEmbeddedImage {
  format?: string;
  base64: string;
  paragraphIndex?: number;
}

export interface ScrivenerEmbeddedPdf {
  fileName?: string;
  paragraphIndex?: number;
  raw?: string;
}

export interface ScrivenerLinkedImage {
  path: string;
  rawPath?: string;
  source?: 'external' | 'project';
  targetUuid?: string;
  fileExtension?: string;
  width?: number;
  height?: number;
  paragraphIndex?: number;
  start?: number;
  end?: number;
  raw?: string;
}

export interface ScrivenerHyperlink {
  url: string;
  text?: string;
}

export interface ScrivenerBookmark {
  name: string;
}

export interface ScrivenerField {
  instruction?: string;
  result?: string;
  kind?: 'hyperlink' | 'scrivener-link' | 'comment-anchor' | 'other';
  url?: string;
  commentId?: string;
  targetUuid?: string;
}

export interface ScrivenerCommentAnchor {
  commentId: string;
  fieldIndex: number;
  text?: string;
  commentIndex?: number;
}

export interface ScrivenerFootnote {
  id: string;
  token: string;
  text?: string;
  rawRtf?: string;
}

export interface ScrivenerRtfList {
  marker: string;
  listId?: number;
  level?: number;
  paragraphIndex?: number;
}

export interface ScrivenerRtfAsset {
  type: 'embedded-image' | 'embedded-pdf' | 'linked-image';
  format?: string;
  base64?: string;
  paragraphIndex?: number;
  start?: number;
  end?: number;
  path?: string;
  rawPath?: string;
  source?: 'external' | 'project';
  targetUuid?: string;
  fileExtension?: string;
  width?: number;
  height?: number;
  fileName?: string;
  raw?: string;
}

export interface ScrivenerRtfModel {
  paragraphs: ScrivenerParagraph[];
  runs: ScrivenerTextRun[];
  fields: ScrivenerField[];
  commentAnchors: ScrivenerCommentAnchor[];
  footnotes: ScrivenerFootnote[];
  annotations: ScrivenerInlineAnnotation[];
  linkedImages: ScrivenerLinkedImage[];
  lists: ScrivenerRtfList[];
  assets: ScrivenerRtfAsset[];
  embeddedPdfs: ScrivenerEmbeddedPdf[];
}

export interface ScrivenerSnapshot {
  title?: string;
  date?: string;
  rtf: string;
  plainText?: string;
  sourceFile?: string;
  hasText?: boolean;
  textWordCount?: number;
  textCharCount?: number;
  paragraphs?: ScrivenerParagraph[];
  runs?: ScrivenerTextRun[];
  placeholders?: ScrivenerPlaceholder[];
  embeddedImages?: ScrivenerEmbeddedImage[];
  embeddedPdfs?: ScrivenerEmbeddedPdf[];
  inlineAnnotations?: ScrivenerInlineAnnotation[];
  linkedImages?: ScrivenerLinkedImage[];
  hyperlinks?: ScrivenerHyperlink[];
  bookmarks?: ScrivenerBookmark[];
  fields?: ScrivenerField[];
  commentAnchors?: ScrivenerCommentAnchor[];
  footnotes?: ScrivenerFootnote[];
  lists?: ScrivenerRtfList[];
  assets?: ScrivenerRtfAsset[];
  rtfModel?: ScrivenerRtfModel;
  tables?: Array<{ start: number; end: number }>;
  indexText?: string;
  hasIndexText?: boolean;
}

export interface ScrivenerSnapshotsIndex {
  uuid: string;
  snapshots: ScrivenerSnapshot[];
}

export interface ScrivenerLabelDefinition {
  id: number;
  title: string;
  color?: string;
}

export interface ScrivenerStatusDefinition {
  id: number;
  title: string;
}

export interface ScrivenerKeywordDefinition {
  id: number;
  title: string;
  color?: string;
}

export interface ScrivenerCustomMetaField {
  id: string;
  title: string;
  type?: string;
  dateType?: string;
  absolute?: boolean;
  options?: Array<{ id: string; title: string }>;
  metadata?: Record<string, string>;
}

export interface ScrivenerCustomMetaValue {
  fieldId: string;
  fieldTitle?: string;
  type?: string;
  rawValue: string;
  value?: string;
  optionId?: string;
  optionTitle?: string;
  parsedDate?: string;
  parsedDateFormat?: string;
}

export interface ScrivenerSectionType {
  id: string;
  title: string;
}

export interface ScrivenerProjectDefaults {
  labelId?: number;
  statusId?: number;
}

export interface ScrivenerSectionTypeLevels {
  folders: string[];
  containers: string[];
  files: string[];
}

export interface ScrivenerCollectionSearch {
  operator?: string;
  type?: string;
  excludeTrash?: boolean;
  excludeTemplates?: boolean;
  caseSensitive?: boolean;
  ignoreDiacritics?: boolean;
  query?: string;
  findDuplicates?: boolean;
}

export interface ScrivenerCollection {
  id: string;
  type: string;
  title?: string;
  color?: string;
  binderUUIDs?: string[];
  search?: ScrivenerCollectionSearch;
}

export interface ScrivenerMetaSettings {
  labels: ScrivenerLabelDefinition[];
  statuses: ScrivenerStatusDefinition[];
  keywords: ScrivenerKeywordDefinition[];
  customMeta: ScrivenerCustomMetaField[];
  sectionTypes: ScrivenerSectionType[];
  sectionTypeLevels?: ScrivenerSectionTypeLevels;
  defaults?: ScrivenerProjectDefaults;
  collections: ScrivenerCollection[];
  bookmarks: string[];
}

export interface ScrivenerProjectTargets {
  draftTarget?: Record<string, unknown>;
  sessionTarget?: Record<string, unknown>;
  previousSession?: Record<string, unknown>;
}

export interface ScrivenerWritingHistoryEntry {
  date: string;
  draftWordCount?: number;
  draftCharCount?: number;
  otherWordCount?: number;
  otherCharCount?: number;
  draftTargetWordCount?: number;
  draftTargetCharCount?: number;
  sessionWordCount?: number;
  sessionCharCount?: number;
}

export interface ScrivenerStats {
  projectTargets: ScrivenerProjectTargets;
  recentWritingHistory?: Record<string, unknown>;
  writingHistory: ScrivenerWritingHistoryEntry[];
}

export interface ScrivenerCompileTextValue {
  raw: string;
  text?: string;
  case?: string;
  placeholdersUsed: string[];
}

export interface ScrivenerCompileSeparatorSetting {
  type?: string;
  use?: boolean;
}

export interface ScrivenerCompileLayoutFormatting {
  override?: boolean;
  ebooksUseBaseFormatting?: boolean;
  title?: ScrivenerCompileTextValue;
  titlePrefix?: ScrivenerCompileTextValue;
  titleSuffix?: ScrivenerCompileTextValue;
  metaData?: ScrivenerCompileTextValue;
  synopsis?: ScrivenerCompileTextValue;
  notes?: ScrivenerCompileTextValue;
  text?: ScrivenerCompileTextValue;
  subtitles?: ScrivenerCompileTextValue;
  preserveUncommonAlignment?: boolean;
  preserveTabsAndIndents?: boolean;
  placeholdersUsed: string[];
}

export interface ScrivenerCompileLayout {
  id: string;
  name?: string;
  include?: {
    titles?: boolean;
    synopses?: boolean;
    notes?: boolean;
    text?: boolean;
  };
  includeTitles?: boolean;
  rtfBookmark?: boolean;
  blankLineSeparator?: {
    text?: string;
    skipStyles?: boolean;
    placeholdersUsed: string[];
  };
  titles?: {
    prefix?: ScrivenerCompileTextValue;
  };
  formatting?: ScrivenerCompileLayoutFormatting;
  separators?: {
    before?: ScrivenerCompileSeparatorSetting;
    between?: ScrivenerCompileSeparatorSetting;
    afterOverride?: ScrivenerCompileSeparatorSetting;
  };
  placeholdersUsed: string[];
}

export type ScrivenerStructuredValue =
  | string
  | number
  | boolean
  | null
  | ScrivenerStructuredObject
  | ScrivenerStructuredValue[];

export interface ScrivenerStructuredObject {
  [key: string]: ScrivenerStructuredValue | undefined;
}

export interface ScrivenerCompileFormat {
  id: string;
  name?: string;
  supportedTypes: string[];
  sectionLayouts: ScrivenerCompileLayout[];
  styles?: ScrivenerStructuredObject;
  formattingOptions?: ScrivenerStructuredObject;
  titleLinks?: ScrivenerStructuredObject;
  layoutOptions?: ScrivenerStructuredObject;
  transformations?: ScrivenerStructuredObject;
  statistics?: ScrivenerStructuredObject;
  tablesOptions?: ScrivenerStructuredObject;
  footnotesAndComments?: ScrivenerStructuredObject;
  pageSettings?: ScrivenerStructuredObject;
  printPdf?: ScrivenerStructuredObject;
  rtfOptions?: ScrivenerStructuredObject;
  scriptFormats?: ScrivenerStructuredObject;
  html?: ScrivenerStructuredObject;
  plainText?: ScrivenerStructuredObject;
  multiMarkdown?: ScrivenerStructuredObject;
  ebookSettings?: ScrivenerStructuredObject;
  postProcessing?: ScrivenerStructuredObject;
  raw?: ScrivenerStructuredObject;
  placeholdersUsed: string[];
}

export interface ScrivenerCompileFormatSelection {
  id: string;
  name?: string;
  sectionLayouts: Record<string, string>;
  font?: string;
}

export interface ScrivenerCompileContentFilter {
  state?: string;
  exclude?: boolean;
  type?: string;
  collectionId?: string;
  label?: string;
  status?: string;
}

export interface ScrivenerCompileContent {
  scope?: string;
  includeSelectionDescendants?: boolean;
  compileGroupType?: string;
  filter?: ScrivenerCompileContentFilter;
}

export interface ScrivenerCompileImageOption {
  enabled?: boolean;
  dpi?: number;
}

export interface ScrivenerCompilePdfOptions {
  cover?: {
    bleed?: number;
    bleedUnits?: string;
  };
  compression?: {
    enabled?: boolean;
    imageResolutionCompressionType?: string;
    imageResolution?: number;
    compressionQuality?: number;
  };
}

export interface ScrivenerCompileScriptwritingOptions {
  includeTitles?: boolean;
  includeSynopses?: boolean;
  commentsAsScriptNotes?: boolean;
}

export interface ScrivenerCompileEbookOptions {
  startAfterFrontMatter?: boolean;
  cover?: {
    imageDocumentSource?: string;
    title?: string;
    svg?: {
      width?: number;
      height?: number;
      content?: string;
    };
  };
  toc?: {
    pandocDepth?: number;
    html?: {
      generate?: boolean;
      title?: string;
    };
  };
}

export interface ScrivenerCompileOptions {
  removeComments?: boolean;
  removeAnnotations?: boolean;
  resampleImages?: ScrivenerCompileImageOption;
  removeHighlights?: boolean;
  removeTextColor?: boolean;
  removeTrailingWhitespace?: boolean;
  convertTablesAndListToMMD?: boolean;
  reduceImageWidth?: ScrivenerCompileImageOption;
  pdf?: ScrivenerCompilePdfOptions;
  scriptwriting?: ScrivenerCompileScriptwritingOptions;
  ebook?: ScrivenerCompileEbookOptions;
}

export interface ScrivenerCompileAuthor {
  name: string;
  fileAs?: string;
  role?: string;
}

export interface ScrivenerCompileMetadataValue {
  key: string;
  value?: string;
  placeholdersUsed: string[];
}

export interface ScrivenerCompileMetadata {
  projectTitle?: string;
  authors: ScrivenerCompileAuthor[];
  surname?: string;
  forename?: string;
  ebookLanguage?: string;
  fountainTitlePageMetaData: ScrivenerCompileMetadataValue[];
  mmdMetaData: ScrivenerCompileMetadataValue[];
  placeholdersUsed: string[];
}

export interface ScrivenerCompileSettings {
  currentFileType?: string;
  content?: ScrivenerCompileContent;
  options?: ScrivenerCompileOptions;
  metadata?: ScrivenerCompileMetadata;
  formats: Record<string, ScrivenerCompileFormatSelection>;
  selectedFormatId?: string;
  selectedFormat?: ScrivenerCompileFormatSelection;
  lastUsedFormats: Record<string, string>;
  placeholdersUsed: string[];
}

export interface ScrivenerCompilePlanEntry {
  binderUuid: string;
  title?: string;
  included: boolean;
  sectionTypeId?: string;
  sectionTypeTitle?: string;
  layoutId?: string;
  layoutName?: string;
  hasMappedLayout: boolean;
  hasLayoutDefinition: boolean;
  includeTitles?: boolean;
  includeSynopses?: boolean;
  includeNotes?: boolean;
  includeText?: boolean;
  separators?: {
    before?: ScrivenerCompileSeparatorSetting;
    between?: ScrivenerCompileSeparatorSetting;
    afterOverride?: ScrivenerCompileSeparatorSetting;
  };
}

export interface ScrivenerCompilePlan {
  currentFileType?: string;
  selectedFormatId?: string;
  selectedFormatName?: string;
  byBinderUuid: Record<string, ScrivenerCompilePlanEntry>;
}

export interface ScrivenerIniFile {
  raw: string;
  global: Record<string, string>;
  sections: Record<string, Record<string, string>>;
}

export interface ScrivenerTemplateInfo {
  title?: string;
  description?: string;
  category?: string;
  customImageData?: string;
  fields: ScrivenerStructuredObject;
}

export interface ScrivenerScriptFormat {
  title?: string;
  scriptElements?: ScrivenerStructuredValue[];
  fields: ScrivenerStructuredObject;
}

export interface ScrivenerLegacyCompilePreset {
  id: string;
  title?: string;
  files: Record<string, ScrivenerStructuredObject>;
}

export interface ScrivenerTutorialInfo {
  id?: string;
  raw: string;
}

export interface ScrivenerFavoriteEntry {
  uuid: string;
  date?: string;
  used?: number;
}

export interface ScrivenerFavoritesBucket {
  recent: ScrivenerFavoriteEntry[];
  popular: ScrivenerFavoriteEntry[];
}

export interface ScrivenerFavorites {
  version?: string;
  moveTo?: ScrivenerFavoritesBucket;
  append?: ScrivenerFavoritesBucket;
  raw?: ScrivenerStructuredObject;
}

export interface ScrivenerProjectPreferencesFont {
  name?: string;
  size?: number;
}

export interface ScrivenerFootnoteMarker {
  value?: string;
  useMarker?: boolean;
}

export interface ScrivenerProjectPreferences {
  version?: string;
  useProjectPreferences?: boolean;
  textFormat?: ScrivenerCompileTextValue;
  useCustomFootnotesFont?: boolean;
  footnotesFont?: ScrivenerProjectPreferencesFont;
  footnoteMarker?: ScrivenerFootnoteMarker;
  raw?: ScrivenerStructuredObject;
}

export interface ScrivenerUiCommonNavigationHistoryItem {
  type?: string;
  viewMode?: string;
  value?: string;
}

export interface ScrivenerUiCommonEditorSummary {
  currentViewMode?: string;
  groupsViewMode?: string;
  selectionAffects?: string;
  contentItemIds?: string[];
  navigationHistory?: ScrivenerUiCommonNavigationHistoryItem[];
}

export interface ScrivenerUiCommon {
  split?: string;
  binderAffects?: string;
  binderExpandedItems?: string[];
  binderSelection?: string[];
  selectedCollection?: string;
  inspectorView?: string;
  projectKeywordExpandedItems?: string[];
  editors?: Record<string, ScrivenerUiCommonEditorSummary>;
  raw?: ScrivenerStructuredObject;
}

export interface ScrivenerUiSelectedCompileOption {
  tag?: number;
  title?: string;
}

export interface ScrivenerUiState {
  binderState?: string[];
  binderSelection?: Array<string | number>;
  binderIsCollapsed?: boolean;
  binderWidth?: number;
  mainWindowShowsFormatBar?: boolean;
  commentsScaleFactor?: number;
  notesScaleFactor?: number;
  selectedCompileOption?: ScrivenerUiSelectedCompileOption;
  collectionSelections?: Record<string, string[]>;
  raw?: ScrivenerStructuredObject;
}

export interface ScrivenerSettingsData {
  compile?: ScrivenerCompileSettings;
  compileRaw?: unknown;
  compileFormats: Record<string, ScrivenerCompileFormat>;
  compileFormatsRaw?: Record<string, unknown>;
  favorites?: ScrivenerFavorites;
  mobile?: unknown;
  projectPreferences?: ScrivenerProjectPreferences;
  recents: string[];
  ui?: ScrivenerUiState;
  uiCommon?: ScrivenerUiCommon;
  compileIni?: ScrivenerIniFile;
  uiIni?: ScrivenerIniFile;
  templateInfo?: ScrivenerTemplateInfo;
  scriptFormat?: ScrivenerScriptFormat;
  legacyCompile?: Record<string, ScrivenerLegacyCompilePreset>;
  tutorial?: ScrivenerTutorialInfo;
  autoComplete?: string[];
  printSettings?: Record<string, unknown>;
}

export interface ScrivenerSearchIndexDocument {
  id: string;
  title?: string;
  synopsis?: string;
  text?: string;
  comments?: string;
  notes?: string;
}

export interface ScrivenerSearchIndex {
  version?: string;
  documents: ScrivenerSearchIndexDocument[];
}

export interface ScrivenerStyleDefinition {
  id?: string;
  name?: string;
  type?: string;
  shortcut?: string;
  formatRtf?: string;
  uiColor?: string;
  uiColorRaw?: string;
}

export interface ScrivenerStyleRef {
  id: string;
  name?: string;
}

export interface ScrivenerMediaSettings {
  imageScaleFactor?: number;
  imageRotation?: string;
  imageScalesProportionally?: boolean;
}

export interface ScrivenerStyleSpan {
  id?: string;
  name?: string;
  kind: 'paragraph' | 'character';
  start: number;
  end: number;
}

export interface ScrivenerUserLock {
  raw: string;
  entries: Record<string, string>;
  platform?: string;
  host?: string;
  user?: string;
  uuid?: string;
  app?: string;
  projectPath?: string;
  appPath?: string;
}

export interface ScrivenerResources {
  styles: ScrivenerStyleDefinition[];
  version?: string;
  docsChecksum?: Array<{ path: string; checksum: string }>;
  userLock?: ScrivenerUserLock;
  icons: Array<{
    name: string;
    base64?: string;
    contentType?: string;
  }>;
  quickLook?: string;
}

export interface ScrivenerParserOptions {
  decodeRtf?: boolean;
  includeBinaryAssets?: boolean;
  loadSnapshots?: boolean;
  extractPlaceholders?: boolean;
  extractStyleIds?: boolean;
  extractStyleSpans?: boolean;
  attachBinderMetaToDocs?: boolean;
  extractEmbeddedImages?: boolean;
  extractInlineAnnotations?: boolean;
  extractLinkedImages?: boolean;
  extractHyperlinks?: boolean;
  extractBookmarks?: boolean;
  extractFields?: boolean;
  extractTables?: boolean;
  normalizeBinderSections?: boolean;
  computeTextCounts?: boolean;
}

export interface ParsedScrivenerProject {
  info: ScrivenerProjectInfo;
  binder: ScrivenerBinderNode[];
  documents: Record<string, ScrivenerDocumentContent>;
  metadata: ScrivenerMetaSettings;
  settings: ScrivenerSettingsData;
  compilePlan?: ScrivenerCompilePlan;
  stats: ScrivenerStats;
  snapshots: Record<string, ScrivenerSnapshot[]>;
  search: ScrivenerSearchIndex;
  resources: ScrivenerResources;
  autoComplete?: string[];
  templateFolderUUID?: string;
  binderSections?: ScrivenerBinderSections;
  archive: {
    root: string;
    scrivxPath: string;
  };
}

export interface ScrivenerBinderSections {
  draft?: ScrivenerBinderNode;
  research?: ScrivenerBinderNode;
  trash?: ScrivenerBinderNode;
  extras: ScrivenerBinderNode[];
}

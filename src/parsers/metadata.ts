import type {
  ScrivenerCollection,
  ScrivenerCollectionSearch,
  ScrivenerCustomMetaField,
  ScrivenerKeywordDefinition,
  ScrivenerLabelDefinition,
  ScrivenerMetaSettings,
  ScrivenerProjectDefaults,
  ScrivenerSectionType,
  ScrivenerSectionTypeLevels,
  ScrivenerStatusDefinition,
} from '../types.js';
import { toArray } from '../utils/collections.js';
import { yesNo } from '../utils/strings.js';

function parseNumericId(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function split(value?: string): string[] | undefined {
  if (!value) {
    return undefined;
  }
  const entries = value
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return entries.length ? entries : undefined;
}

function parseLabels(node: any): ScrivenerLabelDefinition[] {
  const labels = toArray(node?.Labels?.Label);
  return labels.map((label: any) => ({
    id: Number(label.ID ?? label.Id ?? '-1'),
    title: String(label['#text'] ?? label.Title ?? ''),
    color: label.Color,
  }));
}

function parseStatuses(node: any): ScrivenerStatusDefinition[] {
  const statuses = toArray(node?.StatusItems?.Status);
  return statuses.map((status: any) => ({
    id: Number(status.ID ?? status.Id ?? '-1'),
    title: String(status['#text'] ?? status.Title ?? ''),
  }));
}

function parseKeywords(node: any): ScrivenerKeywordDefinition[] {
  const keywords = toArray(node?.Keyword);
  return keywords.map((keyword: any) => ({
    id: Number(keyword.ID ?? keyword.Id ?? '-1'),
    title: String(keyword.Title ?? keyword['#text'] ?? ''),
    color: keyword.Color,
  }));
}

function parseCustomMeta(node: any): ScrivenerCustomMetaField[] {
  const fields = toArray(node?.MetaDataField);
  return fields.map((field: any) => ({
    id: String(field.ID ?? field.Id ?? field.FieldID ?? ''),
    title: String(field.Title ?? ''),
    type: field.Type,
    dateType: field.DateType ?? field.DateFormat,
    absolute: yesNo(field.Absolute),
    options: toArray(field.ListOptions?.Option).map((option: any) => ({
      id: String(option.ID ?? option.Id ?? option['@_ID'] ?? option['#text'] ?? option),
      title: String(option['#text'] ?? option.Title ?? option),
    })),
    metadata: (() => {
      const entries = Object.entries(field)
        .filter(([key]) => !['Title', 'ID', 'Id', 'Type', 'DateType', 'DateFormat', 'Absolute'].includes(key))
        .map(([key, value]) => [key, value === undefined ? '' : String(value)]);
      return entries.length ? Object.fromEntries(entries) : undefined;
    })(),
  }));
}

function parseSectionTypes(node: any): ScrivenerSectionType[] {
  const definitions = toArray(node?.TypeDefinitions?.Type);
  return definitions.map((definition: any) => ({
    id: String(definition.ID ?? definition.Id ?? ''),
    title: String(definition['#text'] ?? definition.Title ?? ''),
  }));
}

function parseSectionTypeLevels(node: any): ScrivenerSectionTypeLevels | undefined {
  const levelTypes = node?.LevelTypes;
  if (!levelTypes) {
    return undefined;
  }

  const parseTypeList = (value: unknown): string[] => (
    toArray((value as any)?.Type ?? value)
      .map((item: any) => String(item?.['#text'] ?? item ?? '').trim())
      .filter(Boolean)
  );

  const levels: ScrivenerSectionTypeLevels = {
    folders: parseTypeList(levelTypes.Folders),
    containers: parseTypeList(levelTypes.Containers),
    files: parseTypeList(levelTypes.Files),
  };

  return (levels.folders.length || levels.containers.length || levels.files.length)
    ? levels
    : undefined;
}

function parseSearchSettings(node: any): ScrivenerCollectionSearch | undefined {
  if (!node) {
    return undefined;
  }
  const settings: ScrivenerCollectionSearch = {
    operator: node.Operator,
    type: node.Type,
    excludeTrash: yesNo(node.ExcludeTrash),
    excludeTemplates: yesNo(node.ExcludeTemplates),
    caseSensitive: yesNo(node.CaseSensitive),
    ignoreDiacritics: yesNo(node.IgnoreDiacritics),
    query: node['#text'] ?? node.text ?? node.Query,
    findDuplicates: yesNo(node.FindDuplicates),
  };
  return Object.values(settings).some((value) => value !== undefined) ? settings : undefined;
}

function parseCollections(node: any): ScrivenerCollection[] {
  const collections = toArray(node?.Collection);
  return collections.map((collection: any) => ({
    id: String(collection.ID ?? collection.Id ?? ''),
    type: String(collection.Type ?? ''),
    title: collection.Title ? String(collection.Title) : undefined,
    color: collection.Color,
    binderUUIDs: split(collection.BinderUUIDs),
    search: parseSearchSettings(collection.SearchSettings),
  }));
}

function parseDefaults(projectNode: any): ScrivenerProjectDefaults | undefined {
  const defaults: ScrivenerProjectDefaults = {};
  const defaultLabelId = parseNumericId(projectNode?.LabelSettings?.DefaultLabelID);
  const defaultStatusId = parseNumericId(projectNode?.StatusSettings?.DefaultStatusID);

  if (defaultLabelId !== undefined) {
    defaults.labelId = defaultLabelId;
  }
  if (defaultStatusId !== undefined) {
    defaults.statusId = defaultStatusId;
  }

  return Object.keys(defaults).length ? defaults : undefined;
}

export function parseMetaSettings(projectNode: any): ScrivenerMetaSettings {
  return {
    labels: parseLabels(projectNode.LabelSettings),
    statuses: parseStatuses(projectNode.StatusSettings),
    keywords: parseKeywords(projectNode.Keywords),
    customMeta: parseCustomMeta(projectNode.CustomMetaDataSettings),
    sectionTypes: parseSectionTypes(projectNode.SectionTypes),
    sectionTypeLevels: parseSectionTypeLevels(projectNode.SectionTypes),
    defaults: parseDefaults(projectNode),
    collections: parseCollections(projectNode.Collections),
    bookmarks: toArray(projectNode.ProjectBookmarks?.Bookmark)
      .map((bookmark: any) => String(bookmark.BinderUUID ?? bookmark['#text'] ?? bookmark))
      .filter(Boolean),
  };
}

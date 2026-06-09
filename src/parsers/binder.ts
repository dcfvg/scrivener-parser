import type {
  ScrivenerBinderBookmark,
  ScrivenerBinderMeta,
  ScrivenerBinderNode,
  ScrivenerCorkboardSettings,
  ScrivenerCustomMetaField,
  ScrivenerCustomMetaValue,
  ScrivenerMediaSettings,
  ScrivenerSectionType,
  ScrivenerTextSettings,
} from '../types.js';
import { toArray } from '../utils/collections.js';
import { yesNo } from '../utils/strings.js';
import { readXmlNodeText as readNodeText } from '../utils/xml.js';

interface BinderParseOptions {
  customMetaFields?: ScrivenerCustomMetaField[];
  sectionTypes?: ScrivenerSectionType[];
  customMetaLookup?: Map<string, ScrivenerCustomMetaField>;
}

function splitList(value?: string): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function buildCustomMetaLookup(
  fields?: ScrivenerCustomMetaField[],
): Map<string, ScrivenerCustomMetaField> {
  const map = new Map<string, ScrivenerCustomMetaField>();
  for (const field of fields ?? []) {
    map.set(field.id ?? '', field);
  }
  return map;
}

function parseDateValue(value: string): string | undefined {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function parseCustomMeta(
  node: any,
  lookup?: Map<string, ScrivenerCustomMetaField>,
): { raw?: Record<string, string>; detailed?: ScrivenerCustomMetaValue[] } {
  const items = toArray(node?.MetaDataItem);
  if (!items.length) {
    return {};
  }
  const result: Record<string, string> = {};
  const detailed: ScrivenerCustomMetaValue[] = [];
  for (const item of items) {
    if (!item) {
      continue;
    }
    const key = item.FieldID === undefined || item.FieldID === null ? '' : String(item.FieldID);
    const value = item.Value === undefined || item.Value === null ? '' : String(item.Value);
    if (!key && !value) {
      continue;
    }
    result[key] = value;
    const def = lookup?.get(key);
    const option =
      def?.type === 'List'
        ? def.options?.find((opt) => opt.id === value || opt.title === value)
        : undefined;
    const parsedDate =
      def?.type?.toLowerCase() === 'date' && value
        ? parseDateValue(value)
        : undefined;
    detailed.push({
      fieldId: key,
      fieldTitle: def?.title,
      type: def?.type,
      rawValue: value,
      optionId: option?.id,
      optionTitle: option?.title,
      value: option?.title ?? value,
      parsedDate,
      parsedDateFormat: def?.dateType,
    });
  }
  return {
    raw: Object.keys(result).length ? result : undefined,
    detailed: detailed.length ? detailed : undefined,
  };
}

function parseMeta(
  node: any,
  options?: BinderParseOptions,
): ScrivenerBinderMeta | undefined {
  if (!node) {
    return undefined;
  }
  const meta: ScrivenerBinderMeta = {};
  if (node.LabelID !== undefined) {
    const value = Number(node.LabelID);
    if (!Number.isNaN(value)) {
      meta.labelId = value;
    }
  }
  if (node.StatusID !== undefined) {
    const value = Number(node.StatusID);
    if (!Number.isNaN(value)) {
      meta.statusId = value;
    }
  }
  if (node.SectionType !== undefined) {
    meta.sectionTypeId = String(node.SectionType);
  }
  const include = yesNo(node.IncludeInCompile);
  if (include !== undefined) {
    meta.includeInCompile = include;
  }
  if (node.IconFileName) {
    meta.iconFileName = String(node.IconFileName);
  }
  if (node.FileExtension) {
    meta.fileExtension = String(node.FileExtension);
  }
  const notesSelection = node.NotesTextSelection ?? node.notesTextSelection;
  if (notesSelection !== undefined) {
    meta.notesTextSelection = String(notesSelection);
  }
  const showSynopsisImage = yesNo(node.ShowSynopsisImage);
  if (showSynopsisImage !== undefined) {
    meta.showSynopsisImage = showSynopsisImage;
  }
  const keywords = toArray(node.Keywords?.KeywordID ?? node.Keywords?.Keyword);
  if (keywords.length) {
    meta.keywords = keywords.map((item) => String(item));
  }
  const customMeta = parseCustomMeta(node.CustomMetaData, options?.customMetaLookup);
  if (customMeta.raw) {
    meta.custom = customMeta.raw;
  }
  if (customMeta.detailed) {
    meta.customFields = customMeta.detailed.map((field) => {
      const sectionTitle =
        field.fieldId && options?.customMetaFields
          ? options.customMetaFields.find((f) => f.id === field.fieldId || (!f.id && !field.fieldId))
          : undefined;
      return {
        ...field,
        fieldTitle: field.fieldTitle ?? sectionTitle?.title,
      };
    });
  }
  if (meta.sectionTypeId && options?.sectionTypes) {
    const def = options.sectionTypes.find((sectionType) => sectionType.id === meta.sectionTypeId);
    if (def?.title) {
      meta.sectionTypeTitle = String(def.title);
    }
  }
  return Object.keys(meta).length ? meta : undefined;
}

function parseTextSettings(node: any): ScrivenerTextSettings | undefined {
  if (!node) {
    return undefined;
  }
  const textSettings: ScrivenerTextSettings = {};
  if (node.TextSelection) {
    textSettings.selection = String(node.TextSelection);
  }
  if (node.NotesTextSelection) {
    textSettings.notesSelection = String(node.NotesTextSelection);
  }
  if (node.Target) {
    const targetValue = Number(node.Target['#text'] ?? node.Target.text ?? node.Target.value);
    textSettings.target = {
      type: node.Target.Type,
      notify: yesNo(node.Target.Notify),
      value: Number.isNaN(targetValue) ? undefined : targetValue,
    };
  }
  if (node.ScriptElement) {
    textSettings.scriptElement = String(node.ScriptElement);
  }
  return Object.keys(textSettings).length ? textSettings : undefined;
}

function parseFreeformDocs(node: any): ScrivenerCorkboardSettings['freeform'] {
  const docs = toArray(node?.IndexCardBinderUUID);
  if (!docs.length) {
    return undefined;
  }
  return docs.map((doc: any) => ({
    uuid: String(doc['#text'] ?? doc.text ?? doc),
    position: doc.Position,
    timeStamp: doc.TimeStamp,
  }));
}

function parseCorkboard(node: any): ScrivenerCorkboardSettings | undefined {
  if (!node) {
    return undefined;
  }
  const corkboard: ScrivenerCorkboardSettings = {};
  const selected = splitList(node.SelectedSubdocumentUUIDs);
  if (selected.length) {
    corkboard.selected = selected;
  }
  const expanded = toArray(node.OutlinerExpandedState?.ItemID);
  if (expanded.length) {
    corkboard.expanded = expanded.map((item) => String(item));
  }
  const arrangement = node.CorkboardSettings?.Arrangement;
  if (arrangement) {
    corkboard.arrangement = String(arrangement);
  }
  const freeform = parseFreeformDocs(node.CorkboardSettings?.FreeformCorkboardDocuments);
  if (freeform?.length) {
    corkboard.freeform = freeform;
  }
  return Object.keys(corkboard).length ? corkboard : undefined;
}

function parseBookmarks(node: any): ScrivenerBinderBookmark[] | undefined {
  const bookmarks = toArray(node?.Bookmark);
  if (!bookmarks.length) {
    return undefined;
  }
  const parsed = bookmarks
    .map((bookmark: any) => ({
      binderUuid: bookmark?.BinderUUID ? String(bookmark.BinderUUID) : undefined,
      destination: bookmark?.Destination ? String(bookmark.Destination) : undefined,
      title: readNodeText(bookmark),
    }))
    .filter((bookmark) => bookmark.binderUuid || bookmark.destination || bookmark.title);
  return parsed.length ? parsed : undefined;
}

function parseMediaSettings(node: any): ScrivenerMediaSettings | undefined {
  if (!node) {
    return undefined;
  }
  const settings: ScrivenerMediaSettings = {};
  const scale = Number(node.ImageScaleFactor);
  if (!Number.isNaN(scale)) {
    settings.imageScaleFactor = scale;
  }
  if (node.ImageRotation) {
    settings.imageRotation = String(node.ImageRotation);
  }
  const scalesProportionally = yesNo(node.ImageScalesProportionally);
  if (scalesProportionally !== undefined) {
    settings.imageScalesProportionally = scalesProportionally;
  }
  return Object.keys(settings).length ? settings : undefined;
}

function isDraftRootNode(node: any): boolean {
  const type = String(node?.Type ?? node?.type ?? '');
  return type === 'DraftFolder' || type === 'Draft';
}

function resolveEffectiveIncludeInCompile(
  node: any,
  meta: ScrivenerBinderMeta | undefined,
): boolean {
  if (isDraftRootNode(node)) {
    return true;
  }

  return meta?.includeInCompile === true;
}

function parseBinderItem(
  node: any,
  options?: BinderParseOptions,
): ScrivenerBinderNode {
  let meta = parseMeta(node.MetaData, options);
  const keywordIds = toArray(node.Keywords?.KeywordID ?? node.Keywords?.Keyword);
  if (keywordIds.length) {
    if (!meta) {
      meta = {};
    }
    meta.keywords = keywordIds.map((item) => String(item));
  }
  const effectiveIncluded = resolveEffectiveIncludeInCompile(node, meta);
  if (meta || !effectiveIncluded) {
    meta = {
      ...(meta ?? {}),
      effectiveIncludeInCompile: effectiveIncluded,
    };
  }
  const children = toArray(node.Children?.BinderItem).map((child) =>
    parseBinderItem(child, options),
  );
  const binderSeparator = yesNo(node.BinderSeparator);
  return {
    uuid: String(node.UUID ?? node.uuid),
    type: String(node.Type ?? node.type ?? 'Text'),
    title: node.Title ? String(node.Title) : undefined,
    created: node.Created,
    modified: node.Modified,
    textId: node.ID ?? node.UUID ?? node.uuid,
    meta,
    textSettings: parseTextSettings(node.TextSettings),
    corkboard: parseCorkboard(node.CorkboardAndOutliner),
    mediaSettings: parseMediaSettings(node.MediaSettings),
    bookmarks: parseBookmarks(node.Bookmarks),
    isBinderSeparator: binderSeparator,
    children,
  };
}

export function parseBinder(root: any, options?: BinderParseOptions): ScrivenerBinderNode[] {
  const items = toArray(root?.BinderItem ?? root);
  const normalizedOptions: BinderParseOptions = {
    ...options,
    customMetaLookup: options?.customMetaLookup ?? buildCustomMetaLookup(options?.customMetaFields),
  };
  return items.map((item) => parseBinderItem(item, normalizedOptions));
}

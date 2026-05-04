import type {
  ScrivenerBinderNode,
  ScrivenerCompileFormat,
  ScrivenerCompileLayout,
  ScrivenerCompilePlan,
  ScrivenerCompilePlanEntry,
  ScrivenerSettingsData,
} from '../types.js';

function isDraftRoot(node: ScrivenerBinderNode): boolean {
  return node.type === 'DraftFolder' || node.type === 'Draft';
}

function isIncluded(node: ScrivenerBinderNode): boolean {
  return isDraftRoot(node) || node.meta?.effectiveIncludeInCompile === true;
}

function indexLayouts(format: ScrivenerCompileFormat | undefined): Map<string, ScrivenerCompileLayout> {
  const map = new Map<string, ScrivenerCompileLayout>();
  for (const layout of format?.sectionLayouts ?? []) {
    if (!layout.id) {
      continue;
    }
    map.set(layout.id, layout);
  }
  return map;
}

export function buildCompilePlan(
  binder: ScrivenerBinderNode[],
  settings: ScrivenerSettingsData,
): ScrivenerCompilePlan | undefined {
  const compile = settings.compile;
  if (!compile) {
    return undefined;
  }

  const selectedFormatId = compile.selectedFormatId;
  const selectedFormatSelection = selectedFormatId
    ? (compile.selectedFormat ?? compile.formats[selectedFormatId])
    : undefined;
  const selectedFormat = selectedFormatId
    ? settings.compileFormats[selectedFormatId]
    : undefined;
  const selectedFormatName = selectedFormat?.name ?? selectedFormatSelection?.name;
  const layoutsById = indexLayouts(selectedFormat);
  const byBinderUuid: Record<string, ScrivenerCompilePlanEntry> = {};

  const visit = (nodes: ScrivenerBinderNode[]) => {
    for (const node of nodes) {
      const sectionTypeId = node.meta?.sectionTypeId;
      const layoutId = sectionTypeId
        ? selectedFormatSelection?.sectionLayouts?.[sectionTypeId]
        : undefined;
      const layout = layoutId ? layoutsById.get(layoutId) : undefined;

      byBinderUuid[node.uuid] = {
        binderUuid: node.uuid,
        title: node.title,
        included: isIncluded(node),
        sectionTypeId,
        sectionTypeTitle: node.meta?.sectionTypeTitle,
        layoutId,
        layoutName: layout?.name,
        hasMappedLayout: Boolean(layoutId),
        hasLayoutDefinition: Boolean(layout),
        includeTitles: layout?.include?.titles ?? layout?.includeTitles,
        includeSynopses: layout?.include?.synopses,
        includeNotes: layout?.include?.notes,
        includeText: layout?.include?.text,
      };

      if (node.children.length) {
        visit(node.children);
      }
    }
  };

  visit(binder);

  return {
    currentFileType: compile.currentFileType,
    selectedFormatId,
    selectedFormatName,
    byBinderUuid,
  };
}

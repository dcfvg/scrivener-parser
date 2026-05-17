import type { ScrivenerProjectTargets, ScrivenerStats, ScrivenerWritingHistoryEntry } from '../types.js';
import { ScrivenerArchive } from '../archive/ScrivenerArchive.js';
import { parseXml } from '../utils/xml.js';
import { toArray, asNumber } from '../utils/collections.js';
import { tryOptionalParse, type ParserDiagnosticSink } from '../utils/diagnostics.js';

function joinPath(base: string, child: string): string {
  return base ? `${base.replace(/\/$/, '')}/${child}` : child;
}

function parseTargets(node: any): ScrivenerProjectTargets {
  const draftTarget = node?.DraftTarget
    ? {
        ...node.DraftTarget,
        value: asNumber(node.DraftTarget['#text'] ?? node.DraftTarget.text ?? node.DraftTarget.value),
      }
    : undefined;
  const sessionTarget = node?.SessionTarget
    ? {
        ...node.SessionTarget,
        value: asNumber(
          node.SessionTarget['#text'] ?? node.SessionTarget.text ?? node.SessionTarget.value,
        ),
      }
    : undefined;
  return {
    draftTarget,
    sessionTarget,
    previousSession: node?.PreviousSession,
  };
}

function parseWritingHistory(
  archive: ScrivenerArchive,
  basePath: string,
  options: ParserDiagnosticSink,
): ScrivenerWritingHistoryEntry[] {
  const path = joinPath(basePath, 'Files/writing.history');
  if (!archive.has(path)) {
    return [];
  }
  const xml = tryOptionalParse<any | undefined>(
    options,
    {
      code: 'xml_parse_failed',
      path,
    },
    undefined,
    () => parseXml<any>(archive.readText(path)),
  );
  if (!xml) {
    return [];
  }
  const days = toArray(xml?.WritingHistory?.Day ?? []);
  return days.map((day: any) => ({
    date: String(day['#text'] ?? day.Text ?? ''),
    draftWordCount: asNumber(day.dwc ?? day.DWC),
    draftCharCount: asNumber(day.dcc ?? day.DCC),
    otherWordCount: asNumber(day.owc ?? day.OWC),
    otherCharCount: asNumber(day.occ ?? day.OCC),
    draftTargetWordCount: asNumber(day.dtwc ?? day.DTWC),
    draftTargetCharCount: asNumber(day.dtcc ?? day.DTCC),
    sessionWordCount: asNumber(day.twc ?? day.TWC),
    sessionCharCount: asNumber(day.tcc ?? day.TCC),
  }));
}

export function parseStats(
  archive: ScrivenerArchive,
  basePath: string,
  projectNode: any,
  options: ParserDiagnosticSink = {},
): ScrivenerStats {
  return {
    projectTargets: parseTargets(projectNode.ProjectTargets ?? {}),
    recentWritingHistory: projectNode.RecentWritingHistory,
    writingHistory: parseWritingHistory(archive, basePath, options),
  };
}

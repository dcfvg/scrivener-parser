import { ScrivenerArchive } from '../archive/ScrivenerArchive.js';
import type { ScrivenerResources, ScrivenerStyleDefinition, ScrivenerUserLock } from '../types.js';
import { parseXml } from '../utils/xml.js';
import { toArray } from '../utils/collections.js';
import { bufferToBase64 } from '../utils/encoding.js';
import { guessMimeType } from '../utils/mime.js';
import { tryOptionalParse, type ParserDiagnosticSink } from '../utils/diagnostics.js';

interface ResourceOptions extends ParserDiagnosticSink {
  basePath: string;
  includeBinaryAssets: boolean;
}

// Scrivener stores style box colors in Apple Generic RGB, not in sRGB.
// These constants come from macOS ICC profiles:
// - Generic RGB Profile.icc (matrix + TRC gamma 461/256)
// - sRGB Profile.icc (matrix, inverted to land in sRGB linear space)
const GENERIC_RGB_GAMMA = 461 / 256;
const GENERIC_RGB_TO_SRGB_LINEAR_MATRIX: ReadonlyArray<ReadonlyArray<number>> = [
  [1.02524872935, -0.026568141206, 0.0013022308],
  [0.019403506303, 0.948049574588, 0.032594620029],
  [-0.001771677222, -0.001437927707, 1.003203455027],
];

function joinPath(base: string, child: string): string {
  return base ? `${base.replace(/\/$/, '')}/${child}` : child;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function multiplyMatrixVector(
  matrix: ReadonlyArray<ReadonlyArray<number>>,
  vector: ReadonlyArray<number>,
): [number, number, number] {
  return matrix.map((row) => row.reduce((sum, coefficient, index) => (
    sum + (coefficient * (vector[index] ?? 0))
  ), 0)) as [number, number, number];
}

function encodeSrgb(linear: number): number {
  const clamped = clampUnit(linear);
  if (clamped <= 0.0031308) {
    return 12.92 * clamped;
  }
  return (1.055 * (clamped ** (1 / 2.4))) - 0.055;
}

function normalizeStyleUiColor(value: unknown): string | undefined {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return undefined;
  }

  const parts = raw.split(/\s+/).map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    return undefined;
  }

  if (parts.some((part) => part > 1)) {
    const [r, g, b] = parts.map((part) => clampByte(part));
    return `rgb(${r}, ${g}, ${b})`;
  }

  const genericLinear = parts.map((part) => clampUnit(part) ** GENERIC_RGB_GAMMA) as [
    number,
    number,
    number,
  ];
  const srgbLinear = multiplyMatrixVector(GENERIC_RGB_TO_SRGB_LINEAR_MATRIX, genericLinear);
  const [r, g, b] = srgbLinear.map((part) => clampByte(encodeSrgb(part) * 255));

  return `rgb(${r}, ${g}, ${b})`;
}

function parseStyles(
  archive: ScrivenerArchive,
  path: string,
  options: ParserDiagnosticSink,
): ScrivenerStyleDefinition[] {
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
  const styles = toArray(xml?.Styles?.Style ?? []);
  return styles.map((style: any) => ({
    id: style.ID,
    name: style.Name,
    type: style.Type,
    shortcut: style.Shortcut,
    formatRtf: style.Format ? String(style.Format) : undefined,
    uiColor: normalizeStyleUiColor(style.Box),
    uiColorRaw: style.Box ? String(style.Box) : undefined,
  }));
}

function parseDocsChecksum(archive: ScrivenerArchive, path: string): Array<{ path: string; checksum: string }> {
  if (!archive.has(path)) {
    return [];
  }
  return archive
    .readText(path)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => Boolean(line) && line.includes('='))
    .map((line) => {
      const [relative, checksum] = line.split('=');
      return { path: relative, checksum };
    });
}

function parseUserLock(archive: ScrivenerArchive, path: string): ScrivenerUserLock | undefined {
  if (!archive.has(path)) {
    return undefined;
  }

  const raw = archive.readText(path).trim();
  if (!raw) {
    return undefined;
  }

  const entries = Object.fromEntries(
    raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => Boolean(line) && line.includes('='))
      .map((line) => {
        const separatorIndex = line.indexOf('=');
        return [line.slice(0, separatorIndex), line.slice(separatorIndex + 1)] as const;
      }),
  );

  return {
    raw,
    entries,
    platform: entries.platform,
    host: entries.host,
    user: entries.user,
    uuid: entries.uuid,
    app: entries.app,
    projectPath: entries.project_path,
    appPath: entries.app_path,
  };
}

function parseIcons(archive: ScrivenerArchive, base: string, includeData: boolean) {
  const iconsPath = joinPath(base, 'Icons');
  const files = archive
    .list(iconsPath)
    .filter((path) => path.startsWith(`${iconsPath}/`));
  return files.map((file) => {
    const name = file.split('/').pop() ?? file;
    return {
      name,
      base64: includeData ? bufferToBase64(archive.readBinary(file)) : undefined,
      contentType: guessMimeType(name),
    };
  });
}

export function parseResources(
  archive: ScrivenerArchive,
  options: ResourceOptions,
): ScrivenerResources {
  return {
    styles: parseStyles(archive, joinPath(options.basePath, 'Files/styles.xml'), options),
    version: archive.has(joinPath(options.basePath, 'Files/version.txt'))
      ? archive.readText(joinPath(options.basePath, 'Files/version.txt')).trim()
      : undefined,
    docsChecksum: parseDocsChecksum(archive, joinPath(options.basePath, 'Files/Data/docs.checksum')),
    userLock: parseUserLock(archive, joinPath(options.basePath, 'Files/user.lock')),
    icons: parseIcons(archive, options.basePath, options.includeBinaryAssets),
    quickLook: archive.has(joinPath(options.basePath, 'QuickLook/Preview.html'))
      ? archive.readText(joinPath(options.basePath, 'QuickLook/Preview.html'))
      : undefined,
  };
}

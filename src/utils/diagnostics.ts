import type { ScrivenerParserDiagnostic } from '../types.js';

export interface ParserDiagnosticSink {
  tolerant?: boolean;
  diagnostics?: ScrivenerParserDiagnostic[];
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function recordParserDiagnostic(
  sink: ParserDiagnosticSink | undefined,
  diagnostic: Omit<ScrivenerParserDiagnostic, 'level' | 'message'> & {
    level?: ScrivenerParserDiagnostic['level'];
    message?: string;
    error?: unknown;
  },
): void {
  sink?.diagnostics?.push({
    level: diagnostic.level ?? 'warning',
    code: diagnostic.code,
    message: diagnostic.message ?? errorMessage(diagnostic.error),
    path: diagnostic.path,
    documentId: diagnostic.documentId,
  });
}

export function tryOptionalParse<T>(
  sink: ParserDiagnosticSink | undefined,
  diagnostic: Omit<ScrivenerParserDiagnostic, 'level' | 'message'> & {
    level?: ScrivenerParserDiagnostic['level'];
    message?: string;
  },
  fallback: T,
  parse: () => T,
): T {
  try {
    return parse();
  } catch (error) {
    if (!sink?.tolerant) {
      throw error;
    }
    recordParserDiagnostic(sink, {
      ...diagnostic,
      error,
    });
    return fallback;
  }
}

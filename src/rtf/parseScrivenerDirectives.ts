export interface ScrivenerParagraphDirectiveState {
  keepWithNext?: boolean;
  headerLevel?: number;
  styleRef?: string | null;
}

const SCRIVENER_DIRECTIVE_PREFIX_RE = /<!?\$Scr[^>\n]+>/y;

function getDirectiveBody(token: string): string {
  if (token.startsWith('<!$') && token.endsWith('>')) {
    return token.slice(3, -1);
  }
  if (token.startsWith('<$') && token.endsWith('>')) {
    return token.slice(2, -1);
  }
  return '';
}

function isClosingDirective(token: string): boolean {
  return token.startsWith('<!$');
}

export function extractLeadingScrivenerParagraphDirectiveState(
  text: string,
): ScrivenerParagraphDirectiveState {
  const state: ScrivenerParagraphDirectiveState = {};
  let cursor = 0;

  while (cursor < text.length) {
    SCRIVENER_DIRECTIVE_PREFIX_RE.lastIndex = cursor;
    const match = SCRIVENER_DIRECTIVE_PREFIX_RE.exec(text);
    if (!match || match.index !== cursor) {
      break;
    }

    const token = match[0];
    const body = getDirectiveBody(token);
    const closing = isClosingDirective(token);

    if (body === 'ScrKeepWithNext' || body === 'ScrKeepWithNextSplittable') {
      state.keepWithNext = !closing;
    } else {
      const headerMatch = /^Scr_H::(\d+)$/.exec(body);
      if (headerMatch && !closing) {
        state.headerLevel = Number(headerMatch[1]);
      }
      const paragraphStyleMatch = /^Scr_Ps::(.+)$/.exec(body);
      if (paragraphStyleMatch && !closing) {
        state.styleRef = paragraphStyleMatch[1];
      }
    }

    cursor = SCRIVENER_DIRECTIVE_PREFIX_RE.lastIndex;
  }

  return state;
}

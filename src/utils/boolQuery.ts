type TokenType = 'WORD' | 'AND' | 'OR' | 'NOT' | 'LPAREN' | 'RPAREN';

interface Token {
  type: TokenType;
  value?: string;
  isRegex?: boolean;
  flags?: string;
}

export interface BoolQuery {
  evaluate: (text: string) => boolean;
}

function tokenizeBool(query: string): Token[] {
  const tokens: Token[] = [];
  const regex = /"[^"]+"|\(|\)|\bAND\b|\bOR\b|\bNOT\b|-?\/.+?\/[gimuy]*|-?\w[\w:-]*/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(query)) !== null) {
    const raw = match[0];
    if (raw === '(') {
      tokens.push({ type: 'LPAREN' });
      continue;
    }
    if (raw === ')') {
      tokens.push({ type: 'RPAREN' });
      continue;
    }
    const upper = raw.toUpperCase();
    if (upper === 'AND') {
      tokens.push({ type: 'AND' });
      continue;
    }
    if (upper === 'OR') {
      tokens.push({ type: 'OR' });
      continue;
    }
    if (upper === 'NOT') {
      tokens.push({ type: 'NOT' });
      continue;
    }

    const isNegated = raw.startsWith('-');
    const cleaned = isNegated ? raw.slice(1) : raw;
    const regexMatch = cleaned.match(/^\/(.+)\/([gimuy]*)$/);
    const wordToken: Token = regexMatch
      ? { type: 'WORD', value: regexMatch[1], isRegex: true, flags: regexMatch[2] }
      : { type: 'WORD', value: cleaned.replace(/^"|"$/g, '') };
    if (isNegated) {
      tokens.push({ type: 'NOT' });
    }
    tokens.push(wordToken);
  }
  return tokens;
}

function precedence(type: TokenType): number {
  switch (type) {
    case 'NOT':
      return 3;
    case 'AND':
      return 2;
    case 'OR':
      return 1;
    default:
      return 0;
  }
}

function toRpn(tokens: Token[]): Token[] {
  const output: Token[] = [];
  const stack: Token[] = [];
  for (const token of tokens) {
    if (token.type === 'WORD') {
      output.push(token);
      continue;
    }
    if (token.type === 'NOT' || token.type === 'AND' || token.type === 'OR') {
      while (
        stack.length &&
        stack[stack.length - 1].type !== 'LPAREN' &&
        precedence(stack[stack.length - 1].type) >= precedence(token.type)
      ) {
        output.push(stack.pop()!);
      }
      stack.push(token);
      continue;
    }
    if (token.type === 'LPAREN') {
      stack.push(token);
      continue;
    }
    if (token.type === 'RPAREN') {
      while (stack.length && stack[stack.length - 1].type !== 'LPAREN') {
        output.push(stack.pop()!);
      }
      stack.pop();
    }
  }
  while (stack.length) output.push(stack.pop()!);
  return output;
}

export function buildBoolQuery(
  query: string,
  normalize: (value: string) => string,
): BoolQuery {
  const tokens = toRpn(tokenizeBool(query));
  return {
    evaluate(text: string) {
      const stack: boolean[] = [];
      const haystack = normalize(text);
      for (const token of tokens) {
        switch (token.type) {
          case 'WORD':
            if (token.isRegex) {
              try {
                const re = new RegExp(token.value ?? '', token.flags ?? 'g');
                stack.push(re.test(haystack));
              } catch {
                stack.push(false);
              }
            } else {
              stack.push(haystack.includes(normalize(token.value ?? '')));
            }
            break;
          case 'NOT': {
            const a = stack.pop() ?? false;
            stack.push(!a);
            break;
          }
          case 'AND': {
            const b = stack.pop() ?? false;
            const a = stack.pop() ?? false;
            stack.push(a && b);
            break;
          }
          case 'OR': {
            const b = stack.pop() ?? false;
            const a = stack.pop() ?? false;
            stack.push(a || b);
            break;
          }
          default:
            break;
        }
      }
      return stack.pop() ?? false;
    },
  };
}

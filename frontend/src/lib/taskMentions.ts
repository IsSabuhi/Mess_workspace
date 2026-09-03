export function activeMentionToken(text: string): { query: string; start: number; end: number } | null {
  const m = text.match(/(^|\s)@([^\s@]*)$/u);
  if (!m) return null;
  const query = m[2] ?? "";
  const start = text.length - query.length - 1;
  return { query, start, end: text.length };
}

export function applyMention(text: string, token: { start: number; end: number }, mentionValue: string): string {
  return `${text.slice(0, token.start)}${mentionValue} ${text.slice(token.end)}`;
}

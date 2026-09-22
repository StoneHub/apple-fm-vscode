// Editor-free request building and response shaping, shared by the extension and scripts/dogfood.js.
import { normalizeInsertion, requestId, Request } from './backend';
import { commentInsertion, completionHint, CompletionHint, MAX_COMMENT_LINES } from './comments';

export const CAP = 6000;
export type Prepared = { request: Request; hint: CompletionHint; linePrefix: string; lineSuffix: string };

function contextFor(text: string, offset: number, scope: string, cap: number, note?: (message: string) => void) {
  if (scope === 'currentFile' && text.length <= cap) return { before: text.slice(0, offset), after: text.slice(offset) };
  const start = scope === 'nearby' ? Math.max(0, offset - cap / 2) : Math.max(0, Math.min(offset - cap / 2, text.length - cap));
  if (scope === 'currentFile') note?.(`currentFile context truncated (${text.length} chars)`);
  return { before: text.slice(start, offset), after: text.slice(offset, start + cap) };
}
export function prepare(text: string, offset: number, language: string, scope: string, note?: (message: string) => void): Prepared {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1, lineEnd = text.indexOf('\n', offset);
  const linePrefix = text.slice(lineStart, offset), lineSuffix = text.slice(offset, lineEnd < 0 ? text.length : lineEnd);
  const linesAbove = text.slice(0, Math.max(0, lineStart - 1)).split('\n').slice(-MAX_COMMENT_LINES);
  const hint = completionHint(language, linePrefix, lineStart ? linesAbove : []);
  const request: Request = { id: requestId(), kind: 'editor', language, ...contextFor(text, offset, scope, CAP - (hint.context?.length ?? 0), note), context: hint.context, mode: hint.comment ? 'comment' : undefined };
  return { request, hint, linePrefix, lineSuffix };
}
// When the model restates the cursor line further down, continue from that restatement instead of its first line.
function oneLine(lines: string[], linePrefix: string, lineSuffix: string): string {
  const anchor = linePrefix.trim(), suffix = lineSuffix.trim();
  const echo = anchor.length >= 3 ? lines.slice(1).find(line => line.trimStart().startsWith(anchor)) : undefined;
  let line = echo ? echo.trimStart().slice(anchor.length) : lines[0];
  if (suffix && line.endsWith(suffix)) line = line.slice(0, -suffix.length);
  return /\s$/.test(linePrefix) ? line.trimStart() : line;
}
// After code or before existing text, keep one line; on an empty line, reindent a block to the cursor's indentation.
export function shapeCode(text: string, linePrefix: string, lineSuffix: string): string {
  const blank = !linePrefix.trim();
  let lines = text.split('\n');
  if (blank) while (lines.length > 1 && !lines[0].trim()) lines.shift();
  const base = blank ? lines[0].match(/^[ \t]*/)![0] : '';
  lines = lines.map(line => line.startsWith(base) ? line.slice(base.length) : line.trimStart());
  if (!blank || lineSuffix.trim()) return oneLine(lines, linePrefix, lineSuffix);
  return lines.map((line, i) => i === 0 ? line : line.trim() ? linePrefix + line : '').join('\n').trimEnd();
}
export function finish(raw: string, prepared: Prepared): string {
  const normalized = normalizeInsertion(raw, prepared.request.before, prepared.request.after);
  return prepared.hint.comment ? commentInsertion(normalized, prepared.linePrefix, prepared.request.language) : shapeCode(normalized, prepared.linePrefix, prepared.lineSuffix);
}

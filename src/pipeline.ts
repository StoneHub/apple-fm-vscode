// Editor-free request building and response shaping, shared by the extension and scripts/dogfood.js.
import { bracketExcess, normalizeInsertion, requestId, Request, stripSuffix } from './backend';
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
  const linePrefix = text.slice(lineStart, offset), lineSuffix = text.slice(offset, lineEnd < 0 ? text.length : lineEnd).replace(/\r$/, '');
  const linesAbove = text.slice(0, Math.max(0, lineStart - 1)).split('\n').slice(-MAX_COMMENT_LINES);
  const hint = completionHint(language, linePrefix, lineStart ? linesAbove : []);
  const request: Request = { id: requestId(), kind: 'editor', language, ...contextFor(text, offset, scope, CAP - (hint.context?.length ?? 0), note), context: hint.context, mode: hint.comment ? 'comment' : undefined };
  return { request, hint, linePrefix, lineSuffix };
}
const indentOf = (line: string) => line.match(/^[ \t]*/)![0].length;
const OPENS_BLOCK = /([:{([]|\bdo(\s*\|[^|]*\|)?|\bthen)\s*$|^\s*(def|class|module|if|unless|while|until|for|case|begin|function|fn|func|struct|enum)\b/;
const END_LANGUAGES = new Set(['ruby', 'elixir', 'crystal', 'lua']);
const OPENS_END = /^\s*(def|class|module|if|unless|while|until|case|begin|for)\b|\bdo(\s*\|[^|]*\|)?\s*$/;
export type ShapeContext = { before?: string; language?: string };

// True when the line repeats one of the non-empty lines above the cursor.
function restated(line: string, before: string) {
  return !!line.trim() && before.split('\n').slice(0, -1).some(above => above.trim() === line.trim());
}
// When the model restates earlier lines and then the cursor line, continue from that restatement instead of its first line.
function oneLine(lines: string[], linePrefix: string, lineSuffix: string, before: string): string {
  const anchor = linePrefix.trim();
  const echo = anchor.length >= 3 && restated(lines[0], before) ? lines.slice(1).find(line => line.trimStart().startsWith(anchor)) : undefined;
  const line = stripSuffix(echo ? echo.trimStart().slice(anchor.length) : lines[0], lineSuffix);
  return /\s$/.test(linePrefix) ? line.trimStart() : line;
}
// Drop leading lines that repeat the lines just above the cursor.
function dropRestated(lines: string[], before: string): string[] {
  const above = before.split('\n').slice(0, -1).map(line => line.trim()).filter(Boolean);
  for (let k = Math.min(lines.length - 1, above.length); k > 0; k--) {
    const head = lines.slice(0, k).map(line => line.trim());
    if (head.join('').length >= 4 && head.every((line, i) => line === above[above.length - k + i])) return lines.slice(k);
  }
  return lines;
}
// Drop trailing closers the block never opened; they already follow the cursor in the file.
function dropExtraClosers(lines: string[], language: string): string[] {
  const ends = (block: string[]) => block.filter(line => /^\s*end\b/.test(line)).length - block.filter(line => OPENS_END.test(line)).length;
  while (lines.length > 1) {
    const last = lines[lines.length - 1].trim();
    const extra = /^[)\]}]+[;,]?$/.test(last) ? bracketExcess(lines.join('\n')) > 0 : END_LANGUAGES.has(language) && /^end\b/.test(last) && ends(lines) > 0;
    if (!extra) break;
    lines = lines.slice(0, -1);
  }
  return lines;
}
// With a tab-indented cursor, turn the reply's space indentation into tabs, one tab per indent unit.
function matchTabs(lines: string[], linePrefix: string): string[] {
  const widths = lines.map(line => line.match(/^ */)![0].length).filter(Boolean);
  if (!linePrefix.includes('\t') || !widths.length) return lines;
  const unit = Math.min(...widths);
  return lines.map(line => { const n = line.match(/^ */)![0].length; return '\t'.repeat(Math.floor(n / unit)) + ' '.repeat(n % unit) + line.slice(n); });
}
// Place a block at the cursor. The reply's first line is either indented itself (then every line is relative to it)
// or starts at the cursor, and its later lines are then either at file columns or relative to the first line.
function block(lines: string[], linePrefix: string): string {
  lines = matchTabs(lines, linePrefix);
  const width = linePrefix.length, first = lines[0], firstIndent = indentOf(first);
  if (width === 0) return lines.join('\n');
  const rest = lines.slice(1).filter(line => line.trim()), second = rest[0];
  const fileColumns = firstIndent === 0 && !!second && Math.min(...rest.map(indentOf)) >= width && !(OPENS_BLOCK.test(first) && indentOf(second) <= width);
  return lines.map((line, i) => {
    if (i === 0) return line.slice(firstIndent);
    if (!line.trim()) return '';
    if (fileColumns) return line;
    return linePrefix + (line.startsWith(first.slice(0, firstIndent)) ? line.slice(firstIndent) : line.trimStart());
  }).join('\n');
}
// After code, keep one line. On an empty line, place a block at the cursor. Before existing code on an otherwise empty line, offer nothing.
export function shapeCode(text: string, linePrefix: string, lineSuffix: string, context: ShapeContext = {}): string {
  const before = context.before ?? '', blank = !linePrefix.trim();
  let lines = text.split('\n');
  if (blank) {
    if (lineSuffix.trim()) return '';
    while (lines.length > 1 && !lines[0].trim()) lines.shift();
    lines = dropExtraClosers(dropRestated(lines, before), context.language ?? '');
    return block(lines, linePrefix).trimEnd();
  }
  return oneLine(lines, linePrefix, lineSuffix, before);
}
export function finish(raw: string, prepared: Prepared): string {
  // clean() drops \r from the reply, so compare against the window without it too.
  const before = prepared.request.before.replace(/\r/g, ''), after = prepared.request.after.replace(/\r/g, '');
  const normalized = normalizeInsertion(raw, before, after);
  return prepared.hint.comment ? commentInsertion(normalized, prepared.linePrefix, prepared.request.language)
    : shapeCode(normalized, prepared.linePrefix, prepared.lineSuffix, { before, language: prepared.request.language });
}

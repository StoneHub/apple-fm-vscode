// Line-comment detection for inline completions; languages without an entry get no comment handling.
const markers: Record<string, string[]> = {};
const add = (marker: string, languages: string) => languages.split(' ').forEach(language => (markers[language] ??= []).push(marker));
add('#', 'ruby python shellscript yaml dockerfile makefile perl r coffeescript toml powershell elixir julia properties ini php');
add('//', 'javascript typescript javascriptreact typescriptreact swift go rust c cpp csharp java kotlin scala dart php objective-c objective-cpp jsonc scss less groovy zig');
add('--', 'sql lua haskell elm');
add(';', 'clojure lisp scheme ini');
add('%', 'latex tex erlang matlab');
export const MAX_COMMENT_LINES = 20;

// Index where a line comment starts outside string literals, or -1.
export function commentStart(line: string, language: string): number {
  const own = markers[language];
  if (!own) return -1;
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    const marker = own.find(m => line.startsWith(m, i));
    if (marker) return i;
  }
  return -1;
}
function commentOnly(line: string, language: string) {
  const start = commentStart(line, language);
  return start >= 0 && line.slice(0, start).trim() === '';
}
export type CompletionHint = { comment: boolean; context?: string };
// linePrefix is the cursor line up to the cursor; linesAbove are the lines before it, nearest last.
export function completionHint(language: string, linePrefix: string, linesAbove: string[]): CompletionHint {
  if (commentStart(linePrefix, language) >= 0)
    return { comment: true, context: `The cursor is inside a ${language} comment. Continue only the comment's text on this line. Do not write code.` };
  const block: string[] = [];
  for (let i = linesAbove.length - 1; i >= 0 && block.length < MAX_COMMENT_LINES && commentOnly(linesAbove[i], language); i--) block.unshift(linesAbove[i].trim());
  return block.length ? { comment: false, context: `The comment directly above the cursor describes the code to write next:\n${block.join('\n')}` } : { comment: false };
}
// Keep a comment suggestion to the rest of the current line, without a repeated comment marker.
export function commentInsertion(text: string, linePrefix: string, language: string): string {
  let value = text.split('\n')[0];
  const own = markers[language] ?? [];
  const marker = own.find(m => value.trimStart().startsWith(`${m} `) || value.trim() === m);
  if (marker) value = value.trimStart().slice(marker.length);
  // The model often restates some or all of the typed comment, so drop words that overlap its ending.
  const start = commentStart(linePrefix, language);
  const typed = start < 0 ? [] : linePrefix.slice(start + (own.find(m => linePrefix.startsWith(m, start))?.length ?? 0)).trim().split(/\s+/).filter(Boolean);
  for (let n = typed.length; n > 0; n--) {
    const tail = typed.slice(-n).join(' '), rest = value.trimStart();
    if (rest.startsWith(tail) && !/^[\p{L}\p{N}_]/u.test(rest.slice(tail.length))) { value = rest.slice(tail.length); break; }
  }
  if (/\s$/.test(linePrefix)) value = value.trimStart();
  return value.trimEnd();
}

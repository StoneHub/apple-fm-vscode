// Comment detection for inline completions: line comments, plus block comments and docstrings where the language has them.
// Languages without an entry get no comment handling.
const markers: Record<string, string[]> = {};
const add = (marker: string, languages: string) => languages.split(' ').forEach(language => (markers[language] ??= []).push(marker));
add('#', 'ruby python shellscript yaml dockerfile makefile perl r coffeescript toml powershell elixir julia properties ini php');
add('//', 'javascript typescript javascriptreact typescriptreact swift go rust c cpp csharp java kotlin scala dart php objective-c objective-cpp jsonc scss less groovy zig');
add('--', 'sql lua haskell elm');
add(';', 'clojure lisp scheme ini');
add('%', 'latex tex erlang matlab');
export const MAX_COMMENT_LINES = 20;
// The comment sent as intent stays small so the code around the cursor keeps most of the 6000-character window.
const MAX_INTENT_CHARS = 1000;
const INTERPOLATES = new Set(['ruby', 'elixir', 'crystal', 'coffeescript']);

// # and % start a comment only at the start of a word, which rules out $#, ${#x}, a/#b, \% and interpolation like #{x}.
function startsComment(line: string, i: number, marker: string, language: string) {
  if (marker !== '#' && marker !== '%') return true;
  if (i > 0 && !/[\s;&|()<>]/.test(line[i - 1])) return false;
  if (marker === '#' && line[i + 1] === '{' && INTERPOLATES.has(language)) return false;
  return !(language === 'php' && line[i + 1] === '[');
}

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
    if (marker && startsComment(line, i, marker, language)) return i;
  }
  return -1;
}
// /* */ languages; those in NESTS allow a block comment inside another.
const C_BLOCK = new Set('javascript typescript javascriptreact typescriptreact swift go rust c cpp csharp java kotlin scala dart php objective-c objective-cpp jsonc css scss less groovy sql'.split(' '));
const NESTS = new Set(['swift', 'rust', 'kotlin', 'scala', 'dart']);
const BACKTICK_STRINGS = new Set(['javascript', 'typescript', 'javascriptreact', 'typescriptreact', 'go']);
// In Rust and Swift ' is a lifetime or not a delimiter, so only " opens a string there.
const DOUBLE_ONLY = new Set(['rust', 'swift']);

function openCBlock(text: string, language: string): number {
  const nests = NESTS.has(language), lineMarkers = markers[language] ?? [];
  let depth = 0, start = -1, quote = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (depth) {
      if (text.startsWith('*/', i)) { depth--; i++; }
      else if (nests && text.startsWith('/*', i)) { depth++; i++; }
      continue;
    }
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
      else if (ch === '\n' && quote !== '`') quote = '';
      continue;
    }
    if (text.startsWith('/*', i)) { depth = 1; start = i; i++; continue; }
    if (ch === '"' || (ch === "'" && !DOUBLE_ONLY.has(language)) || (ch === '`' && BACKTICK_STRINGS.has(language))) { quote = ch; continue; }
    const marker = lineMarkers.find(m => text.startsWith(m, i));
    if (marker && startsComment(text, i, marker, language)) {
      const end = text.indexOf('\n', i);
      if (end < 0) return -1;
      i = end;
    }
  }
  return depth ? start : -1;
}

// =begin and =end count only at the start of a line.
function openRubyBlock(text: string): number {
  let start = -1, offset = 0;
  for (const line of text.split('\n')) {
    if (start < 0 && /^=begin(\s|$)/.test(line)) start = offset;
    else if (start >= 0 && /^=end(\s|$)/.test(line)) start = -1;
    offset += line.length + 1;
  }
  return start;
}

// A triple-quoted string is a docstring when it stands alone on its line, first in the file or right under a line ending in :
// (def, class). query = """SELECT is an ordinary string.
function isDocstring(text: string, start: number) {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  if (!/^[ \t]*[rRuU]?$/.test(text.slice(lineStart, start))) return false;
  const code = text.slice(0, Math.max(0, lineStart - 1)).split('\n').map(line => {
    const comment = commentStart(line, 'python');
    return (comment < 0 ? line : line.slice(0, comment)).trim();
  }).filter(Boolean);
  return !code.length || code[code.length - 1].endsWith(':');
}

function openDocstring(text: string): number {
  let quote = '', start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (text.startsWith(quote, i)) { i += quote.length - 1; quote = ''; }
      else if (ch === '\n' && quote.length === 1) quote = '';
      continue;
    }
    if (ch === '#') {
      const end = text.indexOf('\n', i);
      if (end < 0) return -1;
      i = end; continue;
    }
    const triple = text.startsWith('"""', i) ? '"""' : text.startsWith("'''", i) ? "'''" : '';
    if (triple) { quote = triple; start = i; i += 2; continue; }
    if (ch === '"' || ch === "'") quote = ch;
  }
  return quote.length === 3 && isDocstring(text, start) ? start : -1;
}

// Index where the block comment or docstring that the text ends inside starts, or -1. The text is everything before the cursor.
export function openBlockComment(text: string, language: string): number {
  if (language === 'ruby') return openRubyBlock(text);
  if (language === 'python') return openDocstring(text);
  return C_BLOCK.has(language) ? openCBlock(text, language) : -1;
}
function commentOnly(line: string, language: string) {
  const start = commentStart(line, language);
  return start >= 0 && line.slice(0, start).trim() === '';
}
export type CompletionHint = { comment: boolean; block?: boolean; context?: string };
// linePrefix is the cursor line up to the cursor; linesAbove are the lines before it, nearest last; inBlock says the cursor is
// inside a block comment or docstring (openBlockComment).
export function completionHint(language: string, linePrefix: string, linesAbove: string[], inBlock = false): CompletionHint {
  if (inBlock)
    return { comment: true, block: true, context: `The cursor is inside a ${language} block comment or docstring. Continue only its text on this line. Do not close it or write code.` };
  if (commentStart(linePrefix, language) >= 0)
    return { comment: true, context: `The cursor is inside a ${language} comment. Continue only the comment's text on this line. Do not write code.` };
  const block: string[] = [];
  let chars = 0;
  for (let i = linesAbove.length - 1; i >= 0 && block.length < MAX_COMMENT_LINES && commentOnly(linesAbove[i], language); i--) {
    const line = linesAbove[i].trim();
    if (chars + line.length > MAX_INTENT_CHARS) break;
    block.unshift(line); chars += line.length + 1;
  }
  return block.length ? { comment: false, context: `The comment directly above the cursor describes the code to write next:\n${block.join('\n')}` } : { comment: false };
}
const BLOCK_DECORATION = /^(\/\*+|\*+|"""|'''|=begin\b)/;
const BLOCK_CLOSER: Record<string, RegExp> = { python: /"""|'''/, ruby: /^=end\b/ };
// Keep a comment suggestion to the rest of the current line, without a repeated comment marker. In a block comment or
// docstring, the typed decoration (/**, *, """, =begin) counts as the marker, and the suggestion stops before a closer.
export function commentInsertion(text: string, linePrefix: string, language: string, block = false): string {
  let value = text.split('\n')[0];
  if (block) {
    // Streaming can stop at a bare fence before the backend's fence cleaner sees a newline.
    if (/^\s*```(?:\w+)?\s*$/.test(value)) return '';
    const closer = value.search(BLOCK_CLOSER[language] ?? /\*\//);
    if (closer >= 0) value = value.slice(0, closer);
  }
  const start = block ? linePrefix.match(/^[ \t]*/)![0].length : commentStart(linePrefix, language);
  // The typed marker run, e.g. ///, ## or ;;, so a restated one is stripped whole.
  const run = start < 0 ? '' : block ? linePrefix.slice(start).match(BLOCK_DECORATION)?.[0] ?? '' : linePrefix.slice(start).match(/^([^\s\w])\1*/)?.[0] ?? '';
  const marker = [run, ...(block ? ['*', '/*', '/**', '"""', "'''", ...(language === 'ruby' ? ['=begin'] : [])] : markers[language] ?? [])].filter(Boolean).sort((a, b) => b.length - a.length)
    .find(m => value.trimStart().startsWith(`${m} `) || value.trim() === m);
  if (marker) value = value.trimStart().slice(marker.length);
  // The model often restates some or all of the typed comment, so drop words that overlap its ending.
  // Mid-word, the last typed word may continue into the reply (fu + full -> ll).
  const midWord = !/\s$/.test(linePrefix);
  const typed = linePrefix.slice(start + run.length).trim().split(/\s+/).filter(Boolean);
  for (let n = start < 0 ? 0 : typed.length; n > 0; n--) {
    const tail = typed.slice(-n).join(' '), rest = value.trimStart();
    if (rest.startsWith(tail) && (midWord || !/^[\p{L}\p{N}_]/u.test(rest.slice(tail.length)))) { value = rest.slice(tail.length); break; }
  }
  if (!midWord) value = value.trimStart();
  return value.trimEnd();
}

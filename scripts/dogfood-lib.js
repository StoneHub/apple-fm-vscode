// Fixture loading and suggestion checks shared by scripts/dogfood.js and scripts/regression-golden.js.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { bracketExcess } = require('../dist/backend');
const { repeatedTail } = require('../dist/pipeline');

const LANGUAGES = { rb: 'ruby', py: 'python', ts: 'typescript', js: 'javascript', swift: 'swift', go: 'go', sh: 'shellscript', rs: 'rust', sql: 'sql' };
const FIXTURES = path.join(__dirname, 'dogfood');
const GOLDEN = path.join(__dirname, 'golden');

function loadFixture(file) {
  const source = fs.readFileSync(file, 'utf8'), offset = source.indexOf('<CURSOR>');
  return { name: path.basename(file), language: LANGUAGES[path.extname(file).slice(1)] ?? 'plaintext', text: source.replace('<CURSOR>', ''), offset };
}
function fixtureFiles() {
  return fs.readdirSync(FIXTURES).sort().map(f => path.join(FIXTURES, f)).filter(f => fs.statSync(f).isFile());
}
// Parse the file with the suggestion inserted, for languages with a local syntax checker; null means not checked.
function parses(language, text) {
  if (['typescript', 'javascript'].includes(language)) {
    const ts = require('typescript');
    return ts.transpileModule(text, { reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.CommonJS } }).diagnostics.length === 0;
  }
  const run = { ruby: ['ruby', ['-c']], python: ['python3', ['-c', 'import ast,sys; ast.parse(sys.stdin.read())']] }[language];
  if (!run) return null;
  try { execFileSync(run[0], run[1], { input: text, stdio: ['pipe', 'ignore', 'ignore'] }); return true; } catch { return false; }
}
// Each check is true, false, or null when it does not apply. The verdict ranks a broken suggestion below none at all:
// bad (a check failed), none (nothing suggested), good (suggested and every check passed).
function score(fixture, prepared, insertion) {
  const { text, offset, language } = fixture;
  const lines = insertion.split('\n');
  // Closers the suggestion never opened would duplicate the ones already after the cursor.
  const extraEnds = language === 'ruby' ? lines.filter(line => /^\s*end\b/.test(line)).length - lines.filter(line => /^\s*(def|class|module|if|unless|while|until|case|begin)\b|\bdo(\s*\|[^|]*\|)?\s*$/.test(line)).length : 0;
  const anchor = prepared.linePrefix.trim();
  const oneLine = prepared.hint.comment || !!anchor;
  const checks = {
    suggested: insertion.trim().length > 0,
    noEcho: anchor.length >= 3 ? !insertion.trimStart().startsWith(anchor) && repeatedTail(insertion, prepared.linePrefix) === 0 : null,
    noExtraClosers: lines.length > 1 ? bracketExcess(insertion) <= 0 && extraEnds <= 0 : null,
    shape: oneLine ? !insertion.includes('\n') : null,
    parses: insertion.trim() ? parses(language, text.slice(0, offset) + insertion + text.slice(offset)) : null,
  };
  const applied = Object.values(checks).filter(value => value !== null);
  const verdict = !checks.suggested ? 'none' : applied.every(Boolean) ? 'good' : 'bad';
  return { checks, verdict, passed: applied.filter(Boolean).length, total: applied.length };
}
const RANK = { bad: 0, none: 1, good: 2 };
const goldenPath = (name, backend) => path.join(GOLDEN, `${name}.${backend}.json`);

module.exports = { LANGUAGES, FIXTURES, GOLDEN, RANK, loadFixture, fixtureFiles, score, goldenPath };

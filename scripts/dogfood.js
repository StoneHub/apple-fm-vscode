#!/usr/bin/env node
// Run real on-device completions through the extension's own pipeline and print what the editor would insert.
// Usage: node scripts/dogfood.js [--backend fm|swift|both] [--runs N] [--scope nearby|currentFile] [--text '<code with <CURSOR>>' --lang ruby] [fixture ...]
// Fixtures mark the cursor with <CURSOR>; with no fixtures or --text, every file in scripts/dogfood/ runs. Run `npm run compile` first.
const fs = require('node:fs');
const path = require('node:path');
const { createBackend } = require('../dist/backend');
const { prepare, finish } = require('../dist/pipeline');

const LANGUAGES = { rb: 'ruby', py: 'python', ts: 'typescript', js: 'javascript', swift: 'swift', go: 'go', sh: 'shellscript', rs: 'rust', sql: 'sql' };
const args = process.argv.slice(2), files = [];
const opts = { backend: 'both', runs: 1, scope: 'nearby', text: undefined, lang: 'ruby' };
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) opts[args[i].slice(2)] = args[++i];
  else files.push(args[i]);
}
const dir = path.join(__dirname, 'dogfood');
const cases = opts.text !== undefined ? [{ name: '--text', language: opts.lang, source: opts.text }]
  : (files.length ? files : fs.readdirSync(dir).sort().map(f => path.join(dir, f)))
      .map(file => ({ name: path.basename(file), language: LANGUAGES[path.extname(file).slice(1)] ?? 'plaintext', source: fs.readFileSync(file, 'utf8') }));
const kinds = opts.backend === 'both' ? ['fm', 'swift'] : [opts.backend];
const backends = Object.fromEntries(kinds.map(kind => [kind, createBackend(kind, path.join(__dirname, '..', 'bin', 'apple-fm-helper'))]));

function show(label, value) { console.log(`  ${label.padEnd(8)}${JSON.stringify(value)}`); }
(async () => {
  for (const { name, language, source } of cases) {
    const offset = source.indexOf('<CURSOR>');
    if (offset < 0) { console.log(`${name}: no <CURSOR> marker, skipped`); continue; }
    const text = source.replace('<CURSOR>', '');
    for (const kind of kinds) for (let run = 1; run <= Number(opts.runs); run++) {
      const prepared = prepare(text, offset, language, opts.scope);
      const started = Date.now();
      const result = await backends[kind].run(prepared.request);
      const ms = Date.now() - started;
      const insertion = result.status === 'ok' ? finish(result.insertText, prepared) : '';
      const mode = prepared.hint.comment ? 'comment' : prepared.hint.context ? 'code+intent' : 'code';
      console.log(`${name} [${kind}${Number(opts.runs) > 1 ? ` #${run}` : ''}] ${mode} ${result.status} ${ms}ms`);
      show('raw', result.insertText ?? result.reason ?? '');
      show('insert', insertion);
      // The cursor line and any inserted lines, as they would read in the editor after Tab.
      const after = text.slice(0, offset) + insertion + text.slice(offset);
      const first = text.slice(0, offset).split('\n').length - 1;
      after.split('\n').slice(first, first + insertion.split('\n').length).forEach(line => console.log(`  │ ${line}`));
    }
  }
})();

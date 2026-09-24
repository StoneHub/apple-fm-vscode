#!/usr/bin/env node
// Run real on-device completions through the extension's own pipeline, score them, and print what the editor would insert.
// Usage: node scripts/dogfood.js [--backend fm|swift|both] [--runs N] [--scope nearby|currentFile] [--record] [--text '<code with <CURSOR>>' --lang ruby] [fixture ...]
// Fixtures mark the cursor with <CURSOR>; with no fixtures or --text, every file in scripts/dogfood/ runs. Run `npm run compile` first.
// --record saves each raw reply to scripts/golden/ so scripts/regression-golden.js can replay it without the model.
// Exits 1 when a fixture's verdict (good, none, bad) is worse than its recorded reply's.
const fs = require('node:fs');
const path = require('node:path');
const { createBackend } = require('../dist/backend');
const { prepare, finish, stopWhen } = require('../dist/pipeline');
const { loadFixture, fixtureFiles, score, goldenPath, GOLDEN, RANK } = require('./dogfood-lib');

const args = process.argv.slice(2), files = [];
const opts = { backend: 'both', runs: 1, scope: 'nearby', text: undefined, lang: 'ruby', record: false };
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--record') opts.record = true;
  else if (args[i].startsWith('--')) opts[args[i].slice(2)] = args[++i];
  else files.push(args[i]);
}
if (!['fm', 'swift', 'both'].includes(opts.backend)) { console.error(`Unknown --backend ${opts.backend}; use fm, swift or both.`); process.exit(2); }
const cases = opts.text !== undefined
  ? [{ name: '--text', language: opts.lang, text: opts.text.replace('<CURSOR>', ''), offset: opts.text.indexOf('<CURSOR>') }]
  : (files.length ? files : fixtureFiles()).map(loadFixture);
const kinds = opts.backend === 'both' ? ['fm', 'swift'] : [opts.backend];
const backends = Object.fromEntries(kinds.map(kind => [kind, createBackend(kind, path.join(__dirname, '..', 'bin', 'apple-fm-helper'))]));

function show(label, value) { console.log(`  ${label.padEnd(8)}${JSON.stringify(value)}`); }
(async () => {
  let regressions = 0;
  const verdicts = { good: 0, none: 0, bad: 0 };
  for (const fixture of cases) {
    const { name, language, text, offset } = fixture;
    if (offset < 0) { console.log(`${name}: no <CURSOR> marker, skipped`); continue; }
    for (const kind of kinds) for (let run = 1; run <= Number(opts.runs); run++) {
      const prepared = prepare(text, offset, language, opts.scope);
      const started = Date.now();
      const result = await backends[kind].run(prepared.request, undefined, stopWhen(prepared));
      const diag = backends[kind].diagnostics();
      const ms = Date.now() - started;
      const insertion = result.status === 'ok' ? finish(result.insertText, prepared) : '';
      const mode = prepared.hint.comment ? 'comment' : prepared.hint.context ? 'code+intent' : 'code';
      const scored = score(fixture, prepared, insertion);
      verdicts[scored.verdict]++;
      const failed = Object.entries(scored.checks).filter(([, value]) => value === false).map(([check]) => check);
      const golden = name !== '--text' && fs.existsSync(goldenPath(name, kind)) ? JSON.parse(fs.readFileSync(goldenPath(name, kind), 'utf8')) : undefined;
      const worse = golden && RANK[scored.verdict] < RANK[golden.verdict];
      if (worse) regressions++;
      console.log(`${name} [${kind}${Number(opts.runs) > 1 ? ` #${run}` : ''}] ${mode} ${result.status} ${ms}ms${diag?.firstByteMs !== undefined ? ` first ${diag.firstByteMs}ms` : ''}${diag?.stoppedEarly ? ' stopped' : ''} ${scored.verdict}${failed.length ? ` failed: ${failed.join(', ')}` : ''}${worse ? ` WORSE THAN GOLDEN ${golden.verdict}` : ''}`);
      show('raw', result.insertText ?? result.reason ?? '');
      show('insert', insertion);
      // The cursor line and any inserted lines, as they would read in the editor after Tab.
      const shown = text.slice(0, offset) + insertion + text.slice(offset);
      const first = text.slice(0, offset).split('\n').length - 1;
      shown.split('\n').slice(first, first + insertion.split('\n').length).forEach(line => console.log(`  │ ${line}`));
      if (opts.record && name !== '--text' && result.status === 'ok' && run === 1) {
        fs.mkdirSync(GOLDEN, { recursive: true });
        fs.writeFileSync(goldenPath(name, kind), JSON.stringify({ fixture: name, backend: kind, raw: result.insertText, insertion, verdict: scored.verdict }, null, 2) + '\n');
      }
    }
  }
  console.log(`good ${verdicts.good}, none ${verdicts.none}, bad ${verdicts.bad}${regressions ? `, ${regressions} worse than golden` : ''}`);
  process.exitCode = regressions ? 1 : 0;
})();

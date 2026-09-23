#!/usr/bin/env node
// Replay recorded model replies from scripts/golden/ through finish() without the model, so shaping changes are checked against real reply shapes.
// After an intended shaping change, review the diff and run with --update to rewrite the expected insertions and scores.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { prepare, finish } = require('../dist/pipeline');
const { FIXTURES, GOLDEN, RANK, loadFixture, score } = require('./dogfood-lib');

const update = process.argv.includes('--update');
const files = fs.existsSync(GOLDEN) ? fs.readdirSync(GOLDEN).filter(f => f.endsWith('.json')).sort() : [];
assert.ok(files.length > 0, 'no golden replies; record some with node scripts/dogfood.js --record');
for (const file of files) {
  const golden = JSON.parse(fs.readFileSync(path.join(GOLDEN, file), 'utf8'));
  const fixture = loadFixture(path.join(FIXTURES, golden.fixture));
  const prepared = prepare(fixture.text, fixture.offset, fixture.language, 'nearby');
  const insertion = finish(golden.raw, prepared), scored = score(fixture, prepared, insertion);
  if (update) {
    const { passed, total, ...kept } = golden;
    fs.writeFileSync(path.join(GOLDEN, file), JSON.stringify({ ...kept, insertion, verdict: scored.verdict }, null, 2) + '\n');
    continue;
  }
  assert.equal(insertion, golden.insertion, `${file}: insertion changed`);
  assert.ok(RANK[scored.verdict] >= RANK[golden.verdict], `${file}: ${scored.verdict}, recorded ${golden.verdict}`);
}
console.log(`golden regressions: ${update ? 'UPDATED' : 'PASS'} (${files.length} recorded replies)`);

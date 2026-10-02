#!/usr/bin/env node
// Authored replies, not recorded model output. Exercise the actual prepare/finish
// path and both process transports without a real model or executing suggestions.
const assert = require('node:assert/strict');
const { prepare, finish, shapeCode, stopWhen, MAX_BLOCK_LINES, MAX_REPLY_CHARS } = require('../dist/pipeline');
const { ProcessBackend } = require('../dist/backend');
const { score, RUBY_VALIDATOR } = require('./dogfood-lib');
const packet = require('./authored/block-cap.json');

assert.equal(packet.provenance, 'authored');
let checked = 0, unchecked = 0;
for (const fixture of packet.fixtures) {
  const offset = fixture.source.indexOf('<CURSOR>');
  assert.ok(offset >= 0, `${fixture.name}: cursor required`);
  const text = fixture.source.replace('<CURSOR>', '');
  const prepared = prepare(text, offset, fixture.language, 'nearby');
  const insertion = finish(fixture.raw, prepared);
  assert.equal(insertion, fixture.insertion, fixture.name);
  if (!insertion) continue; // Abstention is allowed, and is not a syntax pass.
  const scored = score({ text, offset, language: fixture.language }, prepared, insertion);
  if (scored.validator) {
    unchecked++;
    console.log(`${fixture.name}: syntax unchecked (${scored.validator})`);
  } else {
    assert.equal(scored.checks.parses, true, `${fixture.name}: inserted result must parse`);
    checked++;
  }
}

// The direct shaping entry point must also abstain rather than slice a block.
const overCap = packet.fixtures.find(f => f.name === 'javascript-complete-over-cap');
assert.equal(shapeCode(overCap.raw, '', '', { language: 'javascript' }), '');
const prepared = prepare('', 0, 'javascript', 'nearby');
const stop = stopWhen(prepared);
const capped = overCap.raw.split('\n').slice(0, MAX_BLOCK_LINES).join('\n');
assert.equal(stop(capped), false, 'CLI deadline and stop policy stay unchanged');
assert.equal(stop(overCap.raw), true, 'CLI still stops after the block budget');
assert.equal(stop('x'.repeat(MAX_REPLY_CHARS)), false);
assert.equal(stop('x'.repeat(MAX_REPLY_CHARS + 1)), true);

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let finished = false;
process.on('exit', code => {
  if (!finished && code === 0) {
    console.error('block-cap regressions did not finish');
    process.exitCode = 1;
  }
});

(async () => {
  // CLI-style streaming: the process is stopped while the last line may be partial.
  const streamingProgram = `process.stdin.resume(); process.stdout.write(${JSON.stringify(capped)}); setTimeout(() => { process.stdout.write('\\n}'); }, 30); setInterval(() => {}, 1000);`;
  const cli = new ProcessBackend(process.execPath, ['-e', streamingProgram]);
  try {
    const result = await cli.run(prepared.request, undefined, stop);
    assert.equal(result.status, 'ok');
    assert.equal(cli.diagnostics().stoppedEarly, true);
    assert.equal(finish(result.insertText, prepared), '', 'CLI cut block must abstain');
  } finally { await cli.dispose(); }

  // The Swift JSON protocol can return an already-truncated, exactly-12-line reply.
  const jsonProgram = `let input = ''; process.stdin.on('data', d => input += d); process.stdin.on('end', () => { const request = JSON.parse(input); process.stdout.write(JSON.stringify({ id: request.id, status: 'ok', insertText: ${JSON.stringify(capped)} })); });`;
  const swift = new ProcessBackend(process.execPath, ['-e', jsonProgram], true);
  try {
    const result = await swift.run(prepared.request, undefined, stop);
    assert.equal(result.status, 'ok');
    assert.equal(finish(result.insertText, prepared), '', 'Swift cut block must abstain');
  } finally { await swift.dispose(); }

  // Cancelling before reaching the cap still returns cancelled and reaps the child.
  const waiting = new ProcessBackend(process.execPath, ['-e', "process.stdin.resume(); process.stdout.write('function pending() {'); setInterval(() => {}, 1000);"]);
  try {
    const controller = new AbortController();
    const pending = waiting.run(prepared.request, controller.signal, stop);
    const deadline = Date.now() + 2000;
    while (waiting.diagnostics()?.firstByteMs === undefined && Date.now() < deadline) await delay(10);
    assert.notEqual(waiting.diagnostics()?.firstByteMs, undefined, 'mock stream must start');
    controller.abort();
    assert.equal((await pending).status, 'cancelled');
  } finally { await waiting.dispose(); }
  finished = true;
  console.log(`block-cap regressions: PASS (${packet.fixtures.length} authored replies, ${checked} syntax-checked insertions, ${unchecked} unchecked; mock CLI/Swift, cancellation)`);
})().catch(error => { console.error(error); process.exitCode = 1; });

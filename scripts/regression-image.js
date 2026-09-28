// Image questions and image-guided refactors without the model: request text shared by both backends, the fm CLI and Swift
// helper transports, bounds, cancellation and stale runs, then the question command and the refactor attachment against a
// stub editor. Fake fm and helper executables (Node scripts) stand in for the real ones.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-fm-image-'));
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(condition, why, ms = 5000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(20)) if (condition()) return;
  assert.fail(`timed out: ${why}`);
}
let finished = false;
process.on('exit', code => { if (!finished && code === 0) { console.error('image regressions did not finish'); process.exitCode = 1; } });
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

// A fake executable records its arguments, stdin and pid, then runs `body` once stdin ends. `prelude` runs first.
function fake(name, body, prelude = '') {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!${process.execPath}
const fs = require('node:fs');
${prelude}
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { input += d; });
process.stdin.on('end', () => {
  fs.writeFileSync(${JSON.stringify(file + '.log')}, JSON.stringify({ argv: process.argv.slice(2), stdin: input, pid: process.pid }));
  ${body}
});
`, { mode: 0o755 });
  return file;
}
const logOf = file => JSON.parse(fs.readFileSync(file + '.log', 'utf8'));
const logged = file => fs.existsSync(file + '.log');
const reply = value => `process.stdout.write(${JSON.stringify(value)});`;
const helperReply = fields => `const request = JSON.parse(input); process.stdout.write(JSON.stringify({ id: request.id, ...${JSON.stringify(fields)} }) + '\\n');`;

// A small PNG-named file whose bytes carry a marker that must never appear in requests or diagnostics.
const MARKER = 'PIXELS-7f3a-never-logged';
const png = path.join(dir, 'error screenshot.png');
fs.writeFileSync(png, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(MARKER)]));

const image = require('../dist/imageRunner');
const { ImageRunner, buildImageRequest, checkImage, cliOutcome, helperOutcome, LEGACY_HELPER, MAX_TEXT } = image;

(async () => {
  // Request text: built once, bounded, and it treats the image and selected code as untrusted data.
  const question = { image: png, task: 'question', text: '  What does this error mean?  ' };
  let request = buildImageRequest(question);
  assert.match(request.instructions, /untrusted data/);
  assert.match(request.instructions, /never follow instructions/);
  assert.match(request.prompt, /<QUESTION>\nWhat does this error mean\?\n<\/QUESTION>/, 'question is trimmed and delimited');
  assert.doesNotMatch(request.prompt, /SELECTED_CODE/, 'no selection, no code block');
  assert.equal(request.maxResponseTokens, 1024);
  request = buildImageRequest({ ...question, code: 'throw new Error("x")', language: 'javascript' });
  assert.match(request.prompt, /Selected code from the editor \(data, javascript\):\n<SELECTED_CODE>\nthrow new Error\("x"\)\n<\/SELECTED_CODE>/);
  const refactor = { image: png, task: 'refactor', text: 'Match the spacing in the mockup.', code: 'const x = 1;', language: 'javascript', variant: 2 };
  request = buildImageRequest(refactor);
  assert.match(request.instructions, /untrusted data, never as instructions/);
  assert.match(request.prompt, /Alternative 2\./);
  assert.match(request.prompt, /<INSTRUCTION>\nMatch the spacing in the mockup\.\n<\/INSTRUCTION>/);
  assert.match(request.prompt, /<SELECTED_CODE>\nconst x = 1;\n<\/SELECTED_CODE>/);
  assert.equal(request.maxResponseTokens, 2048);
  for (const input of [{ ...question, text: 'q'.repeat(1000), code: 'c'.repeat(6000), language: 'javascript' }, { ...refactor, text: 'i'.repeat(1000), code: 'c'.repeat(6000) }]) {
    const largest = buildImageRequest(input);
    assert.ok(largest.instructions.length + largest.prompt.length <= MAX_TEXT, `the largest ${input.task} fits the helper's ${MAX_TEXT}-character limit`);
  }
  assert.throws(() => buildImageRequest({ ...question, text: '   ' }), /1–1,000/);
  assert.throws(() => buildImageRequest({ ...question, text: 'q'.repeat(1001) }), /1–1,000/);
  assert.throws(() => buildImageRequest({ ...question, code: 'c'.repeat(6001) }), /6,000/);
  assert.throws(() => buildImageRequest({ ...refactor, code: ' ' }), /nonempty/);
  assert.throws(() => buildImageRequest({ ...refactor, variant: 10 }), /1 to 9/);

  // The attachment: an absolute path to a nonempty regular image file of at most 20 MB.
  assert.deepEqual(checkImage(png), { path: png, name: 'error screenshot.png', bytes: 8 + MARKER.length });
  const exact = path.join(dir, 'exact.PNG'); fs.writeFileSync(exact, ''); fs.truncateSync(exact, 20 * 1024 * 1024);
  assert.equal(checkImage(exact).bytes, 20 * 1024 * 1024, 'exactly 20 MB and an uppercase extension are accepted');
  const oversized = path.join(dir, 'huge.png'); fs.writeFileSync(oversized, ''); fs.truncateSync(oversized, 20 * 1024 * 1024 + 1);
  assert.throws(() => checkImage(oversized), /exceeds 20 MB/);
  assert.throws(() => checkImage(path.join(dir, 'missing.png')), /not found/);
  const text = path.join(dir, 'notes.txt'); fs.writeFileSync(text, 'hello');
  assert.throws(() => checkImage(text), /PNG, JPEG/);
  fs.mkdirSync(path.join(dir, 'folder.png'));
  assert.throws(() => checkImage(path.join(dir, 'folder.png')), /regular file/);
  const empty = path.join(dir, 'empty.jpg'); fs.writeFileSync(empty, '');
  assert.throws(() => checkImage(empty), /empty/);
  assert.throws(() => checkImage('relative.png'), /on this Mac/);

  // CLI: fm respond --model system --no-stream --instructions <instructions> --image <path>, prompt on stdin.
  const runner = new ImageRunner();
  const fm = fake('fm', reply('```\nThe stack trace shows a null user.\n```\n'));
  const withCode = { ...question, code: 'user.name', language: 'javascript' };
  const shared = buildImageRequest(withCode);
  let result = await runner.run(withCode, { kind: 'fm', executable: fm });
  assert.equal(result.status, 'ok', result.reason);
  assert.equal(result.text, 'The stack trace shows a null user.', 'reply is cleaned of fences and the trailing newline');
  const cli = logOf(fm);
  assert.deepEqual(cli.argv, ['respond', '--model', 'system', '--no-stream', '--instructions', shared.instructions, '--image', png]);
  assert.equal(cli.stdin, shared.prompt);
  let d = result.diagnostics;
  assert.equal(d.backend, 'CLI');
  assert.deepEqual(d.argv, [fm, ...cli.argv]);
  assert.equal(d.image, 'error screenshot.png');
  assert.equal(d.imageBytes, 8 + MARKER.length);
  assert.equal(d.inputChars, shared.instructions.length + shared.prompt.length);
  assert.equal(d.contextChars, 'user.name'.length);
  assert.ok(Number.isFinite(d.durationMs) && Number.isFinite(d.startedAt));

  // Swift helper: one JSON request with the same instructions and prompt, byte for byte; no context field.
  const helper = fake('helper', helperReply({ status: 'ok', text: 'The user is null.' }));
  result = await runner.run(withCode, { kind: 'swift', executable: helper });
  assert.equal(result.status, 'ok', result.reason);
  assert.equal(result.text, 'The user is null.');
  const sent = JSON.parse(logOf(helper).stdin);
  assert.deepEqual(logOf(helper).argv, []);
  assert.deepEqual(Object.keys(sent).sort(), ['greedy', 'id', 'image', 'instructions', 'kind', 'maxResponseTokens', 'prompt']);
  assert.equal(sent.kind, 'image');
  assert.equal(sent.image, png);
  assert.equal(sent.maxResponseTokens, 1024);
  assert.equal(sent.greedy, false);
  assert.equal(sent.instructions, cli.argv[cli.argv.indexOf('--instructions') + 1], 'identical instructions on both backends');
  assert.equal(sent.prompt, cli.stdin, 'identical prompt on both backends');
  assert.equal(result.diagnostics.backend, 'Swift');
  assert.equal(result.diagnostics.inputChars, d.inputChars);
  for (const text of [JSON.stringify(d), JSON.stringify(result.diagnostics), cli.stdin, logOf(helper).stdin]) assert.ok(!text.includes(MARKER), 'image bytes never appear in requests or diagnostics');

  // Helper outcomes, including unsupported image input and a helper that predates it.
  result = await runner.run(question, { kind: 'swift', executable: fake('legacy', `process.stdout.write(JSON.stringify({ id: '', status: 'error', reason: 'malformed request' }) + '\\n');`) });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, LEGACY_HELPER);
  assert.match(result.reason, /predates image support/);
  result = await runner.run(question, { kind: 'swift', executable: fake('old-os', helperReply({ status: 'unavailable', reason: 'image_requires_macos_27' })) });
  assert.deepEqual([result.status, result.reason], ['unavailable', 'Image input requires macOS 27 or later. (image_requires_macos_27)']);
  const id = 'request-id';
  assert.match(helperOutcome(id, JSON.stringify({ id, status: 'unavailable', reason: 'vision_unsupported' }), 0, '').reason, /does not accept images/);
  assert.match(helperOutcome(id, JSON.stringify({ id, status: 'unavailable', reason: 'apple_intelligence_not_enabled' }), 0, '').reason, /Turn on Apple Intelligence/);
  assert.deepEqual(helperOutcome(id, JSON.stringify({ id, status: 'error', reason: 'image exceeds 36 megapixels' }), 0, ''), { status: 'error', reason: 'image exceeds 36 megapixels' });
  assert.deepEqual(helperOutcome(id, JSON.stringify({ id: 'other', status: 'ok', text: 'x' }), 0, ''), { status: 'error', reason: 'Invalid helper response' });
  assert.deepEqual(helperOutcome(id, JSON.stringify({ id, status: 'ok' }), 0, ''), { status: 'error', reason: 'Helper reply is missing text' });
  assert.deepEqual(helperOutcome(id, 'not json', 0, ''), { status: 'error', reason: 'Malformed helper response' });
  assert.deepEqual(helperOutcome(id, JSON.stringify({ id, status: 'ok', text: '  ' }), 0, ''), { status: 'empty' });

  // CLI outcomes: an fm without --image, an unavailable model, other failures, and a missing fm.
  assert.equal(cliOutcome('', 64, "Error: Unknown option '--image'\nUsage: fm respond").status, 'unavailable');
  assert.match(cliOutcome('', 64, "Error: Unknown option '--image'").reason, /does not accept --image/);
  assert.deepEqual(cliOutcome('', 1, 'The model is unavailable on this device.'), { status: 'unavailable', reason: 'Apple FM is unavailable: The model is unavailable on this device.' });
  assert.deepEqual(cliOutcome('', 1, 'Could not load image\nmore detail'), { status: 'error', reason: 'Could not load image' });
  assert.deepEqual(cliOutcome('', 2, ''), { status: 'error', reason: 'fm exited with code 2' });
  assert.deepEqual(cliOutcome('\n', 0, ''), { status: 'empty' });
  result = await runner.run(question, { kind: 'fm', executable: path.join(dir, 'no-such-fm') });
  assert.equal(result.status, 'unavailable');
  assert.match(result.reason, /not found.*macOS 27/);
  result = await runner.run(question, { kind: 'fm', executable: fm });
  assert.equal(result.status, 'ok', 'a run after a missing executable still starts');
  await assert.rejects(() => runner.run({ ...question, image: oversized }, { kind: 'fm', executable: fm }), /exceeds 20 MB/);
  await assert.rejects(() => runner.run(question, { kind: 'fm', executable: 'fm' }), /CLI or Swift/);

  // Cancellation stops the child and reports cancelled.
  const slow = fake('slow', 'setTimeout(() => process.stdout.write("too late"), 30000);');
  let abort = new AbortController();
  let pending = runner.run(question, { kind: 'fm', executable: slow }, abort.signal);
  await until(() => logged(slow), 'slow fm started');
  abort.abort();
  result = await pending;
  assert.equal(result.status, 'cancelled');
  assert.equal(result.text, undefined);
  await until(() => !alive(logOf(slow).pid), 'cancelled fm exits');

  // A child that ignores SIGTERM is killed with SIGKILL.
  const stubborn = fake('stubborn', 'setTimeout(() => {}, 30000);', "process.on('SIGTERM', () => {});");
  fs.rmSync(stubborn + '.log', { force: true });
  pending = runner.run(question, { kind: 'fm', executable: stubborn });
  await until(() => logged(stubborn), 'stubborn fm started');
  const cancelled = Date.now();
  runner.cancel();
  await sleep(250);
  assert.ok(alive(logOf(stubborn).pid), 'the child survives SIGTERM');
  await until(() => !alive(logOf(stubborn).pid), 'SIGKILL ends a child that ignores SIGTERM', 3000);
  assert.ok(Date.now() - cancelled >= 400, 'SIGKILL follows the SIGTERM grace period');
  assert.equal((await pending).status, 'cancelled');

  // A newer run supersedes an older one: the older run reports cancelled even though its process printed an answer and exited 0.
  const stale = fake('stale', 'setTimeout(() => {}, 30000);', "process.on('SIGTERM', () => { process.stdout.write('stale answer'); process.exit(0); });");
  const older = runner.run(question, { kind: 'fm', executable: stale });
  await until(() => logged(stale), 'older fm started');
  const newer = runner.run({ ...question, text: 'And now?' }, { kind: 'fm', executable: fm });
  assert.deepEqual([(await older).status, (await older).text], ['cancelled', undefined], 'superseded output is ignored');
  assert.equal((await newer).status, 'ok');
  assert.match(logOf(fm).stdin, /And now\?/);

  // Timeout and output bounds.
  result = await new ImageRunner(300).run(question, { kind: 'fm', executable: fake('hang', 'setTimeout(() => {}, 30000);') });
  assert.equal(result.status, 'error');
  assert.match(result.reason, /timed out/);
  result = await runner.run(question, { kind: 'fm', executable: fake('flood', reply('x'.repeat(50000))) });
  assert.deepEqual([result.status, result.reason], ['error', 'Reply exceeds 40000 characters']);
  await runner.dispose();
  await assert.rejects(() => runner.run(question, { kind: 'fm', executable: fm }), /disposed/);

  await editorFlows(fm, helper, slow);
  finished = true;
  console.log('image regressions: PASS (shared request text, CLI and Swift transport, helper and CLI outcomes, bounds, cancellation, SIGKILL, stale runs, question command, refactor attachment)');
})().catch(error => { console.error(error); process.exitCode = 1; });

// The question command and the refactor widget's attachment, against a stub editor.
async function editorFlows(fm, helper, slow) {
  class Range { constructor(start, end) { this.start = start; this.end = end; } }
  const warnings = [], infos = [], shown = [], commands = [];
  let picked = [{ scheme: 'file', fsPath: png }], answer = 'Why is user null?', inputOptions, cancelProgress;
  let text = 'const x = 1;\nuser.name;';
  const doc = { uri: { scheme: 'file', fsPath: '/work/app.js', toString: () => 'file:///work/app.js' }, fileName: '/work/app.js', version: 1, isClosed: false, languageId: 'javascript',
    getText: range => range ? text.slice(0, 12) : text };
  const editor = { document: doc, selection: { start: { line: 0, character: 0 }, end: { line: 0, character: 12 }, isEmpty: false }, edits: 0,
    edit: async (build, options) => { build({ replace: (range, value) => { text = value + text.slice(12); } }); assert.deepEqual(options, { undoStopBefore: true, undoStopAfter: true }); doc.version++; editor.edits++; return true; } };
  const providers = {};
  const vscode = {
    Range, UIKind: { Desktop: 1, Web: 2 }, env: { uiKind: 1, remoteName: undefined }, ProgressLocation: { Notification: 15 }, ViewColumn: { Beside: -2 },
    Uri: { from: ({ scheme, path }) => ({ scheme, path, toString: () => `${scheme}:${path}` }) },
    workspace: {
      registerTextDocumentContentProvider: (scheme, registered) => { providers[scheme] = registered; return { dispose() {} }; },
      onDidChangeTextDocument: () => ({ dispose() {} }), onDidCloseTextDocument: () => ({ dispose() {} }),
      openTextDocument: async uri => ({ uri, getText: () => providers[uri.scheme].provideTextDocumentContent(uri) })
    },
    window: {
      activeTextEditor: editor, onDidChangeActiveTextEditor: () => ({ dispose() {} }), onDidChangeTextEditorSelection: () => ({ dispose() {} }),
      showOpenDialog: async options => { assert.ok(options.filters.Images.includes('png') && !options.canSelectMany); return picked; },
      showInputBox: async options => { inputOptions = options; return answer; },
      withProgress: async (options, task) => {
        assert.equal(options.cancellable, true);
        const listeners = [];
        cancelProgress = () => listeners.splice(0).forEach(fn => fn());
        return task({ report() {} }, { onCancellationRequested: fn => { listeners.push(fn); return { dispose() {} }; } });
      },
      showTextDocument: async (document, options) => { shown.push({ document, options }); return editor; },
      showWarningMessage: message => { warnings.push(message); }, showInformationMessage: message => { infos.push(message); }
    },
    commands: { executeCommand: async (...args) => { commands.push(args); } }
  };
  const textRuns = [];
  class RefactorRunner { cancel() {} async dispose() {} async run(input) { textRuns.push(input); return { text: 'const x = 3;', diagnostics: { argv: [], stdin: '', backend: 'CLI', model: 'system', inputChars: 1 } }; } }
  const originalLoad = Module._load;
  Module._load = function (name, parent, isMain) {
    if (name === 'vscode') return vscode;
    if (name === './refactorRunner') return { RefactorRunner };
    return originalLoad.call(this, name, parent, isMain);
  };
  const { ImageQuestion } = require('../dist/imageQuestion');
  const { RefactorController } = require('../dist/refactor');
  Module._load = originalLoad;
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'darwin' }); // Mac-only features; the stubbed editor stands in for a local Mac window.

  // Ask with a selection: the input box says the selection is included, and the answer opens in a read-only preview.
  let backend = { kind: 'swift', executable: helper };
  let prepared = 0;
  const questions = new ImageQuestion(() => {}, async () => { prepared++; }, () => backend);
  await questions.ask();
  assert.match(inputOptions.prompt, /Selected code is included as context: app\.js · lines 1–1 · 12 chars/);
  assert.equal(inputOptions.validateInput(''), 'Enter a question.');
  assert.equal(inputOptions.validateInput('q'.repeat(1001)), 'Use at most 1,000 characters.');
  assert.equal(inputOptions.validateInput('ok'), undefined);
  assert.equal(prepared, 1, 'inline completion is stopped before the image request');
  const asked = JSON.parse(logOf(helper).stdin);
  assert.equal(asked.image, png);
  assert.match(asked.prompt, /<QUESTION>\nWhy is user null\?\n<\/QUESTION>/);
  assert.match(asked.prompt, /<SELECTED_CODE>\nconst x = 1;\n<\/SELECTED_CODE>/);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].document.uri.scheme, 'apple-fm-image', 'answers open in a read-only virtual document');
  const preview = shown[0].document.getText();
  assert.match(preview, /# Apple FM · error screenshot\.png/);
  assert.match(preview, /Question: Why is user null\?/);
  assert.match(preview, /Context: selected code, app\.js/);
  assert.match(preview, /The user is null\./);
  assert.equal(questions.isGenerating, false);
  assert.equal(questions.diagnostics().image, 'error screenshot.png');

  // Without a selection only the image and question are sent; a legacy helper is reported clearly.
  editor.selection.isEmpty = true;
  backend = { kind: 'swift', executable: fake('legacy-ask', `process.stdout.write(JSON.stringify({ id: '', status: 'error', reason: 'malformed request' }) + '\\n');`) };
  await questions.ask();
  assert.match(inputOptions.prompt, /No code selected/);
  assert.doesNotMatch(JSON.parse(logOf(backend.executable).stdin).prompt, /SELECTED_CODE/);
  assert.match(warnings.at(-1), /predates image support/);
  editor.selection.isEmpty = false;

  // Stopping the progress notification cancels the request and its process.
  backend = { kind: 'fm', executable: slow };
  fs.rmSync(slow + '.log', { force: true });
  const asking = questions.ask();
  await until(() => logged(slow), 'question started');
  assert.equal(questions.isGenerating, true, 'a running question blocks inline completion');
  cancelProgress();
  await asking;
  assert.equal(infos.at(-1), 'Apple FM image question stopped.');
  assert.equal(questions.isGenerating, false);
  await until(() => !alive(logOf(slow).pid), 'cancelled question process exits');
  assert.equal(shown.length, 1, 'no preview after cancellation');

  // Refusals: dialog dismissed, credential-file selection, oversized selection, remote window.
  let runsBefore = prepared;
  picked = undefined; await questions.ask(); picked = [{ scheme: 'file', fsPath: png }];
  assert.equal(prepared, runsBefore, 'dismissing the picker sends nothing');
  doc.uri.fsPath = '/work/.env';
  await assert.rejects(() => questions.ask(), /credential file/);
  doc.uri.fsPath = '/work/app.js';
  const getText = doc.getText; doc.getText = range => range ? 'x'.repeat(6001) : text;
  await assert.rejects(() => questions.ask(), /at most 6,000/);
  doc.getText = getText;
  vscode.env.remoteName = 'ssh-remote';
  await assert.rejects(() => questions.ask(), /local Mac window/);
  vscode.env.remoteName = undefined;
  assert.equal(prepared, runsBefore, 'refused questions never reach the model');
  questions.dispose();

  // Refactor: attaching an image resets alternatives, and Generate sends the image through the selected backend.
  backend = { kind: 'swift', executable: fake('refactor-helper', helperReply({ status: 'ok', text: 'const x = 2;' })) };
  const controller = new RefactorController(() => {}, async () => {}, () => backend);
  await controller.capture();
  await controller.generate('Match the screenshot.', 1);
  assert.equal(textRuns.length, 1, 'without an image, the text refactor runner is used');
  assert.equal(controller.snapshot().candidates.length, 1);
  controller.attachImage(png);
  assert.deepEqual(controller.snapshot().image, { name: 'error screenshot.png', bytes: 8 + MARKER.length });
  assert.equal(controller.snapshot().candidates.length, 0, 'attaching an image starts a fresh set');
  await controller.generate('Match the screenshot.', 2);
  assert.equal(textRuns.length, 1, 'with an image, the text runner is not used');
  assert.deepEqual(controller.snapshot().candidates.map(c => c.text), ['const x = 2;', 'const x = 2;']);
  const refactorRequest = JSON.parse(logOf(backend.executable).stdin);
  assert.equal(refactorRequest.image, png);
  assert.equal(refactorRequest.maxResponseTokens, 2048);
  assert.match(refactorRequest.prompt, /Alternative 2\./);
  assert.match(refactorRequest.prompt, /<INSTRUCTION>\nMatch the screenshot\.\n<\/INSTRUCTION>/);
  assert.match(refactorRequest.prompt, /<SELECTED_CODE>\nconst x = 1;\n<\/SELECTED_CODE>/);
  assert.equal(controller.snapshot().candidates[0].diagnostics.image, 'error screenshot.png');
  assert.throws(() => controller.attachImage(path.join(dir, 'notes.txt')), /PNG, JPEG/);
  assert.equal(controller.snapshot().image.name, 'error screenshot.png', 'a rejected file leaves the attachment unchanged');

  // A helper without image support fails visibly instead of producing alternatives.
  backend = { kind: 'swift', executable: fake('legacy-refactor', `process.stdout.write(JSON.stringify({ id: '', status: 'error', reason: 'malformed request' }) + '\\n');`) };
  controller.attachImage(png);
  await controller.generate('Match the screenshot.', 1);
  assert.equal(controller.snapshot().candidates.length, 0);
  assert.match(controller.snapshot().progress, /^Generation failed: This Swift helper predates image support/);

  // The CLI path, then Apply: still guarded by the stale-source check and applied with native Undo stops.
  backend = { kind: 'fm', executable: fm };
  await controller.generate('Match the screenshot.', 1);
  assert.match(logOf(fm).argv.join(' '), /--image .*error screenshot\.png/);
  assert.equal(controller.snapshot().candidates.length, 1);
  doc.version++;
  await assert.rejects(() => controller.apply(), /source changed/i);
  assert.equal(editor.edits, 0, 'a stale image alternative must not edit');
  await controller.capture();
  controller.attachImage(png);
  backend = { kind: 'swift', executable: fake('refactor-helper-2', helperReply({ status: 'ok', text: 'const x = 2;' })) };
  await controller.generate('Match the screenshot.', 1);
  await controller.apply();
  assert.equal(editor.edits, 1);
  assert.ok(text.startsWith('const x = 2;'));

  // Removing the image resets alternatives and returns to the text runner.
  await controller.capture();
  controller.attachImage(png);
  await controller.generate('Match the screenshot.', 1);
  controller.removeImage();
  assert.equal(controller.snapshot().image, undefined);
  assert.equal(controller.snapshot().candidates.length, 0, 'removing the image starts a fresh set');
  await controller.generate('Match the screenshot.', 1);
  assert.equal(textRuns.length, 2);
  controller.dispose();
  Object.defineProperty(process, 'platform', platform);
}

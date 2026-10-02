// Activate the real extension/controllers with a stub editor and fake model children. A replacement must wait for
// the previous owner's child to exit, including a child that ignores SIGTERM. No model or generated code is run.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const processes = require('node:child_process');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-fm-handoff-'));
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(condition, why) {
  for (const end = Date.now() + 5000; Date.now() < end; await sleep(10)) if (condition()) return;
  assert.fail(`timed out: ${why}`);
}
const disposable = () => ({ dispose() {} });
const png = path.join(dir, 'reference.png'); fs.writeFileSync(png, 'authored attachment');
const logOf = file => JSON.parse(fs.readFileSync(file + '.log', 'utf8'));
function fake(name, previous) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!${process.execPath}
const fs = require('node:fs');
process.on('SIGTERM', () => {});
let input = '';
process.stdin.on('data', d => { input += d; });
process.stdin.on('end', () => {
  const previous = ${JSON.stringify(previous ?? null)};
  let previousAlive = false, previousPid;
  if (previous) { previousPid = JSON.parse(fs.readFileSync(previous + '.log')).pid; try { process.kill(previousPid, 0); previousAlive = true; } catch {} }
  fs.writeFileSync(${JSON.stringify(file + '.log')}, JSON.stringify({ pid: process.pid, previousPid, previousAlive, startedAt: Date.now() }));
  if (!previous) setTimeout(() => {}, 30000);
  else { const request = JSON.parse(input); process.stdout.write(JSON.stringify({ id: request.id, status: 'ok', text: 'const x = 2;' }) + '\\n'); }
});
`, { mode: 0o755 });
  return file;
}

const commands = {}, providers = {};
const config = { enabled: true, backend: 'swift', automaticSuggestions: false, swiftHelperPath: '' };
const document = { uri: { scheme: 'file', fsPath: '/synthetic/app.js', toString: () => 'file:///synthetic/app.js' },
  fileName: '/synthetic/app.js', version: 1, isClosed: false, languageId: 'javascript', getText: () => 'const x = 1;' };
const editor = { document, selection: { start: { line: 0, character: 0 }, end: { line: 0, character: 12 }, isEmpty: false } };
const vscode = {
  Range: class { constructor(start, end) { this.start = start; this.end = end; } },
  UIKind: { Desktop: 1, Web: 2 }, env: { uiKind: 1 }, ProgressLocation: { Notification: 15 }, ViewColumn: { Beside: -2 },
  StatusBarAlignment: { Right: 2 }, CodeActionKind: { RefactorRewrite: 'refactor.rewrite' },
  Uri: { from: ({ scheme, path }) => ({ scheme, path, toString: () => `${scheme}:${path}` }), joinPath: (_base, ...parts) => ({ fsPath: parts.join('/') }) },
  window: {
    activeTextEditor: editor, visibleTextEditors: [],
    createOutputChannel: () => ({ appendLine() {}, dispose() {} }), createStatusBarItem: () => ({ show() {}, dispose() {} }),
    createTextEditorDecorationType: disposable, registerWebviewViewProvider: disposable,
    onDidChangeActiveTextEditor: disposable, onDidChangeTextEditorSelection: disposable,
    showOpenDialog: async () => [{ scheme: 'file', fsPath: png }], showInputBox: async () => 'Explain the colors.',
    withProgress: async (_options, task) => task({ report() {} }, { onCancellationRequested: disposable }),
    showTextDocument: async () => editor, showWarningMessage() {}, showInformationMessage() {}
  },
  workspace: {
    getConfiguration: () => ({ get: (key, fallback) => key in config ? config[key] : fallback }),
    onDidChangeTextDocument: disposable, onDidCloseTextDocument: disposable, onDidChangeConfiguration: disposable,
    registerTextDocumentContentProvider: (scheme, provider) => { providers[scheme] = provider; return disposable(); },
    openTextDocument: async uri => ({ uri, getText: () => providers[uri.scheme].provideTextDocumentContent(uri) })
  },
  languages: { registerInlineCompletionItemProvider: disposable, registerCodeActionsProvider: disposable },
  commands: { registerCommand: (name, fn) => { commands[name] = fn; return disposable(); }, executeCommand: async () => {} }
};
let refactor, questions, textExecutable;
const originalLoad = Module._load, originalSpawn = processes.spawn;
processes.spawn = (executable, ...args) => originalSpawn(executable === '/usr/bin/fm' ? textExecutable : executable, ...args);
Module._load = function (name, parent, isMain) {
  if (name === 'vscode') return vscode;
  if (parent?.filename?.endsWith('extension.js')) {
    if (name === './backend') return { ...originalLoad.call(this, name, parent, isMain), createBackend: () => ({ cancel() {}, async dispose() {}, diagnostics() {} }) };
    if (name === './modelMeter') return { ModelMeter: class { observe() {} dispose() {} } };
    if (name === './refactorOverlay') return { RefactorOverlay: class { update() {} dispose() {} } };
    if (name === './statusView') return { StatusView: class { update() {} } };
    if (name === './refactor') { const real = originalLoad.call(this, name, parent, isMain); return { ...real, RefactorController: class extends real.RefactorController { constructor(...args) { super(...args); refactor = this; } } }; }
    if (name === './imageQuestion') { const real = originalLoad.call(this, name, parent, isMain); return { ...real, ImageQuestion: class extends real.ImageQuestion { constructor(...args) { super(...args); questions = this; } } }; }
  }
  return originalLoad.call(this, name, parent, isMain);
};
const { activate, deactivate } = require('../dist/extension');
Module._load = originalLoad;
const platform = Object.getOwnPropertyDescriptor(process, 'platform');
Object.defineProperty(process, 'platform', { value: 'darwin' });
let finished = false;
process.on('exit', code => { if (!finished && code === 0) { console.error('handoff regressions did not finish'); process.exitCode = 1; } });

(async () => {
  activate({ subscriptions: [], extensionUri: {}, extensionPath: '/synthetic/extension' });
  const outcomes = [];
  for (const direction of ['question-to-image-refactor', 'image-refactor-to-question', 'text-refactor-to-question']) {
    const old = fake(direction + '-old'), replacement = fake(direction + '-new', old);
    let pending;
    try {
      config.swiftHelperPath = old; textExecutable = old;
      await refactor.capture();
      if (direction !== 'text-refactor-to-question') refactor.attachImage(png);
      pending = direction === 'question-to-image-refactor' ? commands['appleFm.askAboutImage']() : refactor.generate('Match the image.', 1);
      await until(() => fs.existsSync(old + '.log'), 'previous owner started');
      config.swiftHelperPath = replacement;
      const started = Date.now();
      const next = direction === 'question-to-image-refactor' ? refactor.generate('Match the image.', 1) : commands['appleFm.askAboutImage']();
      await until(() => fs.existsSync(replacement + '.log'), 'replacement owner started');
      const observed = logOf(replacement);
      outcomes.push({ direction, previousAliveAtReplacementStart: observed.previousAlive, handoffMs: observed.startedAt - started });
      assert.equal(observed.previousAlive, false, `${direction}: replacement launched while the previous owner's child was alive`);
      await next;
      await pending;
    } finally {
      refactor.cancel(); questions.cancel();
      if (pending) await pending;
      await until(() => !fs.existsSync(old + '.log') || !alive(logOf(old).pid), 'previous child closed');
      await until(() => !fs.existsSync(replacement + '.log') || !alive(logOf(replacement).pid), 'replacement child closed');
      console.log(JSON.stringify(outcomes.at(-1)));
    }
  }
  finished = true;
  console.log('handoff regressions: PASS (three cross-controller transitions wait for child closure)');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  refactor?.dispose(); questions?.dispose(); deactivate();
  processes.spawn = originalSpawn;
  Object.defineProperty(process, 'platform', platform);
});

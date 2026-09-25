// Drive the real registered inline completion Provider against a stub editor, backend and clock: request rules, debounce and stale results.
const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;

// A manual clock: the Provider's timers run only when the test advances time.
let now = 0, nextTimer = 1;
const timers = new Map();
global.setTimeout = (fn, ms = 0) => { const id = nextTimer++; timers.set(id, { at: now + ms, fn }); return id; };
global.clearTimeout = id => { timers.delete(id); };
const settle = () => new Promise(resolve => setImmediate(resolve));
async function tick(ms) {
  const until = now + ms;
  for (;;) {
    const due = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
    if (!due) break;
    timers.delete(due[0]); now = due[1].at; due[1].fn(); await settle();
  }
  now = until; await settle();
}

class Position { constructor(line, character) { this.line = line; this.character = character; } isEqual(other) { return other.line === this.line && other.character === this.character; } }
class Range { constructor(a, b, c, d) { if (typeof a === 'number') { this.start = new Position(a, b); this.end = new Position(c, d); } else { this.start = a; this.end = b; } } }
class InlineCompletionItem { constructor(insertText, range, command) { Object.assign(this, { insertText, range, command }); } }
const disposable = () => ({ dispose() {} });
const handlers = {}, commands = {};
let provider;
const config = { enabled: true, backend: 'fm', contextScope: 'nearby', swiftHelperPath: '', automaticSuggestions: true };
const vscode = {
  Position, Range, InlineCompletionItem, ThemeColor: class { constructor(id) { this.id = id; } }, CodeAction: class {},
  InlineCompletionTriggerKind: { Invoke: 0, Automatic: 1 }, UIKind: { Desktop: 1, Web: 2 }, StatusBarAlignment: { Left: 1, Right: 2 },
  CodeActionKind: { RefactorRewrite: 'refactor.rewrite' }, ConfigurationTarget: { Global: 1 },
  Uri: { joinPath: (base, ...parts) => ({ fsPath: [base.fsPath, ...parts].join('/') }) },
  env: { uiKind: 1, remoteName: undefined },
  window: {
    activeTextEditor: undefined, visibleTextEditors: [],
    createOutputChannel: () => ({ appendLine() {}, dispose() {} }),
    createStatusBarItem: () => ({ text: '', show() {}, dispose() {} }),
    createTextEditorDecorationType: disposable, registerWebviewViewProvider: disposable,
    onDidChangeActiveTextEditor: handler => { handlers.active = handler; return disposable(); },
    onDidChangeTextEditorSelection: handler => { handlers.selection = handler; return disposable(); }
  },
  workspace: {
    getConfiguration: () => ({ get: (key, fallback) => key in config ? config[key] : fallback, update: async () => {} }),
    onDidChangeTextDocument: handler => { handlers.change = handler; return disposable(); },
    onDidChangeConfiguration: handler => { handlers.configuration = handler; return disposable(); }
  },
  languages: { registerInlineCompletionItemProvider: (_selector, registered) => { provider = registered; return disposable(); }, registerCodeActionsProvider: disposable },
  commands: { registerCommand: (name, fn) => { commands[name] = fn; return disposable(); }, executeCommand: async () => {} }
};

// The backend answers only when a test resolves its call.
const backend = {
  calls: [], cancels: 0,
  run(request) { return new Promise(resolve => this.calls.push({ request, resolve })); },
  cancel() { this.cancels++; }, async dispose() {}, diagnostics() { return undefined; }
};
const realBackend = require('../dist/backend');
const stubs = {
  './backend': { ...realBackend, createBackend: () => backend },
  './modelMeter': { ModelMeter: class { constructor() { this.state = {}; } observe() {} dispose() {} } },
  './refactor': { RefactorController: class { constructor() { this.isGenerating = false; } snapshot() { return { candidates: [], selected: 0 }; } dispose() {} } },
  './refactorOverlay': { RefactorOverlay: class { update() {} start() {} dispose() {} } },
  './statusView': { StatusView: class { update() {} } }
};
Module._load = function (name, parent, isMain) {
  if (name === 'vscode') return vscode;
  if (parent?.filename?.endsWith('extension.js') && name in stubs) return stubs[name];
  return originalLoad.call(this, name, parent, isMain);
};
const { activate } = require('../dist/extension');
Module._load = originalLoad;

let documents = 0;
function open(text, languageId = 'javascript', path = `/work/file-${++documents}.${languageId === 'python' ? 'py' : 'js'}`) {
  return {
    uri: { scheme: 'file', fsPath: path, toString: () => `file://${path}` }, version: 1, languageId, text,
    get lineCount() { return this.text.split('\n').length; },
    getText() { return this.text; },
    lineAt(line) { return { text: this.text.split('\n')[line] }; },
    offsetAt(position) { return this.text.split('\n').slice(0, position.line).reduce((sum, line) => sum + line.length + 1, 0) + position.character; }
  };
}
function focus(document, position, selectionEmpty = true) {
  vscode.window.activeTextEditor = { document, selection: { isEmpty: selectionEmpty, active: position }, setDecorations() {} };
}
function tokenSource() {
  const listeners = [];
  const token = { isCancellationRequested: false, onCancellationRequested(fn) { listeners.push(fn); return { dispose() { listeners.splice(listeners.indexOf(fn) >>> 0, 1); } }; } };
  return { token, cancel() { token.isCancellationRequested = true; listeners.splice(0).forEach(fn => fn()); } };
}
const AUTOMATIC = { triggerKind: 1 }, EXPLICIT = { triggerKind: 0 };
function request(document, position, context) {
  const source = tokenSource();
  return { source, result: provider.provideInlineCompletionItems(document, position, context, source.token) };
}
const answer = (call, insertText) => call.resolve({ id: call.request.id, status: 'ok', insertText });
const endOf = (document, line = 0) => new Position(line, document.lineAt(line).text.length);

// The state of a promise, readable without awaiting one that may never settle.
function track(promise) { const state = { done: false }; promise.then(value => { state.done = true; state.value = value; }); return state; }
// Assert a request is refused before the backend is asked, including after the debounce would have ended.
async function refused(document, position, context, why) {
  const calls = backend.calls.length;
  const state = track(request(document, position, context).result);
  await tick(1000);
  assert.equal(backend.calls.length, calls, `${why}: backend must not run`);
  assert.ok(state.done, `${why}: request must finish`);
  assert.deepEqual(state.value, [], why);
}
// Assert a request reaches the backend (after the debounce if automatic) and returns the backend's insertion.
async function served(document, position, context, reply, why) {
  const calls = backend.calls.length;
  const { result } = request(document, position, context);
  await tick(context === AUTOMATIC ? 350 : 0);
  assert.equal(backend.calls.length, calls + 1, `${why}: backend must run once`);
  answer(backend.calls.at(-1), reply);
  const items = await result;
  assert.equal(items.length, 1, why);
  return items[0];
}

let finished = false;
process.on('exit', code => { if (!finished && code === 0) { console.error('provider regressions did not finish'); process.exitCode = 1; } });
const platform = Object.getOwnPropertyDescriptor(process, 'platform');
Object.defineProperty(process, 'platform', { value: 'darwin' }); // The Provider is Mac-only; the stubbed editor stands in for a local Mac window.

(async () => {
  activate({ subscriptions: [], extensionUri: { fsPath: '/extension' }, extensionPath: '/extension' });
  await settle();
  assert.ok(provider, 'activate must register the inline completion provider');

  // An explicit request skips the debounce and returns the backend's insertion at the cursor.
  let document = open('const total = ');
  let position = endOf(document);
  focus(document, position);
  let pending = request(document, position, EXPLICIT);
  await settle();
  assert.equal(backend.calls.length, 1, 'explicit request must not wait for the debounce');
  answer(backend.calls[0], '1 + 2;');
  let [item] = await pending.result;
  assert.equal(item.insertText, '1 + 2;');
  assert.deepEqual([item.range.start, item.range.end], [position, position]);
  assert.equal(item.command.command, 'appleFm.accepted');

  // Automatic requests wait 350 ms after the last change.
  document = open('let count = ');
  position = endOf(document);
  focus(document, position);
  pending = request(document, position, AUTOMATIC);
  await tick(349);
  assert.equal(backend.calls.length, 1, 'automatic request must wait the full debounce');
  await tick(1);
  assert.equal(backend.calls.length, 2, 'automatic request runs once the debounce ends');
  answer(backend.calls[1], '0;');
  assert.equal((await pending.result)[0].insertText, '0;');

  // Cancelling during the debounce ends the request without asking the backend.
  document = open('let name = ');
  position = endOf(document);
  focus(document, position);
  pending = request(document, position, AUTOMATIC);
  let state = track(pending.result);
  await tick(100);
  pending.source.cancel();
  await settle();
  assert.ok(state.done, 'cancellation must end the debounce at once');
  assert.deepEqual(state.value, [], 'cancellation during the debounce returns nothing');
  await tick(1000);
  assert.equal(backend.calls.length, 2, 'cancelled debounce must not reach the backend');

  // An edit during the debounce makes the request stale before the backend is asked.
  pending = request(document, position, AUTOMATIC);
  state = track(pending.result);
  await tick(100);
  document.version++;
  await tick(250);
  assert.equal(backend.calls.length, 2, 'document change during the debounce: backend must not run');
  assert.deepEqual(state.value, [], 'document change during the debounce drops the request');

  // No suggestion with a selection, in credential-like files, or in remote and web windows.
  document = open('const secret = ');
  position = endOf(document);
  focus(document, position, false);
  await refused(document, position, EXPLICIT, 'selection');
  for (const path of ['/work/.env', '/work/.env.local', '/work/server.pem', '/work/deploy.key', '/home/me/.ssh/id_rsa', '/work/.aws/credentials']) {
    document = open('TOKEN=', 'plaintext', path);
    position = endOf(document);
    focus(document, position);
    await refused(document, position, EXPLICIT, `credential-like file ${path}`);
  }
  document = open('const environment = ', 'javascript', '/work/environment.js');
  position = endOf(document);
  focus(document, position);
  assert.equal((await served(document, position, EXPLICIT, "'test';", 'ordinary file')).insertText, "'test';");
  vscode.env.remoteName = 'ssh-remote';
  await refused(document, position, EXPLICIT, 'remote workspace');
  vscode.env.remoteName = undefined;
  vscode.env.uiKind = vscode.UIKind.Web;
  await refused(document, position, EXPLICIT, 'web workspace');
  vscode.env.uiKind = vscode.UIKind.Desktop;
  await served(document, position, EXPLICIT, "'test';", 'local desktop window after remote and web');

  // After an accepted suggestion, automatic requests on that line stop; explicit ones and other lines still work.
  document = open('total = \nlater = ', 'python');
  position = endOf(document);
  focus(document, position);
  const accepted = await served(document, position, EXPLICIT, '1 + 2', 'suggestion to accept');
  document.text = 'total = 1 + 2\nlater = ';
  document.version++;
  handlers.change({ document, contentChanges: [{ range: new Range(position, position), text: accepted.insertText }] });
  commands['appleFm.accepted'](document.uri.toString(), position.line);
  position = endOf(document);
  focus(document, position);
  await refused(document, position, AUTOMATIC, 'automatic request on the line just accepted');
  await served(document, position, EXPLICIT, ' + 3', 'explicit request on the accepted line');
  position = endOf(document, 1);
  focus(document, position);
  await served(document, position, AUTOMATIC, '4', 'automatic request on another line');

  // No automatic request at the end of a JavaScript or TypeScript line ending in `;`; explicit requests and other languages proceed.
  for (const language of ['javascript', 'typescript', 'typescriptreact']) {
    document = open('const done = true;', language);
    position = endOf(document);
    focus(document, position);
    await refused(document, position, AUTOMATIC, `${language} line ending in ;`);
  }
  await served(document, position, EXPLICIT, ' // done', 'explicit request after ;');
  document = open('x = 1;', 'python');
  position = endOf(document);
  focus(document, position);
  await served(document, position, AUTOMATIC, ' y = 2', 'Python line ending in ;');

  // With automatic suggestions off, only explicit requests run.
  config.automaticSuggestions = false;
  document = open('let flag = ');
  position = endOf(document);
  focus(document, position);
  await refused(document, position, AUTOMATIC, 'automatic suggestions disabled');
  await served(document, position, EXPLICIT, 'false;', 'explicit request with automatic suggestions disabled');
  config.automaticSuggestions = true;

  // A result is dropped when the document, cursor or request changed while it was generating.
  const stale = async (change, why) => {
    const document = open('let value = ');
    const position = endOf(document);
    focus(document, position);
    const calls = backend.calls.length;
    const pending = request(document, position, EXPLICIT);
    await settle();
    assert.equal(backend.calls.length, calls + 1, `${why}: backend must run`);
    change(document, pending);
    answer(backend.calls.at(-1), '42;');
    assert.deepEqual(await pending.result, [], why);
  };
  await stale(document => { document.version++; }, 'document edited while generating');
  await stale(document => focus(document, new Position(0, 3)), 'cursor moved while generating');
  await stale(document => focus(open(document.text), endOf(document)), 'another editor with the same text and cursor focused while generating');
  await stale((_document, pending) => pending.source.cancel(), 'request cancelled while generating');

  // A newer request supersedes an older one: the backend is cancelled and only the newer result is shown.
  document = open('let first = ');
  position = endOf(document);
  focus(document, position);
  const older = request(document, position, EXPLICIT);
  await settle();
  const cancels = backend.cancels;
  const newer = request(document, position, EXPLICIT);
  await settle();
  assert.equal(backend.cancels, cancels + 1, 'a newer request cancels the running one');
  answer(backend.calls.at(-2), 'old;');
  answer(backend.calls.at(-1), 'new;');
  assert.deepEqual(await older.result, [], 'superseded result is dropped');
  assert.equal((await newer.result)[0].insertText, 'new;');

  Object.defineProperty(process, 'platform', platform);
  finished = true;
  console.log(`provider regressions: PASS (${backend.calls.length} backend calls: explicit, debounce, cancellation, selection, credentials, remote/web, accepted line, semicolons, automatic setting, stale results)`);
})().catch(error => { console.error(error); process.exitCode = 1; });

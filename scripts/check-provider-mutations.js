// Disable each Provider rule in the compiled extension and confirm regression-provider.js fails. Run after `npm run compile`.
// dist/extension.js is restored after every mutation; if this is interrupted, `npm run compile` rebuilds it.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'dist', 'extension.js');
const test = path.join(__dirname, 'regression-provider.js');
const mutations = [
  ['selection', '!vscode.window.activeTextEditor?.selection.isEmpty || ', ''],
  ['credential-like file', ' || isCredential(document))', ')'],
  ['remote workspace', 'vscode.env.remoteName || ', ''],
  ['web workspace', 'vscode.env.uiKind === vscode.UIKind.Web || ', ''],
  ['automatic setting', "if (automatic && !vscode.workspace.getConfiguration('appleFm').get('automaticSuggestions', true))", 'if (false)'],
  ['accepted line', 'if (automatic && suppressed.has(', 'if (false && suppressed.has('],
  ['JS/TS semicolon', 'if (automatic && /\\b(?:javascript', 'if (false && /\\b(?:javascript'],
  ['350 ms debounce length', 'setTimeout(finish, 350)', 'setTimeout(finish, 0)'],
  ['automatic debounce', 'await debounce(token);', ';'],
  ['explicit skips debounce', 'if (ctx.triggerKind === vscode.InlineCompletionTriggerKind.Automatic)', 'if (true)'],
  ['cancellation ends debounce', 'const listener = token.onCancellationRequested(finish);', 'const listener = { dispose() { } };'],
  ['stale before backend', 'configuring || token.isCancellationRequested || !current(document, position, version))', 'configuring || token.isCancellationRequested)'],
  ['stale document or cursor after result', '!enabled || token.isCancellationRequested || !current(document, position, version))', '!enabled || token.isCancellationRequested)'],
  ['cancelled after result', '!enabled || token.isCancellationRequested || !current', '!enabled || !current'],
  ['superseded result', 'mine !== generation || !enabled || token', '!enabled || token'],
  ['newer request cancels backend', '        backend.cancel();\n', '\n'],
  ['editor identity', 'editor?.document === document && ', ''],
  ['cursor position', ' && editor.selection.active.isEqual(position)', '']
];

const original = fs.readFileSync(file, 'utf8');
const baseline = spawnSync(process.execPath, [test], { encoding: 'utf8', timeout: 30000 });
assert.equal(baseline.status, 0, `regression-provider.js must pass before mutation:\n${baseline.stderr}`);
let survived = 0;
try {
  for (const [rule, find, replace] of mutations) {
    const count = original.split(find).length - 1;
    assert.equal(count, 1, `${rule}: expected exactly one match for ${JSON.stringify(find)}, found ${count}`);
    fs.writeFileSync(file, original.replace(find, replace));
    const run = spawnSync(process.execPath, [test], { encoding: 'utf8', timeout: 30000 });
    const caught = run.status !== 0;
    if (!caught) survived++;
    const reason = (run.stderr.match(/AssertionError[^\n]*\n[^\n]*\n?[^\n]*/) || run.stderr.match(/did not finish/) || [''])[0].replace(/\s+/g, ' ').slice(0, 140);
    console.log(`${caught ? 'caught  ' : 'SURVIVED'} ${rule}${reason ? ` — ${reason}` : ''}`);
  }
} finally {
  fs.writeFileSync(file, original);
}
console.log(`provider mutations: ${mutations.length - survived}/${mutations.length} caught`);
process.exitCode = survived ? 1 : 0;

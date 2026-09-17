import * as vscode from 'vscode';
import { Backend, createBackend, requestId, Request } from './backend';

const CAP = 6000;
let enabled = true;
let backend: Backend;
let generation = 0;
let configuring = false;
let configurationRevision = 0;
let output: vscode.OutputChannel;
let status: vscode.StatusBarItem;

function contextFor(document: vscode.TextDocument, position: vscode.Position, scope: string) {
  const text = document.getText(), offset = document.offsetAt(position);
  if (scope === 'currentFile' && text.length <= CAP) return { before: text.slice(0, offset), after: text.slice(offset) };
  const start = scope === 'nearby' ? Math.max(0, offset - CAP / 2) : Math.max(0, Math.min(offset - CAP / 2, text.length - CAP));
  if (scope === 'currentFile') output.appendLine(`currentFile context truncated (${text.length} chars)`);
  return { before: text.slice(start, offset), after: text.slice(offset, start + CAP) };
}
function isCredential(document: vscode.TextDocument) {
  return /(^|\/)(\.env(?:\.[^/]+)?|[^/]+\.(?:pem|key|p12|pfx|secret|secrets)|id_rsa|id_ed25519|credentials)$/i.test(document.uri.fsPath);
}
function label() {
  return enabled ? `Apple FM · ${vscode.workspace.getConfiguration('appleFm').get('backend') === 'swift' ? 'Swift' : 'CLI'}` : 'Apple FM · disabled';
}
function invalidate() { generation++; backend?.cancel(); if (status) status.text = label(); }
function current(document: vscode.TextDocument, position: vscode.Position, version: number) {
  const editor = vscode.window.activeTextEditor;
  return document.version === version && editor?.document === document && editor.selection.active.isEqual(position);
}
async function debounce(token: vscode.CancellationToken): Promise<void> {
  if (token.isCancellationRequested) return;
  await new Promise<void>(resolve => {
    const finish = () => { clearTimeout(timer); listener.dispose(); resolve(); };
    const timer = setTimeout(finish, 350);
    const listener = token.onCancellationRequested(finish);
  });
}
class Provider implements vscode.InlineCompletionItemProvider {
  async provideInlineCompletionItems(document: vscode.TextDocument, position: vscode.Position, ctx: vscode.InlineCompletionContext, token: vscode.CancellationToken): Promise<vscode.InlineCompletionItem[]> {
    if (!enabled || configuring || token.isCancellationRequested || process.platform !== 'darwin' || vscode.env.remoteName || vscode.env.uiKind === vscode.UIKind.Web || isCredential(document)) return [];
    const mine = ++generation, version = document.version;
    backend.cancel();
    if (ctx.triggerKind === vscode.InlineCompletionTriggerKind.Automatic) await debounce(token);
    if (mine !== generation || !enabled || configuring || token.isCancellationRequested || !current(document, position, version)) return [];
    const cfg = vscode.workspace.getConfiguration('appleFm');
    const controller = new AbortController();
    const listener = token.onCancellationRequested(() => controller.abort());
    status.text = 'Apple FM · generating';
    const request: Request = { id: requestId(), kind: 'editor', language: document.languageId, ...contextFor(document, position, cfg.get('contextScope', 'nearby')) };
    try {
      const result = await backend.run(request, controller.signal);
      if (mine !== generation || !enabled || token.isCancellationRequested || !current(document, position, version)) return [];
      if (result.status !== 'ok') {
        status.text = result.status === 'error' || result.status === 'unavailable' ? `Apple FM · ${result.status}` : label();
        status.tooltip = result.reason;
        return [];
      }
      status.text = label(); status.tooltip = undefined;
      return [new vscode.InlineCompletionItem(result.insertText!, new vscode.Range(position, position))];
    } finally { listener.dispose(); }
  }
}
export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel('Apple FM');
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  const configure = async () => {
    const mine = ++configurationRevision;
    generation++;
    configuring = true;
    await backend?.dispose();
    if (mine !== configurationRevision) return;
    const cfg = vscode.workspace.getConfiguration('appleFm');
    enabled = cfg.get('enabled', true);
    backend = createBackend(cfg.get('backend', 'fm'), cfg.get<string>('swiftHelperPath', '') || `${context.extensionPath}/bin/apple-fm-helper`);
    configuring = false; status.text = label(); status.show();
  };
  void configure();
  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider([{ scheme: 'file' }, { scheme: 'untitled' }], new Provider()),
    vscode.window.onDidChangeActiveTextEditor(invalidate),
    vscode.window.onDidChangeTextEditorSelection(invalidate),
    vscode.workspace.onDidChangeTextDocument(invalidate),
    vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('appleFm')) void configure(); }),
    vscode.commands.registerCommand('appleFm.enable', () => { enabled = true; invalidate(); return vscode.workspace.getConfiguration('appleFm').update('enabled', true, vscode.ConfigurationTarget.Global); }),
    vscode.commands.registerCommand('appleFm.disable', () => { enabled = false; invalidate(); return vscode.workspace.getConfiguration('appleFm').update('enabled', false, vscode.ConfigurationTarget.Global); }),
    vscode.commands.registerCommand('appleFm.requestSuggestion', () => vscode.commands.executeCommand('editor.action.inlineSuggest.trigger')),
    status, output
  );
}
export function deactivate(): void { generation++; configurationRevision++; void backend?.dispose(); }

import * as vscode from 'vscode';
import { Backend, createBackend, requestId, Request } from './backend';
const CAP = 6000; let enabled = true; let backend: Backend; let generation = 0; let output: vscode.OutputChannel; let status: vscode.StatusBarItem;

function contextFor(document: vscode.TextDocument, position: vscode.Position, scope: string) {
  const text = document.getText(); const offset = document.offsetAt(position);
  if (scope === 'currentFile' && text.length <= CAP) return { before: text.slice(0, offset), after: text.slice(offset) };
  const start = scope === 'nearby' ? Math.max(0, offset - Math.floor(CAP / 2)) : Math.max(0, Math.min(offset - Math.floor(CAP / 2), text.length - CAP));
  const end = Math.min(text.length, start + CAP); if (scope === 'currentFile') output.appendLine(`currentFile context truncated (${text.length} chars)`);
  return { before: text.slice(start, offset), after: text.slice(offset, end) };
}
function isCredential(document: vscode.TextDocument) { return /(^|\/)(\.env(?:\.|$)|.*\.(pem|key|p12|pfx|secret|secrets))$/i.test(document.uri.fsPath); }
class Provider implements vscode.InlineCompletionItemProvider {
  async provideInlineCompletionItems(document: vscode.TextDocument, position: vscode.Position, _context: vscode.InlineCompletionContext, token: vscode.CancellationToken): Promise<vscode.InlineCompletionItem[]> {
    if (!enabled || vscode.env.remoteName || vscode.env.uiKind === vscode.UIKind.Web || isCredential(document)) return [];
    const cfg = vscode.workspace.getConfiguration('appleFm'); const scope = cfg.get<string>('contextScope', 'nearby'); const version = document.version; const line = position.line; const character = position.character; const mine = ++generation;
    const controller = new AbortController(); const cancel = () => controller.abort(); const listener = token.onCancellationRequested(cancel); status.text = 'Apple FM · generating';
    const request: Request = { id: requestId(), kind: 'editor', language: document.languageId, ...contextFor(document, position, scope) };
    try { const result = await backend.run(request, controller.signal); const current = vscode.window.activeTextEditor;
      if (result.status !== 'ok' || mine !== generation || token.isCancellationRequested || document.version !== version || !current || current.document.uri.toString() !== document.uri.toString() || current.selection.active.line !== line || current.selection.active.character !== character) return [];
      return [new vscode.InlineCompletionItem(result.insertText!, new vscode.Range(position, position))];
    } finally { listener.dispose(); if (mine === generation && !token.isCancellationRequested) status.text = `Apple FM · ${cfg.get<string>('backend', 'fm')}`; }
  }
}
export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel('Apple FM'); status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100); enabled = vscode.workspace.getConfiguration('appleFm').get('enabled', true);
  const configure = () => { const c = vscode.workspace.getConfiguration('appleFm'); const kind = c.get<'fm' | 'swift'>('backend', 'fm'); const helper = c.get<string>('swiftHelperPath', ''); backend = createBackend(kind, helper || `${context.extensionPath}/../swift/.build/release/apple-fm-helper`); status.text = `Apple FM · ${kind === 'fm' ? 'CLI' : 'Swift'}`; }; configure(); status.show();
  context.subscriptions.push(vscode.languages.registerInlineCompletionItemProvider({ scheme: '*' }, new Provider()), vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('appleFm')) { enabled = vscode.workspace.getConfiguration('appleFm').get('enabled', true); configure(); } }), vscode.commands.registerCommand('appleFm.enable', () => { enabled = true; vscode.workspace.getConfiguration('appleFm').update('enabled', true, vscode.ConfigurationTarget.Global); }), vscode.commands.registerCommand('appleFm.disable', () => { enabled = false; generation++; vscode.workspace.getConfiguration('appleFm').update('enabled', false, vscode.ConfigurationTarget.Global); }), vscode.commands.registerCommand('appleFm.requestSuggestion', () => vscode.commands.executeCommand('editor.action.inlineSuggest.trigger')), status, output);
}
export function deactivate(): void { generation++; }

import * as vscode from 'vscode';
import { ModelMeter } from './modelMeter';
import { RefactorOverlay } from './refactorOverlay';
import { RefactorController } from './refactor';
import { StatusView } from './statusView';
import { Backend, createBackend, normalizeInsertion, requestId, Request } from './backend';

const CAP = 6000;
let enabled = true;
let backend: Backend;
let generation = 0;
let configuring = false;
let configurationRevision = 0;
let output: vscode.OutputChannel;
let status: vscode.StatusBarItem;
let offered: { uri: string; line: number; character: number; text: string } | undefined;
const suppressed = new Set<string>();
const justAccepted = new Set<string>();
let lastAutomaticRequest = '';
let acceptedDecoration: vscode.TextEditorDecorationType;
let acceptedTimer: ReturnType<typeof setTimeout> | undefined;
let panel: StatusView | undefined;
let refactor: RefactorController;
let refactorOverlay: RefactorOverlay | undefined;
let modelMeter: ModelMeter;
function refreshPanel() { panel?.update(); refactorOverlay?.update(); }

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
function invalidate() { generation++; backend?.cancel(); if (status) { status.text = label(); status.color = undefined; } refreshPanel(); }
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
    if (refactor?.isGenerating || !vscode.window.activeTextEditor?.selection.isEmpty || !enabled || configuring || token.isCancellationRequested || process.platform !== 'darwin' || vscode.env.remoteName || vscode.env.uiKind === vscode.UIKind.Web || isCredential(document)) return [];
    const automatic = ctx.triggerKind === vscode.InlineCompletionTriggerKind.Automatic;
    if (automatic && !vscode.workspace.getConfiguration('appleFm').get('automaticSuggestions', true)) return [];
    if (automatic && suppressed.has(`${document.uri.toString()}:${position.line}`)) return [];
    if (automatic && /\b(?:javascript|typescript|javascriptreact|typescriptreact)\b/i.test(document.languageId) && document.lineAt(position.line).text.trimEnd().endsWith(';')) return [];
    const requestKey = `${document.uri}:${document.version}:${position.line}:${position.character}:${configurationRevision}`;
    if (automatic && requestKey === lastAutomaticRequest) return [];
    const mine = ++generation, version = document.version;
    backend.cancel();
    if (ctx.triggerKind === vscode.InlineCompletionTriggerKind.Automatic) await debounce(token);
    if (mine !== generation || !enabled || configuring || token.isCancellationRequested || !current(document, position, version)) return [];
    const cfg = vscode.workspace.getConfiguration('appleFm');
    const controller = new AbortController();
    const listener = token.onCancellationRequested(() => controller.abort());
    lastAutomaticRequest = requestKey;
    status.text = '$(loading~spin) Apple FM · generating'; refreshPanel();
    const request: Request = { id: requestId(), kind: 'editor', language: document.languageId, ...contextFor(document, position, cfg.get('contextScope', 'nearby')) };
    try {
      const result = await backend.run(request, controller.signal);
      if (mine !== generation || !enabled || token.isCancellationRequested || !current(document, position, version)) return [];
      if (result.status !== 'ok') {
        status.text = result.status === 'error' || result.status === 'unavailable' ? `Apple FM · ${result.status}` : label();
        status.tooltip = result.reason;
        return [];
      }
      const insertion = normalizeInsertion(result.insertText!, request.before, request.after);
      if (!insertion) { status.text = label(); return []; }
      status.text = '$(sparkle) Apple FM · ready';
      status.color = new vscode.ThemeColor('charts.blue');
      status.tooltip = 'Apple FM returned a suggestion. With multiple providers enabled, VS Code may display another provider. Click for request details.';
      offered = { uri: document.uri.toString(), line: position.line, character: position.character, text: insertion };
      return [new vscode.InlineCompletionItem(insertion, new vscode.Range(position, position), {
        command: 'appleFm.accepted', title: 'Record Apple FM acceptance', arguments: [document.uri.toString(), position.line]
      })];
    } finally { listener.dispose(); refreshPanel(); }
  }
}
export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel('Apple FM');
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.name = 'Apple FM';
  acceptedDecoration = vscode.window.createTextEditorDecorationType({
    gutterIconPath: vscode.Uri.joinPath(context.extensionUri, 'media', 'accepted.svg'), gutterIconSize: 'contain'
  });
  status.command = 'appleFm.statusView.focus'; status.tooltip = 'Open Apple FM controls and latest request';
  modelMeter = new ModelMeter(`${context.extensionPath}/bin/apple-fm-info`, refreshPanel);
  context.subscriptions.push(modelMeter);
  refactor = new RefactorController(refreshPanel, async () => { invalidate(); await backend?.dispose(); });
  refactorOverlay = new RefactorOverlay(refactor);
  context.subscriptions.push(refactor, refactorOverlay);
  panel = new StatusView(() => {
    const cfg = vscode.workspace.getConfiguration('appleFm');
    const refactorState = refactor.snapshot();
    const diagnostics = refactorState.candidates[refactorState.selected]?.diagnostics ?? backend?.diagnostics();
    modelMeter.observe(diagnostics);
    return { enabled, automatic: cfg.get('automaticSuggestions', true), backend: cfg.get('backend', 'fm'), scope: cfg.get('contextScope', 'nearby'),
      phase: !enabled ? 'Paused' : status.text.includes('generating') ? 'Generating' : status.text.includes('accepted') ? 'Accepted' : status.text.includes('ready') ? 'Ready' : 'On', diagnostics, refactor: refactorState, meter: modelMeter.state };
  });
  context.subscriptions.push(vscode.commands.registerCommand('appleFm.refactorSelection', () => refactorOverlay?.start()));
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('appleFm.statusView', panel));
  context.subscriptions.push(vscode.languages.registerCodeActionsProvider([{ scheme: 'file' }, { scheme: 'untitled' }], {
    provideCodeActions(_document, range) {
      if (range.isEmpty) return [];
      const action = new vscode.CodeAction('Refactor with Apple FM', vscode.CodeActionKind.RefactorRewrite);
      action.command = { command: 'appleFm.refactorSelection', title: 'Refactor with Apple FM' };
      return [action];
    }
  }, { providedCodeActionKinds: [vscode.CodeActionKind.RefactorRewrite] }));
  const configure = async () => {
    const mine = ++configurationRevision;
    generation++;
    configuring = true;
    await backend?.dispose();
    if (mine !== configurationRevision) return;
    const cfg = vscode.workspace.getConfiguration('appleFm');
    enabled = cfg.get('enabled', true);
    backend = createBackend(cfg.get('backend', 'fm'), cfg.get<string>('swiftHelperPath', '') || `${context.extensionPath}/bin/apple-fm-helper`);
    configuring = false; status.text = label(); status.show(); refreshPanel();
  };
  void configure();
  const changeListener = vscode.workspace.onDidChangeTextDocument(e => {
    if (offered && e.document.uri.toString() === offered.uri) {
      const accepted = e.contentChanges.some(c => c.range.start.line === offered!.line && c.range.start.character === offered!.character && c.text === offered!.text);
      if (accepted) { const key=`${offered.uri}:${offered.line}`; suppressed.add(key); justAccepted.add(key); } else suppressed.clear();
      offered = undefined;
    } else if (justAccepted.size) { justAccepted.clear(); suppressed.clear(); }
    invalidate();
  });
  const showPanel = vscode.commands.registerCommand('appleFm.showMenu', () => vscode.commands.executeCommand('appleFm.statusView.focus'));
  const acceptedCommand = vscode.commands.registerCommand('appleFm.accepted', (uri: string, line: number) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.toString() !== uri || line >= editor.document.lineCount) return;
    suppressed.add(`${uri}:${line}`);
    justAccepted.add(`${uri}:${line}`);
    status.text = '$(check) Apple FM · accepted'; status.color = new vscode.ThemeColor('charts.green');
    status.tooltip = 'This completion was accepted from Apple FM. Click for its prompt and timing.';
    for (const visible of vscode.window.visibleTextEditors) visible.setDecorations(acceptedDecoration, []);
    editor.setDecorations(acceptedDecoration, [{ range: new vscode.Range(line, 0, line, 0), hoverMessage: 'Accepted from Apple FM' }]);
    refreshPanel();
    if (acceptedTimer) clearTimeout(acceptedTimer);
    acceptedTimer = setTimeout(() => {
      editor.setDecorations(acceptedDecoration, []);
      if (status.text.includes('accepted')) { status.text = label(); status.color = undefined; }
      refreshPanel();
    }, 1500);
  });
  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider([{ scheme: 'file' }, { scheme: 'untitled' }], new Provider()),
    vscode.window.onDidChangeActiveTextEditor(invalidate),
    vscode.window.onDidChangeTextEditorSelection(invalidate),
    changeListener,
    vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('appleFm')) void configure(); }),
    vscode.commands.registerCommand('appleFm.enable', () => { enabled = true; invalidate(); return vscode.workspace.getConfiguration('appleFm').update('enabled', true, vscode.ConfigurationTarget.Global); }),
    vscode.commands.registerCommand('appleFm.disable', () => { enabled = false; invalidate(); return vscode.workspace.getConfiguration('appleFm').update('enabled', false, vscode.ConfigurationTarget.Global); }),
    vscode.commands.registerCommand('appleFm.requestSuggestion', () => vscode.commands.executeCommand('editor.action.inlineSuggest.trigger')), showPanel,
    acceptedCommand, acceptedDecoration, { dispose: () => { if (acceptedTimer) clearTimeout(acceptedTimer); } }, status, output
  );
}
export function deactivate(): void { generation++; configurationRevision++; void backend?.dispose(); }

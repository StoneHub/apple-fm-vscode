import * as vscode from 'vscode';
import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Diagnostics } from './backend';
import { RefactorRunner } from './refactorRunner';

type Candidate = { text: string; diagnostics: Diagnostics; duplicate: boolean };
type Session = {
  id: string; document: vscode.TextDocument; version: number; range: vscode.Range;
  original: string; label: string; instruction: string; candidates: Candidate[];
  selected: number; applied: boolean;
};
export type RefactorState = {
  id?: string; target?: string; original?: string; instruction: string; busy: boolean;
  progress: string; stale: boolean; applied: boolean; selected: number;
  candidates: Candidate[]; canCapture: boolean;
};

// Preview documents and alternatives live only for this extension session.
export class RefactorController implements vscode.Disposable, vscode.TextDocumentContentProvider {
  private session?: Session;
  private sourceEditor?: vscode.TextEditor;
  private runner = new RefactorRunner();
  private abort?: AbortController;
  private previews = new Map<string, string>();
  private progress = '';
  private subscriptions: vscode.Disposable[];

  constructor(private readonly changed: () => void, private readonly beforeGenerate: () => Promise<void>) {
    this.sourceEditor = vscode.window.activeTextEditor;
    this.subscriptions = [
      vscode.workspace.registerTextDocumentContentProvider('apple-fm-refactor', this),
      vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor && this.isLocal(editor.document)) this.sourceEditor = editor;
        this.changed();
      }),
      vscode.window.onDidChangeTextEditorSelection(e => {
        if (this.isLocal(e.textEditor.document)) this.sourceEditor = e.textEditor;
        this.changed();
      }),
      vscode.workspace.onDidChangeTextDocument(e => {
        if (e.document === this.session?.document && e.contentChanges.length) {
          if (this.session?.applied) { this.session.applied = false; this.progress = 'Source changed after applying. Capture a fresh selection to continue.'; }
          if (this.isGenerating) this.cancel();
          this.changed();
        }
      }),
      vscode.workspace.onDidCloseTextDocument(() => this.changed())
    ];
  }

  target(): { document: vscode.TextDocument; range: vscode.Range } | undefined {
    return this.session ? { document: this.session.document, range: this.session.range } : undefined;
  }

  get isGenerating(): boolean { return !!this.abort; }
  private isLocal(doc: vscode.TextDocument): boolean { return ['file', 'untitled'].includes(doc.uri.scheme); }
  private stale(s: Session): boolean {
    return s.document.isClosed || s.document.version !== s.version || s.document.getText(s.range) !== s.original;
  }
  snapshot(): RefactorState {
    const s = this.session;
    return { id: s?.id, target: s?.label, original: s?.original, instruction: s?.instruction ?? 'Improve readability while preserving behavior.',
      busy: this.isGenerating, progress: this.progress, stale: !!s && this.stale(s), applied: s?.applied ?? false,
      selected: s?.selected ?? 0, candidates: s?.candidates ?? [],
      canCapture: !!this.sourceEditor && !this.sourceEditor.selection.isEmpty && !this.sourceEditor.document.isClosed };
  }

  async capture(): Promise<void> {
    const editor = this.sourceEditor;
    if (!editor || !this.isLocal(editor.document) || editor.document.isClosed || editor.selection.isEmpty)
      throw new Error('Highlight code in a local editor, then choose Refactor Selection.');
    if (process.platform !== 'darwin' || vscode.env.remoteName || vscode.env.uiKind === vscode.UIKind.Web)
      throw new Error('Selection refactoring requires a local Mac window.');
    if (/(^|\/)(\.env(?:\.[^/]+)?|[^/]+\.(?:pem|key|p12|pfx|secret|secrets)|id_rsa|id_ed25519|credentials)$/i.test(editor.document.uri.fsPath))
      throw new Error('Refactoring is unavailable for credential files.');
    const original = editor.document.getText(editor.selection);
    if (!original.trim()) throw new Error('Highlight a nonempty section of code.');
    if (original.length > 6000) throw new Error('Select at most 6,000 characters for this local prototype.');
    this.cancel();
    this.previews.clear();
    this.session = { id: randomUUID(), document: editor.document, version: editor.document.version,
      range: new vscode.Range(editor.selection.start, editor.selection.end), original,
      label: `${basename(editor.document.fileName)} · lines ${editor.selection.start.line + 1}–${editor.selection.end.line + 1} · ${original.length} chars`,
      instruction: 'Improve readability while preserving behavior.', candidates: [], selected: 0, applied: false };
    this.progress = 'Ready';
    this.changed();

  }

  async generate(instruction: string, count: number): Promise<void> {
    const s = this.session;
    if (!s || this.stale(s) || s.applied) throw new Error('Capture a fresh selection before generating.');
    if (this.isGenerating) return;
    instruction = instruction.trim();
    if (!instruction || instruction.length > 1000) throw new Error('Enter an instruction of 1–1,000 characters.');
    if (![1, 2, 3].includes(count)) return;
    if (instruction !== s.instruction) { s.candidates = []; s.selected = 0; s.instruction = instruction; }
    if (s.candidates.length >= 9) throw new Error('Nine alternatives retained. Capture the selection again to start a fresh set.');
    count = Math.min(count, 9 - s.candidates.length);
    const abort = new AbortController(); this.abort = abort;
    try {
      await this.beforeGenerate();
      for (let i = 0; i < count; i++) {
        if (abort.signal.aborted || this.session !== s || this.stale(s)) break;
        this.progress = `Generating ${i + 1} of ${count}…`;
        this.changed();
        const result = await this.runner.run({ language: s.document.languageId, original: s.original, instruction, variant: s.candidates.length + 1 }, abort.signal);
        if (abort.signal.aborted || this.session !== s || this.stale(s)) break;
        const duplicate = result.text === s.original || s.candidates.some(c => c.text === result.text);
        s.candidates.push({ ...result, duplicate });
        if (s.candidates.length === 1) s.selected = 0;
        this.changed();
      }
      if (this.session === s) this.progress = abort.signal.aborted ? 'Stopped' : `${s.candidates.length} alternatives`;
    } catch (error) {
      if (this.session === s) this.progress = abort.signal.aborted ? 'Stopped' : `Generation failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      if (this.abort === abort) this.abort = undefined;
      this.changed();
    }
  }

  cancel(): void { this.abort?.abort(); this.runner.cancel(); }
  select(index: number): void {
    if (Number.isInteger(index) && this.session?.candidates[index] && this.session.selected !== index) { this.session.selected = index; this.changed(); }
  }
  provideTextDocumentContent(uri: vscode.Uri): string { return this.previews.get(uri.toString()) ?? ''; }
  async compare(preserveFocus = false): Promise<void> {
    const s = this.session, c = s?.candidates[s.selected];
    if (!s || !c) return;
    const ext = s.document.fileName.split('.').pop() ?? 'txt';
    const left = vscode.Uri.from({ scheme: 'apple-fm-refactor', path: `/${s.id}/original.${ext}` });
    const right = vscode.Uri.from({ scheme: 'apple-fm-refactor', path: `/${s.id}/alternative-${s.selected + 1}-${randomUUID()}.${ext}` });
    this.previews.set(left.toString(), s.original); this.previews.set(right.toString(), c.text);
    await vscode.commands.executeCommand('vscode.diff', left, right, `Apple FM · Original ↔ Alternative ${s.selected + 1}`, { preview: true, preserveFocus });
  }
  async apply(): Promise<void> {
    const s = this.session, c = s?.candidates[s.selected];
    if (!s || !c || this.isGenerating || s.applied) return;
    if (this.stale(s)) throw new Error('The source changed. Capture a fresh selection to avoid overwriting your edits.');
    const editor = await vscode.window.showTextDocument(s.document, { preserveFocus: false });
    if (this.session !== s || this.stale(s)) throw new Error('The source changed. Capture a fresh selection.');
    const ok = await editor.edit(edit => edit.replace(s.range, c.text), { undoStopBefore: true, undoStopAfter: true });
    if (!ok) throw new Error('The edit was not applied. Capture a fresh selection and try again.');
    s.applied = true; this.progress = `Applied alternative ${s.selected + 1}`;
    this.changed();
  }
  async action(message: { action: string; value?: unknown; count?: unknown }): Promise<void> {
    try {
      if (message.action === 'refactorCapture') await this.capture();
      else if (message.action === 'refactorGenerate' && typeof message.value === 'string' && typeof message.count === 'number') await this.generate(message.value, message.count);
      else if (message.action === 'refactorCancel') this.cancel();
      else if (message.action === 'refactorSelect' && typeof message.value === 'number') this.select(message.value);
      else if (message.action === 'refactorCompare') await this.compare();
      else if (message.action === 'refactorApply') await this.apply();
    } catch (error) { void vscode.window.showWarningMessage(error instanceof Error ? error.message : String(error)); }
  }
  dispose(): void { this.cancel(); void this.runner.dispose(); this.subscriptions.forEach(s => s.dispose()); this.previews.clear(); }
}

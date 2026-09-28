import * as vscode from 'vscode';
import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Diagnostics } from './backend';
import { AttachedImage, IMAGE_EXTENSIONS, ImageBackend, ImageInput, ImageResult, ImageRunner, MAX_CODE, MAX_QUESTION, buildImageRequest, checkImage } from './imageRunner';
import { CREDENTIAL_FILE } from './refactor';

type Selection = { code: string; language: string; label: string };
const MAX_ANSWERS = 20;

export function requireLocalMac(feature: string): void {
  if (process.platform !== 'darwin' || vscode.env.remoteName || vscode.env.uiKind === vscode.UIKind.Web)
    throw new Error(`${feature} requires a local Mac window.`);
}

// An explicit picker: images are only ever chosen by the person, never gathered automatically.
export async function pickImage(title: string, openLabel: string): Promise<string | undefined> {
  const picked = await vscode.window.showOpenDialog({ title, openLabel, canSelectFiles: true, canSelectFolders: false, canSelectMany: false, filters: { Images: IMAGE_EXTENSIONS } });
  const uri = picked?.[0];
  if (!uri) return undefined;
  if (uri.scheme !== 'file') throw new Error('Choose an image stored on this Mac.');
  return uri.fsPath;
}

// The active local editor's selection, when there is one, goes with the question as bounded, untrusted context.
function selectedCode(): Selection | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty || editor.document.isClosed || !['file', 'untitled'].includes(editor.document.uri.scheme)) return undefined;
  if (CREDENTIAL_FILE.test(editor.document.uri.fsPath)) throw new Error('Text selected in a credential file is never sent. Clear the selection to ask about the image alone.');
  const code = editor.document.getText(editor.selection);
  if (!code.trim()) return undefined;
  if (code.length > MAX_CODE) throw new Error('Select at most 6,000 characters, or clear the selection to ask about the image alone.');
  const { start, end } = editor.selection;
  return { code, language: editor.document.languageId, label: `${basename(editor.document.fileName)} · lines ${start.line + 1}–${end.line + 1} · ${code.length} chars` };
}

// Apple FM: Ask About Image… Pick an image, type a question, read the answer in a read-only preview.
export class ImageQuestion implements vscode.Disposable, vscode.TextDocumentContentProvider {
  private readonly runner = new ImageRunner();
  private abort?: AbortController;
  private readonly answers = new Map<string, string>();
  private readonly registration: vscode.Disposable;

  constructor(private readonly changed: () => void, private readonly beforeAsk: () => Promise<void>, private readonly backendFor: () => ImageBackend) {
    this.registration = vscode.workspace.registerTextDocumentContentProvider('apple-fm-image', this);
  }

  get isGenerating(): boolean { return !!this.abort; }
  diagnostics(): Diagnostics | undefined { return this.runner.diagnostics(); }
  cancel(): void { this.abort?.abort(); this.runner.cancel(); }
  provideTextDocumentContent(uri: vscode.Uri): string { return this.answers.get(uri.toString()) ?? ''; }

  async ask(): Promise<void> {
    if (this.isGenerating) { void vscode.window.showInformationMessage('An Apple FM image question is already running.'); return; }
    requireLocalMac('Asking about an image');
    const selection = selectedCode();
    const path = await pickImage('Apple FM: choose an image to ask about', 'Ask about image');
    if (!path) return;
    const image = checkImage(path);
    const question = await vscode.window.showInputBox({
      title: `Ask Apple FM about ${image.name}`,
      prompt: selection ? `Selected code is included as context: ${selection.label}. Processed on this Mac.` : 'No code selected: only the image and your question are sent. Processed on this Mac.',
      placeHolder: 'What does this error mean?',
      ignoreFocusOut: true,
      validateInput: value => !value.trim() ? 'Enter a question.' : value.trim().length > MAX_QUESTION ? 'Use at most 1,000 characters.' : undefined
    });
    if (question === undefined) return;
    const input: ImageInput = { image: image.path, task: 'question', text: question, code: selection?.code, language: selection?.language };
    buildImageRequest(input); // Report bounds before any model work starts.
    const backend = this.backendFor();
    const abort = new AbortController();
    this.abort = abort;
    this.changed();
    let result: ImageResult;
    try {
      await this.beforeAsk();
      result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Apple FM · ${image.name}`, cancellable: true }, async (progress, token) => {
        const listener = token.onCancellationRequested(() => abort.abort());
        progress.report({ message: `Asking the on-device model (${backend.kind === 'swift' ? 'Swift' : 'CLI'})…` });
        try { return await this.runner.run(input, backend, abort.signal); } finally { listener.dispose(); }
      });
    } finally {
      if (this.abort === abort) this.abort = undefined;
      this.changed();
    }
    if (result.status === 'ok') await this.show(image, question.trim(), selection, result);
    else if (result.status === 'empty') void vscode.window.showInformationMessage(`Apple FM returned no answer about ${image.name}.`);
    else if (result.status === 'cancelled') void vscode.window.showInformationMessage('Apple FM image question stopped.');
    else if (result.status === 'unavailable') void vscode.window.showWarningMessage(result.reason ?? 'Apple FM is unavailable.');
    else void vscode.window.showWarningMessage(`Apple FM image question failed: ${result.reason ?? 'unknown error'}`);
  }

  // The answer is model output shown as read-only text; nothing in it is run or rendered as HTML.
  private async show(image: AttachedImage, question: string, selection: Selection | undefined, result: ImageResult): Promise<void> {
    const d = result.diagnostics;
    const uri = vscode.Uri.from({ scheme: 'apple-fm-image', path: `/${randomUUID()}/${image.name} answer.md` });
    this.answers.set(uri.toString(), [
      `# Apple FM · ${image.name}`, '',
      `Question: ${question}`,
      `Context: ${selection ? `selected code, ${selection.label}` : 'image only'}`,
      `On-device ${d.backend} · ${d.durationMs ?? '—'} ms`, '', '---', '',
      result.text!, ''
    ].join('\n'));
    while (this.answers.size > MAX_ANSWERS) this.answers.delete(this.answers.keys().next().value!);
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, { preview: true, viewColumn: vscode.ViewColumn.Beside });
  }

  dispose(): void { this.cancel(); void this.runner.dispose(); this.registration.dispose(); this.answers.clear(); }
}

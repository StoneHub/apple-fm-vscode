import * as vscode from 'vscode';
import { RefactorController } from './refactor';

// Native editor-anchored UI. No Quick Pick or separate diff editor is involved.
export class RefactorOverlay implements vscode.Disposable {
  private readonly comments = vscode.comments.createCommentController('apple-fm-refactor', 'Apple FM');
  private thread?: vscode.CommentThread;
  private starting = false;
  private showChanges = true;
  private lastBody = '';
  private readonly subscriptions: vscode.Disposable[] = [];

  constructor(private readonly controller: RefactorController) {
    this.comments.options = { prompt: 'Modify selected code', placeHolder: 'What should change?' };
    const command = (name: string, action: (...args: any[]) => unknown) => {
      this.subscriptions.push(vscode.commands.registerCommand(`appleFm.refactor.${name}`, async (...args) => {
        try { await action(...args); } catch (error) { this.report(error); }
      }));
    };
    command('generate', async (reply: vscode.CommentReply) => {
      if (reply?.thread !== this.thread || this.controller.isGenerating) return;
      await this.controller.generate(reply.text, 3);
    });
    command('previous', () => { const s = this.controller.snapshot(); this.controller.select(Math.max(0, s.selected - 1)); });
    command('next', () => { const s = this.controller.snapshot(); this.controller.select(Math.min(s.candidates.length - 1, s.selected + 1)); });
    command('more', () => this.controller.generate(this.controller.snapshot().instruction, 3));
    command('toggleChanges', () => { this.showChanges = !this.showChanges; this.lastBody = ''; this.update(); });
    command('apply', async () => { await this.controller.apply(); if (this.controller.snapshot().applied) this.close(); });
    command('stop', () => this.controller.cancel());
    command('close', () => this.close());
  }

  async start(): Promise<void> {
    if (this.starting) return;
    this.starting = true;
    try {
      this.close();
      await this.controller.capture();
      const target = this.controller.target();
      if (!target) return;
      const editor = await vscode.window.showTextDocument(target.document, { preserveFocus: false });
      // Attach just below the selection's first line, like an inline editing prompt.
      const anchor = new vscode.Range(target.range.start.line, 0, target.range.start.line, 0);
      this.thread = this.comments.createCommentThread(target.document.uri, anchor, []);
      this.thread.label = 'Apple FM · Refactor';
      this.thread.contextValue = 'appleFmReady';
      this.thread.canReply = true;
      this.thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
      this.showChanges = true; this.lastBody = '';
      editor.revealRange(anchor, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      this.update();
    } catch (error) { this.report(error); }
    finally { this.starting = false; }
  }

  update(): void {
    if (!this.thread) return;
    const s = this.controller.snapshot();
    const candidate = s.candidates[s.selected];
    this.thread.contextValue = s.stale ? 'appleFmStale' : s.busy ? 'appleFmBusy' : candidate ? 'appleFmResults' : 'appleFmReady';
    this.thread.canReply = !s.busy && !s.stale;
    this.thread.label = s.stale ? 'Apple FM · Selection changed' : s.busy ? `Apple FM · ${s.progress}` : candidate ? `Apple FM · ${s.selected + 1} / ${s.candidates.length}` : 'Apple FM · Refactor';
    const body = new vscode.MarkdownString();
    body.isTrusted = false; body.supportHtml = false;
    if (s.stale) body.appendText('Select the code again to continue.');
    else if (candidate) {
      const language = this.controller.target()?.document.languageId ?? '';
      body.appendCodeblock(this.showChanges ? selectionDiff(s.original ?? '', candidate.text) : candidate.text, this.showChanges ? 'diff' : language);
    } else if (s.progress.startsWith('Generation failed:')) body.appendText(s.progress);
    const key = `${body.value}:${s.selected}:${s.busy}:${s.stale}:${candidate?.duplicate}`;
    if (key !== this.lastBody) {
      this.lastBody = key;
      this.thread.comments = body.value ? [{ body, mode: vscode.CommentMode.Preview,
        author: { name: candidate ? `Alternative ${s.selected + 1}` : 'Apple FM' },
        label: candidate?.duplicate ? 'duplicate' : undefined,
        contextValue: 'appleFmAlternative' }] : [];
    }
  }

  private close(): void {
    this.controller.cancel(); this.thread?.dispose(); this.thread = undefined; this.lastBody = '';
  }
  private report(error: unknown): void { void vscode.window.showWarningMessage(error instanceof Error ? error.message : String(error)); }
  dispose(): void { this.close(); this.subscriptions.forEach(s => s.dispose()); this.comments.dispose(); }
}

export function selectionDiff(original: string, replacement: string): string {
  if (original === replacement) return replacement;
  const before = original.split('\n'), after = replacement.split('\n');
  let start = 0, end = 0;
  while (start < Math.min(before.length, after.length) && before[start] === after[start]) start++;
  while (end < Math.min(before.length, after.length) - start && before[before.length - end - 1] === after[after.length - end - 1]) end++;
  return [
    ...before.slice(Math.max(0, start - 2), start).map(line => ` ${line}`),
    ...before.slice(start, before.length - end).map(line => `-${line}`),
    ...after.slice(start, after.length - end).map(line => `+${line}`),
    ...after.slice(after.length - end, after.length - end + 2).map(line => ` ${line}`)
  ].join('\n');
}

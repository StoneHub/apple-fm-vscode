import * as vscode from 'vscode';
import { RefactorController } from './refactor';

type AlternativeItem = vscode.QuickPickItem & { index: number };

export class RefactorOverlay implements vscode.Disposable {
  private picker?: vscode.QuickPick<AlternativeItem>;
  private rendering = false;
  private starting = false;
  private readonly preview = { iconPath: new vscode.ThemeIcon('diff'), tooltip: 'Preview diff' };
  private readonly apply = { iconPath: new vscode.ThemeIcon('check'), tooltip: 'Apply replacement' };
  private readonly more = { iconPath: new vscode.ThemeIcon('add'), tooltip: 'Generate 3 more' };
  private readonly stop = { iconPath: new vscode.ThemeIcon('debug-stop'), tooltip: 'Stop' };
  private readonly edit = { iconPath: new vscode.ThemeIcon('edit'), tooltip: 'Change instruction' };

  constructor(private readonly controller: RefactorController) {}

  async start(): Promise<void> {
    if (this.starting) return;
    this.starting = true;
    try {
      this.picker?.hide();
      await this.controller.capture();
      await this.askInstruction();
    } catch (error) { this.report(error); }
    finally { this.starting = false; }
  }

  private async askInstruction(): Promise<void> {
    const state = this.controller.snapshot();
    const instruction = await vscode.window.showInputBox({
      title: 'Refactor selection', prompt: state.target, placeHolder: 'What should change?',
      value: state.instruction, ignoreFocusOut: true,
      validateInput: value => !value.trim() ? 'Enter a change.' : value.length > 1000 ? 'Keep it under 1,000 characters.' : undefined
    });
    if (instruction === undefined) return;
    this.show();
    try { await this.controller.generate(instruction, 3); }
    catch (error) { this.report(error); }
  }

  private show(): void {
    const picker = vscode.window.createQuickPick<AlternativeItem>();
    this.picker = picker;
    picker.title = 'Refactor selection';
    picker.ignoreFocusOut = true;
    picker.matchOnDetail = true;
    const subscriptions = [
      picker.onDidAccept(() => {
        const item = picker.selectedItems[0];
        if (item) { this.controller.select(item.index); void this.controller.compare(true).catch(error => this.report(error)); }
      }),
      picker.onDidChangeActive(items => {
        if (!this.rendering && items[0]) this.controller.select(items[0].index);
      }),
      picker.onDidTriggerItemButton(async event => {
        this.controller.select(event.item.index);
        try {
          if (event.button === this.preview) await this.controller.compare(true);
          else if (event.button === this.apply) {
            await this.controller.apply();
            if (this.controller.snapshot().applied) picker.hide();
          }
        } catch (error) { this.report(error); }
      }),
      picker.onDidTriggerButton(async button => {
        try {
          if (button === this.stop) this.controller.cancel();
          else if (button === this.more) await this.controller.generate(this.controller.snapshot().instruction, 3);
          else if (button === this.edit) { picker.hide(); await this.askInstruction(); }
        } catch (error) { this.report(error); }
      }),
      picker.onDidHide(() => {
        this.controller.cancel();
        if (this.picker === picker) this.picker = undefined;
        subscriptions.forEach(s => s.dispose()); picker.dispose();
      })
    ];
    this.update(); picker.show();
  }

  update(): void {
    const picker = this.picker;
    if (!picker || this.rendering) return;
    const s = this.controller.snapshot();
    this.rendering = true;
    picker.busy = s.busy;
    picker.placeholder = s.stale ? 'Source changed — select it again.' : s.busy || !s.candidates.length ? s.progress : 'Enter: preview · ✓: apply';
    picker.title = `Refactor selection${s.candidates.length ? ` · ${s.candidates.length} alternatives` : ''}`;
    picker.buttons = s.busy ? [this.stop] : s.stale ? [] : [this.edit, ...(s.candidates.length < 9 ? [this.more] : [])];
    picker.items = s.candidates.map((c, index) => ({
      index, label: `Alternative ${index + 1}`, alwaysShow: true,
      description: [c.duplicate ? 'duplicate' : '', `${c.diagnostics.durationMs ?? 0} ms`].filter(Boolean).join(' · '),
      detail: c.text.replace(/\s+/g, ' ').slice(0, 180),
      buttons: s.busy || s.stale || s.applied ? [this.preview] : [this.preview, this.apply]
    }));
    if (picker.items[s.selected]) picker.activeItems = [picker.items[s.selected]];
    this.rendering = false;
  }

  private report(error: unknown): void { void vscode.window.showWarningMessage(error instanceof Error ? error.message : String(error)); }
  dispose(): void { this.picker?.hide(); }
}

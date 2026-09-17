import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { Diagnostics } from './backend';

export type PanelState = {
  enabled: boolean; automatic: boolean; backend: string; scope: string;
  phase: string; diagnostics?: Diagnostics;
};

export class StatusView implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  constructor(private readonly version: string, private readonly snapshot: () => PanelState) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    const nonce = randomBytes(16).toString('hex');
    view.webview.html = this.html(nonce);
    const messages = view.webview.onDidReceiveMessage(async message => {
      const config = vscode.workspace.getConfiguration('appleFm');
      if (message?.action === 'ready') this.update();
      else if (message?.action === 'enabled' && typeof message.value === 'boolean')
        await vscode.commands.executeCommand(message.value ? 'appleFm.enable' : 'appleFm.disable');
      else if (message?.action === 'automatic' && typeof message.value === 'boolean')
        await config.update('automaticSuggestions', message.value, vscode.ConfigurationTarget.Global);
      else if (message?.action === 'backend' && ['fm', 'swift'].includes(message.value))
        await config.update('backend', message.value, vscode.ConfigurationTarget.Global);
      else if (message?.action === 'scope' && ['nearby', 'currentFile'].includes(message.value))
        await config.update('contextScope', message.value, vscode.ConfigurationTarget.Global);
      else if (message?.action === 'request') {
        await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
        await vscode.commands.executeCommand('appleFm.requestSuggestion');
      } else if (message?.action === 'copilot')
        await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:github.copilot inline');
      this.update();
    });
    view.onDidDispose(() => { messages.dispose(); if (this.view === view) this.view = undefined; });
    view.onDidChangeVisibility(() => { if (view.visible) this.update(); });
  }

  update(): void { if (this.view) void this.view.webview.postMessage({ type: 'state', ...this.snapshot() }); }

  private html(nonce: string): string {
    return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style nonce="${nonce}">
body{padding:18px 16px;font:var(--vscode-font-size)/1.5 var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-sideBar-background)}
h1{font-size:20px;margin:0}h2{font-size:13px;margin:0 0 12px}p{margin:6px 0}.muted{color:var(--vscode-descriptionForeground)}
.hero{display:flex;align-items:center;justify-content:space-between;gap:8px}.badge{font-size:11px;padding:3px 8px;border:1px solid var(--vscode-panel-border);border-radius:12px}
section{padding:18px 0;border-bottom:1px solid var(--vscode-panel-border)}.row{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:10px 0}
label{display:flex;align-items:center;gap:8px}input{accent-color:var(--vscode-focusBorder)}select{max-width:55%;padding:5px;background:var(--vscode-dropdown-background);color:var(--vscode-dropdown-foreground);border:1px solid var(--vscode-dropdown-border)}
button{cursor:pointer;padding:7px 11px;border:1px solid transparent;border-radius:3px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);font:inherit}button:hover{background:var(--vscode-button-hoverBackground)}button.secondary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
button:focus-visible,select:focus-visible,input:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:2px}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:14px 0}.metric strong{display:block;font-size:18px;font-weight:500}.metric span{font-size:11px;color:var(--vscode-descriptionForeground)}
pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:10px;background:var(--vscode-textCodeBlock-background);font:12px/1.5 var(--vscode-editor-font-family);max-height:420px;overflow:auto}summary{cursor:pointer;margin:10px 0}.foot{font-size:11px;margin-top:18px}
</style></head><body>
<div class="hero"><h1>Apple FM</h1><span class="badge">On-device</span></div>
<p class="muted">Apple system model · <span id="backendLabel">CLI</span></p>
<section><h2>Inline suggestions</h2>
<div class="row"><label><input id="enabled" type="checkbox">Enable Apple FM</label><span id="phase" class="muted">Ready</span></div>
<div class="row"><label><input id="automatic" type="checkbox">Suggest while typing</label></div>
<div class="row"><label for="backend">Backend</label><select id="backend"><option value="fm">Apple CLI</option><option value="swift">Native Swift</option></select></div>
<div class="row"><label for="scope">Context</label><select id="scope"><option value="nearby">Near the cursor</option><option value="currentFile">Current file (bounded)</option></select></div>
<button id="request">Request suggestion</button><p class="muted">Tab accepts. Escape dismisses.</p></section>
<section><h2>Latest request</h2><p id="result" class="muted">No request yet</p>
<div class="metrics"><div class="metric"><strong id="latency">—</strong><span>milliseconds</span></div><div class="metric"><strong id="input">—</strong><span>input chars</span></div><div class="metric"><strong id="output">—</strong><span>output chars</span></div></div>
<p id="reason" class="muted"></p>
<details><summary>Command and model</summary><pre id="command">No request yet</pre></details>
<details open><summary>Prompt / submitted input</summary><pre id="prompt">Request a suggestion to inspect its exact input.</pre></details>
<p class="muted">Only the latest request is kept in memory. No request history is saved by this extension.</p></section>
<section><h2>Which provider?</h2><p>Apple FM shows its own activity below. A teal gutter flash confirms an accepted Apple FM suggestion.</p><p class="muted">When multiple providers are enabled, VS Code chooses the preview. “Ready” alone does not identify the visible provider.</p><button class="secondary" id="copilot">Copilot inline settings</button></section>
<p class="foot muted">Apple FM ${this.version} · Exact Apple model version is not exposed.</p>
<script nonce="${nonce}">
const api=acquireVsCodeApi();const el=id=>document.getElementById(id);
for(const id of ['enabled','automatic','backend','scope']) el(id).addEventListener('change',()=>api.postMessage({action:id,value:el(id).type==='checkbox'?el(id).checked:el(id).value}));
for(const id of ['request','copilot']) el(id).addEventListener('click',()=>api.postMessage({action:id}));
window.addEventListener('message',event=>{const s=event.data;if(s.type!=='state')return;el('enabled').checked=s.enabled;el('automatic').checked=s.automatic;el('backend').value=s.backend;el('scope').value=s.scope;el('backendLabel').textContent=s.backend==='swift'?'Native Swift':'Apple CLI';el('phase').textContent=s.phase;el('request').disabled=!s.enabled;const d=s.diagnostics;el('result').textContent=d?(d.status||'Generating'):'No request yet';el('latency').textContent=d?.durationMs??'—';el('input').textContent=d?.inputChars??'—';el('output').textContent=d?.outputChars??'—';el('reason').textContent=d?.reason||'';el('command').textContent=d?d.model+'\\n\\nExecutable and arguments:\\n'+JSON.stringify(d.argv,null,2):'No request yet';el('prompt').textContent=d?.stdin||'Request a suggestion to inspect its exact input.';});api.postMessage({action:'ready'});
</script></body></html>`;
  }
}

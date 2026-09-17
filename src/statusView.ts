import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { Diagnostics } from './backend';
import { RefactorState } from './refactor';
import { MeterState } from './modelMeter';

export type PanelState = {
  enabled: boolean; automatic: boolean; backend: string; scope: string;
  phase: string; diagnostics?: Diagnostics; refactor: RefactorState; meter: MeterState;
};

export class StatusView implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  constructor(private readonly snapshot: () => PanelState) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    const nonce = randomBytes(16).toString('hex');
    view.webview.html = this.html(nonce);
    const messages = view.webview.onDidReceiveMessage(async message => {
      const config = vscode.workspace.getConfiguration('appleFm');
      if (message?.action === 'ready') this.update();
      else if (message?.action === 'refactor') await vscode.commands.executeCommand('appleFm.refactorSelection');
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
      }
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
body{padding:16px;font:var(--vscode-font-size)/1.5 var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-sideBar-background)}
h1{font-size:20px;margin:0}h2{font-size:13px;margin:0 0 10px}p{margin:6px 0}.muted{color:var(--vscode-descriptionForeground)}
.hero,.row{display:flex;align-items:center;justify-content:space-between;gap:10px}.row{margin:10px 0}.badge{font-size:11px;padding:3px 8px;border:1px solid var(--vscode-panel-border);border-radius:12px}
section{padding:16px 0;border-bottom:1px solid var(--vscode-panel-border)}label{display:flex;align-items:center;gap:8px}input{accent-color:var(--vscode-focusBorder)}
select{max-width:55%;padding:5px;background:var(--vscode-dropdown-background);color:var(--vscode-dropdown-foreground);border:1px solid var(--vscode-dropdown-border)}
button{cursor:pointer;padding:7px 10px;border:1px solid var(--vscode-contrastBorder,transparent);border-radius:3px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);font:inherit}button:hover{background:var(--vscode-button-hoverBackground)}button:disabled{opacity:.45;cursor:default}
button:focus-visible,select:focus-visible,input:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:2px}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0}.metric strong{display:block;font-size:18px;font-weight:500}.metric span{font-size:11px;color:var(--vscode-descriptionForeground)}
pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:10px;background:var(--vscode-textCodeBlock-background);font:12px/1.5 var(--vscode-editor-font-family);max-height:420px;overflow:auto}summary{cursor:pointer;margin:10px 0}
.meter{height:9px;display:flex;border-radius:6px;overflow:hidden;background:var(--vscode-editor-inactiveSelectionBackground);margin:8px 0}.inputFill{background:var(--vscode-charts-blue)}.outputFill{background:var(--vscode-charts-green)}progress{width:100%;height:7px;accent-color:var(--vscode-charts-blue)}
</style></head><body>
<div class="hero"><h1>Apple FM</h1><span class="badge">Local</span></div>
<section><div class="row"><label><input id="enabled" type="checkbox">Enabled</label><span id="phase" class="muted"></span></div>
<label><input id="automatic" type="checkbox">Suggest while typing</label>
<div class="row"><label for="backend">Backend</label><select id="backend"><option value="fm">CLI</option><option value="swift">Swift</option></select></div>
<div class="row"><label for="scope">Context</label><select id="scope"><option value="nearby">Near cursor</option><option value="currentFile">Current file</option></select></div>
<div class="actions"><button id="request">Suggest</button><button id="refactor">Refactor selection…</button></div></section>
<section><h2>Context</h2><p id="contextCapacity" class="muted">Loading…</p>
<div class="meter" role="img" id="contextMeter" aria-label="Context usage"><span class="inputFill" id="inputFill"></span><span class="outputFill" id="outputFill"></span></div>
<p id="contextUsage" class="muted">No request yet</p>
<p id="contextSource" class="muted"></p><progress id="sourceMeter" max="6000" value="0" aria-label="Source character budget"></progress>
<details><summary>Details</summary><p class="muted">Blue: input. Green: output. Tokenized text only; excludes system overhead.</p><p class="muted">Source cap: 6,000 characters. Each alternative uses a fresh context.</p></details></section>
<section><h2 id="requestHeading">Latest request</h2><p id="result" class="muted">—</p>
<div class="metrics"><div class="metric"><strong id="latency">—</strong><span>ms</span></div><div class="metric"><strong id="input">—</strong><span>input chars</span></div><div class="metric"><strong id="output">—</strong><span>output chars</span></div></div>
<p id="reason" class="muted"></p>
<details><summary>Command / model</summary><pre id="command">—</pre></details>
<details><summary>Prompt</summary><pre id="prompt">—</pre></details></section>
<script nonce="${nonce}">
const api=acquireVsCodeApi();const el=id=>document.getElementById(id);
function renderMeter(m){
const cap=m.contextSize, input=(m.promptTokens||0)+(m.instructionTokens||0), output=m.responseTokens||0;
el('contextCapacity').textContent=cap?cap.toLocaleString()+' tokens':'Capacity unavailable';
el('inputFill').style.width=cap?Math.min(100,input/cap*100)+'%':'0%';el('outputFill').style.width=cap?Math.min(Math.max(0,100-input/cap*100),output/cap*100)+'%':'0%';
const text=m.pending?'Measuring…':m.error||((m.promptTokens!==undefined)?input.toLocaleString()+' in + '+output.toLocaleString()+' out · '+Math.round((input+output)/cap*100)+'%':'No request yet');el('contextUsage').textContent=text;el('contextMeter').setAttribute('aria-label',text);el('contextSource').textContent=(m.contextChars??0).toLocaleString()+' / 6,000 source chars';el('sourceMeter').value=m.contextChars??0;
}
for(const id of ['enabled','automatic','backend','scope']) el(id).addEventListener('change',()=>api.postMessage({action:id,value:el(id).type==='checkbox'?el(id).checked:el(id).value}));
for(const id of ['request','refactor']) el(id).addEventListener('click',()=>api.postMessage({action:id}));
window.addEventListener('message',event=>{const s=event.data;if(s.type!=='state')return;renderMeter(s.meter);el('refactor').disabled=!s.refactor.canCapture;el('requestHeading').textContent=s.refactor.candidates[s.refactor.selected]?'Alternative '+(s.refactor.selected+1):'Latest request';el('enabled').checked=s.enabled;el('automatic').checked=s.automatic;el('backend').value=s.backend;el('scope').value=s.scope;el('phase').textContent=s.phase;el('request').disabled=!s.enabled;const d=s.diagnostics;el('result').textContent=d?(d.status||'Generating…'):'—';el('latency').textContent=d?.durationMs??'—';el('input').textContent=d?.inputChars??'—';el('output').textContent=d?.outputChars??'—';el('reason').textContent=d?.reason||'';el('command').textContent=d?d.model+'\\n\\n'+JSON.stringify(d.argv,null,2):'—';el('prompt').textContent=d?.stdin||'—';});api.postMessage({action:'ready'});
</script></body></html>`;
  }
}

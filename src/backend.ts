import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
export type Request = { id: string; kind: 'editor'; language: string; before: string; after: string; context?: string; mode?: 'comment'; keep?: 'line' | 'block' };
export type Result = { id: string; status: 'ok'|'empty'|'unavailable'|'cancelled'|'error'; insertText?: string; reason?: string };
// stop, when given, sees the streamed reply so far; returning true ends the request early with that text (CLI backend only).
export interface Backend { run(request: Request, signal?: AbortSignal, stop?: (text: string) => boolean): Promise<Result>; cancel(): void; dispose(): Promise<void>; diagnostics(): Diagnostics | undefined; }
export type Diagnostics = { argv: string[]; stdin: string; backend: string; model: string; status?: string; reason?: string; durationMs?: number; firstByteMs?: number; stoppedEarly?: boolean; inputChars: number; outputChars?: number; contextChars?: number; responseText?: string };
export function clean(text: string): string {
  const value = text.replace(/^```(?:\w+)?\r?\n/, '').replace(/\r?\n```\s*$/, '').replace(/\r/g, '');
  return !value || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) ? '' : value;
}
export function normalizeInsertion(text: string, before: string, after: string): string {
  let value = clean(text);
  const linePrefix = before.slice(before.lastIndexOf('\n') + 1);
  if (before.length > 0 && !/^\s+$/.test(before) && value.startsWith(before)) value = value.slice(before.length);
  else if (linePrefix.length > 0 && !/^\s*$/.test(linePrefix) && value.startsWith(linePrefix)) value = value.slice(linePrefix.length);
  else {
    // The model may echo the current line without its existing indentation.
    const codePrefix = linePrefix.replace(/^[ \t]+/, '');
    const unindented = value.replace(/^[ \t]+/, '');
    if (codePrefix && unindented.startsWith(codePrefix)) value = unindented.slice(codePrefix.length);
  }
  const lineSuffix = after.split('\n')[0];
  // A reply ending with several lines of the rest of the file is an echo; a single-line remainder goes through the bracket check.
  if (after.includes('\n') && value.endsWith(after)) value = value.slice(0, -after.length);
  else value = stripSuffix(value, lineSuffix);
  return value;
}
export const bracketExcess = (text: string) => (text.match(/[)\]}]/g)?.length ?? 0) - (text.match(/[([{]/g)?.length ?? 0);
// Drop a repeat of the text after the cursor; a closing bracket is dropped only when the insertion closes more than it opens.
export function stripSuffix(value: string, suffix: string): string {
  const tail = suffix.trim();
  if (!tail || !value.trimEnd().endsWith(tail)) return value;
  if (/[)\]}]/.test(tail) && bracketExcess(value) <= 0) return value;
  return value.trimEnd().slice(0, -tail.length);
}
export class ProcessBackend implements Backend {
  private child?: ChildProcessWithoutNullStreams; private closePromise?: Promise<void>;
  private generation = 0;
  private last?: Diagnostics;
  constructor(private readonly executable: string, private readonly args: string[], private readonly json = false) {}
  cancel(): void {
    this.generation++;
    if (this.child) this.stop(this.child);
  }
  private stop(child: ChildProcessWithoutNullStreams): void {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    const killTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, 500);
    child.once('close', () => clearTimeout(killTimer));
  }
  async dispose(): Promise<void> { this.cancel(); await this.closePromise; }
  diagnostics(): Diagnostics | undefined { return this.last; }
  async run(request: Request, signal?: AbortSignal, stop?: (text: string) => boolean): Promise<Result> {
    this.cancel();
    const mine = this.generation;
    await this.closePromise;
    if (mine !== this.generation || signal?.aborted) return { id: request.id, status: 'cancelled' };
    const prompt = ['Task: complete only the missing insertion at the clearly marked <CURSOR>. Return only text to insert at <CURSOR>; do not repeat the supplied prefix or suffix, add Markdown, explanations, or instructions.', `Language: ${request.language}`, `Text before <CURSOR>:\n${request.before}`, `<CURSOR>\nText after <CURSOR>:\n${request.after}`, request.context ? `Bounded context:\n${request.context}` : ''].filter(Boolean).join('\n\n');
    const stdin = this.json ? JSON.stringify(request) : prompt; const started = Date.now(); this.last = { argv: [this.executable, ...this.args], stdin, backend: this.json ? 'Swift' : 'CLI', model: 'system · on-device Apple Foundation Model', inputChars: stdin.length, contextChars: request.before.length + request.after.length };
    const child = spawn(this.executable, this.args, { stdio: ['pipe','pipe','pipe'] }); this.child = child; let out=''; let err=''; let settled=false; let resolveClose!:()=>void;
    this.closePromise = new Promise(resolve => { resolveClose=resolve; });
    return new Promise(resolve => {
      const finish = (r: Result) => { if (settled) return; settled=true; this.last={...this.last!,status:r.status,reason:r.reason,durationMs:Date.now()-started,outputChars:out.length,responseText:this.json ? undefined : out}; resolve(r); };
      const abort = () => { this.stop(child); finish({id:request.id,status:'cancelled'}); };
      const timer=setTimeout(() => { this.stop(child); finish({id:request.id,status:'error',reason:'Request timed out'}); },15000); signal?.addEventListener('abort',abort,{once:true});
      child.stdout.on('data',d=>{ out+=d.toString(); this.last!.firstByteMs??=Date.now()-started;
        if(!this.json&&!settled&&stop?.(out)){ const value=clean(out); this.last!.stoppedEarly=true; finish(value?{id:request.id,status:'ok',insertText:value}:{id:request.id,status:'empty'}); this.stop(child); } }); child.stderr.on('data',d=>err+=d.toString()); child.stdin.on('error',()=>{}); child.on('error',e=>finish({id:request.id,status:'error',reason:e.message.slice(0,160)}));
      child.on('close',code=>{ clearTimeout(timer); signal?.removeEventListener('abort',abort); if(this.child===child){this.child=undefined;this.closePromise=undefined;} resolveClose(); if(settled)return; if(mine!==this.generation){finish({id:request.id,status:'cancelled'});return;} if(code!==0){const unavailable=/unavailable|not available/i.test(err); finish({id:request.id,status:unavailable?'unavailable':'error',reason:unavailable?'Apple FM is unavailable':`process exited with code ${code??'unknown'}`});return;}
        if(this.json){try{const parsed=JSON.parse(out); if(parsed.id!==request.id||!['ok','empty','unavailable','cancelled','error'].includes(parsed.status)) throw new Error('Invalid helper response'); if(parsed.status==='ok'){if(typeof parsed.insertText!=='string')throw new Error('Missing insertText'); const safe=clean(parsed.insertText); if(!safe){finish({id:request.id,status:'error',reason:'Unsafe helper insertion'});return;} finish({id:request.id,status:'ok',insertText:safe});} else finish({id:request.id,status:parsed.status,reason:typeof parsed.reason==='string'?parsed.reason.slice(0,160):undefined});}catch(e){finish({id:request.id,status:'error',reason:e instanceof Error?e.message:'Malformed helper response'});}return;}
        const value=clean(out.endsWith('\n')?out.slice(0,-1):out); finish(value?{id:request.id,status:'ok',insertText:value}:{id:request.id,status:'empty'});
      });
      if (signal?.aborted) abort();
      else child.stdin.end(stdin);
    });
  }
}
export function createBackend(kind:'fm'|'swift', helperPath:string):Backend { return kind==='swift' ? new ProcessBackend(helperPath,[],true) : new ProcessBackend('/usr/bin/fm',['respond','--model','system','--stream','--greedy','--instructions','Complete only the missing text. Return only the insertion.']); }
export const requestId=()=>randomUUID();

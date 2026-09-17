import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
export type Request = { id: string; kind: 'editor'; language: string; before: string; after: string; context?: string };
export type Result = { id: string; status: 'ok'|'empty'|'unavailable'|'cancelled'|'error'; insertText?: string; reason?: string };
export interface Backend { run(request: Request, signal?: AbortSignal): Promise<Result>; cancel(): void; dispose(): Promise<void>; }
export function clean(text: string): string {
  const value = text.replace(/^```(?:\w+)?\r?\n/, '').replace(/\r?\n```\s*$/, '').replace(/\r/g, '');
  return !value || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) ? '' : value;
}
export class ProcessBackend implements Backend {
  private child?: ChildProcessWithoutNullStreams; private closePromise?: Promise<void>;
  private generation = 0;
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
  async run(request: Request, signal?: AbortSignal): Promise<Result> {
    this.cancel();
    const mine = this.generation;
    await this.closePromise;
    if (mine !== this.generation || signal?.aborted) return { id: request.id, status: 'cancelled' };
    const prompt = ['Complete only the missing code at the cursor. Return only the insertion text; do not repeat the supplied prefix or suffix, add Markdown, explanations, or instructions.', `Language: ${request.language}`, `Text before cursor:\n${request.before}`, `Text after cursor:\n${request.after}`, request.context ? `Context:\n${request.context}` : ''].filter(Boolean).join('\n\n');
    const child = spawn(this.executable, this.args, { stdio: ['pipe','pipe','pipe'] }); this.child = child; let out=''; let err=''; let settled=false; let resolveClose!:()=>void;
    this.closePromise = new Promise(resolve => { resolveClose=resolve; });
    return new Promise(resolve => {
      const finish = (r: Result) => { if (settled) return; settled=true; resolve(r); };
      const abort = () => { this.stop(child); finish({id:request.id,status:'cancelled'}); };
      const timer=setTimeout(() => { this.stop(child); finish({id:request.id,status:'error',reason:'Request timed out'}); },15000); signal?.addEventListener('abort',abort,{once:true});
      child.stdout.on('data',d=>out+=d.toString()); child.stderr.on('data',d=>err+=d.toString()); child.stdin.on('error',()=>{}); child.on('error',e=>finish({id:request.id,status:'error',reason:e.message.slice(0,160)}));
      child.on('close',code=>{ clearTimeout(timer); signal?.removeEventListener('abort',abort); if(this.child===child){this.child=undefined;this.closePromise=undefined;} resolveClose(); if(settled)return; if(mine!==this.generation){finish({id:request.id,status:'cancelled'});return;} if(code!==0){const unavailable=/unavailable|not available/i.test(err); finish({id:request.id,status:unavailable?'unavailable':'error',reason:unavailable?'Apple FM is unavailable':`process exited with code ${code??'unknown'}`});return;}
        if(this.json){try{const parsed=JSON.parse(out); if(parsed.id!==request.id||!['ok','empty','unavailable','cancelled','error'].includes(parsed.status)) throw new Error('Invalid helper response'); if(parsed.status==='ok'){if(typeof parsed.insertText!=='string')throw new Error('Missing insertText'); const safe=clean(parsed.insertText); if(!safe){finish({id:request.id,status:'error',reason:'Unsafe helper insertion'});return;} finish({id:request.id,status:'ok',insertText:safe});} else finish({id:request.id,status:parsed.status,reason:typeof parsed.reason==='string'?parsed.reason.slice(0,160):undefined});}catch(e){finish({id:request.id,status:'error',reason:e instanceof Error?e.message:'Malformed helper response'});}return;}
        const value=clean(out.endsWith('\n')?out.slice(0,-1):out); finish(value?{id:request.id,status:'ok',insertText:value}:{id:request.id,status:'empty'});
      });
      if (signal?.aborted) abort();
      else child.stdin.end(this.json?JSON.stringify(request):prompt);
    });
  }
}
export function createBackend(kind:'fm'|'swift', helperPath:string):Backend { return kind==='swift' ? new ProcessBackend(helperPath,[],true) : new ProcessBackend('/usr/bin/fm',['respond','--model','system','--no-stream','--greedy','--instructions','Complete only the missing text. Return only the insertion.']); }
export const requestId=()=>randomUUID();

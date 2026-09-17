import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export type Request = { id: string; kind: 'editor'; language: string; before: string; after: string; context?: string };
export type Result = { id: string; status: 'ok' | 'empty' | 'unavailable' | 'cancelled' | 'error'; insertText?: string; reason?: string };

export interface Backend { run(request: Request, signal?: AbortSignal): Promise<Result>; }

function clean(text: string): string {
  const value = text.replace(/^```(?:\w+)?\r?\n/, '').replace(/\r?\n```\s*$/, '').replace(/\r/g, '');
  if (!value || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return '';
  return value;
}

export class ProcessBackend implements Backend {
  private child?: ChildProcessWithoutNullStreams;
  constructor(private readonly executable: string, private readonly args: string[]) {}

  run(request: Request, signal?: AbortSignal): Promise<Result> {
    this.child?.kill('SIGTERM');
    if (signal?.aborted) return Promise.resolve({ id: request.id, status: 'cancelled' });
    if (signal?.aborted) return Promise.resolve({ id: request.id, status: 'cancelled' });
    const prompt = [
      'Complete only the missing code at the cursor. Return only the insertion text; do not repeat the supplied prefix or suffix, add Markdown, explanations, or instructions.',
      `Language: ${request.language}`, `Text before cursor:\n${request.before}`, `Text after cursor:\n${request.after}`,
      request.context ? `Context:\n${request.context}` : ''
    ].filter(Boolean).join('\n\n');
    return new Promise(resolve => {
      const child = spawn(this.executable, this.args, { stdio: ['pipe', 'pipe', 'pipe'] });
      this.child = child;
      let output = ''; let error = ''; let settled = false;
      const finish = (result: Result) => { if (settled) return; settled = true; if (this.child === child) this.child = undefined; resolve(result); };
      const abort = () => { child.kill('SIGTERM'); finish({ id: request.id, status: 'cancelled' }); };
      const timer = setTimeout(() => { child.kill('SIGTERM'); finish({ id: request.id, status: 'error', reason: 'Request timed out' }); }, 15000);
      signal?.addEventListener('abort', abort, { once: true });
      child.stdout.on('data', data => { output += data.toString(); });
      child.stderr.on('data', data => { error += data.toString(); });
      child.stdin.on('error', () => { /* close is reported by the child */ });
      child.on('error', err => finish({ id: request.id, status: 'error', reason: err.message.slice(0, 160) }));
      child.on('close', code => {
        signal?.removeEventListener('abort', abort);
        clearTimeout(timer); if (settled) return;
        if (code !== 0) {
          const reason = /unavailable|not available/i.test(error) ? 'Apple FM is unavailable' : `fm exited with code ${code ?? 'unknown'}`;
          finish({ id: request.id, status: /unavailable/i.test(reason) ? 'unavailable' : 'error', reason }); return;
        }
        const insertText = clean(output.trim());
        finish(insertText ? { id: request.id, status: 'ok', insertText } : { id: request.id, status: 'empty' });
      });
      child.stdin.end(prompt);
    });
  }
}

export class SwiftBackend implements Backend {
  private child?: ChildProcessWithoutNullStreams;
  constructor(private readonly executable: string) {}
  run(request: Request, signal?: AbortSignal): Promise<Result> {
    this.child?.kill('SIGTERM');
    return new Promise(resolve => {
      const child = spawn(this.executable, [], { stdio: ['pipe', 'pipe', 'pipe'] }); this.child = child;
      let output = ''; let settled = false;
      const finish = (result: Result) => { if (settled) return; settled = true; if (this.child === child) this.child = undefined; resolve(result); };
      const abort = () => { child.kill('SIGTERM'); finish({ id: request.id, status: 'cancelled' }); };
      const timer = setTimeout(() => { child.kill('SIGTERM'); finish({ id: request.id, status: 'error', reason: 'Request timed out' }); }, 15000);
      signal?.addEventListener('abort', abort, { once: true }); child.stdout.on('data', d => output += d.toString()); child.stdin.on('error', () => { /* close is reported by the child */ });
      child.on('error', e => finish({ id: request.id, status: 'error', reason: e.message.slice(0, 160) }));
      child.on('close', code => { clearTimeout(timer); signal?.removeEventListener('abort', abort); if (settled) return; if (code !== 0) { finish({ id: request.id, status: 'error', reason: `Swift helper exited with code ${code ?? 'unknown'}` }); return; }
        try { const result = JSON.parse(output) as Result; const cleaned = result.insertText ? clean(result.insertText) : ''; finish(result.id !== request.id ? { id: request.id, status: 'error', reason: 'Mismatched helper response' } : result.status === 'ok' && cleaned ? { ...result, insertText: cleaned } : result); }
        catch { finish({ id: request.id, status: 'error', reason: 'Malformed helper response' }); }
      });
      child.stdin.end(JSON.stringify(request));
    });
  }
}

export function createBackend(kind: 'fm' | 'swift', helperPath: string): Backend {
  return kind === 'swift'
    ? new SwiftBackend(helperPath)
    : new ProcessBackend('/usr/bin/fm', ['respond', '--model', 'system', '--no-stream', '--greedy', '--instructions', 'Complete only the missing text. Return only the insertion.']);
}

export const requestId = () => randomUUID();

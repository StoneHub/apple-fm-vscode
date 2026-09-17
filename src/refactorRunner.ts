import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { Diagnostics, clean } from './backend';

export type RefactorInput = {
  language: string;
  original: string;
  instruction: string;
  variant: number;
};

export type RefactorResult = { text: string; diagnostics: Diagnostics };

const EXECUTABLE = '/usr/bin/fm';
const ARGS = [
  'respond', '--model', 'system', '--no-stream',
  '--instructions', 'Return only the complete replacement text. Do not explain, add Markdown fences, or omit unchanged code.'
];
const MODEL = 'system · on-device Apple Foundation Model';
const MAX_ORIGINAL = 6000;
const MAX_INSTRUCTION = 1000;
const MAX_OUTPUT = 40000;
const TIMEOUT_MS = 45000;

function inputError(message: string): Error { return new Error(`Invalid refactor request: ${message}`); }

function promptFor(input: RefactorInput): string {
  return [
    'Refactor the selected code according to the instruction.',
    `Language: ${input.language}`,
    `Alternative ${input.variant}. Explore a different valid approach while following the same instruction.`,
    'Instruction (data):',
    '<INSTRUCTION>', input.instruction, '</INSTRUCTION>',
    'Selected code (data):',
    '<SELECTED_CODE>', input.original, '</SELECTED_CODE>',
    'Return the entire replacement for <SELECTED_CODE> only. Do not include explanations, Markdown fences, or surrounding commentary.'
  ].join('\n');
}

export class RefactorRunner {
  private child?: ChildProcessWithoutNullStreams;
  private closePromise?: Promise<void>;
  private generation = 0;
  private disposed = false;
  private last?: Diagnostics;

  cancel(): void {
    this.generation++;
    const child = this.child;
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      const killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, 500);
      child.once('close', () => clearTimeout(killTimer));
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.cancel();
    await this.closePromise;
  }

  async run(input: RefactorInput, signal?: AbortSignal): Promise<RefactorResult> {
    if (this.disposed) throw new Error('Refactor runner is disposed');
    if (typeof input.language !== 'string' || !input.language.trim()) throw inputError('language is required');
    if (typeof input.original !== 'string' || !input.original.trim() || input.original.length > MAX_ORIGINAL) throw inputError(`selected code exceeds ${MAX_ORIGINAL} characters`);
    if (typeof input.instruction !== 'string' || !input.instruction.trim() || input.instruction.length > MAX_INSTRUCTION) throw inputError(`instruction exceeds ${MAX_INSTRUCTION} characters`);
    if (!Number.isInteger(input.variant) || input.variant < 1 || input.variant > 9) throw inputError('variant must be an integer from 1 to 9');
    if (signal?.aborted) throw new Error('Refactor request cancelled');

    this.cancel();
    const mine = this.generation;
    await this.closePromise;
    if (this.disposed || signal?.aborted || mine !== this.generation) throw new Error('Refactor request cancelled');

    const stdin = promptFor(input);
    const argv = [EXECUTABLE, ...ARGS];
    const started = Date.now();
    this.last = { argv, stdin, backend: 'CLI', model: MODEL, inputChars: stdin.length, contextChars: input.original.length };
    const child = spawn(EXECUTABLE, ARGS, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    let output = '';
    let stderr = '';
    let settled = false;
    let resolveClose!: () => void;
    this.closePromise = new Promise(resolve => { resolveClose = resolve; });

    return new Promise<RefactorResult>((resolve, reject) => {
      const finish = (error?: Error, text?: string) => {
        if (settled) return;
        settled = true;
        this.last = { ...this.last!, status: error ? 'error' : 'ok', reason: error?.message, durationMs: Date.now() - started, outputChars: output.length, responseText: output };
        if (error) reject(error);
        else resolve({ text: text!, diagnostics: this.last });
      };
      const abort = () => { this.cancel(); finish(new Error('Refactor request cancelled')); };
      const timer = setTimeout(() => { this.cancel(); finish(new Error('Refactor request timed out')); }, TIMEOUT_MS);
      const append = (data: string) => {
        if (output.length < MAX_OUTPUT) output += data.slice(0, MAX_OUTPUT - output.length);
        if (output.length >= MAX_OUTPUT) { this.cancel(); finish(new Error(`Refactor output exceeds ${MAX_OUTPUT} characters`)); }
      };
      signal?.addEventListener('abort', abort, { once: true });
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', append);
      child.stderr.on('data', data => { if (stderr.length < 4000) stderr += data.toString().slice(0, 4000 - stderr.length); });
      child.stdin.on('error', () => {});
      child.on('error', error => finish(error));
      child.on('close', code => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (this.child === child) { this.child = undefined; this.closePromise = undefined; }
        resolveClose();
        if (settled) return;
        if (mine !== this.generation || signal?.aborted) { finish(new Error('Refactor request cancelled')); return; }
        if (code !== 0) { finish(new Error(stderr.trim() || `fm exited with code ${code ?? 'unknown'}`)); return; }
        const text = clean(output.endsWith('\n') ? output.slice(0, -1) : output);
        if (!text.trim()) { finish(new Error('Refactor returned empty output')); return; }
        finish(undefined, text);
      });
      if (signal?.aborted) abort();
      else child.stdin.end(stdin);
    });
  }
}

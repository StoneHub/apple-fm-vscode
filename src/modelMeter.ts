import { execFile, ChildProcess } from 'node:child_process';
import { Diagnostics } from './backend';

export type MeterState = { contextSize?: number; promptTokens?: number; instructionTokens?: number; responseTokens?: number; error?: string; pending?: boolean; contextChars?: number };

export class ModelMeter {
  private child?: ChildProcess;
  private key = '';
  private revision = 0;
  state: MeterState = {};
  constructor(private readonly helper: string, private readonly changed: () => void) { this.observe(); }
  observe(d?: Diagnostics): void {
    const key = d ? JSON.stringify([d.argv, d.stdin, d.responseText]) : 'capability';
    if (this.key === key) return;
    this.key = key;
    this.child?.kill();
    const revision = ++this.revision;
    this.state = { contextSize: this.state.contextSize, contextChars: d?.contextChars, pending: true };
    const instructionIndex = d?.argv.indexOf('--instructions') ?? -1;
    const request = d && d.backend === 'CLI' ? { prompt: d.stdin, instructions: instructionIndex >= 0 ? d.argv[instructionIndex + 1] : '', response: d.responseText } : {};
    this.child = execFile(this.helper, [], { timeout: 8000, maxBuffer: 16000 }, (error, stdout) => {
      if (revision !== this.revision) return;
      this.child = undefined;
      try {
        if (error) throw error;
        const result = JSON.parse(stdout);
        this.state = { ...result, contextChars: d?.contextChars, error: result.error || (d && d.backend !== 'CLI' ? 'Token counts are unavailable for this Swift helper request.' : undefined) };
      } catch { this.state = { contextSize: this.state.contextSize, contextChars: d?.contextChars, error: 'Token measurement unavailable.' }; }
      this.changed();
    });
    this.child.stdin?.on('error', () => {});
    this.child.stdin?.end(JSON.stringify(request));
  }
  dispose(): void { this.revision++; this.child?.kill(); }
}

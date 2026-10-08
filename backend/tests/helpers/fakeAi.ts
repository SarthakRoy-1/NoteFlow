import type { AIProvider, StructuredRequest } from '../../src/ai/provider/index.js';

type Step = string | Error | ((req: StructuredRequest) => string | Promise<string>);

/** Test double for the AI provider: scripted replies, records every request, never touches the network. */
export class FakeAI implements AIProvider {
  requests: StructuredRequest[] = [];
  private queue: Step[] = [];
  /** Reply used when the script is empty: "nothing actionable". */
  fallback = reply();

  respondWith(...steps: Step[]) {
    this.queue.push(...steps);
    return this;
  }

  async generateStructured(req: StructuredRequest): Promise<string> {
    this.requests.push(req);
    const step = this.queue.shift() ?? this.fallback;
    if (step instanceof Error) throw step;
    return typeof step === 'function' ? step(req) : step;
  }
}

export interface FakeItem {
  kind: 'todo' | 'reminder';
  text: string;
  person: string | null;
  evidence: string;
  due_kind: 'none' | 'date' | 'datetime' | 'relative';
  due_expression: string | null;
  due_local: string | null;
  due_relative_minutes: number | null;
  [extra: string]: unknown;
}

export const item = (partial: Partial<FakeItem> = {}): FakeItem => ({
  kind: 'todo',
  text: 'Buy milk',
  person: null,
  evidence: 'buy milk',
  due_kind: 'none',
  due_expression: null,
  due_local: null,
  due_relative_minutes: 0,
  ...partial,
});

export const reply = (...items: FakeItem[]) => JSON.stringify({ items });

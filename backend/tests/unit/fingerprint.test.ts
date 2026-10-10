import { describe, expect, it } from 'vitest';
import type { ExtractedItem } from '../../src/ai/extraction/validate.js';
import { fingerprintItems } from '../../src/reconcile/fingerprint.js';

const make = (partial: Partial<ExtractedItem> = {}): ExtractedItem => ({
  kind: 'todo',
  text: 'Buy milk',
  person: null,
  evidence: 'buy milk',
  dueAt: null,
  dueHasTime: false,
  recurrenceDays: null,
  recurrenceTime: null,
  ...partial,
});

const fp = (i: ExtractedItem) => fingerprintItems([i])[0]?.fingerprint;

describe('fingerprintItems', () => {
  it('is stable across runs and ignores case, punctuation and spacing', () => {
    expect(fp(make({ text: 'Buy milk' }))).toBe(fp(make({ text: '  buy   MILK! ' })));
  });

  it('does not depend on the due date (so a changed date updates, not duplicates)', () => {
    expect(fp(make({ dueAt: new Date('2026-10-09T00:00:00Z') }))).toBe(
      fp(make({ dueAt: new Date('2026-10-16T00:00:00Z'), dueHasTime: true })),
    );
  });

  it('distinguishes kind, text and person', () => {
    const base = fp(make());
    expect(fp(make({ kind: 'reminder' }))).not.toBe(base);
    expect(fp(make({ text: 'Buy bread' }))).not.toBe(base);
    expect(fp(make({ kind: 'reminder', person: 'John' }))).not.toBe(fp(make({ kind: 'reminder' })));
  });

  it('keeps two identical actions in one note distinct, deterministically', () => {
    const a = fingerprintItems([make(), make()]);
    const b = fingerprintItems([make(), make()]);
    expect(a[0]?.fingerprint).not.toBe(a[1]?.fingerprint);
    expect(a.map((x) => x.fingerprint)).toEqual(b.map((x) => x.fingerprint));
  });

  it('handles non-latin text', () => {
    expect(fp(make({ text: 'दूध खरीदें' }))).toBe(fp(make({ text: ' दूध  खरीदें! ' })));
  });
});

import { describe, expect, it } from 'vitest';
import {
  actionSimilarity,
  contentTokens,
  isSameAction,
  matchRewordings,
} from '../../src/reconcile/similarity.js';

const a = (text: string, person: string | null = null) => ({ text, person });

describe('isSameAction: rewordings are recognised', () => {
  it.each([
    ['Send the invoice', 'Send invoice'],
    ['Send the QA invoice to John', 'Send QA invoice to John'],
    ['Buy milk', 'Buy some milk'],
    ['Call the bank', 'Call bank'],
    ['Send invoices', 'Send invoice'],
    ['Remember to send the report', 'Send report'],
    ['  BUY   MILK!! ', 'buy milk'],
  ])('%j == %j', (x, y) => {
    expect(isSameAction(a(x), a(y))).toBe(true);
  });
});

describe('isSameAction: genuinely different tasks are never merged', () => {
  it.each([
    ['Buy milk', 'Buy eggs'],
    ['Call John', 'Call Jane'],
    ['Email Sarah the report', 'Email Sarah the budget'],
    ['Send Q3 report to client A', 'Send Q3 report to client B'],
    ['Buy 2 apples', 'Buy 3 apples'],
    ['Pay rent', 'Pay electricity bill'],
    ['Book flight to Berlin', 'Book hotel in Berlin'],
    ['Water the plants', 'Feed the cat'],
  ])('%j != %j', (x, y) => {
    expect(isSameAction(a(x), a(y))).toBe(false);
  });

  it('never merges across different people, even with identical text', () => {
    expect(isSameAction(a('Send the invoice', 'John'), a('Send the invoice', 'Mary'))).toBe(false);
    expect(isSameAction(a('Send the invoice', 'John'), a('Send the invoice', null))).toBe(false);
    expect(isSameAction(a('Send the invoice', 'John'), a('send the invoice', ' john '))).toBe(true);
  });

  it('treats texts with no content words as unrelated', () => {
    expect(actionSimilarity(a('the to for'), a('the to for'))).toBe(0);
    expect(actionSimilarity(a(''), a('Buy milk'))).toBe(0);
  });
});

describe('contentTokens', () => {
  it('drops filler words and plural s, keeps single letters and digits', () => {
    expect([...contentTokens('Send the invoices to client A for 2 weeks')].sort()).toEqual(
      ['2', 'a', 'client', 'invoice', 'send', 'week'].sort(),
    );
  });
});

describe('matchRewordings', () => {
  const protectedItem = (fingerprint: string, text: string, person: string | null = null) => ({
    fingerprint,
    text,
    person,
  });

  it('folds a reworded item into the protected one it rewords', () => {
    const r = matchRewordings(
      [protectedItem('new-1', 'Send invoice')],
      [protectedItem('old-1', 'Send the invoice')],
      [],
    );
    expect(r.mergedInto.get('new-1')).toBe('old-1');
    expect(r.dismissed.size).toBe(0);
  });

  it('lets one protected item absorb only one incoming item', () => {
    const r = matchRewordings(
      [protectedItem('new-a', 'Send the invoice'), protectedItem('new-b', 'Send invoice')],
      [protectedItem('old-1', 'Send the invoice')],
      [],
    );
    expect([...r.mergedInto.values()]).toEqual(['old-1']);
    expect(r.mergedInto.size).toBe(1);
  });

  it('does not depend on the order of the incoming items', () => {
    const existing = [protectedItem('old-1', 'Send the QA invoice to John')];
    const close = protectedItem('close', 'Send QA invoice to John');
    const far = protectedItem('far', 'Send the invoice to John'); // 4/5 shared: also similar
    const one = matchRewordings([close, far], existing, []);
    const two = matchRewordings([far, close], existing, []);
    expect(one.mergedInto.get('close')).toBe('old-1');
    expect(two.mergedInto.get('close')).toBe('old-1');
  });

  it('suppresses a reworded copy of something the user deleted, but not a different task', () => {
    const tombstones = [a('Send the invoice')];
    const r = matchRewordings(
      [protectedItem('reworded', 'Send invoice'), protectedItem('different', 'Pay the invoice')],
      [],
      tombstones,
    );
    expect(r.dismissed.has('reworded')).toBe(true);
    expect(r.dismissed.has('different')).toBe(false);
  });
});

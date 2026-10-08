import { createHash } from 'node:crypto';
import type { ExtractedItem } from '../ai/extraction/validate.js';

export interface FingerprintedItem extends ExtractedItem {
  fingerprint: string;
}

/** Lowercase, drop punctuation, collapse whitespace: "Buy milk!" and "buy  milk" are the same action. */
export function normalizeIdentityText(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Identity of a derived action within one note: kind + normalized text + person.
 * The due date is deliberately NOT part of the identity, so changing "tomorrow" to "Friday" in the
 * note updates the existing item instead of creating a duplicate. If the same action legitimately
 * appears twice in one note, an occurrence index keeps the two fingerprints distinct.
 */
export function fingerprintItems(items: ExtractedItem[]): FingerprintedItem[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const identity = [
      item.kind,
      normalizeIdentityText(item.text),
      normalizeIdentityText(item.person ?? ''),
    ].join('|');
    const occurrence = seen.get(identity) ?? 0;
    seen.set(identity, occurrence + 1);
    const fingerprint = createHash('sha256').update(`${identity}#${occurrence}`).digest('hex');
    return { ...item, fingerprint };
  });
}

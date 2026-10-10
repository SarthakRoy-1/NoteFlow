import { normalizeIdentityText } from './fingerprint.js';

/**
 * Re-analysing a note can make the model reword the same action ("Send the invoice" -> "Send
 * invoice"). Exact fingerprints then differ even though nothing changed for the user. This module
 * decides whether two action texts are the same action, deliberately strictly: a missed match only
 * leaves one extra item the user can delete, but a wrong match would hide a real task.
 */

/** Words that carry no identity. Single letters and digits are NOT here ("client A" vs "client B"). */
const STOPWORDS = new Set([
  'the',
  'to',
  'for',
  'of',
  'on',
  'in',
  'at',
  'by',
  'and',
  'or',
  'my',
  'your',
  'our',
  'their',
  'his',
  'her',
  'its',
  'an',
  'some',
  'this',
  'that',
  'please',
  'with',
  'about',
  'me',
  'us',
  'it',
  'need',
  'needs',
  'remember',
  'remind',
  'must',
  'should',
]);

/** Fraction of shared content words (Jaccard) at which two texts are the same action. */
export const SAME_ACTION_THRESHOLD = 0.75;

/** Plural/third-person "s" only; anything cleverer would start merging different words. */
const stem = (token: string) =>
  token.length > 3 && token.endsWith('s') && !token.endsWith('ss') ? token.slice(0, -1) : token;

export function contentTokens(text: string): Set<string> {
  const tokens = normalizeIdentityText(text)
    .split(' ')
    .filter(Boolean)
    .map(stem)
    .filter((t) => !STOPWORDS.has(t));
  return new Set(tokens);
}

export interface ActionLike {
  text: string;
  person: string | null;
}

/** 0 when the people differ or either text has no content words; otherwise the Jaccard score. */
export function actionSimilarity(a: ActionLike, b: ActionLike): number {
  if (normalizeIdentityText(a.person ?? '') !== normalizeIdentityText(b.person ?? '')) return 0;
  const ta = contentTokens(a.text);
  const tb = contentTokens(b.text);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

export const isSameAction = (a: ActionLike, b: ActionLike): boolean =>
  actionSimilarity(a, b) >= SAME_ACTION_THRESHOLD;

export interface RewordingResult {
  /** incoming fingerprint -> fingerprint of the protected existing item it is a rewording of. */
  mergedInto: Map<string, string>;
  /** incoming fingerprints that reword something the user already deleted. */
  dismissed: Set<string>;
}

/**
 * Pair incoming items that have no exact match with items that already exist but are protected
 * from replacement (edited or completed by the user), or that the user deleted. Each protected
 * item is claimed by at most one incoming item, best score first, so two genuinely different
 * incoming actions can never both be folded into one existing item.
 */
export function matchRewordings(
  incoming: (ActionLike & { fingerprint: string })[],
  protectedExisting: (ActionLike & { fingerprint: string })[],
  tombstones: ActionLike[],
): RewordingResult {
  const mergedInto = new Map<string, string>();
  const dismissed = new Set<string>();
  const claimed = new Set<string>();

  // Score every pair once, then assign best-first so the result does not depend on list order.
  const pairs: { incoming: string; existing: string; score: number; order: number }[] = [];
  incoming.forEach((item, order) => {
    for (const existing of protectedExisting) {
      const score = actionSimilarity(item, existing);
      if (score >= SAME_ACTION_THRESHOLD) {
        pairs.push({ incoming: item.fingerprint, existing: existing.fingerprint, score, order });
      }
    }
  });
  pairs.sort((a, b) => b.score - a.score || a.order - b.order);
  for (const pair of pairs) {
    if (mergedInto.has(pair.incoming) || claimed.has(pair.existing)) continue;
    mergedInto.set(pair.incoming, pair.existing);
    claimed.add(pair.existing);
  }

  for (const item of incoming) {
    if (mergedInto.has(item.fingerprint)) continue;
    if (tombstones.some((t) => isSameAction(item, t))) dismissed.add(item.fingerprint);
  }
  return { mergedInto, dismissed };
}

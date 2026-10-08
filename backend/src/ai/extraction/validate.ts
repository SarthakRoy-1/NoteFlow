import { anchorDateOnly, resolveDue } from './dates.js';
import type { RawExtraction, RawItem } from './schema.js';

export const MAX_ITEMS = 20;
export const MAX_TEXT = 200;
export const MAX_PERSON = 80;

/** A validated, normalized item that is safe to hand to reconciliation. */
export interface ExtractedItem {
  kind: 'todo' | 'reminder';
  text: string;
  person: string | null;
  evidence: string;
  dueAt: Date | null;
  dueHasTime: boolean;
}

export interface ValidationResult {
  items: ExtractedItem[];
  /** How many model items were discarded by business rules (for diagnostics only). */
  dropped: number;
}

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Lowercase, collapse whitespace, unify curly quotes/dashes so harmless model reformatting still matches. */
export function normalizeForMatch(s: string): string {
  return collapse(
    s
      .normalize('NFKC')
      .replace(/[‘’‛]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, '-')
      .toLowerCase(),
  );
}

/**
 * Business-rule validation + normalization of schema-valid model output.
 * Items that cannot be grounded in the note are dropped; weak date claims are downgraded or removed.
 */
export function validateExtraction(
  raw: RawExtraction,
  ctx: { title: string; content: string; timezone: string; now: Date },
): ValidationResult {
  const haystack = normalizeForMatch(`${ctx.title}\n${ctx.content}`);
  const groundedIn = (text: string) => {
    const needle = normalizeForMatch(text);
    return needle.length > 0 && haystack.includes(needle);
  };

  const items: ExtractedItem[] = [];
  let dropped = 0;

  for (const rawItem of raw.items) {
    const item = validateOne(rawItem, groundedIn, ctx);
    if (!item) {
      dropped++;
    } else if (items.length < MAX_ITEMS) {
      items.push(item);
    } else {
      dropped++;
    }
  }
  return { items, dropped };
}

function validateOne(
  raw: RawItem,
  groundedIn: (text: string) => boolean,
  ctx: { timezone: string; now: Date },
): ExtractedItem | null {
  const text = collapse(raw.text);
  if (!text || text.length > MAX_TEXT) return null;

  // An item must be supported by words that are really in the note.
  const evidence = collapse(raw.evidence);
  if (!evidence || !groundedIn(evidence)) return null;

  let person: string | null = null;
  if (raw.kind === 'reminder' && raw.person) {
    const candidate = collapse(raw.person);
    if (candidate && candidate.length <= MAX_PERSON && groundedIn(candidate)) person = candidate;
  }

  const due = resolveDue(raw, { now: ctx.now, timezone: ctx.timezone, groundedIn });
  let dueAt = due.dueAt;
  if (dueAt && !due.dueHasTime && raw.kind === 'todo') {
    dueAt = anchorDateOnly(dueAt, ctx.timezone, 'end');
  }

  return {
    kind: raw.kind,
    text,
    person,
    evidence,
    dueAt,
    dueHasTime: dueAt ? due.dueHasTime : false,
  };
}

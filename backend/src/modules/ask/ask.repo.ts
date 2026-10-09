import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { askHistory, askHistorySources, notes } from '../../db/schema.js';

/** Limits on what is sent to the AI: never the whole database, never an unbounded note. */
export const MAX_CONTEXT_NOTES = 5;
export const MAX_NOTE_CHARS = 4000;
export const MAX_QUERY_TERMS = 12;
export const HISTORY_LIMIT = 50;

export interface RetrievedNote {
  id: string;
  title: string;
  /** Possibly shortened to MAX_NOTE_CHARS. */
  content: string;
}

export interface AskSourceDto {
  /** null once the note has been deleted; the title is then the saved snapshot. */
  noteId: string | null;
  title: string;
}

export interface AskDto {
  id: string;
  question: string;
  answer: string;
  status: 'answered' | 'no_info' | 'failed';
  createdAt: string;
  sources: AskSourceDto[];
}

/**
 * Distinct lowercase words of the question. Only letters/digits survive, so nothing here can carry
 * query syntax; each term is also passed to Postgres as a bound parameter.
 */
export function extractTerms(question: string): string[] {
  const words = question.toLowerCase().split(/[^\p{L}\p{N}]+/u);
  const terms: string[] = [];
  for (const w of words) {
    if (w.length >= 2 && w.length <= 40 && !terms.includes(w)) terms.push(w);
    if (terms.length === MAX_QUERY_TERMS) break;
  }
  return terms;
}

/**
 * The user's most relevant notes for a question, via the existing full-text index on
 * to_tsvector('english', title || ' ' || content). Terms are OR-ed (a note matching more of them
 * ranks higher; normalization 1 divides by the log of the note length so long notes do not win
 * just by being long) because a natural-language question rarely appears in a note word for word.
 * Order is deterministic: rank, then most recently edited, then id. Always scoped to `userId`.
 */
export async function retrieveNotes(
  db: Db,
  userId: string,
  question: string,
  limit = MAX_CONTEXT_NOTES,
): Promise<RetrievedNote[]> {
  const terms = extractTerms(question);
  if (terms.length === 0) return [];

  const query = sql.join(
    terms.map((t) => sql`plainto_tsquery('english', ${t}::text)`),
    sql` || `,
  );
  const vector = sql`to_tsvector('english', ${notes.title} || ' ' || ${notes.content})`;
  const rank = sql<number>`ts_rank_cd(${vector}, ${query}, 1)`;

  const rows = await db
    .select({ id: notes.id, title: notes.title, content: notes.content })
    .from(notes)
    .where(and(eq(notes.userId, userId), sql`${vector} @@ (${query})`))
    .orderBy(desc(rank), desc(notes.updatedAt), asc(notes.id))
    .limit(limit);

  return rows.map((r) => ({
    ...r,
    content:
      r.content.length > MAX_NOTE_CHARS ? `${r.content.slice(0, MAX_NOTE_CHARS)}…` : r.content,
  }));
}

export interface NewAsk {
  question: string;
  answer: string;
  status: 'answered' | 'no_info';
  /** The notes the backend retrieved, in rank order. Never taken from the model or the client. */
  sources: { id: string; title: string }[];
  createdAt: Date;
}

/**
 * One transaction: the entry and its sources are saved together or not at all. The AI call between
 * retrieval and saving can take seconds, so a source note may have been deleted meanwhile: only
 * notes that still exist (and belong to this user) are saved as sources.
 */
export async function saveAsk(db: Db, userId: string, input: NewAsk): Promise<AskDto> {
  return db.transaction(async (tx) => {
    const [ask] = await tx
      .insert(askHistory)
      .values({
        userId,
        question: input.question,
        answer: input.answer,
        status: input.status,
        createdAt: input.createdAt,
      })
      .returning();
    if (!ask) throw new Error('failed to save ask history');

    const alive = new Set(
      input.sources.length === 0
        ? []
        : (
            await tx
              .select({ id: notes.id })
              .from(notes)
              .where(
                and(
                  eq(notes.userId, userId),
                  inArray(
                    notes.id,
                    input.sources.map((s) => s.id),
                  ),
                ),
              )
          ).map((n) => n.id),
    );
    const sources = input.sources.filter((s) => alive.has(s.id));

    if (sources.length > 0) {
      await tx.insert(askHistorySources).values(
        sources.map((s, rank) => ({
          askId: ask.id,
          noteId: s.id,
          noteTitleSnapshot: s.title,
          rank,
        })),
      );
    }
    return {
      id: ask.id,
      question: ask.question,
      answer: ask.answer,
      status: ask.status,
      createdAt: ask.createdAt.toISOString(),
      sources: sources.map((s) => ({ noteId: s.id, title: s.title })),
    };
  });
}

type AskRow = typeof askHistory.$inferSelect;

async function withSources(db: Db, userId: string, rows: AskRow[]): Promise<AskDto[]> {
  if (rows.length === 0) return [];
  const sourceRows = await db
    .select({
      askId: askHistorySources.askId,
      rank: askHistorySources.rank,
      noteId: notes.id,
      liveTitle: notes.title,
      snapshot: askHistorySources.noteTitleSnapshot,
    })
    .from(askHistorySources)
    // Ownership-scoped join: a note id is only resolved for the note's own owner.
    .leftJoin(notes, and(eq(notes.id, askHistorySources.noteId), eq(notes.userId, userId)))
    .where(
      inArray(
        askHistorySources.askId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(askHistorySources.rank));

  return rows.map((r) => ({
    id: r.id,
    question: r.question,
    answer: r.answer,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    sources: sourceRows
      .filter((s) => s.askId === r.id)
      .map((s) => ({ noteId: s.noteId, title: s.liveTitle ?? s.snapshot })),
  }));
}

/** Newest first, bounded. Only the caller's own entries. */
export async function listHistory(db: Db, userId: string): Promise<AskDto[]> {
  const rows = await db
    .select()
    .from(askHistory)
    .where(eq(askHistory.userId, userId))
    .orderBy(desc(askHistory.createdAt), desc(askHistory.id))
    .limit(HISTORY_LIMIT);
  return withSources(db, userId, rows);
}

export async function getHistory(db: Db, userId: string, id: string): Promise<AskDto | null> {
  const [row] = await db
    .select()
    .from(askHistory)
    .where(and(eq(askHistory.id, id), eq(askHistory.userId, userId)));
  if (!row) return null;
  return (await withSources(db, userId, [row]))[0] ?? null;
}

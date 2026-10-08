import { and, eq } from 'drizzle-orm';
import { extractIntents, toExtractionError } from '../../ai/extraction/extractor.js';
import type { AIProvider } from '../../ai/provider/index.js';
import type { Db } from '../../db/client.js';
import { notes } from '../../db/schema.js';
import { logger } from '../../lib/logger.js';
import { reconcileNote } from '../../reconcile/reconcile.js';

export interface AnalysisDeps {
  db: Db;
  ai: AIProvider;
  now: () => Date;
}

export interface AnalysisOwner {
  id: string;
  timezone: string;
}

export type AnalysisOutcome = 'ok' | 'failed' | 'superseded' | 'missing';

/**
 * Analyse one note for its owner and store the validated result. Never throws: every failure is
 * recorded on the note as a user-safe message, and the note itself is never touched.
 *
 * The caller passes the *authenticated* user; the note is looked up with that user's id, and the
 * model output (which contains no ids) can only ever create rows for that same (user, note).
 */
export async function analyzeNote(
  deps: AnalysisDeps,
  owner: AnalysisOwner,
  noteId: string,
): Promise<AnalysisOutcome> {
  const { db } = deps;
  let snapshot: { title: string; content: string; updatedAt: Date } | undefined;
  try {
    const [note] = await db
      .select({ title: notes.title, content: notes.content, updatedAt: notes.updatedAt })
      .from(notes)
      .where(and(eq(notes.id, noteId), eq(notes.userId, owner.id)))
      .limit(1);
    if (!note) return 'missing';
    snapshot = note;

    const items = await extractIntents({
      provider: deps.ai,
      title: note.title,
      content: note.content,
      timezone: owner.timezone,
      now: deps.now(),
    });

    const outcome = await reconcileNote(db, {
      userId: owner.id,
      noteId,
      expectedUpdatedAt: note.updatedAt,
      items,
    });
    if (outcome.status === 'applied') return 'ok';
    return outcome.status === 'superseded' ? 'superseded' : 'missing';
  } catch (err) {
    const failure = toExtractionError(err);
    // Only the failure code is logged: never note text, model output or credentials.
    logger.warn('Note analysis failed', { code: failure.code, noteId });
    if (snapshot) await markFailed(db, owner.id, noteId, snapshot.updatedAt, failure.userMessage);
    return 'failed';
  }
}

/** Record a failure, unless the note was edited meanwhile (then a newer analysis owns the state). */
async function markFailed(
  db: Db,
  userId: string,
  noteId: string,
  expectedUpdatedAt: Date,
  message: string,
) {
  try {
    await db.transaction(async (tx) => {
      const [note] = await tx
        .select({ updatedAt: notes.updatedAt })
        .from(notes)
        .where(and(eq(notes.id, noteId), eq(notes.userId, userId)))
        .for('update');
      if (!note || note.updatedAt.getTime() !== expectedUpdatedAt.getTime()) return;
      await tx
        .update(notes)
        .set({ analysisStatus: 'failed', analysisError: message })
        .where(and(eq(notes.id, noteId), eq(notes.userId, userId)));
    });
  } catch (err) {
    logger.error('Could not record analysis failure', { name: (err as Error).name, noteId });
  }
}

import { and, eq } from 'drizzle-orm';
import {
  ExtractionError,
  extractIntents,
  toExtractionError,
} from '../../ai/extraction/extractor.js';
import type { AIProvider } from '../../ai/provider/index.js';
import type { CalendarSync } from '../../calendar/calendarSync.js';
import type { Db } from '../../db/client.js';
import { notes } from '../../db/schema.js';
import { logger } from '../../lib/logger.js';
import type { RateLimiter } from '../../lib/rateLimit.js';
import { reconcileNote } from '../../reconcile/reconcile.js';

export interface AnalysisDeps {
  db: Db;
  ai: AIProvider;
  now: () => Date;
  limiter: RateLimiter;
  /** Optional: when present, saved reminders are mirrored into the owner's Google Calendar. */
  sync?: CalendarSync;
}

export interface AnalysisOwner {
  id: string;
  timezone: string;
}

export type AnalysisOutcome = 'ok' | 'failed' | 'rate_limited' | 'superseded' | 'missing';

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

    // Before the AI is called. The note is already saved; the user can retry the analysis later.
    if (!deps.limiter.take(owner.id)) {
      throw new ExtractionError(
        'AI_RATE_LIMITED',
        'Your note was saved. You have used the AI a lot in the last minute, so it was not analysed. Please retry the analysis shortly.',
      );
    }

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
      timezone: owner.timezone,
    });
    if (outcome.status === 'applied') {
      // After the commit: a calendar problem can never undo or fail the saved analysis.
      await deps.sync?.removeEvents(owner.id, outcome.removedEventIds);
      await deps.sync?.syncNote(owner.id, noteId);
      return 'ok';
    }
    return outcome.status === 'superseded' ? 'superseded' : 'missing';
  } catch (err) {
    const failure = toExtractionError(err);
    // Only the failure code is logged: never note text, model output or credentials.
    logger.warn('Note analysis failed', { code: failure.code, noteId });
    if (snapshot) await markFailed(db, owner.id, noteId, snapshot.updatedAt, failure.userMessage);
    return failure.code === 'AI_RATE_LIMITED' ? 'rate_limited' : 'failed';
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

import { Router } from 'express';
import { answerQuestion } from '../../ai/ask/answerer.js';
import type { AIProvider } from '../../ai/provider/index.js';
import type { Db } from '../../db/client.js';
import { AppError, notFound } from '../../lib/errors.js';
import type { RateLimiter } from '../../lib/rateLimit.js';
import { currentUser } from '../../middleware/requireAuth.js';
import * as repo from './ask.repo.js';
import { ASK_NOT_FOUND, askBody, parseAskId } from './ask.schemas.js';

/** Shown when no note matches, or when the model says the notes do not contain the answer. */
export const NO_INFO_ANSWER =
  'Your saved notes do not contain enough information to answer this question.';

export interface AskDeps {
  db: Db;
  ai: AIProvider;
  now: () => Date;
  limiter: RateLimiter;
}

/**
 * Mounted behind requireAuth. The user always comes from the session. The notes sent to the AI
 * are retrieved here, for that user only, and the sources shown with the answer are exactly the
 * notes retrieved (never ids supplied by the client or the model).
 */
/**
 * The retrieved notes the model says it used. Positions come from the model but are only ever
 * looked up in our own list; out-of-range or repeated ones are ignored. With nothing usable we
 * keep showing every retrieved note rather than none.
 */
function citedNotes<T extends { id: string; title: string }>(found: T[], used: number[]) {
  const picked = [...new Set(used)]
    .filter((n) => n >= 1 && n <= found.length)
    .sort((a, b) => a - b);
  const notes = picked.length > 0 ? picked.map((n) => found[n - 1] as T) : found;
  return notes.map((n) => ({ id: n.id, title: n.title }));
}

export function askRouter({ db, ai, now, limiter }: AskDeps) {
  const router = Router();

  router.post('/', async (req, res) => {
    const user = currentUser(req);
    const { question } = askBody.parse(req.body);

    const found = await repo.retrieveNotes(db, user.id, question);

    // Nothing relevant: answer deterministically without spending an AI call.
    if (found.length === 0) {
      const ask = await repo.saveAsk(db, user.id, {
        question,
        answer: NO_INFO_ANSWER,
        status: 'no_info',
        sources: [],
        createdAt: now(),
      });
      res.status(201).json({ ask });
      return;
    }

    // Checked only when the AI will really be called (the no-match answer above costs nothing).
    if (!limiter.take(user.id)) {
      throw new AppError(
        'AI_RATE_LIMITED',
        429,
        'You are asking too quickly. Please wait a minute and try again.',
      );
    }

    // A provider failure throws here, before anything is saved: no misleading history entry.
    const result = await answerQuestion({
      provider: ai,
      question,
      notes: found.map((n) => ({ title: n.title, content: n.content })),
    });

    // If the model says the notes are not enough, no note is presented as support for the answer.
    const ask = await repo.saveAsk(db, user.id, {
      question,
      answer: result.answer,
      status: result.answerable ? 'answered' : 'no_info',
      sources: result.answerable ? citedNotes(found, result.used_notes) : [],
      createdAt: now(),
    });
    res.status(201).json({ ask });
  });

  // Registered before '/history/:id' so the list is never read as an id.
  router.get('/history', async (req, res) => {
    res.json({ history: await repo.listHistory(db, currentUser(req).id) });
  });

  router.get('/history/:id', async (req, res) => {
    const ask = await repo.getHistory(db, currentUser(req).id, parseAskId(req.params.id));
    if (!ask) throw notFound(ASK_NOT_FOUND);
    res.json({ ask });
  });

  return router;
}

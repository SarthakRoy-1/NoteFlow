import { Router } from 'express';
import type { Db } from '../../db/client.js';
import { AppError, notFound } from '../../lib/errors.js';
import { currentUser } from '../../middleware/requireAuth.js';
import { analyzeNote, type AnalysisDeps } from './analysis.service.js';
import * as repo from './notes.repo.js';
import { createNoteBody, parseNoteId, updateNoteBody } from './notes.schemas.js';

const NOT_FOUND_MESSAGE = 'We could not find that note.';

/**
 * Mounted behind requireAuth. Identity always comes from the session, never from the request.
 * Saving a note never depends on the AI: analysis runs after the note is stored and reports its
 * own status on the returned note.
 */
export function notesRouter(deps: AnalysisDeps) {
  const { db } = deps;
  const router = Router();

  const load = async (db_: Db, userId: string, id: string) => {
    const note = await repo.getNote(db_, userId, id);
    if (!note) throw notFound(NOT_FOUND_MESSAGE);
    return note;
  };

  router.get('/', async (req, res) => {
    res.json({ notes: await repo.listNotes(db, currentUser(req).id) });
  });

  router.post('/', async (req, res) => {
    const user = currentUser(req);
    const input = createNoteBody.parse(req.body);
    const id = await repo.insertNote(db, user.id, input);
    await analyzeNote(deps, user, id);
    res.status(201).json({ note: await load(db, user.id, id) });
  });

  router.get('/:id', async (req, res) => {
    res.json({ note: await load(db, currentUser(req).id, parseNoteId(req.params.id)) });
  });

  router.patch('/:id', async (req, res) => {
    const user = currentUser(req);
    const id = parseNoteId(req.params.id);
    const input = updateNoteBody.parse(req.body);

    const existing = await repo.getNote(db, user.id, id);
    if (!existing) throw notFound(NOT_FOUND_MESSAGE);

    const changed =
      (input.title !== undefined && input.title !== existing.title) ||
      (input.content !== undefined && input.content !== existing.content);

    if (changed) {
      if (!(await repo.applyNoteEdit(db, user.id, id, input))) throw notFound(NOT_FOUND_MESSAGE);
      await analyzeNote(deps, user, id);
    } else if (existing.analysis.status !== 'ok') {
      // Re-saving an unchanged note retries a failed/pending analysis; a good one is left alone.
      await analyzeNote(deps, user, id);
    }
    res.json({ note: await load(db, user.id, id) });
  });

  // Retry after an AI failure. Notes already analysed successfully are returned as-is, so this
  // endpoint cannot be used to spend AI quota repeatedly.
  router.post('/:id/analyze', async (req, res) => {
    const user = currentUser(req);
    const id = parseNoteId(req.params.id);
    const existing = await load(db, user.id, id);
    if (existing.analysis.status !== 'ok') {
      const outcome = await analyzeNote(deps, user, id);
      if (outcome === 'rate_limited') {
        throw new AppError(
          'AI_RATE_LIMITED',
          429,
          'You are retrying too quickly. Please wait a minute and try again.',
        );
      }
    }
    res.json({ note: await load(db, user.id, id) });
  });

  router.delete('/:id', async (req, res) => {
    const userId = currentUser(req).id;
    const id = parseNoteId(req.params.id);
    // Deleting the note deletes its reminders, so their calendar events are collected first.
    const eventIds = (await deps.sync?.eventIdsForNote(userId, id)) ?? [];
    const deleted = await repo.deleteNote(db, userId, id);
    if (!deleted) throw notFound(NOT_FOUND_MESSAGE);
    await deps.sync?.removeEvents(userId, eventIds);
    res.status(204).end();
  });

  return router;
}

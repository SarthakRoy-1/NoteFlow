import { Router } from 'express';
import type { Db } from '../../db/client.js';
import { notFound } from '../../lib/errors.js';
import { currentUser } from '../../middleware/requireAuth.js';
import * as repo from './notes.repo.js';
import { createNoteBody, parseNoteId, updateNoteBody } from './notes.schemas.js';

const NOT_FOUND_MESSAGE = 'We could not find that note.';

/** Mounted behind requireAuth. Identity always comes from the session, never from the request. */
export function notesRouter(db: Db) {
  const router = Router();

  router.get('/', async (req, res) => {
    res.json({ notes: await repo.listNotes(db, currentUser(req).id) });
  });

  router.post('/', async (req, res) => {
    const input = createNoteBody.parse(req.body);
    const note = await repo.createNote(db, currentUser(req).id, input);
    res.status(201).json({ note });
  });

  router.get('/:id', async (req, res) => {
    const note = await repo.getNote(db, currentUser(req).id, parseNoteId(req.params.id));
    if (!note) throw notFound(NOT_FOUND_MESSAGE);
    res.json({ note });
  });

  router.patch('/:id', async (req, res) => {
    const id = parseNoteId(req.params.id);
    const input = updateNoteBody.parse(req.body);
    const note = await repo.updateNote(db, currentUser(req).id, id, input);
    if (!note) throw notFound(NOT_FOUND_MESSAGE);
    res.json({ note });
  });

  router.delete('/:id', async (req, res) => {
    const deleted = await repo.deleteNote(db, currentUser(req).id, parseNoteId(req.params.id));
    if (!deleted) throw notFound(NOT_FOUND_MESSAGE);
    res.status(204).end();
  });

  return router;
}

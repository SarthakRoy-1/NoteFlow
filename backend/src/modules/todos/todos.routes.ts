import { Router } from 'express';
import type { Db } from '../../db/client.js';
import { AppError, notFound } from '../../lib/errors.js';
import { currentUser } from '../../middleware/requireAuth.js';
import * as repo from './todos.repo.js';
import {
  parseTodoId,
  resolveManualDue,
  TODO_NOT_FOUND,
  todoStatusQuery,
  updateTodoBody,
  type ResolvedDue,
} from './todos.schemas.js';

/** Mounted behind requireAuth. Identity always comes from the session, never from the request. */
export function todosRouter(db: Db) {
  const router = Router();

  const load = async (userId: string, id: string) => {
    const todo = await repo.getTodo(db, userId, id);
    if (!todo) throw notFound(TODO_NOT_FOUND);
    return todo;
  };

  router.get('/', async (req, res) => {
    const status = todoStatusQuery.catch('all').parse(req.query.status);
    res.json({ todos: await repo.listTodos(db, currentUser(req).id, status) });
  });

  router.get('/:id', async (req, res) => {
    res.json({ todo: await load(currentUser(req).id, parseTodoId(req.params.id)) });
  });

  router.patch('/:id', async (req, res) => {
    const user = currentUser(req);
    const id = parseTodoId(req.params.id);
    const input = updateTodoBody.parse(req.body);

    // The due date is interpreted in the user's own timezone, taken from their account.
    let due: ResolvedDue | undefined;
    if (input.due === null) {
      due = { dueAt: null, dueHasTime: false };
    } else if (input.due !== undefined) {
      const resolved = resolveManualDue(input.due, user.timezone);
      if (!resolved) {
        throw new AppError('VALIDATION_FAILED', 422, 'That is not a valid due date.');
      }
      due = resolved;
    }

    const updated = await repo.updateTodo(db, user.id, id, {
      title: input.title,
      completed: input.completed,
      due,
    });
    if (!updated) throw notFound(TODO_NOT_FOUND);
    res.json({ todo: await load(user.id, id) });
  });

  router.delete('/:id', async (req, res) => {
    const deleted = await repo.deleteTodo(db, currentUser(req).id, parseTodoId(req.params.id));
    if (!deleted) throw notFound(TODO_NOT_FOUND);
    res.status(204).end();
  });

  return router;
}

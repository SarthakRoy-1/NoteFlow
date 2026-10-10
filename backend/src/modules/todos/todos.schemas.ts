import { z } from 'zod';
import {
  dueInputSchema,
  resolveDueInput,
  type DueInput,
  type ResolvedDue,
} from '../../lib/dueInput.js';
import { notFound } from '../../lib/errors.js';
import { NO_NUL_MESSAGE, noNul } from '../../lib/text.js';

export const TODO_TITLE_MAX = 200;
const NOT_FOUND_MESSAGE = 'We could not find that todo.';

const title = z
  .string({ invalid_type_error: 'Todo text must be text.' })
  .trim()
  .min(1, 'Todo text cannot be empty.')
  .max(TODO_TITLE_MAX, `Todo text must be at most ${TODO_TITLE_MAX} characters.`)
  .refine(noNul, NO_NUL_MESSAGE);

// strict(): only these fields can be edited. user_id, source_note_id, ai_fingerprint, timestamps
// and any other column are rejected, never ignored.
export const updateTodoBody = z
  .object({
    title: title.optional(),
    completed: z.boolean().optional(),
    due: dueInputSchema.optional(),
  })
  .strict()
  .refine((b) => b.title !== undefined || b.completed !== undefined || b.due !== undefined, {
    message: 'Provide something to update.',
  });

export type UpdateTodoInput = z.infer<typeof updateTodoBody>;

export const todoStatusQuery = z.enum(['open', 'done', 'all']).default('all');

const uuid = z.string().uuid();

/** A malformed id can never match a todo, so it is reported exactly like a missing one. */
export function parseTodoId(raw: unknown): string {
  const parsed = uuid.safeParse(raw);
  if (!parsed.success) throw notFound(NOT_FOUND_MESSAGE);
  return parsed.data;
}

export const TODO_NOT_FOUND = NOT_FOUND_MESSAGE;

export type { ResolvedDue };

/** Todos are due BY the end of a date-only day (reminders, by contrast, alert at its start). */
export function resolveManualDue(input: DueInput, timezone: string): ResolvedDue | null {
  return resolveDueInput(input, timezone, 'end');
}

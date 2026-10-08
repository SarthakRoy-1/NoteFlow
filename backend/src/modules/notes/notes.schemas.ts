import { z } from 'zod';
import { notFound } from '../../lib/errors.js';

export const TITLE_MAX = 200;
export const CONTENT_MAX = 20_000;

const title = z
  .string({ required_error: 'Title is required.' })
  .trim()
  .min(1, 'Title cannot be empty.')
  .max(TITLE_MAX, `Title must be at most ${TITLE_MAX} characters.`);

const content = z
  .string({ required_error: 'Note text is required.' })
  .trim()
  .min(1, 'Note text cannot be empty.')
  .max(CONTENT_MAX, `Note text must be at most ${CONTENT_MAX} characters.`);

// strict(): any unknown key, notably a client-supplied user_id, is rejected rather than ignored.
export const createNoteBody = z.object({ title, content }).strict();

export const updateNoteBody = z
  .object({ title: title.optional(), content: content.optional() })
  .strict()
  .refine((b) => b.title !== undefined || b.content !== undefined, {
    message: 'Provide a title or note text to update.',
  });

export type CreateNoteInput = z.infer<typeof createNoteBody>;
export type UpdateNoteInput = z.infer<typeof updateNoteBody>;

const uuid = z.string().uuid();

/** A malformed id can never match a note, so it is reported exactly like a missing one. */
export function parseNoteId(raw: unknown): string {
  const parsed = uuid.safeParse(raw);
  if (!parsed.success) throw notFound('We could not find that note.');
  return parsed.data;
}

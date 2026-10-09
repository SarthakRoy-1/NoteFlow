import { z } from 'zod';
import { notFound } from '../../lib/errors.js';

export const QUESTION_MAX = 500;
export const ASK_NOT_FOUND = 'We could not find that question.';

// strict(): only `question` is accepted. user_id, note ids, sources and any other field are
// rejected, never ignored: the server alone decides whose notes are searched and which are used.
export const askBody = z
  .object({
    question: z
      .string({
        required_error: 'Type a question first.',
        invalid_type_error: 'The question must be text.',
      })
      .trim()
      .min(1, 'Type a question first.')
      .max(QUESTION_MAX, `Questions can be at most ${QUESTION_MAX} characters.`)
      // PostgreSQL text cannot hold NUL; reject it here instead of failing at the database.
      .refine(
        (q) => !q.includes('\u0000'),
        'The question contains a character that is not allowed.',
      ),
  })
  .strict();

const uuid = z.string().uuid();

/** A malformed id is "not found", the same answer as another user's id. */
export function parseAskId(raw: unknown): string {
  const parsed = uuid.safeParse(raw);
  if (!parsed.success) throw notFound(ASK_NOT_FOUND);
  return parsed.data;
}

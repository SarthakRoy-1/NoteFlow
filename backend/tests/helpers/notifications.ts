import { notes, reminders } from '../../src/db/schema.js';
import { runDispatch } from '../../src/notifications/dispatcher.js';
import type { EmailSender } from '../../src/email/types.js';
import type { PushSender } from '../../src/notifications/push.js';
import type { TestDb } from './testApp.js';
import { FIXED_NOW, FakeEmail, FakePush } from './testApp.js';

export const NOTE_TITLE = 'PRIVATE-NOTE-TITLE-5521';
export const BASE_URL = 'http://localhost:5173';

/** Due 30 minutes before FIXED_NOW unless overridden. */
export const DUE_AT = new Date(FIXED_NOW.getTime() - 30 * 60_000);

export async function seedReminder(
  db: TestDb,
  userId: string,
  partial: Partial<typeof reminders.$inferInsert> = {},
) {
  const [n] = await db
    .insert(notes)
    .values({ userId, title: NOTE_TITLE, content: 'body', analysisStatus: 'ok' })
    .returning();
  if (!n) throw new Error('seed failed');
  const [r] = await db
    .insert(reminders)
    .values({
      userId,
      sourceNoteId: n.id,
      content: 'Send the invoice',
      person: 'John',
      dueAt: DUE_AT,
      dueHasTime: true,
      // Created well before it came due, as a real reminder would be.
      createdAt: new Date(DUE_AT.getTime() - 24 * 3_600_000),
      ...partial,
    })
    .returning();
  if (!r) throw new Error('seed failed');
  return { note: n, reminder: r };
}

/** One scheduler tick with a movable clock. */
export function tick(
  db: TestDb,
  senders: { email?: EmailSender; push?: PushSender } = {},
  at: Date = FIXED_NOW,
) {
  return runDispatch({
    db,
    email: senders.email ?? new FakeEmail(),
    push: senders.push ?? new FakePush(),
    appBaseUrl: BASE_URL,
    now: () => at,
  });
}

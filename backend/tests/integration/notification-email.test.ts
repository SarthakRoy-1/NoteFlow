import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  notificationDeliveries,
  notificationPreferences,
  reminderShares,
  reminders,
} from '../../src/db/schema.js';
import { EmailDeliveryError } from '../../src/email/types.js';
import { LATE_WINDOW_MS } from '../../src/notifications/dispatcher.js';
import { DUE_AT, NOTE_TITLE, seedReminder, tick } from '../helpers/notifications.js';
import {
  FIXED_NOW,
  FakeEmail,
  FakePush,
  createUserWithSession,
  openTestDb,
  resetDb,
} from '../helpers/testApp.js';

const { db, pool } = openTestDb();
afterAll(() => pool.end());
beforeEach(() => resetDb(db));

const MINUTE = 60_000;
const after = (ms: number) => new Date(FIXED_NOW.getTime() + ms);

async function owner(timezone = 'Asia/Kolkata') {
  return createUserWithSession(db, { email: 'owner@example.com', timezone });
}
const ledger = () => db.select().from(notificationDeliveries);

describe('due reminder email', () => {
  it('emails the owner once, with the text, person, time in their zone and a link', async () => {
    const { user } = await owner();
    await seedReminder(db, user.id);
    const email = new FakeEmail();
    const result = await tick(db, { email });
    expect(result).toMatchObject({ enqueued: 1, sent: 1 });
    expect(email.sent).toHaveLength(1);
    const [mail] = email.sent;
    expect(mail?.to).toBe('owner@example.com');
    expect(mail?.subject).toBe('Reminder: Send the invoice');
    expect(mail?.text).toContain('Send the invoice');
    expect(mail?.text).toContain('About: John');
    expect(mail?.text).toContain('Thu 8 Oct 2026, 3:00 PM (Asia/Kolkata)'); // 09:30 UTC
    expect(mail?.text).toContain('http://localhost:5173/reminders');
    expect(mail?.text).not.toContain(NOTE_TITLE);
    expect(mail?.idempotencyKey).toMatch(/^reminder-email\/[0-9a-f-]{36}$/);
    const [row] = await ledger();
    expect(row).toMatchObject({ channel: 'email', status: 'sent', attempts: 1 });
    expect(row?.occurrenceAt.getTime()).toBe(DUE_AT.getTime());
  });

  it('never sends the same occurrence again: repeated ticks, a restart, concurrent workers', async () => {
    const { user } = await owner();
    await seedReminder(db, user.id);
    const email = new FakeEmail();
    await tick(db, { email });
    await tick(db, { email });
    await tick(db, { email }, after(MINUTE));
    // A "restart": every in-memory object is new, only PostgreSQL is shared.
    const restarted = new FakeEmail();
    await tick(db, { email: restarted }, after(2 * MINUTE));
    expect(email.sent).toHaveLength(1);
    expect(restarted.sent).toHaveLength(0);
    expect(await ledger()).toHaveLength(1);
  });

  it('two workers running at the same instant send one email', async () => {
    const { user } = await owner();
    await seedReminder(db, user.id);
    const a = new FakeEmail();
    const b = new FakeEmail();
    await Promise.all([tick(db, { email: a }), tick(db, { email: b })]);
    expect(a.sent.length + b.sent.length).toBe(1);
    expect(await ledger()).toHaveLength(1);
  });

  it('does not email before the reminder is due, or for one with no time', async () => {
    const { user } = await owner();
    await seedReminder(db, user.id, { dueAt: after(10 * MINUTE) });
    await seedReminder(db, user.id, { dueAt: null });
    const email = new FakeEmail();
    expect(await tick(db, { email })).toMatchObject({ enqueued: 0, sent: 0 });
    expect(email.sent).toHaveLength(0);
    // ...and does when the time arrives.
    await tick(db, { email }, after(11 * MINUTE));
    expect(email.sent).toHaveLength(1);
  });

  it('drops an occurrence that is too old rather than sending it late', async () => {
    const { user } = await owner();
    await seedReminder(db, user.id, {
      dueAt: new Date(FIXED_NOW.getTime() - LATE_WINDOW_MS - MINUTE),
    });
    const email = new FakeEmail();
    expect(await tick(db, { email })).toMatchObject({ enqueued: 0 });
    expect(email.sent).toHaveLength(0);
  });

  it('skips reminders that were acknowledged, dismissed or deleted', async () => {
    const { user } = await owner();
    await seedReminder(db, user.id, { status: 'acknowledged' });
    await seedReminder(db, user.id, { status: 'dismissed' });
    const gone = await seedReminder(db, user.id);
    await db.delete(reminders).where(eq(reminders.id, gone.reminder.id));
    const email = new FakeEmail();
    await tick(db, { email });
    expect(email.sent).toHaveLength(0);
  });

  it('a repeating reminder is emailed once per occurrence', async () => {
    const { user } = await owner('UTC');
    // Thursdays at 09:30 UTC. FIXED_NOW is Thursday 10:00 UTC.
    await seedReminder(db, user.id, { recurrenceDays: [4], recurrenceTime: '09:30' });
    const email = new FakeEmail();
    await tick(db, { email });
    await tick(db, { email }, after(5 * MINUTE));
    expect(email.sent).toHaveLength(1);
    const nextWeek = new Date('2026-10-15T09:45:00Z');
    await tick(db, { email }, nextWeek);
    await tick(db, { email }, new Date(nextWeek.getTime() + MINUTE));
    expect(email.sent).toHaveLength(2);
    expect(await ledger()).toHaveLength(2);
  });

  it('a repeating reminder that was acknowledged at this occurrence is not emailed', async () => {
    const { user } = await owner('UTC');
    await seedReminder(db, user.id, {
      recurrenceDays: [4],
      recurrenceTime: '09:30',
      alertedAt: new Date('2026-10-08T09:45:00Z'),
    });
    const email = new FakeEmail();
    await tick(db, { email });
    expect(email.sent).toHaveLength(0);
  });

  it('a repeating reminder is not emailed for an occurrence before it was created', async () => {
    const { user } = await owner('UTC');
    await seedReminder(db, user.id, {
      recurrenceDays: [4],
      recurrenceTime: '09:30',
      createdAt: new Date('2026-10-08T09:40:00Z'),
    });
    const email = new FakeEmail();
    await tick(db, { email });
    expect(email.sent).toHaveLength(0);
  });
});

describe('preferences and changed state', () => {
  it('respects emailEnabled = false', async () => {
    const { user } = await owner();
    await seedReminder(db, user.id);
    await db.insert(notificationPreferences).values({ userId: user.id, emailEnabled: false });
    const email = new FakeEmail();
    expect(await tick(db, { email })).toMatchObject({ enqueued: 0 });
    expect(email.sent).toHaveLength(0);
  });

  it('is on by default when the user never chose', async () => {
    const { user } = await owner();
    await seedReminder(db, user.id);
    const email = new FakeEmail();
    await tick(db, { email });
    expect(email.sent).toHaveLength(1);
  });

  it('does not send an already-queued email after the user turned email off', async () => {
    const { user } = await owner();
    await seedReminder(db, user.id);
    const flaky = new FakeEmail();
    flaky.failWith = new EmailDeliveryError('unavailable');
    await tick(db, { email: flaky }); // queued, first attempt failed
    await db.insert(notificationPreferences).values({ userId: user.id, emailEnabled: false });
    const email = new FakeEmail();
    await tick(db, { email }, after(2 * MINUTE));
    expect(email.sent).toHaveLength(0);
    expect((await ledger())[0]).toMatchObject({ status: 'skipped', lastError: 'disabled' });
  });

  it('does not send an already-queued email for a reminder deleted in the meantime', async () => {
    const { user } = await owner();
    const { reminder } = await seedReminder(db, user.id);
    const flaky = new FakeEmail();
    flaky.failWith = new EmailDeliveryError('unavailable');
    await tick(db, { email: flaky });
    expect(await ledger()).toHaveLength(1);
    await db.delete(reminders).where(eq(reminders.id, reminder.id));
    expect(await ledger()).toHaveLength(0); // the ledger goes with it
    const email = new FakeEmail();
    await tick(db, { email }, after(2 * MINUTE));
    expect(email.sent).toHaveLength(0);
  });

  it('does not send once the reminder was acknowledged or moved, and uses the new time', async () => {
    const { user } = await owner();
    const { reminder } = await seedReminder(db, user.id);
    const flaky = new FakeEmail();
    flaky.failWith = new EmailDeliveryError('unavailable');
    await tick(db, { email: flaky });

    await db.update(reminders).set({ status: 'acknowledged' }).where(eq(reminders.id, reminder.id));
    const email = new FakeEmail();
    await tick(db, { email }, after(2 * MINUTE));
    expect(email.sent).toHaveLength(0);
    expect((await ledger())[0]).toMatchObject({ status: 'skipped', lastError: 'not_pending' });

    // Re-armed for a later time: that is a new occurrence and is sent once it arrives.
    await db
      .update(reminders)
      .set({ status: 'pending', dueAt: after(30 * MINUTE) })
      .where(eq(reminders.id, reminder.id));
    await tick(db, { email }, after(31 * MINUTE));
    await tick(db, { email }, after(32 * MINUTE));
    expect(email.sent).toHaveLength(1);
  });
});

describe('shared reminders', () => {
  async function shareWith(timezone = 'Europe/London') {
    const a = await owner();
    const b = await createUserWithSession(db, { email: 'friend@example.com', timezone });
    const { reminder } = await seedReminder(db, a.user.id);
    await db.insert(reminderShares).values({
      reminderId: reminder.id,
      ownerId: a.user.id,
      recipientId: b.user.id,
      createdAt: new Date(DUE_AT.getTime() - 3_600_000),
    });
    return { a, b, reminder };
  }

  it('also emails the recipient, in their time zone, naming the sender and nothing private', async () => {
    const { a, b } = await shareWith();
    const email = new FakeEmail();
    await tick(db, { email });
    expect(email.sent.map((m) => m.to).sort()).toEqual(['friend@example.com', 'owner@example.com']);
    const mail = email.to('friend@example.com')[0];
    expect(mail?.text).toContain(`${a.user.name} shared a reminder with you.`);
    expect(mail?.text).toContain('Thu 8 Oct 2026, 10:30 AM (Europe/London)');
    expect(mail?.text).not.toContain(NOTE_TITLE);
    expect(mail?.text).not.toContain('owner@example.com');
    expect(mail?.text).not.toContain(a.user.id);
    expect(mail?.text).not.toContain(b.user.id);
  });

  it('honours the recipient’s own preference', async () => {
    const { b } = await shareWith();
    await db.insert(notificationPreferences).values({ userId: b.user.id, emailEnabled: false });
    const email = new FakeEmail();
    await tick(db, { email });
    expect(email.sent.map((m) => m.to)).toEqual(['owner@example.com']);
  });

  it('does not email a recipient for an occurrence from before it was shared', async () => {
    const a = await owner();
    const b = await createUserWithSession(db, { email: 'late@example.com' });
    const { reminder } = await seedReminder(db, a.user.id);
    await db.insert(reminderShares).values({
      reminderId: reminder.id,
      ownerId: a.user.id,
      recipientId: b.user.id,
      createdAt: new Date(DUE_AT.getTime() + 5 * MINUTE),
    });
    const email = new FakeEmail();
    await tick(db, { email });
    expect(email.to('late@example.com')).toHaveLength(0);
    expect(email.to('owner@example.com')).toHaveLength(1);
  });

  it('does not email a recipient who acknowledged it, or whose share was removed', async () => {
    const { reminder, b } = await shareWith();
    await db
      .update(reminderShares)
      .set({ acknowledgedAt: after(-10 * MINUTE) })
      .where(eq(reminderShares.recipientId, b.user.id));
    const email = new FakeEmail();
    await tick(db, { email });
    expect(email.to('friend@example.com')).toHaveLength(0);

    // Removed while a send was still queued.
    await resetDb(db);
    const s = await shareWith();
    const flaky = new FakeEmail();
    flaky.failWith = new EmailDeliveryError('unavailable');
    await tick(db, { email: flaky });
    await db.delete(reminderShares).where(eq(reminderShares.reminderId, s.reminder.id));
    const later = new FakeEmail();
    await tick(db, { email: later }, after(2 * MINUTE));
    expect(later.to('friend@example.com')).toHaveLength(0);
    expect(reminder.id).toBeDefined();
  });
});

describe('provider failures', () => {
  it('retries a transient failure with backoff, using the same idempotency key', async () => {
    const { user } = await owner();
    await seedReminder(db, user.id);
    const email = new FakeEmail();
    email.failWith = new EmailDeliveryError('unavailable');
    expect(await tick(db, { email })).toMatchObject({ retried: 1, sent: 0 });
    let [row] = await ledger();
    expect(row).toMatchObject({ status: 'pending', attempts: 1, lastError: 'unavailable' });
    expect(row?.nextAttemptAt.getTime()).toBe(after(MINUTE).getTime());

    // Not retried before the backoff has passed.
    email.failWith = undefined;
    await tick(db, { email }, after(30_000));
    expect(email.sent).toHaveLength(0);

    await tick(db, { email }, after(MINUTE));
    expect(email.sent).toHaveLength(1);
    [row] = await ledger();
    expect(row).toMatchObject({ status: 'sent', attempts: 2 });
  });

  it('does not retry a permanent rejection such as an invalid address', async () => {
    const { user } = await owner();
    await seedReminder(db, user.id);
    const email = new FakeEmail();
    email.failWith = new EmailDeliveryError('rejected');
    expect(await tick(db, { email })).toMatchObject({ failed: 1 });
    email.failWith = undefined;
    await tick(db, { email }, after(10 * MINUTE));
    await tick(db, { email }, after(60 * MINUTE));
    expect(email.sent).toHaveLength(0);
    expect((await ledger())[0]).toMatchObject({
      status: 'failed',
      lastError: 'rejected',
      attempts: 1,
    });
  });

  it('gives up after five transient failures and then stays quiet', async () => {
    const { user } = await owner();
    await seedReminder(db, user.id);
    const email = new FakeEmail();
    email.failWith = new EmailDeliveryError('unavailable');
    // Attempts land on the backoff schedule: now, +1, +5, +15 and +60 minutes after each failure.
    for (const offset of [0, 1, 6, 21, 81]) await tick(db, { email }, after(offset * MINUTE));
    expect((await ledger())[0]).toMatchObject({
      status: 'failed',
      attempts: 5,
      lastError: 'gave_up',
    });
    email.failWith = undefined;
    await tick(db, { email }, after(150 * MINUTE));
    expect(email.sent).toHaveLength(0);
  });

  it('a crashed worker’s stale claim is picked up and sent once', async () => {
    const { user } = await owner();
    await seedReminder(db, user.id);
    const flaky = new FakeEmail();
    flaky.failWith = new EmailDeliveryError('unavailable');
    await tick(db, { email: flaky });
    // Simulate a worker that claimed the row and died before recording a result.
    await db.update(notificationDeliveries).set({ status: 'sending', claimedAt: after(MINUTE) });
    const email = new FakeEmail();
    await tick(db, { email }, after(2 * MINUTE)); // claim still fresh: left alone
    expect(email.sent).toHaveLength(0);
    await tick(db, { email }, after(8 * MINUTE)); // stale: taken over
    expect(email.sent).toHaveLength(1);
  });

  it('sends nothing, and records nothing, when no email provider is configured', async () => {
    const { user } = await owner();
    await seedReminder(db, user.id);
    const email = new FakeEmail();
    email.configured = false;
    const push = new FakePush();
    push.configured = false;
    expect(await tick(db, { email, push })).toMatchObject({ enqueued: 0, sent: 0 });
    expect(await ledger()).toHaveLength(0);
  });

  it('keeps provider text and addresses out of the ledger', async () => {
    const { user } = await owner();
    await seedReminder(db, user.id);
    const email = new FakeEmail();
    email.failWith = new EmailDeliveryError('rejected');
    await tick(db, { email });
    const [row] = await ledger();
    expect(JSON.stringify(row)).not.toContain('owner@example.com');
    expect(JSON.stringify(row)).not.toContain('Send the invoice');
  });
});

import { DateTime } from 'luxon';
import type { EmailMessage } from '../email/types.js';
import type { PushPayload } from './push.js';

export interface ReminderNotice {
  text: string;
  person: string | null;
  occurrenceAt: Date;
  /** false = a date with no time of day. */
  hasTime: boolean;
  /** The IANA zone of the person being notified. */
  timezone: string;
  /** Set when the reminder was shared by someone else: their display name. */
  sharedBy: string | null;
}

/** Header and notification titles must stay on one line and short. */
const oneLine = (value: string, max: number) => {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

function whenLabel(notice: ReminderNotice): string {
  const at = DateTime.fromJSDate(notice.occurrenceAt, { zone: notice.timezone });
  if (!at.isValid) return notice.occurrenceAt.toISOString();
  return notice.hasTime
    ? `${at.toFormat('ccc d LLL yyyy, h:mm a')} (${notice.timezone})`
    : at.toFormat('ccc d LLL yyyy');
}

/** Plain text on purpose: nothing a note author wrote is ever interpreted as markup. */
export function reminderEmail(to: string, baseUrl: string, notice: ReminderNotice, key: string) {
  const base = baseUrl.replace(/\/$/, '');
  const lines = [
    notice.sharedBy ? `${notice.sharedBy} shared a reminder with you.` : 'Your reminder is due.',
    '',
    notice.text,
  ];
  if (notice.person) lines.push(`About: ${notice.person}`);
  lines.push(
    '',
    `When: ${whenLabel(notice)}`,
    '',
    `Open it in NoteFlow: ${base}/reminders`,
    '',
    `You get this because reminder emails are on. Turn them off any time: ${base}/settings`,
  );
  const message: EmailMessage = {
    to,
    subject: `Reminder: ${oneLine(notice.text, 80)}`,
    text: lines.join('\n'),
    idempotencyKey: `reminder-email/${key}`,
  };
  return message;
}

/** Private by default: the generic form carries no reminder text at all. */
export function reminderPush(notice: ReminderNotice, showText: boolean, tag: string): PushPayload {
  const generic = notice.sharedBy
    ? 'A reminder was shared with you and is due.'
    : 'You have a reminder due.';
  return {
    title: 'NoteFlow',
    body: showText ? oneLine(notice.text, 120) : generic,
    url: '/reminders',
    tag,
  };
}

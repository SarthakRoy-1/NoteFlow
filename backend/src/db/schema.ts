import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** timestamptz: PostgreSQL stores the instant in UTC; the driver returns JS Dates. */
const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => timestamptz('created_at').notNull().defaultNow();
/** No implicit ON UPDATE: code sets updated_at explicitly, so status-only changes never bump it. */
const updatedAt = () => timestamptz('updated_at').notNull().defaultNow();

export const analysisStatus = pgEnum('analysis_status', ['pending', 'ok', 'failed']);
export const reminderStatus = pgEnum('reminder_status', ['pending', 'acknowledged', 'dismissed']);
export const itemKind = pgEnum('item_kind', ['todo', 'reminder']);
export const askStatus = pgEnum('ask_status', ['answered', 'no_info', 'failed']);
export const userTokenPurpose = pgEnum('user_token_purpose', ['verify_email', 'reset_password']);
export const deliveryChannel = pgEnum('delivery_channel', ['email', 'push']);
export const deliveryStatus = pgEnum('delivery_status', [
  'pending',
  'sending',
  'sent',
  'failed',
  'skipped',
]);

/**
 * An account signs in with Google (`google_sub`), a password (`password_hash`, Argon2id PHC string),
 * or both. The two are never merged automatically just because the email matches.
 * One email = one account, compared case-insensitively.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    googleSub: text('google_sub').unique(),
    passwordHash: text('password_hash'),
    /** Set only after the owner proved control of the address (Google-verified, or an emailed link). */
    emailVerifiedAt: timestamptz('email_verified_at'),
    email: text('email').notNull(),
    name: text('name').notNull(),
    timezone: text('timezone').notNull().default('UTC'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('users_email_lower_unique').on(sql`lower(${t.email})`),
    check(
      'users_auth_method_check',
      sql`${t.googleSub} is not null or ${t.passwordHash} is not null`,
    ),
  ],
);

/**
 * A sign-up that has not proven its email yet. It is NOT an account: it cannot sign in, and it does
 * not reserve the address against a real account (the unique index is on this table only), so
 * nobody can lock the legitimate owner out of Google sign-in. Only the hash of the emailed token
 * is stored. Rows expire and are purged.
 */
export const pendingRegistrations = pgTable(
  'pending_registrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    timezone: text('timezone').notNull().default('UTC'),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamptz('expires_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('pending_registrations_email_lower_unique').on(sql`lower(${t.email})`),
    index('pending_registrations_expires_at_idx').on(t.expiresAt),
  ],
);

/** One-time emailed tokens for an existing account (hash only; single use; expiring). */
export const userTokens = pgTable(
  'user_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: userTokenPurpose('purpose').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamptz('expires_at').notNull(),
    usedAt: timestamptz('used_at'),
    createdAt: createdAt(),
  },
  (t) => [index('user_tokens_user_id_idx').on(t.userId)],
);

/**
 * One in-flight "connect Google" attempt. Bound to the account AND the exact session that started
 * it (deleting the session deletes the attempt). `state_hash` is the one-time OAuth state, hashed.
 */
export const oauthLinkAttempts = pgTable(
  'oauth_link_attempts',
  {
    stateHash: text('state_hash').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    codeVerifier: text('code_verifier').notNull(),
    nonce: text('nonce').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    usedAt: timestamptz('used_at'),
    createdAt: createdAt(),
  },
  (t) => [index('oauth_link_attempts_expires_at_idx').on(t.expiresAt)],
);

/** `id` is the SHA-256 hash of the session token. The raw token only ever lives in the cookie. */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamptz('expires_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('sessions_user_id_idx').on(t.userId),
    index('sessions_expires_at_idx').on(t.expiresAt),
  ],
);

export const notes = pgTable(
  'notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    content: text('content').notNull(),
    analysisStatus: analysisStatus('analysis_status').notNull().default('pending'),
    analysisError: text('analysis_error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Lets child tables reference (note, owner) together so a row can never point at another user's note.
    unique('notes_id_user_id_key').on(t.id, t.userId),
    index('notes_user_updated_idx').on(t.userId, t.updatedAt.desc()),
    index('notes_search_idx').using(
      'gin',
      sql`to_tsvector('english', ${t.title} || ' ' || ${t.content})`,
    ),
  ],
);

export const todos = pgTable(
  'todos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sourceNoteId: uuid('source_note_id').notNull(),
    title: text('title').notNull(),
    dueAt: timestamptz('due_at'),
    /** false = the user gave only a date; dueAt is then the end of that local day. */
    dueHasTime: boolean('due_has_time').notNull().default(false),
    completed: boolean('completed').notNull().default(false),
    completedAt: timestamptz('completed_at'),
    createdByAi: boolean('created_by_ai').notNull().default(false),
    aiFingerprint: text('ai_fingerprint'),
    /** The AI's own wording, kept when the user edits `title`, so a reworded copy can be recognised. */
    aiText: text('ai_text'),
    userModified: boolean('user_modified').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.sourceNoteId, t.userId],
      foreignColumns: [notes.id, notes.userId],
      name: 'todos_source_note_owner_fk',
    }).onDelete('cascade'),
    index('todos_user_status_idx').on(t.userId, t.completed, t.dueAt),
    index('todos_source_note_idx').on(t.sourceNoteId),
    uniqueIndex('todos_note_fingerprint_key')
      .on(t.sourceNoteId, t.aiFingerprint)
      .where(sql`${t.aiFingerprint} is not null`),
  ],
);

export const reminders = pgTable(
  'reminders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sourceNoteId: uuid('source_note_id').notNull(),
    content: text('content').notNull(),
    person: text('person'),
    /** NULL = no time or date was given. Such a reminder never alerts. */
    dueAt: timestamptz('due_at'),
    /** false = only a date was given; dueAt is then the start of that local day. */
    dueHasTime: boolean('due_has_time').notNull().default(true),
    status: reminderStatus('status').notNull().default('pending'),
    alertedAt: timestamptz('alerted_at'),
    /**
     * Recurring reminders: the ISO weekdays (1 = Monday ... 7 = Sunday) it repeats on. NULL = a
     * one-off reminder. `dueAt` is always the NEXT occurrence; acknowledging one advances it.
     */
    recurrenceDays: smallint('recurrence_days').array(),
    /** Wall-clock "HH:mm" in the owner's timezone. NULL (with days set) = alert at the start of the day. */
    recurrenceTime: text('recurrence_time'),
    createdByAi: boolean('created_by_ai').notNull().default(false),
    aiFingerprint: text('ai_fingerprint'),
    /** The AI's own wording, kept when the user edits `content`, so a reworded copy can be recognised. */
    aiText: text('ai_text'),
    userModified: boolean('user_modified').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.sourceNoteId, t.userId],
      foreignColumns: [notes.id, notes.userId],
      name: 'reminders_source_note_owner_fk',
    }).onDelete('cascade'),
    // Lets reminder_shares reference (reminder, owner) together, like notes_id_user_id_key above.
    unique('reminders_id_user_id_key').on(t.id, t.userId),
    check(
      'reminders_recurrence_days_check',
      sql`${t.recurrenceDays} is null or (cardinality(${t.recurrenceDays}) between 1 and 7 and ${t.recurrenceDays} <@ array[1,2,3,4,5,6,7]::smallint[])`,
    ),
    check(
      'reminders_recurrence_time_check',
      sql`${t.recurrenceTime} is null or (${t.recurrenceDays} is not null and ${t.recurrenceTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')`,
    ),
    index('reminders_user_due_idx').on(t.userId, t.status, t.dueAt),
    index('reminders_source_note_idx').on(t.sourceNoteId),
    uniqueIndex('reminders_note_fingerprint_key')
      .on(t.sourceNoteId, t.aiFingerprint)
      .where(sql`${t.aiFingerprint} is not null`),
  ],
);

/** Tombstones: AI items the user deleted, so re-analysis does not bring them back. */
export const aiDismissed = pgTable(
  'ai_dismissed',
  {
    sourceNoteId: uuid('source_note_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: itemKind('kind').notNull(),
    aiFingerprint: text('ai_fingerprint').notNull(),
    /** The dismissed item's text and person, so a reworded copy of it is not brought back (nullable: older rows). */
    itemText: text('item_text'),
    person: text('person'),
  },
  (t) => [
    primaryKey({ columns: [t.sourceNoteId, t.kind, t.aiFingerprint] }),
    foreignKey({
      columns: [t.sourceNoteId, t.userId],
      foreignColumns: [notes.id, notes.userId],
      name: 'ai_dismissed_source_note_owner_fk',
    }).onDelete('cascade'),
  ],
);

/**
 * A reminder its owner explicitly shared with one other NoteFlow user. The recipient is a real user
 * (resolved server-side from a verified account email), never a display name. The recipient sees
 * only the reminder's text, time and recurrence, never its source note. Deleting the reminder (or
 * either account) deletes the share.
 */
export const reminderShares = pgTable(
  'reminder_shares',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reminderId: uuid('reminder_id').notNull(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    /** The last time the recipient acknowledged it. NULL = never (a new, unread share). */
    acknowledgedAt: timestamptz('acknowledged_at'),
  },
  (t) => [
    foreignKey({
      columns: [t.reminderId, t.ownerId],
      foreignColumns: [reminders.id, reminders.userId],
      name: 'reminder_shares_reminder_owner_fk',
    }).onDelete('cascade'),
    unique('reminder_shares_reminder_recipient_key').on(t.reminderId, t.recipientId),
    check('reminder_shares_not_self', sql`${t.ownerId} <> ${t.recipientId}`),
    index('reminder_shares_recipient_idx').on(t.recipientId, t.createdAt.desc()),
  ],
);

export const askHistory = pgTable(
  'ask_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    question: text('question').notNull(),
    answer: text('answer').notNull(),
    status: askStatus('status').notNull().default('answered'),
    createdAt: createdAt(),
  },
  (t) => [index('ask_history_user_created_idx').on(t.userId, t.createdAt.desc())],
);

/** Sources keep a title snapshot so history still reads correctly after a note is deleted. */
export const askHistorySources = pgTable(
  'ask_history_sources',
  {
    askId: uuid('ask_id')
      .notNull()
      .references(() => askHistory.id, { onDelete: 'cascade' }),
    noteId: uuid('note_id').references(() => notes.id, { onDelete: 'set null' }),
    noteTitleSnapshot: text('note_title_snapshot').notNull(),
    rank: integer('rank').notNull(),
  },
  (t) => [primaryKey({ columns: [t.askId, t.rank] })],
);

/** Per-user notification choices. A missing row means the defaults below, so nothing is backfilled. */
export const notificationPreferences = pgTable('notification_preferences', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  emailEnabled: boolean('email_enabled').notNull().default(true),
  /** Pauses push without forgetting the user's devices. A device is only used once subscribed. */
  pushEnabled: boolean('push_enabled').notNull().default(true),
  /** Off by default: a lock screen or a shared screen should not show private reminder text. */
  pushShowText: boolean('push_show_text').notNull().default(false),
  updatedAt: updatedAt(),
});

/**
 * One browser/device a user allowed notifications on. `endpoint` is a capability URL (anyone who
 * holds it can push to that browser), so it is never logged or returned. It is unique: a browser
 * profile belongs to whoever subscribed it last.
 */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    /** A short human label such as "Chrome on Windows". */
    label: text('label').notNull().default('Browser'),
    createdAt: createdAt(),
    lastSuccessAt: timestamptz('last_success_at'),
  },
  (t) => [index('push_subscriptions_user_idx').on(t.userId)],
);

/**
 * The durable ledger of notifications: one row per (reminder, person, channel, occurrence). The
 * unique key is what makes sending idempotent: a repeated scheduler run, a second instance or a
 * restart can enqueue the same occurrence again and it collapses into the existing row. Deleting
 * the reminder deletes its rows, so a deleted reminder can never be sent afterwards.
 */
export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reminderId: uuid('reminder_id')
      .notNull()
      .references(() => reminders.id, { onDelete: 'cascade' }),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    channel: deliveryChannel('channel').notNull(),
    /** The reminder instant this delivery is for. A repeating reminder has one row per occurrence. */
    occurrenceAt: timestamptz('occurrence_at').notNull(),
    status: deliveryStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamptz('next_attempt_at').notNull().defaultNow(),
    /** Set while a worker holds the row; a stale claim (crashed worker) can be taken over. */
    claimedAt: timestamptz('claimed_at'),
    sentAt: timestamptz('sent_at'),
    /** A short machine code ("rejected", "unavailable", ...), never provider text or reminder content. */
    lastError: text('last_error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('notification_deliveries_occurrence_key').on(
      t.reminderId,
      t.recipientId,
      t.channel,
      t.occurrenceAt,
    ),
    index('notification_deliveries_due_idx').on(t.status, t.nextAttemptAt),
    index('notification_deliveries_recipient_idx').on(t.recipientId),
  ],
);

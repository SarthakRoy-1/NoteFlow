import { sql } from 'drizzle-orm';
import {
  boolean,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** timestamptz: PostgreSQL stores the instant in UTC; the driver returns JS Dates. */
const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => timestamptz('created_at').notNull().defaultNow();
const updatedAt = () =>
  timestamptz('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const analysisStatus = pgEnum('analysis_status', ['pending', 'ok', 'failed']);
export const reminderStatus = pgEnum('reminder_status', ['pending', 'acknowledged', 'dismissed']);
export const itemKind = pgEnum('item_kind', ['todo', 'reminder']);
export const askStatus = pgEnum('ask_status', ['answered', 'no_info', 'failed']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  googleSub: text('google_sub').notNull().unique(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('UTC'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

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
    /** NULL = no time was given. Such a reminder never alerts. */
    dueAt: timestamptz('due_at'),
    status: reminderStatus('status').notNull().default('pending'),
    alertedAt: timestamptz('alerted_at'),
    createdByAi: boolean('created_by_ai').notNull().default(false),
    aiFingerprint: text('ai_fingerprint'),
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

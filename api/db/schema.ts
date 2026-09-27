/**
 * GoalCoach Drizzle schema — Phase 1.
 *
 * Source of truth: migration/discovery/03-nextjs-architecture.md Section 2.
 *
 * 9 domain tables (mirror the 9 Mongo collections in
 * migration/discovery/01-mongo-schema.md) + 3 Auth.js tables (accounts,
 * sessions, verificationTokens) required by @auth/drizzle-adapter.
 *
 * Design notes:
 *  - All primary keys are TEXT — preserved Mongo string IDs (e.g. user_xxx,
 *    goal_xxx) so the ETL in db/migrate-from-mongo.ts can stream rows 1:1.
 *  - Timestamps use Postgres `timestamp with time zone` (`timestamptz`) so
 *    `defaultNow()` returns a UTC instant in Postgres and reads back as a
 *    JS Date in Drizzle without timezone surprises.
 *  - Date-only columns (e.g. start_date, target_date) use Postgres `date`
 *    so Mongo's ISO date strings round-trip cleanly.
 *  - proposals.args and audit_log.payload are JSONB per the architecture
 *    plan so we can index/query nested fields later without migration
 *    churn.
 *  - FK actions: ON DELETE CASCADE for owned children of a user
 *    (commitments, milestones, blockers, messages, audit_log, sources);
 *    ON DELETE SET NULL for goal_id references where the parent goal may
 *    be removed but the child row (e.g. a milestone) is still useful.
 *  - No explicit secondary indexes are declared here. The architecture
 *    sketch is the source of truth; if/when we add
 *    (user_id, created_at DESC) etc. they go in a later migration so the
 *    generated 0001_init.sql matches the plan byte-for-byte.
 */

import {
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'

/* -------------------------------------------------------------------------- */
/* Domain tables                                                              */
/* -------------------------------------------------------------------------- */

export const users = pgTable('users', {
  id: text('id').primaryKey(), // 'user_xxx' (preserve IDs)
  email: text('email').unique(),
  name: text('name'),
  // `image` matches @auth/drizzle-adapter's expected column name (the
  // adapter writes the Google profile picture URL here). Renamed from
  // `picture` per Auth.js v5 convention. ETL in migrate-from-mongo.ts
  // reads `doc.picture` from Mongo and writes it into `image`.
  image: text('image'),
  // `emailVerified` is written by the Auth.js adapter when Google returns
  // a verified email. Optional — guests and unverified users have null.
  emailVerified: timestamp('email_verified', { withTimezone: true, mode: 'date' }),
  modelProvider: text('model_provider').notNull().default('gemini'),
  isGuest: boolean('is_guest').notNull().default(false),
  // Phase 2 — curated dev personas. `personaKey` is a stable display
  // handle (`founder`, `starter`, `overdue`, `dormant`, `dense`,
  // `memory_heavy`); it does NOT replace `users.id` (the row id remains
  // the auth identity). `personaWeight` orders the persona menu so the
  // founder is always first.
  personaKey: text('persona_key'),
  personaWeight: integer('persona_weight').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const goals = pgTable('goals', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  horizon: text('horizon', {
    enum: ['weekly', 'short', 'medium', 'long'],
  }).notNull(),
  why: text('why').notNull().default(''),
  nextAction: text('next_action').notNull().default(''),
  startDate: date('start_date'),
  targetDate: date('target_date'),
  status: text('status', {
    enum: ['active', 'paused', 'dropped'],
  })
    .notNull()
    .default('active'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const commitments = pgTable('commitments', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  goalId: text('goal_id').references(() => goals.id, { onDelete: 'set null' }),
  goalTitle: text('goal_title').notNull().default(''),
  text: text('text').notNull(),
  due: date('due'),
  status: text('status', { enum: ['open', 'done'] })
    .notNull()
    .default('open'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const milestones = pgTable('milestones', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  goalId: text('goal_id').references(() => goals.id, { onDelete: 'set null' }),
  goalTitle: text('goal_title').notNull().default(''),
  title: text('title').notNull(),
  targetDate: date('target_date'),
  status: text('status').notNull().default('open'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const blockers = pgTable('blockers', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date'),
  note: text('note').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

/* -------------------------------------------------------------------------- */
/* Conversations — Phase 3 thread model                                        */
/*                                                                             */
/* A conversation is one coach thread: a fresh thread is opened when the user */
/* hits "Add goal", "Plan my day", or "Review progress" from the dashboard, so */
/* each starts from a clean transcript. The migration seeds one `general`     */
/* conversation per existing user (id `conv_general_<user_id>`); newly-created */
/* guests get their `general` row on first chat insert (idempotent INSERT).   */
/* -------------------------------------------------------------------------- */

export const conversations = pgTable('conversations', {
  id: text('id').primaryKey(), // 'conv_general_<user_id>' or 'conv_<kind>_<uuid>'
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind', {
    enum: ['general', 'add_goal', 'plan_day', 'review_progress', 'edit_goal', 'drop_goal'],
  })
    .notNull()
    .default('general'),
  goalId: text('goal_id').references(() => goals.id, { onDelete: 'set null' }),
  title: text('title').notNull().default(''),
  status: text('status', { enum: ['open', 'closed'] })
    .notNull()
    .default('open'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const messages = pgTable('messages', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  // Phase 3 — every chat thread belongs to a conversation row. The
  // default per-user thread is `conv_general_<user_id>`, seeded by
  // migration 0006_conversations.sql. The schema enforces NOT NULL so
  // dangling messages are impossible. Pass an explicit conversationId
  // from the chat route; clients that need a fresh thread mint a
  // new conversation row first.
  conversationId: text('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['user', 'assistant'] }).notNull(),
  content: text('content').notNull(),
  provider: text('provider'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const proposals = pgTable('proposals', {
  id: text('id').primaryKey(),
  messageId: text('message_id')
    .notNull()
    .references(() => messages.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  // Phase 3 — see messages.conversationId above.
  conversationId: text('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  action: text('action').notNull(),
  args: jsonb('args').notNull(),
  status: text('status', { enum: ['pending', 'confirmed', 'rejected'] })
    .notNull()
    .default('pending'),
  result: text('result'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
})

export const auditLog = pgTable('audit_log', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  summary: text('summary').notNull(),
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const sources = pgTable('sources', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  goalId: text('goal_id').references(() => goals.id, { onDelete: 'set null' }),
  goalTitle: text('goal_title').notNull().default(''),
  kind: text('kind', { enum: ['file', 'link'] }).notNull(),
  storagePath: text('storage_path').notNull().default(''),
  originalFilename: text('original_filename').notNull(),
  contentType: text('content_type').notNull(),
  size: integer('size').notNull().default(0),
  url: text('url').notNull().default(''),
  textExcerpt: text('text_excerpt'),
  isDeleted: boolean('is_deleted').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

/* -------------------------------------------------------------------------- */
/* Memories — user-pinned photos and Instagram-style embeds. Distinct from   */
/* `sources` (which are reference material the coach reasons over) — these  */
/* are the user's own 'why does this matter' artefacts that anchor goals.    */
/*                                                                             */
/* Photo kind:        source_id pointer to the underlying `sources` row.     */
/* Instagram kind:    external_url + parsed shortcode. The embed displays   */
/*                    via the canonical instagram.com/p/{shortcode}/embed   */
/*                    URL; we don't scrape Instagram (no auth, fragile).     */
/* ------------------------------------------------------------------------- */
export const memories = pgTable('memories', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['photo', 'instagram'] }).notNull(),
  caption: text('caption').notNull().default(''),
  goalId: text('goal_id').references(() => goals.id, { onDelete: 'set null' }),
  goalTitle: text('goal_title').notNull().default(''),
  sourceId: text('source_id'),
  externalUrl: text('external_url'),
  instagramShortcode: text('instagram_shortcode'),
  width: integer('width'),
  height: integer('height'),
  mimeType: text('mime_type'),
  sizeBytes: integer('size_bytes'),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

/* -------------------------------------------------------------------------- */
/* Auth.js v5 tables (per @auth/drizzle-adapter spec)                         */
/*                                                                             */
/* Even though we use JWT session strategy (see architecture plan Section 3),  */
/* the adapter still expects all four tables to exist so it can write rows     */
/* for OAuth account linking.                                                 */
/* -------------------------------------------------------------------------- */

export const accounts = pgTable(
  'accounts',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (account) => [
    primaryKey({
      columns: [account.provider, account.providerAccountId],
    }),
  ]
)

export const sessions = pgTable('sessions', {
  sessionToken: text('session_token').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { withTimezone: true }).notNull(),
})

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { withTimezone: true }).notNull(),
  },
  (vt) => [
    primaryKey({
      columns: [vt.identifier, vt.token],
    }),
  ]
)

/* -------------------------------------------------------------------------- */
/* user_sessions — runtime-managed session tokens                             */
/*                                                                             */
/* Mirror of the legacy Python `user_sessions` collection. Links Emergent-    */
/* issued `session_token` cookies to a `users.id`. Read/written by raw SQL   */
/* in lib/auth.ts (see auth.ts:161 SELECT, auth.ts:229 INSERT).               */
/* -------------------------------------------------------------------------- */

export const userSessions = pgTable('user_sessions', {
  sessionToken: text('session_token').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/* -------------------------------------------------------------------------- */
/* state_overrides — per-user tunable overrides to computed state              */
/*                                                                             */
/* Referenced from lib/auth.ts:255 in the guest-migration UPDATE loop.       */
/* Shape (jsonb `payload`) is forward-compatible — the migration only needs   */
/* `user_id` to exist for the UPDATE SET user_id = ... WHERE user_id = ...   */
/* to succeed; no read/write paths exist yet.                                  */
/* -------------------------------------------------------------------------- */

export const stateOverrides = pgTable('state_overrides', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  payload: jsonb('payload'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

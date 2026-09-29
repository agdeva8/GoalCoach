#!/usr/bin/env tsx
/**
 * Seed the six canonical dev personas.
 *
 * Hard-gated on `process.env.ALLOW_DEV_LOGIN === 'true'`. Refuses to
 * run otherwise so this script can never be invoked against
 * production by accident.
 *
 * Idempotent: every INSERT uses deterministic ids derived from the
 * persona key + an in-persona sequence number. Re-running the script
 * hits `ON CONFLICT (id) DO NOTHING` on every row, so it's a true
 * no-op. To force a re-seed, run `scripts/reset-dev-data.ts
 * --confirm` first.
 *
 * The six personas cover the UX matrix the UI needs to look right in
 * review:
 *
 *   founder        Dev User (re-seeds as the canonical dev account)
 *   starter        Priya Nair (first-ever goal, no history)
 *   overdue        Marcus Bell (open commitments past their due date)
 *   dormant        Ana Duarte (goals untouched for 21 days)
 *   dense          Kenji Sato (6 goals, week fully booked)
 *   memory_heavy   Sofia Iqbal (3 goals + photo/instagram memories)
 *
 * Why not `import { db } from '@/lib/db'`: that module pulls in
 * `lib/env.ts` which has an `import 'server-only'` guard and crashes
 * when invoked from a CLI script outside the Next.js server runtime.
 * We open a `pg` pool directly so the script can run via `tsx`.
 *
 * Usage:
 *   pnpm tsx scripts/seed-personas.ts
 */

import 'dotenv/config'

import pg from 'pg'

const ALLOW = process.env.ALLOW_DEV_LOGIN
const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  console.error('[seed] DATABASE_URL is not set. Aborting.')
  process.exit(2)
}

if (ALLOW !== 'true') {
  console.error('[seed] ALLOW_DEV_LOGIN must be "true" to run this script. Aborting.')
  process.exit(2)
}

const { Pool } = pg
const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })

/* -------------------------------------------------------------------------- */
/* ID + date helpers                                                          */
/* -------------------------------------------------------------------------- */

interface IdGen {
  goal: () => string
  milestone: () => string
  commit: () => string
  blocker: () => string
  memory: () => string
  tb: () => string
}

/**
 * Per-persona id generator. The counter resets between runs because
 * the process exits, so the same persona produces the same ids every
 * run — which is what makes ON CONFLICT (id) DO NOTHING idempotent.
 */
function personaIds(personaKey: string): IdGen {
  let n = 0
  const personaTag = personaKey
    .replace(/[^a-z0-9]+/gi, '')
    .toLowerCase()
    .slice(0, 8)
    .padEnd(8, '0')
  const make = (prefix: string) => {
    n += 1
    const kindTag = prefix.replace(/[^a-z]/gi, '').slice(0, 2).toLowerCase()
    const seq = n.toString(36).padStart(3, '0')
    return `${prefix}_${personaTag}${kindTag}${seq}`
  }
  return {
    goal: () => make('goal'),
    milestone: () => make('milestone'),
    commit: () => make('commit'),
    blocker: () => make('blocker'),
    memory: () => make('memory'),
    tb: () => make('tb'),
  }
}

function userIdForPersona(personaKey: string): string {
  const suffix = personaKey.replace(/[^a-z0-9]+/gi, '').toLowerCase()
  return `user_persona_${suffix}`
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function offsetDays(base: Date, n: number): Date {
  const out = new Date(base)
  out.setUTCDate(out.getUTCDate() + n)
  return out
}

/* -------------------------------------------------------------------------- */
/* Persona specs                                                              */
/*                                                                             */
/* Each spec is wrapped in an IIFE so the per-persona `id` closure can be     */
/* referenced from the nested goal/milestone/commitment literals without     */
/* threading it through every level.                                          */
/* -------------------------------------------------------------------------- */

interface GoalSpec {
  id: string
  title: string
  horizon: 'weekly' | 'short' | 'medium' | 'long'
  why: string
  nextAction: string
  status?: 'active' | 'paused' | 'dropped'
  milestones?: Array<{ id: string; title: string; targetDate: string; status?: string }>
  commitments?: Array<{
    id: string
    text: string
    dueOffsetDays: number
    status?: 'open' | 'done'
  }>
  blockers?: Array<{
    id: string
    title: string
    startOffsetDays: number
    endOffsetDays?: number
    note?: string
  }>
}

interface MemorySpec {
  id: string
  kind: 'photo' | 'instagram'
  caption: string
  goalTitle?: string
  sourceId?: string | null
  externalUrl?: string | null
  instagramShortcode?: string | null
  width?: number | null
  height?: number | null
  mimeType?: string | null
  sizeBytes?: number | null
  occurredOffsetDays: number
  startTime?: string | null
  endTime?: string | null
}

interface TimetableSpec {
  id: string
  blockOffsetDays: number
  startTime: string
  endTime: string
  label: string
  kind?: 'commitment' | 'routine' | 'blocker' | 'focus'
  source?: 'manual' | 'plan' | 'commitment' | 'blocker'
  sourceId?: string | null
  goalTitle?: string
  note?: string
}

interface PersonaSpec {
  personaKey: string
  personaWeight: number
  userId: string
  name: string
  email: string
  goals: GoalSpec[]
  memories?: MemorySpec[]
  timetable?: TimetableSpec[]
}

function buildSpecs(): PersonaSpec[] {
  const today = new Date()

  return [
    /* ---------------------------------------------------------------- */
    /* founder — Dev User. Mirrors the reset script's reseed so this   */
    /* persona is always available, even without running reset first. */
    /* ---------------------------------------------------------------- */
    (() => {
      const id = personaIds('founder')
      return {
        personaKey: 'founder',
        personaWeight: 10,
        userId: 'user_founder01',
        name: 'Dev User',
        email: 'founder@sutra.local',
        goals: [
          {
            id: id.goal(),
            title: 'Ship persona-aware planner UI',
            horizon: 'weekly' as const,
            why: 'Reviewers want to see the planner working for every persona bucket.',
            nextAction: 'Wire /api/auth/personas response into the PersonaMenu dropdown.',
            milestones: [
              { id: id.milestone(), title: 'Header dropdown shows weights', targetDate: isoDate(offsetDays(today, 3)) },
              { id: id.milestone(), title: 'Tab key cycles personas', targetDate: isoDate(offsetDays(today, 7)) },
            ],
            commitments: [
              { id: id.commit(), text: 'Read response-user resolver diff', dueOffsetDays: 0, status: 'done' },
              { id: id.commit(), text: 'Add fallback for missing persona_key', dueOffsetDays: 1 },
              { id: id.commit(), text: 'Smoke-test all six personas in dev', dueOffsetDays: 2 },
            ],
          },
          {
            id: id.goal(),
            title: 'Get healthier',
            horizon: 'short' as const,
            why: 'Sustained energy for the next launch cycle.',
            nextAction: 'Book a 30-min walk after standup tomorrow.',
            milestones: [
              { id: id.milestone(), title: '20 walks logged', targetDate: isoDate(offsetDays(today, 21)) },
            ],
            commitments: [
              { id: id.commit(), text: 'Walk 30 min after standup', dueOffsetDays: 1 },
              { id: id.commit(), text: 'Track meals in the journal', dueOffsetDays: 0, status: 'done' },
            ],
          },
          {
            id: id.goal(),
            title: 'Land the Q3 release by Aug 31',
            horizon: 'medium' as const,
            why: 'Avoid the Sep 1 milestone slippage from last cycle.',
            nextAction: 'Final review with the QA team this Friday.',
            milestones: [
              { id: id.milestone(), title: 'Feature freeze', targetDate: isoDate(offsetDays(today, 14)) },
              { id: id.milestone(), title: 'Public launch', targetDate: isoDate(offsetDays(today, 30)) },
            ],
            commitments: [
              { id: id.commit(), text: 'Cut over release notes', dueOffsetDays: 5 },
            ],
          },
        ],
      }
    })(),

    /* ---------------------------------------------------------------- */
    /* starter — first-ever goal, empty planner.                       */
    /* ---------------------------------------------------------------- */
    (() => {
      const id = personaIds('starter')
      return {
        personaKey: 'starter',
        personaWeight: 20,
        userId: userIdForPersona('starter'),
        name: 'Priya Nair',
        email: 'priya@dev.local',
        goals: [
          {
            id: id.goal(),
            title: 'Set up my first weekly intention',
            horizon: 'weekly' as const,
            why: 'Get oriented before I add more goals.',
            nextAction: 'Write a one-sentence intention for the week.',
            commitments: [
              { id: id.commit(), text: 'Draft a one-sentence intention', dueOffsetDays: 1 },
            ],
          },
        ],
      }
    })(),

    /* ---------------------------------------------------------------- */
    /* overdue — 2 goals, many past-due commitments, one open blocker. */
    /* ---------------------------------------------------------------- */
    (() => {
      const id = personaIds('overdue')
      return {
        personaKey: 'overdue',
        personaWeight: 30,
        userId: userIdForPersona('overdue'),
        name: 'Marcus Bell',
        email: 'marcus@dev.local',
        goals: [
          {
            id: id.goal(),
            title: 'Launch the partner portal',
            horizon: 'short' as const,
            why: 'Three partners are blocked on this.',
            nextAction: 'Send the overdue follow-up email.',
            milestones: [
              { id: id.milestone(), title: 'Beta opens', targetDate: isoDate(offsetDays(today, 14)) },
            ],
            commitments: [
              { id: id.commit(), text: 'Email partner leads', dueOffsetDays: -7, status: 'open' },
              { id: id.commit(), text: 'Cut release notes draft', dueOffsetDays: -3, status: 'open' },
              { id: id.commit(), text: 'Book launch rehearsal', dueOffsetDays: -1, status: 'open' },
              { id: id.commit(), text: 'Send final invite list', dueOffsetDays: 2 },
            ],
            blockers: [
              {
                id: id.blocker(),
                title: 'Legal review pending on partner DPA',
                startOffsetDays: -10,
                endOffsetDays: 5,
                note: 'Asked for a status update on 2026-09-22.',
              },
            ],
          },
          {
            id: id.goal(),
            title: 'Get back to running 3x/week',
            horizon: 'short' as const,
            why: 'Energy dropped since April.',
            nextAction: 'Schedule tomorrow morning before it slips.',
            commitments: [
              { id: id.commit(), text: 'Run 3km Tuesday', dueOffsetDays: -5, status: 'open' },
              { id: id.commit(), text: 'Run 5km Saturday', dueOffsetDays: -2, status: 'open' },
              { id: id.commit(), text: 'Log run in journal', dueOffsetDays: 1 },
            ],
          },
        ],
      }
    })(),

    /* ---------------------------------------------------------------- */
    /* dormant — goals untouched 21 days, no blockers.                 */
    /* ---------------------------------------------------------------- */
    (() => {
      const id = personaIds('dormant')
      return {
        personaKey: 'dormant',
        personaWeight: 40,
        userId: userIdForPersona('dormant'),
        name: 'Ana Duarte',
        email: 'ana@dev.local',
        goals: [
          {
            id: id.goal(),
            title: 'Learn conversational Spanish',
            horizon: 'long' as const,
            why: 'Trip to Buenos Aires in November.',
            nextAction: 'Re-activate with a 10-minute review session.',
            milestones: [
              { id: id.milestone(), title: 'Finish chapter 6 of textbook', targetDate: isoDate(offsetDays(today, 30)) },
            ],
            commitments: [
              { id: id.commit(), text: '10-min review session', dueOffsetDays: 0 },
              { id: id.commit(), text: 'Watch one Spanish-language podcast', dueOffsetDays: 1 },
            ],
          },
          {
            id: id.goal(),
            title: 'Reorganize the home office',
            horizon: 'short' as const,
            why: 'Working from a corner of the kitchen has stopped working.',
            nextAction: 'Block Saturday morning to sort cables.',
            commitments: [
              { id: id.commit(), text: 'Order the new monitor arm', dueOffsetDays: 3 },
            ],
          },
        ],
      }
    })(),

    /* ---------------------------------------------------------------- */
    /* dense — 6 goals, week fully booked, over-committed.             */
    /* ---------------------------------------------------------------- */
    (() => {
      const id = personaIds('dense')
      return {
        personaKey: 'dense',
        personaWeight: 50,
        userId: userIdForPersona('dense'),
        name: 'Kenji Sato',
        email: 'kenji@dev.local',
        goals: [
          {
            id: id.goal(),
            title: 'Close the Series A',
            horizon: 'short' as const,
            why: 'Runway ends in 6 months.',
            nextAction: 'Send the updated deck tonight.',
            commitments: [
              { id: id.commit(), text: 'Pitch deck v3', dueOffsetDays: 0 },
              { id: id.commit(), text: 'Investor email batch 2', dueOffsetDays: 1 },
            ],
          },
          {
            id: id.goal(),
            title: 'Hire two senior engineers',
            horizon: 'medium' as const,
            why: 'Roadmap is blocked on hiring.',
            nextAction: 'Review the on-site panel scores.',
            commitments: [
              { id: id.commit(), text: 'Onsite debrief', dueOffsetDays: 0 },
              { id: id.commit(), text: 'Send offers', dueOffsetDays: 2 },
            ],
          },
          {
            id: id.goal(),
            title: 'Train for the half-marathon',
            horizon: 'medium' as const,
            why: 'Race is in November.',
            nextAction: 'Long run Sunday at 6am.',
            commitments: [
              { id: id.commit(), text: 'Long run 18km', dueOffsetDays: 2 },
              { id: id.commit(), text: 'Easy run 8km', dueOffsetDays: 1 },
            ],
          },
          {
            id: id.goal(),
            title: 'Refactor the billing service',
            horizon: 'short' as const,
            why: 'Incidents every week now.',
            nextAction: 'Draft the migration plan.',
            commitments: [
              { id: id.commit(), text: 'Migration plan draft', dueOffsetDays: 1 },
            ],
          },
          {
            id: id.goal(),
            title: 'Reconnect with the college cohort',
            horizon: 'long' as const,
            why: 'Annual reunion in October.',
            nextAction: 'Send the group-chat message.',
            commitments: [
              { id: id.commit(), text: 'Group-chat message', dueOffsetDays: 0 },
            ],
          },
          {
            id: id.goal(),
            title: 'Read one book per month',
            horizon: 'long' as const,
            why: 'Recharge after the IPO chaos.',
            nextAction: 'Finish chapter 4 of The Beginning of Infinity.',
            commitments: [
              { id: id.commit(), text: 'Read chapter 5', dueOffsetDays: 2 },
            ],
          },
        ],
        timetable: [
          // Day 0 — today, full day scheduled.
          { id: id.tb(), blockOffsetDays: 0, startTime: '07:00', endTime: '08:00', label: 'Morning run', kind: 'routine', source: 'manual' },
          { id: id.tb(), blockOffsetDays: 0, startTime: '09:00', endTime: '11:00', label: 'Investor pitch deck v3', kind: 'focus', source: 'manual', goalTitle: 'Close the Series A' },
          { id: id.tb(), blockOffsetDays: 0, startTime: '11:30', endTime: '12:30', label: 'Onsite debrief', kind: 'commitment', source: 'manual', goalTitle: 'Hire two senior engineers' },
          { id: id.tb(), blockOffsetDays: 0, startTime: '13:00', endTime: '14:00', label: 'Lunch with the team', kind: 'commitment', source: 'manual' },
          { id: id.tb(), blockOffsetDays: 0, startTime: '14:00', endTime: '16:00', label: 'Billing refactor plan', kind: 'focus', source: 'manual', goalTitle: 'Refactor the billing service' },
          { id: id.tb(), blockOffsetDays: 0, startTime: '16:00', endTime: '17:00', label: 'Investor email batch 2', kind: 'commitment', source: 'manual', goalTitle: 'Close the Series A' },
          { id: id.tb(), blockOffsetDays: 0, startTime: '19:00', endTime: '20:00', label: 'Group-chat message', kind: 'commitment', source: 'manual', goalTitle: 'Reconnect with the college cohort' },
          { id: id.tb(), blockOffsetDays: 0, startTime: '20:30', endTime: '22:00', label: 'Read chapter 5', kind: 'commitment', source: 'manual', goalTitle: 'Read one book per month' },
          // Day 1
          { id: id.tb(), blockOffsetDays: 1, startTime: '07:00', endTime: '08:00', label: 'Easy run 8km', kind: 'routine', source: 'manual', goalTitle: 'Train for the half-marathon' },
          { id: id.tb(), blockOffsetDays: 1, startTime: '09:00', endTime: '11:00', label: 'Migration plan draft', kind: 'commitment', source: 'manual', goalTitle: 'Refactor the billing service' },
          { id: id.tb(), blockOffsetDays: 1, startTime: '11:30', endTime: '13:00', label: 'Long run 18km (Sunday)', kind: 'commitment', source: 'manual', goalTitle: 'Train for the half-marathon', note: 'Move to the calendar morning slot' },
          // Day 2
          { id: id.tb(), blockOffsetDays: 2, startTime: '10:00', endTime: '11:30', label: 'Send offers', kind: 'commitment', source: 'manual', goalTitle: 'Hire two senior engineers' },
          { id: id.tb(), blockOffsetDays: 2, startTime: '15:00', endTime: '16:30', label: 'Pitch practice with Maya', kind: 'commitment', source: 'manual', goalTitle: 'Close the Series A' },
        ],
      }
    })(),

    /* ---------------------------------------------------------------- */
    /* memory_heavy — 3 goals + photo/instagram memories across days. */
    /* ---------------------------------------------------------------- */
    (() => {
      const id = personaIds('memory_heavy')
      return {
        personaKey: 'memory_heavy',
        personaWeight: 60,
        userId: userIdForPersona('memory_heavy'),
        name: 'Sofia Iqbal',
        email: 'sofia@dev.local',
        goals: [
          {
            id: id.goal(),
            title: 'Get to a 10km PR',
            horizon: 'medium' as const,
            why: 'Race day is in October.',
            nextAction: 'Easy 6km tomorrow morning.',
            commitments: [
              { id: id.commit(), text: 'Easy 6km', dueOffsetDays: 1 },
            ],
          },
          {
            id: id.goal(),
            title: 'Save for the Japan trip',
            horizon: 'medium' as const,
            why: 'Tickets go on sale next month.',
            nextAction: 'Move ¥50,000 to the travel fund.',
            commitments: [
              { id: id.commit(), text: 'Transfer ¥50k', dueOffsetDays: 0, status: 'done' },
              { id: id.commit(), text: 'Set up auto-deposit', dueOffsetDays: 2 },
            ],
          },
          {
            id: id.goal(),
            title: 'Cook one new recipe a week',
            horizon: 'short' as const,
            why: 'I keep defaulting to delivery.',
            nextAction: 'Try the miso-eggplant recipe from the saved photo.',
            commitments: [
              { id: id.commit(), text: 'Miso-eggplant dinner', dueOffsetDays: 1 },
              { id: id.commit(), text: 'Grocery run', dueOffsetDays: 0, status: 'done' },
            ],
          },
        ],
        memories: [
          {
            id: id.memory(),
            kind: 'instagram',
            caption: 'Sunrise run along the bay — fastest 5km yet.',
            goalTitle: 'Get to a 10km PR',
            externalUrl: 'https://www.instagram.com/p/Ck8H2qXv4rL/',
            instagramShortcode: 'Ck8H2qXv4rL',
            width: 1080,
            height: 1080,
            occurredOffsetDays: -2,
            startTime: '06:30',
            endTime: '07:15',
          },
          {
            id: id.memory(),
            kind: 'photo',
            caption: 'Race bib pickup, October 2024 — reminder of why.',
            goalTitle: 'Get to a 10km PR',
            width: 4032,
            height: 3024,
            mimeType: 'image/jpeg',
            sizeBytes: 4_500_000,
            occurredOffsetDays: 0,
            startTime: '18:00',
            endTime: '18:05',
          },
          {
            id: id.memory(),
            kind: 'instagram',
            caption: 'Saved the miso-eggplant recipe — trying it tonight.',
            goalTitle: 'Cook one new recipe a week',
            externalUrl: 'https://www.instagram.com/p/Dk8Mn4Xr2vQ/',
            instagramShortcode: 'Dk8Mn4Xr2vQ',
            width: 1080,
            height: 1350,
            occurredOffsetDays: 0,
            startTime: '19:30',
            endTime: '19:35',
          },
          {
            id: id.memory(),
            kind: 'photo',
            caption: 'Tokyo neighbourhood to visit.',
            goalTitle: 'Save for the Japan trip',
            width: 4032,
            height: 3024,
            mimeType: 'image/jpeg',
            sizeBytes: 5_100_000,
            occurredOffsetDays: -1,
          },
        ],
      }
    })(),
  ]
}

/* -------------------------------------------------------------------------- */
/* Insert helpers                                                             */
/* -------------------------------------------------------------------------- */

async function upsertUser(spec: PersonaSpec): Promise<'created' | 'updated'> {
  // ON CONFLICT DO UPDATE on the user row: dev-login overrides the
  // name to "Dev User" the first time you switch to a persona, and
  // we want re-running the seed to restore the canonical names. The
  // child rows below keep the strict DO NOTHING behaviour so we don't
  // accumulate duplicates.
  await pool.query(
    `
    INSERT INTO users (id, email, name, image, model_provider, is_guest, persona_key, persona_weight, created_at)
    VALUES ($1, $2, $3, NULL, 'gemini', false, $4, $5, NOW())
    ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name,
          email = EXCLUDED.email,
          persona_key = EXCLUDED.persona_key,
          persona_weight = EXCLUDED.persona_weight
  `,
    [spec.userId, spec.email, spec.name, spec.personaKey, spec.personaWeight],
  )
  // Also seed a general conversation for the persona so chat works on
  // first load (mirrors the migration backfill).
  await pool.query(
    `
    INSERT INTO conversations (id, user_id, kind, title, status, created_at, last_message_at)
    VALUES ($1, $2, 'general', '', 'open', NOW(), NOW())
    ON CONFLICT (id) DO NOTHING
  `,
    [`conv_general_${spec.userId}`, spec.userId],
  )
  // We can't cheaply tell from the upsert above whether the row was
  // inserted or updated, so report by inspecting the database state.
  const r = await pool.query<{ created_at: Date }>(
    `SELECT created_at FROM users WHERE id = $1`,
    [spec.userId],
  )
  // The seed always sets created_at on insert. If the current
  // created_at is within the last few seconds of NOW(), treat as
  // just-created; otherwise the row was updated (i.e. pre-existed).
  const created = r.rows[0]
  const ageMs = Date.now() - new Date(created.created_at).getTime()
  return ageMs < 5_000 ? 'created' : 'updated'
}

async function insertGoalFor(spec: PersonaSpec, goal: GoalSpec): Promise<void> {
  await pool.query(
    `
    INSERT INTO goals (id, user_id, title, horizon, why, next_action, status, start_date, target_date, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, NOW(), NOW())
    ON CONFLICT (id) DO NOTHING
  `,
    [
      goal.id,
      spec.userId,
      goal.title,
      goal.horizon,
      goal.why,
      goal.nextAction,
      goal.status ?? 'active',
      isoDate(new Date()),
    ],
  )
  for (const m of goal.milestones ?? []) {
    await pool.query(
      `
      INSERT INTO milestones (id, user_id, goal_id, goal_title, title, target_date, status, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (id) DO NOTHING
    `,
      [m.id, spec.userId, goal.id, goal.title, m.title, m.targetDate, m.status ?? 'open'],
    )
  }
  for (const c of goal.commitments ?? []) {
    await pool.query(
      `
      INSERT INTO commitments (id, user_id, goal_id, goal_title, text, due, status, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (id) DO NOTHING
    `,
      [
        c.id,
        spec.userId,
        goal.id,
        goal.title,
        c.text,
        isoDate(offsetDays(new Date(), c.dueOffsetDays)),
        c.status ?? 'open',
      ],
    )
  }
  for (const b of goal.blockers ?? []) {
    await pool.query(
      `
      INSERT INTO blockers (id, user_id, title, start_date, end_date, note, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (id) DO NOTHING
    `,
      [
        b.id,
        spec.userId,
        b.title,
        isoDate(offsetDays(new Date(), b.startOffsetDays)),
        b.endOffsetDays === undefined ? null : isoDate(offsetDays(new Date(), b.endOffsetDays)),
        b.note ?? '',
      ],
    )
  }
}

async function insertMemoryFor(spec: PersonaSpec, mem: MemorySpec): Promise<void> {
  await pool.query(
    `
    INSERT INTO memories (
      id, user_id, kind, caption, goal_id, goal_title, source_id,
      external_url, instagram_shortcode, width, height, mime_type,
      size_bytes, metadata, occurred_on, start_time, end_time, created_at
    )
    VALUES (
      $1, $2, $3, $4, NULL, $5, $6,
      $7, $8, $9, $10, $11,
      $12, '{}'::jsonb, $13, $14, $15, NOW()
    )
    ON CONFLICT (id) DO NOTHING
  `,
    [
      mem.id,
      spec.userId,
      mem.kind,
      mem.caption,
      mem.goalTitle ?? '',
      mem.sourceId ?? null,
      mem.externalUrl ?? null,
      mem.instagramShortcode ?? null,
      mem.width ?? null,
      mem.height ?? null,
      mem.mimeType ?? null,
      mem.sizeBytes ?? null,
      isoDate(offsetDays(new Date(), mem.occurredOffsetDays)),
      mem.startTime ?? null,
      mem.endTime ?? null,
    ],
  )
}

async function insertTimetableBlockFor(spec: PersonaSpec, tb: TimetableSpec): Promise<void> {
  await pool.query(
    `
    INSERT INTO timetable_blocks (
      id, user_id, block_date, start_time, end_time, label,
      kind, source, source_id, goal_id, goal_title, note, created_at, updated_at
    )
    VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, NULL, $10, $11, NOW(), NOW()
    )
    ON CONFLICT (id) DO NOTHING
  `,
    [
      tb.id,
      spec.userId,
      isoDate(offsetDays(new Date(), tb.blockOffsetDays)),
      tb.startTime,
      tb.endTime,
      tb.label,
      tb.kind ?? 'commitment',
      tb.source ?? 'manual',
      tb.sourceId ?? null,
      tb.goalTitle ?? '',
      tb.note ?? '',
    ],
  )
}

async function main(): Promise<void> {
  const specs = buildSpecs()
  let created = 0
  let updated = 0
  let goalsInserted = 0
  let memoriesInserted = 0
  let timetableInserted = 0

  for (const spec of specs) {
    const outcome = await upsertUser(spec)
    if (outcome === 'created') created += 1
    else updated += 1

    for (const goal of spec.goals) {
      await insertGoalFor(spec, goal)
      goalsInserted += 1
    }
    for (const mem of spec.memories ?? []) {
      await insertMemoryFor(spec, mem)
      memoriesInserted += 1
    }
    for (const tb of spec.timetable ?? []) {
      await insertTimetableBlockFor(spec, tb)
      timetableInserted += 1
    }
    console.log(`[seed] ${spec.personaKey.padEnd(13)} user=${spec.userId} (${outcome})`)
  }

  console.log(
    `[seed] done. users ${created} created / ${updated} updated; ${goalsInserted} goals; ${memoriesInserted} memories; ${timetableInserted} timetable blocks.`,
  )
  await pool.end()
}

main().catch(async (e) => {
  console.error('[seed] FATAL', e)
  try {
    await pool.end()
  } catch {
    /* ignore */
  }
  process.exit(1)
})

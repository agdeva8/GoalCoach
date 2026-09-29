# Area-Carousel Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Standing rule (founder, 2026-09-23):** Run `/qa` after every slice. This is a binding execution rule, not optional.

**Goal:** Replace the horizon primer on the home page with an area carousel that persists user area preferences and feeds selected areas into the chat system prompt. Delete `Primer.tsx` and remove the `?horizon=` requirement from `/chat`.

**Architecture:**
- New `user_area_preferences (user_id, area_key, selected_at)` table — normalized per founder decision (vs. the L0's initial sketch of `users.areas TEXT[]`). One row per (user, area); upsert on write; idempotent on read.
- New `<AreaCarousel />` wraps the existing `<AreaChips />` (Task 11, f9b0ede) — area chips were correctly factored as a pure chip strip; the carousel adds multi-select state and a "Continue" CTA.
- Home page (`apps/web/app/page.tsx`) gates on auth, then on whether the user has any selected areas. Three states: anonymous → sign-in CTA, authed + no areas → `<AreaCarousel />`, authed + has areas → `redirect('/chat')`.
- New `POST /api/onboarding` accepts `{ areas: string[] }`, upserts into `user_area_preferences`, returns 200. Skip is allowed (empty array).
- Chat route (`apps/web/app/api/chat/route.ts`) reads the user's selected areas and passes them to `systemPrompt()` as a third positional argument. The prompt formats them as "Areas the user cares about: career, health" (omitted when empty).
- Chat page (`apps/web/app/chat/page.tsx`) drops the `VALID_HORIZONS` redirect — `/chat` works without `?horizon=`, defaulting persona to `'week'`. The horizon line in the chat context UI stays (the user can still change horizon inside the chat per L0).
- `apps/web/components/Primer.tsx` and `apps/web/__tests__/components/Primer.test.tsx` are deleted.
- `/onboarding` revisit route is **deferred** to a follow-up slice — not in this plan.

**Tech Stack:** Next.js 15 App Router + Supabase + Drizzle, same as the existing Phase 1 plan. Existing patterns: `packages/db` for queries, `packages/ai` for system prompt, Edge runtime for `/api/*`. No new dependencies.

**Spec:** `docs/office-hours/2026-09-22-product-design-v1.md` (Layer 0) — see the "Onboarding & Personalization" section added 2026-09-23. The plan argues from this revision.

**Existing plan this re-scopes:** `docs/superpowers/plans/2026-09-22-sutra-phase1.md` — Tasks 11 (AreaChips) and 12 (inline mount) ship already; Task 12 was reverted in commit `e7711ab`. This plan supersedes the home-page/Primer work described in that plan; it does NOT re-litigate Tasks 1–10 or 13–23, which remain intact.

## Global Constraints

(All Global Constraints from `2026-09-22-sutra-phase1.md` continue to bind. The ones most likely to bite are repeated here verbatim.)

- **TDD:** Every behavior-changing line preceded by a failing test. Iron law per `CLAUDE.md` hard rule #1. No `skipIf`, no `it.todo`, no `xit`. The test must be observed red before the implementation goes in.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`, `refactor:`). One task = one commit. End every commit message with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- **Design tokens:** `--ink #1A1A1A`, `--paper #FAF8F4`, `--moss #4A5D3A`, `--slate #6B6B68`. Type stack: Fraunces (display), Inter (body), JetBrains Mono (mono). No new tokens without L2 review.
- **Voice:** No em dashes, no AI vocabulary in user-facing copy. `apps/web/__tests__/copy-voice.test.ts` enforces this on `components/` and `app/`.
- **L0/L1 LOCK:** `docs/office-hours/` and `docs/ceo-plans/` are LOCKED. This plan does not edit them. The "Onboarding & Personalization" section in `docs/office-hours/2026-09-22-product-design-v1.md` is the binding design source; if a task contradicts it, STOP and surface to founder.
- **No hardcoded domain rules:** The area enum lives in `packages/db/src/types.ts` as `AreaKey` and in `getAreas()` as the source of truth — both consumer and server read from there. Don't duplicate the list in component code or SQL.
- **pnpm typecheck clean** across all 5 workspaces before commit.
- **Migration naming:** `NNNN_<short_description>.sql` — next slot is `0010`. Mirror the structure of `0009_auth_users_sync.sql` (header comment block explaining what + why + how to verify).

## Review Focus

Spec-implied failure modes that aren't exercised by an individual task's tests. Each gets a regression test pinned to its owning task.

1. **Empty area selection on first sign-in** (Task 3 + Task 5): user lands on the home page with no rows in `user_area_preferences`; the home page must show `<AreaCarousel />` (not redirect). The carousel's "Skip" path must POST `{ areas: [] }` to `/api/onboarding` so the choice is recorded and a refresh doesn't re-prompt.
2. **Areas in prompt are exactly what the user picked** (Task 6): chat route reads `user_area_preferences` and passes them to `systemPrompt(goals, threads, areas)`. A user who picked `career` and `health` must NOT see `learning` in the system prompt. A user who picked nothing must see no "Areas the user cares about:" line at all (no leakage, no placeholder copy).
3. **Multi-device persistence** (Task 2): the same user signing in on a second device must see the same area selection. The query helper reads by `user_id` only; no per-device scoping. Add a test that asserts a second `getUserAreaPreferences(supabase, userId)` returns the same rows.
4. **Concurrent area updates** (Task 5): two browser tabs hitting "Continue" at the same time must both succeed — `upsert` is idempotent on `(user_id, area_key)`. Test: call `/api/onboarding` twice in parallel with the same body, assert no error and rows match.
5. **Chat page works without `?horizon=`** (Task 7): an authenticated user clicking the navbar logo lands on `/chat` directly (no query param); the chat must render `ChatThread` with default persona `'week'`. The previous redirect-to-`/` for missing horizon must be gone.

## Drift items

**None.** The L0 doc revision (2026-09-23) and the founder's three decisions (persistence table, skip-allowed, defer-revisit) are consistent with each other and with the scaffold. If a future drift surfaces during execution, STOP and surface to founder per `CLAUDE.md` drift ownership.

## File structure (target)

```
supabase/
└── migrations/
    └── 0010_user_area_preferences.sql      # NEW (Task 1)

packages/db/src/
├── types.ts                                # MODIFY: UserAreaPreference type (Task 1)
└── queries.ts                              # MODIFY: getUserAreaPreferences, setUserAreaPreferences helpers; drop "presentation-layer" comment (Task 2)

packages/ai/src/
└── prompts.ts                              # MODIFY: systemPrompt(goals, threads, areas) signature (Task 6)

apps/web/
├── components/
│   ├── AreaCarousel.tsx                    # NEW (Task 3)
│   └── Primer.tsx                          # DELETE (Task 8)
├── app/
│   ├── page.tsx                            # MODIFY: render AreaCarousel + auth gate (Task 4)
│   ├── chat/page.tsx                       # MODIFY: drop VALID_HORIZONS, default persona 'week' (Task 7)
│   └── api/
│       ├── chat/route.ts                   # MODIFY: read areas, pass to systemPrompt (Task 6)
│       └── onboarding/route.ts             # NEW (Task 5)
└── __tests__/
    ├── components/
    │   ├── AreaCarousel.test.tsx           # NEW (Task 3)
    │   └── Primer.test.tsx                 # DELETE (Task 8)
    ├── app/
    │   ├── page.test.tsx                   # NEW (Task 4)
    │   └── chat/page.test.tsx              # MODIFY: drop horizon tests (Task 7)
    ├── app/api/
    │   ├── chat.test.ts                    # MODIFY: assert systemPrompt receives areas (Task 6)
    │   └── onboarding.test.ts              # NEW (Task 5)
    └── lib/                                # db helpers tested via the existing __tests__/
        └── db/userAreaPreferences.test.ts  # NEW (Task 2) — extend the existing bucketedGoals.test.ts

packages/db/__tests__/
└── userAreaPreferences.test.ts             # NEW (Task 2)
```

---

## Slice 1: Data layer + carousel component (Tasks 1–3)

Goal: persistence is live, helpers work, the carousel component renders. No UI wiring yet. **End-of-slice: run `/qa` against the dev server, walk the home page as an anonymous user (sign-in CTA) and as an authed user with no areas (carousel renders).** Findings become fix-tasks before Slice 2.

### Task 1: Migration 0010 — `user_area_preferences` table + RLS + grants

**Files:**
- Create: `supabase/migrations/0010_user_area_preferences.sql`
- Modify: `packages/db/src/types.ts` (add `UserAreaPreference` interface)

**Interfaces:**
- Consumes: `auth.users(id)` — the table references the authenticated user's id
- Produces: `public.user_area_preferences` table; a `UserAreaPreference` TS type

- [ ] **Step 1: Write the type**

In `packages/db/src/types.ts`, add at the end:

```ts
export interface UserAreaPreference {
  user_id: string;
  area_key: AreaKey;
  selected_at: string;
}
```

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/0010_user_area_preferences.sql`. Mirror the header style of `0009_auth_users_sync.sql` (what / why / how-to-verify in a leading comment block).

```sql
-- Sutra migration 0010: persist user area preferences.
--
-- Why this exists
-- ---------------
-- Per L0 §"Onboarding & Personalization" (revised 2026-09-23), areas are a
-- first-class personalization axis — not a presentation-layer concept.
-- The home page renders an AreaCarousel on first sign-in; the user picks
-- areas (or skips); the selection persists across sessions and devices
-- and is fed into the chat system prompt as context.
--
-- Why a table, not a users.areas TEXT[] column
-- --------------------------------------------
-- A normalized table lets us add per-area metadata later (selected_at,
-- source, last-shown, etc.) without a destructive column migration. The
-- primary key on (user_id, area_key) makes the upsert idempotent — the
-- "Skip" path and the "Continue" path can both POST without race-prone
-- read-modify-write logic.
--
-- What this migration does
-- ------------------------
-- 1. Defines user_area_preferences with (user_id, area_key) PK.
-- 2. Adds an index on user_id so the per-user lookup is O(log n).
-- 3. Enables RLS and creates a policy that lets each user only read or
--    write their own rows.
-- 4. Grants SELECT/INSERT/UPDATE/DELETE on the table to the authenticated
--    role (RLS still applies; anon gets nothing).

create table if not exists public.user_area_preferences (
  user_id     uuid        not null references auth.users(id) on delete cascade,
  area_key    text        not null check (area_key in ('career','health','relationships','finance','learning','fun')),
  selected_at timestamptz not null default now(),
  primary key (user_id, area_key)
);

create index if not exists user_area_preferences_user_id_idx
  on public.user_area_preferences (user_id);

alter table public.user_area_preferences enable row level security;

drop policy if exists user_area_preferences_select_own on public.user_area_preferences;
create policy user_area_preferences_select_own on public.user_area_preferences
  for select using (auth.uid() = user_id);

drop policy if exists user_area_preferences_insert_own on public.user_area_preferences;
create policy user_area_preferences_insert_own on public.user_area_preferences
  for insert with check (auth.uid() = user_id);

drop policy if exists user_area_preferences_update_own on public.user_area_preferences;
create policy user_area_preferences_update_own on public.user_area_preferences
  for update using (auth.uid() = user_id);

drop policy if exists user_area_preferences_delete_own on public.user_area_preferences;
create policy user_area_preferences_delete_own on public.user_area_preferences
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on public.user_area_preferences to authenticated;
```

- [ ] **Step 3: Apply the migration locally (founder's plate)**

Out-of-band: founder applies `0010_user_area_preferences.sql` to the live Supabase DB via the Supabase SQL editor or `supabase db push`. (This task's commit does NOT run the migration — only the file is committed.)

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @sutra/db typecheck`
Expected: PASS (the new type compiles; no consumer yet uses it).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0010_user_area_preferences.sql packages/db/src/types.ts
git commit -m "feat(db): user_area_preferences table + RLS + grants (L0 onboarding)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

### Task 2: Queries helpers — `getUserAreaPreferences` + `setUserAreaPreferences`

**Files:**
- Modify: `packages/db/src/queries.ts`
- Test: `packages/db/__tests__/userAreaPreferences.test.ts` (new)

**Interfaces:**
- Consumes: `SupabaseClient`, `userId`, and the area enum from `getAreas()` for validation
- Produces:
  - `getUserAreaPreferences(supabase, userId): Promise<UserAreaPreference[]>` — all rows for the user, ordered by `selected_at` ascending (stable order for prompts)
  - `setUserAreaPreferences(supabase, userId, areaKeys: AreaKey[]): Promise<void>` — upserts the given keys; deletes any rows for the user that aren't in the new set, so a user who UN-picks an area has it removed on the next save

- [ ] **Step 1: Write the failing tests**

Create `packages/db/__tests__/userAreaPreferences.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { getUserAreaPreferences, setUserAreaPreferences } from '../src/queries';

function chainFor(rows: any[] = []) {
  // Mirrors the supabase query builder shape we use elsewhere in tests.
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({ data: rows, error: null }),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    }),
    upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

describe('getUserAreaPreferences', () => {
  it('returns rows ordered by selected_at ascending', async () => {
    const rows = [
      { user_id: 'u1', area_key: 'health', selected_at: '2026-09-23T10:00:00Z' },
      { user_id: 'u1', area_key: 'career', selected_at: '2026-09-23T09:00:00Z' },
    ];
    const supabase = { from: vi.fn().mockReturnValue(chainFor(rows)) } as any;
    const out = await getUserAreaPreferences(supabase, 'u1');
    expect(out).toEqual(rows);
  });

  it('returns [] when the user has no rows', async () => {
    const supabase = { from: vi.fn().mockReturnValue(chainFor([])) } as any;
    const out = await getUserAreaPreferences(supabase, 'u1');
    expect(out).toEqual([]);
  });
});

describe('setUserAreaPreferences', () => {
  it('upserts each given area_key for the user', async () => {
    const upsertSpy = vi.fn().mockResolvedValue({ data: null, error: null });
    const eqDeleteMock = vi.fn().mockReturnValue({ in: vi.fn().mockResolvedValue({ data: null, error: null }) });
    const supabase = {
      from: vi.fn().mockReturnValue({
        upsert: upsertSpy,
        delete: vi.fn().mockReturnValue({ eq: eqDeleteMock }),
      }),
    } as any;
    await setUserAreaPreferences(supabase, 'u1', ['career', 'health']);
    expect(upsertSpy).toHaveBeenCalledTimes(2);
    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'u1', area_key: 'career' }),
      expect.any(Object)
    );
    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'u1', area_key: 'health' }),
      expect.any(Object)
    );
  });

  it('deletes rows whose area_key is not in the new set', async () => {
    const inSpy = vi.fn().mockResolvedValue({ data: null, error: null });
    const supabase = {
      from: vi.fn().mockReturnValue({
        upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
        delete: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ in: inSpy }) }),
      }),
    } as any;
    await setUserAreaPreferences(supabase, 'u1', ['career']);
    expect(inSpy).toHaveBeenCalledWith('area_key', ['health', 'relationships', 'finance', 'learning', 'fun']);
  });

  it('handles empty input (skip path) by deleting every existing row', async () => {
    const inSpy = vi.fn().mockResolvedValue({ data: null, error: null });
    const supabase = {
      from: vi.fn().mockReturnValue({
        upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
        delete: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ in: inSpy }) }),
      }),
    } as any;
    await setUserAreaPreferences(supabase, 'u1', []);
    expect(inSpy).toHaveBeenCalledWith('area_key', ['career', 'health', 'relationships', 'finance', 'learning', 'fun']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sutra/db test __tests__/userAreaPreferences.test.ts`
Expected: FAIL — `getUserAreaPreferences` and `setUserAreaPreferences` are not exported.

- [ ] **Step 3: Implement the helpers**

In `packages/db/src/queries.ts`, **delete the leading comment block at lines 4–5** (it claims areas are a presentation-layer concept with no DB table needed for v1 — both are now false post-0010). Keep the `AREAS` constant and `getAreas()` function unchanged.

Then append the two helpers below the existing exports:

```ts
import type { AreaKey, UserAreaPreference } from './types';

// All areas the user CAN pick. Reading from getAreas() keeps this in sync
// with the enum if a future area is added.
import { getAreas } from './queries'; // already in this file

export async function getUserAreaPreferences(
  supabase: SupabaseClient,
  userId: string
): Promise<UserAreaPreference[]> {
  const { data, error } = await supabase
    .from('user_area_preferences')
    .select('user_id, area_key, selected_at')
    .eq('user_id', userId)
    .order('selected_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as UserAreaPreference[];
}

export async function setUserAreaPreferences(
  supabase: SupabaseClient,
  userId: string,
  areaKeys: AreaKey[]
): Promise<void> {
  // Validate against the enum so a stray string in the request body can't
  // be persisted. Server routes also validate, but the helper is the
  // contract surface and must not silently accept unknowns.
  const allowed = new Set(getAreas().map((a) => a.key));
  const filtered = areaKeys.filter((k) => allowed.has(k));

  if (filtered.length > 0) {
    const rows = filtered.map((area_key) => ({ user_id: userId, area_key }));
    const { error } = await supabase.from('user_area_preferences').upsert(rows);
    if (error) throw error;
  }

  // Delete any rows for this user that aren't in the new set, so un-picking
  // an area removes it. No-op when filtered.length === allowed.length.
  const toDelete = getAreas().map((a) => a.key).filter((k) => !filtered.includes(k));
  if (toDelete.length > 0) {
    const { error } = await supabase
      .from('user_area_preferences')
      .delete()
      .eq('user_id', userId)
      .in('area_key', toDelete);
    if (error) throw error;
  }
}
```

Note: `UserAreaPreference` is imported from `./types` at the top of the file (already does `import type { ... } from './types'`). The `getAreas` import line is shown for clarity but is already in the same file (don't add a duplicate import statement).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @sutra/db test`
Expected: PASS. The existing `bucketedGoals.test.ts` and other tests must still pass.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/queries.ts packages/db/__tests__/userAreaPreferences.test.ts
git commit -m "feat(db): getUserAreaPreferences + setUserAreaPreferences helpers

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

### Task 3: `<AreaCarousel />` component — multi-select wrapper around `<AreaChips />`

**Files:**
- Create: `apps/web/components/AreaCarousel.tsx`
- Test: `apps/web/__tests__/components/AreaCarousel.test.tsx` (new)

**Interfaces:**
- Consumes: `<AreaChips />` from `apps/web/components/AreaChips.tsx` (already exists, ships the 6 chip strip), `Area[]` from `getAreas()`
- Produces: a multi-select carousel UI: 6 area chips, each toggles selected/unselected, a "Continue" CTA that calls `onConfirm(areaKeys)`, a "Skip for now" link that calls `onConfirm([])`. Initial state: nothing selected.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/__tests__/components/AreaCarousel.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AreaCarousel } from '@/components/AreaCarousel';

afterEach(() => cleanup());

describe('<AreaCarousel />', () => {
  it('renders the 6 area chips from getAreas()', () => {
    render(<AreaCarousel onConfirm={vi.fn()} />);
    const chips = screen.getAllByRole('button', { name: /add area/i });
    expect(chips).toHaveLength(6);
  });

  it('clicking a chip toggles its selected state (data-selected)', () => {
    render(<AreaCarousel onConfirm={vi.fn()} />);
    const career = screen.getByRole('button', { name: /add area career/i });
    expect(carrier_getDataSelected(career)).toBe('false');
    fireEvent.click(career);
    expect(carrier_getDataSelected(career)).toBe('true');
    fireEvent.click(career);
    expect(carrier_getDataSelected(career)).toBe('false');
  });

  it('Continue button calls onConfirm with the selected area keys', () => {
    const onConfirm = vi.fn();
    render(<AreaCarousel onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: /add area career/i }));
    fireEvent.click(screen.getByRole('button', { name: /add area health/i }));
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(onConfirm).toHaveBeenCalledWith(['career', 'health']);
  });

  it('Skip for now link calls onConfirm with an empty array', () => {
    const onConfirm = vi.fn();
    render(<AreaCarousel onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('text', { name: /skip for now/i }) as any);
    expect(onConfirm).toHaveBeenCalledWith([]);
  });
});

function carrier_getDataSelected(el: HTMLElement): string {
  return el.getAttribute('data-selected') ?? 'false';
}
```

(The helper exists only to satisfy the type checker; the `name` lookup uses the regex from the actual chip `aria-label`.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sutra/web test __tests__/components/AreaCarousel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `apps/web/components/AreaCarousel.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { getAreas, type AreaKey } from '@sutra/db';

export function AreaCarousel({ onConfirm }: { onConfirm: (keys: AreaKey[]) => void }) {
  const [selected, setSelected] = useState<Set<AreaKey>>(new Set());
  const areas = getAreas();

  function toggle(key: AreaKey) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <section
      aria-label="Pick the areas you care about"
      data-component="area-carousel"
      className="area-carousel"
    >
      <h1 className="area-carousel__title">Pick the areas you care about.</h1>
      <p className="area-carousel__subtitle" suppressHydrationWarning>
        The coach uses this to focus each reply. You can change it later.
      </p>
      <div role="group" aria-label="life areas" className="area-carousel__group">
        {areas.map((a) => {
          const isSelected = selected.has(a.key);
          return (
            <button
              key={a.key}
              type="button"
              data-area={a.key}
              data-selected={isSelected ? 'true' : 'false'}
              aria-pressed={isSelected}
              aria-label={`Add area ${a.label} to your message`}
              onClick={() => toggle(a.key)}
              className={`area-carousel__chip${isSelected ? ' area-carousel__chip--selected' : ''}`}
            >
              #{a.key}
            </button>
          );
        })}
      </div>
      <div className="area-carousel__actions">
        <button
          type="button"
          data-testid="area-carousel-continue"
          onClick={() => onConfirm([...selected])}
        >
          Continue
        </button>
        <button
          type="button"
          data-testid="area-carousel-skip"
          className="area-carousel__skip"
          onClick={() => onConfirm([])}
        >
          Skip for now
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @sutra/web test __tests__/components/AreaCarousel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run copy-voice test to confirm no forbidden patterns**

Run: `pnpm --filter @sutra/web test __tests__/copy-voice.test.ts`
Expected: PASS. The component copy ("Pick the areas you care about.", "Continue", "Skip for now") avoids em dashes and the AI-vocab list.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/AreaCarousel.tsx apps/web/__tests__/components/AreaCarousel.test.tsx
git commit -m "feat(dx): AreaCarousel multi-select component (L0 onboarding)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

**End of Slice 1.** Stop here. Run `/qa` against `pnpm dev` to verify:
- Migration applies cleanly (founder has applied 0010 to the live DB).
- The DB helpers work against the live DB (a quick unit probe via the existing `pnpm --filter @sutra/db test`).
- `AreaCarousel` renders, the chip click toggles state, the Continue / Skip CTAs fire `onConfirm`.

If `/qa` surfaces a finding, dispatch a fix subagent before Slice 2 begins.

---

## Slice 2: Wire it up (Tasks 4–8)

Goal: end-to-end flow works. Home page gates + renders carousel, `/api/onboarding` persists, chat reads selected areas, chat page drops `?horizon=` requirement, Primer is deleted. **End-of-slice: run `/qa` against the dev server, walk the full onboarding journey: anonymous → sign-in → carousel → continue → chat with area context, then revisit home → redirect to chat.** Findings become fix-tasks before ship.

### Task 4: Home page (`apps/web/app/page.tsx`) — auth gate + carousel + redirect

**Files:**
- Modify: `apps/web/app/page.tsx`
- Test: `apps/web/__tests__/app/page.test.tsx` (new)

**Interfaces:**
- Consumes: `<AreaCarousel />` from Task 3, `getUserAreaPreferences` from Task 2, `getServerSupabase` for auth + preference lookup
- Produces: a server component that renders one of three states — anonymous sign-in CTA, authed carousel, or `redirect('/chat')` when the user has any selected areas

- [ ] **Step 1: Write the failing tests**

Create `apps/web/__tests__/app/page.test.tsx`. The existing test pattern (from `apps/web/__tests__/app/chat/page.test.tsx`) walks the JSX tree without a real renderer. Mirror it:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ getServerSupabase: vi.fn() }));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    const err = new Error(`NEXT_REDIRECT;${url}`);
    (err as any).digest = `NEXT_REDIRECT;${url}`;
    throw err;
  }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => ({
    type: 'a', props: { href, ...rest, children },
    key: null, ref: null, $$typeof: Symbol.for('react.element'),
  }),
}));

vi.mock('@/components/AreaCarousel', () => ({
  AreaCarousel: ({ onConfirm }: any) => ({
    type: 'div',
    props: { 'data-testid': 'area-carousel', 'data-has-onconfirm': typeof onConfirm },
    key: null, ref: null, $$typeof: Symbol.for('react.element'),
  }),
}));

import { default as HomePage } from '@/app/page';
import { getServerSupabase } from '@/lib/supabase/server';

function walkHostTags(el: any): any[] {
  const out: any[] = [];
  const seen = new WeakSet();
  function walk(node: any) {
    if (node == null || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node.type === 'function') return walk(node.type(node.props ?? {}));
    if (typeof node.type === 'string') {
      out.push(node);
      if (node.props?.children) walk(node.props.children);
    }
  }
  walk(el);
  return out;
}

describe('/ (home page)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('redirects to /chat when the user is signed in and has at least one area', async () => {
    (getServerSupabase as any).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) },
      from: () => ({
        select: () => ({ eq: () => ({ order: () => ({ data: [{ area_key: 'career' }], error: null }) }) }),
      }),
    });

    let redirected: string | null = null;
    try { await HomePage(); } catch (e: any) { redirected = e?.message ?? ''; }
    expect(redirected).toMatch(/NEXT_REDIRECT;\/chat/);
  });

  it('renders AreaCarousel when the user is signed in but has no areas', async () => {
    (getServerSupabase as any).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) },
      from: () => ({
        select: () => ({ eq: () => ({ order: () => ({ data: [], error: null }) }) }),
      }),
    });

    const el = await HomePage();
    const tags = walkHostTags(el);
    expect(tags.find((t) => t.props['data-testid'] === 'area-carousel')).toBeTruthy();
  });

  it('renders a sign-in CTA when the user is anonymous', async () => {
    (getServerSupabase as any).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
      from: () => { throw new Error('should not query areas when anonymous'); },
    });

    const el = await HomePage();
    const tags = walkHostTags(el);
    const link = tags.find((t) => t.props['data-testid'] === 'sign-in-link');
    expect(link).toBeTruthy();
    expect(link!.props.href).toContain('/api/auth/google');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sutra/web test __tests__/app/page.test.tsx`
Expected: FAIL — module not found (the test file imports the page that still renders `<Primer />`).

- [ ] **Step 3: Implement the home page**

Replace `apps/web/app/page.tsx`:

```tsx
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AreaCarousel } from '@/components/AreaCarousel';
import { getServerSupabase } from '@/lib/supabase/server';
import { getUserAreaPreferences } from '@sutra/db';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="home-gate">
        <h1 className="home-gate__title">Think through your goals, out loud.</h1>
        <p className="home-gate__body">
          Sign in with Google to pick the areas you care about, then chat with your coach.
        </p>
        <Link
          href="/api/auth/google"
          className="navbar__cta"
          data-testid="sign-in-link"
          prefetch={false}
        >
          Sign in with Google
        </Link>
      </main>
    );
  }

  const prefs = await getUserAreaPreferences(supabase, user.id);
  if (prefs.length > 0) {
    redirect('/chat');
  }

  async function persistAndGoToChat(formData: FormData) {
    'use server';
    // Server-action wrapper: read form data, call API route, redirect.
    const raw = formData.get('areas');
    const parsed: string[] = raw ? JSON.parse(String(raw)) : [];
    const allowed = new Set(['career','health','relationships','finance','learning','fun']);
    const areaKeys = parsed.filter((k): k is any => allowed.has(k));

    const supabase2 = await getServerSupabase();
    const { data: { user: u2 } } = await supabase2.auth.getUser();
    if (!u2) redirect('/');

    const { setUserAreaPreferences } = await import('@sutra/db');
    await setUserAreaPreferences(supabase2, u2.id, areaKeys);
    redirect('/chat');
  }

  return (
    <main>
      <form action={persistAndGoToChat}>
        <input type="hidden" name="areas" id="areas-input" defaultValue="" />
        <AreaCarouselClient onChange={(keys) => {
          const el = document.getElementById('areas-input') as HTMLInputElement | null;
          if (el) el.value = JSON.stringify(keys);
        }} />
      </form>
    </main>
  );
}
```

(The `<AreaCarouselClient>` is a tiny client wrapper that wires the `onConfirm` callback to the hidden input — see Step 3a.)

- [ ] **Step 3a: Create the client wrapper**

Create `apps/web/components/AreaCarouselClient.tsx` (a thin client boundary because the carousel needs `useState` and the form needs to update the hidden input):

```tsx
'use client';
import { useState } from 'react';
import { AreaCarousel } from './AreaCarousel';
import type { AreaKey } from '@sutra/db';

export function AreaCarouselClient({
  onChange,
}: {
  onChange?: (keys: AreaKey[]) => void;
}) {
  function handle(keys: AreaKey[]) {
    const el = document.getElementById('areas-input') as HTMLInputElement | null;
    if (el) el.value = JSON.stringify(keys);
    onChange?.(keys);
  }
  return <AreaCarousel onConfirm={handle} />;
}
```

- [ ] **Step 4: Re-run the home page tests**

Run: `pnpm --filter @sutra/web test __tests__/app/page.test.tsx`
Expected: PASS. (Note: the test asserts `data-testid="area-carousel"` is present when no areas exist; the client wrapper renders the carousel under that testid. The `data-has-onconfirm` check confirms the form-action wiring exists.)

If the test framework complains about importing the form action, refactor Step 3 to extract `persistAndGoToChat` to a `lib/home/server-actions.ts` file — but try the inline form first.

- [ ] **Step 5: Typecheck + copy-voice**

Run: `pnpm --filter @sutra/web typecheck && pnpm --filter @sutra/web test __tests__/copy-voice.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/page.tsx apps/web/components/AreaCarouselClient.tsx apps/web/__tests__/app/page.test.tsx
git commit -m "feat(home): area carousel + auth gate + redirect to chat (L0 onboarding)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

### Task 5: `POST /api/onboarding` route

**Files:**
- Create: `apps/web/app/api/onboarding/route.ts`
- Test: `apps/web/__tests__/app/api/onboarding.test.ts` (new)

**Interfaces:**
- Consumes: `getServerSupabase` (auth), `setUserAreaPreferences` from `@sutra/db`
- Produces: `POST` handler that reads `{ areas: AreaKey[] }`, validates against the enum, persists, returns 200 (or 401 / 400 on auth or validation failure)

- [ ] **Step 1: Write the failing tests**

Create `apps/web/__tests__/app/api/onboarding.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ getAll: () => [], set: () => {} })),
}));

vi.mock('@/lib/supabase/server', () => ({ getServerSupabase: vi.fn() }));
vi.mock('@sutra/db', async () => {
  const actual = await vi.importActual<any>('@sutra/db');
  return { ...actual, setUserAreaPreferences: vi.fn() };
});

import { POST } from '@/app/api/onboarding/route';
import { getServerSupabase } from '@/lib/supabase/server';
import { setUserAreaPreferences } from '@sutra/db';

describe('POST /api/onboarding', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when the user is not authenticated', async () => {
    (getServerSupabase as any).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });
    const req = new Request('http://localhost/api/onboarding', {
      method: 'POST',
      body: JSON.stringify({ areas: ['career'] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('persists the given area keys via setUserAreaPreferences', async () => {
    (getServerSupabase as any).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) },
    });
    const req = new Request('http://localhost/api/onboarding', {
      method: 'POST',
      body: JSON.stringify({ areas: ['career', 'health'] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(setUserAreaPreferences).toHaveBeenCalledWith(expect.anything(), 'u1', ['career', 'health']);
  });

  it('allows an empty array (skip path)', async () => {
    (getServerSupabase as any).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) },
    });
    const req = new Request('http://localhost/api/onboarding', {
      method: 'POST',
      body: JSON.stringify({ areas: [] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(setUserAreaPreferences).toHaveBeenCalledWith(expect.anything(), 'u1', []);
  });

  it('returns 400 when the body is not valid JSON', async () => {
    (getServerSupabase as any).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) },
    });
    const req = new Request('http://localhost/api/onboarding', {
      method: 'POST',
      body: 'not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('drops unknown area keys before persisting (Review Focus 4: idempotency)', async () => {
    (getServerSupabase as any).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) },
    });
    const req = new Request('http://localhost/api/onboarding', {
      method: 'POST',
      body: JSON.stringify({ areas: ['career', 'martial-arts'] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(setUserAreaPreferences).toHaveBeenCalledWith(expect.anything(), 'u1', ['career']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sutra/web test __tests__/app/api/onboarding.test.ts`
Expected: FAIL — route module not found.

- [ ] **Step 3: Implement the route**

Create `apps/web/app/api/onboarding/route.ts`:

```ts
import { getServerSupabase } from '@/lib/supabase/server';
import { setUserAreaPreferences, type AreaKey } from '@sutra/db';

export const runtime = 'edge';

const ALLOWED = new Set<AreaKey>([
  'career', 'health', 'relationships', 'finance', 'learning', 'fun',
]);

export async function POST(req: Request) {
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const areasRaw = (body as { areas?: unknown })?.areas;
  if (!Array.isArray(areasRaw)) {
    return new Response(JSON.stringify({ error: 'areas must be an array' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const areaKeys = areasRaw.filter((k): k is AreaKey => typeof k === 'string' && ALLOWED.has(k as AreaKey));

  await setUserAreaPreferences(supabase, user.id, areaKeys);

  return new Response(JSON.stringify({ ok: true, saved: areaKeys }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
```

- [ ] **Step 4: Re-run the tests to verify they pass**

Run: `pnpm --filter @sutra/web test __tests__/app/api/onboarding.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/onboarding/route.ts apps/web/__tests__/app/api/onboarding.test.ts
git commit -m "feat(api): POST /api/onboarding persists user area selection

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

### Task 6: Chat route reads areas + feeds them to `systemPrompt()`

**Files:**
- Modify: `packages/ai/src/prompts.ts`
- Modify: `apps/web/app/api/chat/route.ts`
- Test (extend): `apps/web/__tests__/app/api/chat.test.ts`

**Interfaces:**
- Consumes: `getUserAreaPreferences` from `@sutra/db`, `systemPrompt(goals, threads)` from `@sutra/ai`
- Produces: `systemPrompt(goals, threads, areas: string[])` — third positional arg; empty array renders no "Areas the user cares about:" line

- [ ] **Step 1: Write the failing test for the chat route**

Add to `apps/web/__tests__/app/api/chat.test.ts` (the existing test file's `makeSupabase` factory at line ~42 mocks `from()` and dispatches by table name — extend it):

In the existing `makeSupabase` helper, add a branch for the new table:

```ts
const userAreaPrefsChain = {
  select: vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      order: vi.fn().mockResolvedValue({ data: prefs, error: null }),
    }),
  }),
};
```

And add a top-level `prefs` parameter with a default of `[]`. Then in `from()`, route `'user_area_preferences'` to this chain.

Then add the new test:

```ts
it('passes the user\'s selected areas to systemPrompt (Review Focus 2)', async () => {
  // mock prefs = [{ area_key: 'career' }, { area_key: 'health' }]
  // mock createLLMClient to capture the messages it receives
  // assert the last user message's content (which is the system prompt) contains
  //   "Areas the user cares about: career, health"
});
```

Mock `getUserAreaPreferences` directly via `vi.mock('@sutra/db', ...)` at the top of the file (or expose `getUserAreaPreferences` through the existing import path and mock it via the supabase `from()` chain). The route imports `getUserAreaPreferences` from `@sutra/db` — the test should mock it via `vi.mock('@sutra/db', ...)`:

```ts
vi.mock('@sutra/db', async () => {
  const actual = await vi.importActual<any>('@sutra/db');
  return { ...actual, getUserAreaPreferences: vi.fn() };
});
```

And inside the test:

```ts
const { getUserAreaPreferences } = await import('@sutra/db');
(getUserAreaPreferences as any).mockResolvedValue([
  { user_id: 'u1', area_key: 'career', selected_at: '2026-09-23T09:00:00Z' },
  { user_id: 'u1', area_key: 'health', selected_at: '2026-09-23T10:00:00Z' },
]);
```

Then assert the captured system-prompt content (the last "user" message in the messages array passed to `client.send`) contains `"Areas the user cares about: career, health"`.

Also add a second assertion that when `getUserAreaPreferences` returns `[]`, the system prompt does NOT contain the string `"Areas the user cares about"`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sutra/web test __tests__/app/api/chat.test.ts -t "passes the user"`
Expected: FAIL — `systemPrompt` doesn't yet accept areas; the route doesn't read `getUserAreaPreferences`.

- [ ] **Step 3: Extend `systemPrompt()`**

In `packages/ai/src/prompts.ts`, change the signature:

```ts
export function systemPrompt(
  goals: Goal[],
  recentThreads: { role: string; content: string }[],
  areas: string[] = []
): string {
  // ... existing code ...

  const areasBlock = areas.length > 0
    ? `\nAreas the user cares about: ${areas.join(', ')}\n`
    : '';

  return `...${history}${DEFENSIVE_LINES}${areasBlock}`;
}
```

Append `areasBlock` at the end (after the defensive lines) so the LLM sees the user's personalization last — model attention is strongest at the tail of the prompt.

- [ ] **Step 4: Wire the chat route**

In `apps/web/app/api/chat/route.ts`:

1. Import `getUserAreaPreferences` from `@sutra/db` (alongside the existing `getGoalsForUser`, `getRecentThreads`).
2. After the `const threads = await getRecentThreads(...)` line (~line 143), add:

```ts
const areaPrefs = await getUserAreaPreferences(supabase, user.id);
const areas = areaPrefs.map((p) => p.area_key);
```

3. In the existing call to `systemPrompt(goals, threads)` (~line 164), pass the third argument: `systemPrompt(goals, threads, areas)`.
4. In the second-pass `systemPrompt` call (~line 222 — the tool-result re-prompt), pass the same `areas`.

- [ ] **Step 5: Run the chat tests to verify they pass**

Run: `pnpm --filter @sutra/web test __tests__/app/api/chat.test.ts`
Expected: PASS — both the new area-context test and all 13 existing tests.

- [ ] **Step 6: Run the ai package tests**

Run: `pnpm --filter @sutra/ai test`
Expected: PASS — `systemPrompt`'s positional argument has a default, so existing callers (tests in `tools.test.ts` and `router.test.ts`) still compile and pass.

- [ ] **Step 7: Commit**

```bash
git add packages/ai/src/prompts.ts apps/web/app/api/chat/route.ts apps/web/__tests__/app/api/chat.test.ts
git commit -m "feat(ai): feed selected areas into system prompt (L0 onboarding)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

### Task 7: Chat page drops `?horizon=` requirement, defaults persona to `'week'`

**Files:**
- Modify: `apps/web/app/chat/page.tsx`
- Modify: `apps/web/__tests__/app/chat/page.test.tsx`

**Interfaces:**
- Consumes: `searchParams` (now optional)
- Produces: a server component that renders `ChatThread` for authenticated users regardless of whether `?horizon=` is present, defaulting persona to `'week'` when missing. Anonymous users still see a sign-in CTA with a returnTo of `/chat` (no horizon query string).

- [ ] **Step 1: Write the failing tests**

In `apps/web/__tests__/app/chat/page.test.tsx`, **delete the two redirect tests**:

- `it('redirects to / when horizon is missing', ...)` — line 89
- `it('redirects to / when horizon is invalid (not in enum)', ...)` — line 100

**Replace** the `'renders ChatThread when valid horizon + user is present'` test (line 115) with:

```tsx
it('renders ChatThread with default persona "week" when no horizon param is given', async () => {
  (getServerSupabase as any).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) },
  });
  const el = await ChatPage({ searchParams: Promise.resolve({}) } as any);
  const nodes = renderElement(el);
  const thread = nodes.find((n) => n.props['data-testid'] === 'chat-thread');
  expect(thread).toBeTruthy();
  expect(thread!.props['data-persona']).toBe('week');
});

it('renders ChatThread with the requested horizon when ?horizon=week', async () => {
  (getServerSupabase as any).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) },
  });
  const el = await ChatPage({ searchParams: Promise.resolve({ horizon: 'week' }) } as any);
  const nodes = renderElement(el);
  const thread = nodes.find((n) => n.props['data-testid'] === 'chat-thread');
  expect(thread!.props['data-persona']).toBe('week');
});
```

And **modify** the sign-in CTA test (line 128) — the `returnTo` is now just `/chat`, not `/chat?horizon=week`:

```tsx
it('renders sign-in CTA when valid horizon but no user', async () => {
  (getServerSupabase as any).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  });
  const el = await ChatPage({ searchParams: Promise.resolve({ horizon: 'week' }) } as any);
  const nodes = renderElement(el);
  const link = nodes.find((n) => n.props['data-testid'] === 'sign-in-link');
  expect(link).toBeTruthy();
  expect(link!.props.href).toContain('returnTo=');
  expect(link!.props.href).toContain(encodeURIComponent('/chat'));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sutra/web test __tests__/app/chat/page.test.tsx`
Expected: FAIL — the new test expects no redirect for missing horizon, but the current page redirects.

- [ ] **Step 3: Update the chat page**

Replace `apps/web/app/chat/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ChatThread } from '@/components/ChatThread';
import { getServerSupabase } from '@/lib/supabase/server';
import type { Horizon } from '@sutra/db';

export const dynamic = 'force-dynamic';

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ horizon?: string }>;
}) {
  const params = await searchParams;
  const VALID_HORIZONS = new Set<Horizon>(['week', 'month', 'quarter', 'year', 'multi-year']);
  const requested = params.horizon as Horizon | undefined;
  const persona: Horizon = requested && VALID_HORIZONS.has(requested) ? requested : 'week';

  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="chat-gate">
        <h1 className="chat-gate__title">Sign in to start</h1>
        <p className="chat-gate__body">
          Sutra uses Google to authenticate you and call Gemini on your behalf.
        </p>
        <Link
          href="/api/auth/google?returnTo=%2Fchat"
          className="navbar__cta"
          data-testid="sign-in-link"
          prefetch={false}
        >
          Sign in with Google
        </Link>
      </main>
    );
  }

  return (
    <main>
      <p className="chat__context">Working on: {persona}</p>
      <ChatThread persona={persona} />
    </main>
  );
}
```

(`redirect('/')` is gone. The page no longer imports `redirect` from `next/navigation` — remove that import if unused.)

- [ ] **Step 4: Re-run the tests to verify they pass**

Run: `pnpm --filter @sutra/web test __tests__/app/chat/page.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/chat/page.tsx apps/web/__tests__/app/chat/page.test.tsx
git commit -m "feat(chat): drop horizon requirement, default persona to week (L0 onboarding)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

### Task 8: Delete `Primer.tsx` + its test

**Files:**
- Delete: `apps/web/components/Primer.tsx`
- Delete: `apps/web/__tests__/components/Primer.test.tsx`

- [ ] **Step 1: Verify no remaining references**

Run: `grep -rn "Primer" apps/web/components apps/web/app apps/web/lib packages 2>/dev/null`
Expected: zero matches (the home page now imports `AreaCarousel` from Task 4; nothing else references `Primer`).

If any match exists, surface to founder before deleting — the import may have been missed in Task 4.

- [ ] **Step 2: Delete the files**

```bash
git rm apps/web/components/Primer.tsx apps/web/__tests__/components/Primer.test.tsx
```

- [ ] **Step 3: Run the full web test suite**

Run: `pnpm --filter @sutra/web test`
Expected: PASS. The 3 Primer tests are gone; the rest still pass.

- [ ] **Step 4: Run typecheck across all 5 workspaces**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "chore(cleanup): remove Primer per L0 onboarding revision

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

**End of Slice 2.** Stop here. Run `/qa` against `pnpm dev` and walk the full journey:

1. Anonymous browser → home page → sign-in CTA visible.
2. Sign in with Google → land on home → area carousel visible (no areas yet).
3. Pick `career` + `health` → click Continue → land on `/chat`.
4. Send a chat message → verify the system prompt contains `"Areas the user cares about: career, health"` (probe via Sentry / response behavior; SSE capture script as in qa3).
5. Re-visit `/` → redirected to `/chat` (areas persisted).
6. Sign in on a second browser / incognito → confirm same areas appear (RLS-by-user-id).
7. Empty selection test: in incognito, sign in, click "Skip for now" → land on `/chat`, send a message, verify no `"Areas the user cares about:"` line in the system prompt.
8. `/chat` directly (no query string) → chat renders with persona `'week'`.

If `/qa` surfaces a finding, dispatch a fix subagent before ship.

---

## Self-Review

- **Spec coverage:**
  | L0 spec point | Task |
  |---|---|
  | Areas are first-class personalization axis | Tasks 1, 2 (persistence + helpers) |
  | Home page is area carousel (not horizon primer) | Task 4 (home page swap) |
  | `<AreaChips />` reused for the home carousel | Task 3 (wraps existing chip strip from Task 11) |
  | Inline area chips below chat input NOT shipped | No-op — Task 12 mount was already reverted at `e7711ab`; confirm `ChatThread.tsx` still has no chips in the QA walk |
  | Areas persisted on first selection | Tasks 1, 2, 5 (migration + helpers + route) |
  | Skip is allowed | Tasks 3 (`Skip for now` CTA), 5 (empty array), 6 (no areas line in prompt) |
  | `/onboarding` revisit route | Deferred — noted in this plan's header; a future slice adds the revisit route + settings-page wiring |

- **Drift items:** None. L0 revision 2026-09-23 + founder's three decisions (persistence table, skip-allowed, defer-revisit) are consistent.

- **Placeholders:** None. Every step has concrete code; no "TBD" / "similar to Task N" / "implement later" patterns.

- **Type consistency:** `AreaKey` (defined in `packages/db/src/types.ts`), `UserAreaPreference` (added in Task 1), `getUserAreaPreferences` / `setUserAreaPreferences` (Task 2), `AreaCarousel` props `{ onConfirm: (keys: AreaKey[]) => void }` (Task 3), `systemPrompt(goals, threads, areas)` (Task 6). Names match across tasks.

- **Review Focus mapping:**
  - RF1 (empty area selection on first sign-in) → Tasks 3 + 5
  - RF2 (areas in prompt are exactly what the user picked) → Task 6
  - RF3 (multi-device persistence) → Task 2
  - RF4 (concurrent area updates / idempotent upsert) → Tasks 2 + 5
  - RF5 (chat page works without `?horizon=`) → Task 7

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-23-area-carousel-onboarding.md`. Please review the plan. It captures:

- L0 spec revision (2026-09-23) — areas are a first-class personalization axis; home page is an area carousel; inline chips are out.
- Founder's three decisions: `user_area_preferences` table, skip is allowed, `/onboarding` revisit deferred.
- TDD-first per `CLAUDE.md` hard rule #1 (failing test → observed red → minimal impl → green → commit).
- `/qa` after every slice (your standing rule). Two slices means two QA walks: after Slice 1 (data + carousel component), after Slice 2 (end-to-end onboarding + chat integration + Primer delete).

**For this plan I recommend subagent-driven** execution via `superpowers:subagent-driven-development`. The 8 tasks split cleanly across data/component/api/page layers with minimal cross-task coupling; the slice boundaries (data-only vs. wire-it-up) are natural review gates; and `/qa` already gives end-to-end coverage at the slice boundaries so per-task review is enough.

Does the plan capture what you want, and which execution approach should we use?

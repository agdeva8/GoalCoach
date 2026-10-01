# Timeline component redesign — SPEC

> Scope: `frontend/src/components/Timeline.js`. The 8-variant `TimelineTabs.js`
> and its sibling explorers (`ChartVariant1..5`, `TimelineVariantA..D`) are
> deleted. `Coach.js` mounts `<Timeline />` directly. No new files.

## Iteration-4 update — 3-view dropdown (replaces the Gantt / Drill toggle)

The original spec described a Chart (Gantt) / Drill toggle. The user changed
direction: **remove the Gantt entirely** and replace the toggle with a
**3-option view-type dropdown**. All three views share the same `{ state,
onPrefill, onOpenChat }` contract; all share the `data-testid="timeline-view"`
wrapper, `timeline-prefill-button` empty-state CTA, `timeline-back`,
`timeline-prev-year`, `timeline-next-year`, `timeline-drift`, and
`timeline-bucket-{level}-{idx}` testids from the original surface.

### View-type dropdown (replaces the Chart/Drill toggle)
- shadcn `DropdownMenu` from `frontend/src/components/ui/dropdown-menu.jsx`.
- Trigger is a pill: view icon + label + muted sub-label + chevron.
- 3 options — plain-language labels for the general public:

| Key      | Label         | Sub-label                                            |
|----------|---------------|------------------------------------------------------|
| `drill`    | Day by day    | See what's due each day                              |
| `strip`    | At a glance   | Snapshots for today, this week, this month…          |
| `calendar` | Calendar      | See tasks across the days they span                  |

- Default selection: `drill` (matches "Drill (as it is)" instruction).
- Active option shows a `· now` marker in the menu and an accent icon.

### View 1 — Day by day (`DrillView`)
- Original bucketed grid — kept verbatim. Quarter → Month → Week drill.
- NOW badge on the bucket containing today. Counts per kind.
- Esc goes back one level.

### View 2 — At a glance (`StripView`)
- Ported from `TimelineVariantB`. Six horizon strips (Today / This Week /
  This Month / This Quarter / This Year / Later), each a snap-scroll card
  carousel. Goal / commitment / milestone / blocker cards.
- Stat strip with totals + "Ask the coach to re-plan" link.

### View 3 — Calendar (`CalendarView`)
- Google-Calendar feel with changeable span. Five span presets:
  Day / Week / Month / 3 Months / Year.
- Sourced from `allItems` (Timeline.js: goals + milestones + commitments +
  blockers; goals carry `start`→`end`, blockers carry `start`→`end`,
  milestones/commitments single-day).
- **Multi-day tiles** — the headline behavior:
  - Each item gets `startCol`/`endCol` (inclusive) on a 7-column week grid.
  - One tile stretches from start to end day via
    `gridColumn: ${startCol} / ${endCol + 1}`.
  - Greedy lane assignment per week (longest-first) so overlapping items
    stack vertically instead of colliding.
  - Color: `HORIZON_COLOR[horizon]` for goals; `--warning` for milestones;
    `--accent` for commitments; `--danger` striped pattern for blockers.
  - Tile content: title (truncate). Tooltip carries dates + kind + horizon.
  - Tile click opens the contextual chat prefill via `onOpenChat`.
- **Day view** — single-day list of items with kind chips.
- **Year view** — 12 month cards, items collapsed to one-line summaries.
- **Week / Month / 3 Months** — grid with DOW header, today ring, lanes of
  spanning tiles per week.
- Navigation: `←` / `→` pan by span unit; **Today** button (disabled when
  anchor already covers today); keyboard `t` → today, `1`–`5` → span.

## Brand anchors
- Dark Swiss / high-contrast: `--bg-primary #17120E`, `--bg-secondary #211A14`, `--bg-tertiary #2C231B`, `--border #3A2E24`, `--border-accent #574636`, `--accent #E8925C`, `--warning #E0A458`, `--success #8FB98A`, `--danger #D9705A`
- Fonts: `Space Grotesk` (display), `JetBrains Mono` (mono caps), `IBM Plex Sans` (body)
- WCAG 2.1 AA; keyboard-first; `prefers-reduced-motion`

## Data available (no API changes)
- `state.goals` (id, title, horizon, status, target_date, start_date, created_at)
- `state.milestones` (id, title, target_date, status, goal_id, goal_title)
- `state.commitments` (id, text, due, status, goal_id, goal_title)
- `state.blockers` (id, title, start_date, end_date)
- `state.sources` (id, kind, original_filename, created_at)
- `state.audit_summary.recent` (id, type, summary, created_at)

## Color refinements
- weekly → `--accent`
- short → `--warning`
- medium → `--accent`
- long → `--success`
- commitments → `--accent` (flag/dot shape distinguishes from goals)
- blockers → `--danger` (striped pattern in Calendar tiles)
- today → `--accent` ring on the cell, today pill on the axis in Calendar

## Data-testids

**Preserved** (still valid on the surviving surface):
`timeline-view`, `timeline-prefill-button`, `timeline-back`,
`timeline-prev-year`, `timeline-next-year`, `timeline-drift`,
`timeline-stats`, `timeline-crumbs`,
`timeline-bucket-{level}-{idx}`, `timeline-b-strip-{horizonKey}`,
`timeline-b-goal-{id}`, `timeline-b-commitment-{id}`,
`timeline-b-milestone-{id}`, `timeline-b-blocker-{id}`.

**New** (added with the dropdown and Calendar):
- `timeline-viewtype-trigger` — the dropdown trigger button
- `timeline-viewtype-{drill|strip|calendar}` — each menu item
- `timeline-cal-span-{day|week|month|quarter|year}` — span chips
- `timeline-cal-tile-{kind}-{id}` — every multi-day / single-day tile
- `timeline-cal-year-month-{0..11}` — year-view month cards

**Removed** (deliberate breaking changes — the Gantt surface is gone):
- `timeline-mode-chart`, `timeline-mode-drill`
- `timeline-span-{day|week|month|quarter|year|5y}`, `timeline-span-auto`
- `timeline-zoom-in`, `timeline-zoom-out`
- `timeline-chart`, `timeline-chart-ask-coach`
- `timeline-row-{g.id}`, `timeline-commitments-row`, `timeline-blockers-row`

## Files touched
- `frontend/src/components/Timeline.js` (full rewrite — 3-view dropdown + 3 peer views)
- `frontend/src/pages/Coach.js` (mounts `<Timeline />` directly instead of `<TimelineTabs />`)
- `frontend/src/components/TimelineTabs.js` — deleted
- `frontend/src/components/ChartVariant{1..5}.js` — deleted
- `frontend/src/components/TimelineVariant{A..D}.js` — deleted

## Out of scope (deferred)
- New API endpoints
- Drag-to-reschedule tiles, recurring tasks, timezone math
- Mobile-optimized calendar layout (current grid is desktop-first;
  falls back to a vertical Day list on small screens via the Day span)

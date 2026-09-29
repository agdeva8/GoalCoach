# Timeline component redesign — SPEC

> Scope: `frontend/src/components/Timeline.js` only. No new files. No API changes.

## Brand anchors
- Dark Swiss / high-contrast: `--bg-primary #17120E`, `--bg-secondary #211A14`, `--bg-tertiary #2C231B`, `--border #3A2E24`, `--border-accent #574636`, `--accent #E8925C`, `--warning #E0A458`, `--success #8FB98A`, `--danger #D9705A`
- Fonts: `Space Grotesk` (display), `JetBrains Mono` (mono caps), `IBM Plex Sans` (body)
- WCAG 2.1 AA; keyboard-first; `prefers-reduced-motion`

## Data available (no API changes)
- `state.goals` (id, title, horizon, status, target_date, start_date)
- `state.milestones` (id, title, target_date, status, goal_title)
- `state.commitments` (id, text, due, status, goal_title)
- `state.blockers` (id, title, start_date, end_date)
- `state.sources` (id, kind, original_filename, created_at)
- `state.audit_summary.recent` (id, type, summary, created_at)

## Redesign decisions

### 1. Two-column chart shell (premium Gantt layout)
- Sticky left rail (240px) holds goal metadata: name, horizon pill, days-to-target, a micro "ask coach" affordance on hover.
- Horizontally-scrollable chart canvas on the right.
- Goal label column stays put when the user pans horizontally.

### 2. Premium axis strip
- Three stacked rows (each 22px):
  - Top — month labels with year tags at January dividers.
  - Middle — **today** badge (subtle pill in `--accent`/15%).
  - Bottom — quarter tickmarks for year-span.
- They never collide.

### 3. Today line — softer and more legible
- 1px solid line in `--accent` at 35% opacity (was dashed red at 70%).
- Topped by a 6px dot in `--accent`.
- "TODAY" pill in `--accent`/15% at the very top of the axis strip.

### 4. Goal rows — premium Gantt bar
- Solid bar from `start_date → target_date` in `${color}33` (15% opacity), 3px left edge in full color.
- **Progress overlay** — fills from start to today's x-position in `${color}` at 55% opacity (visual "how far you are into the goal").
- **Milestone "pins"** — diamond markers ABOVE the bar with a thin connector line down to the bar's top edge. Color-coded: `--warning` for future, `--danger` for overdue.
- **Commitment flags** — small upward triangles BELOW the bar (8px tall) in `--accent`.
- **Done state** — bar opacity 0.55 + a tiny check icon.

### 5. Side tracks (consolidated)
- One bottom swimlane for blockers + commitments together.
- Blockers: repeating-linear-gradient(45deg) striped pattern in `--danger` at 50% opacity (less alarming than solid red).
- Commitments: small flag chips with text (max 100px width, ellipsis).

### 6. Activity swimlane (new)
- Optional row at the very bottom showing recent sources/audit events as 6px dots.
- Hover tooltip shows the source/audit summary.
- Tight + minimal so it doesn't overwhelm.

### 7. Refined chrome
- Span preset selector — 7 chips (Day / Week / Month / Quarter / Year / 5Yr / Auto), the active one filled with `--accent`, inactive one with subtle border.
- Zoom — single-arrow buttons with a floating "{N}%" chip between them.
- Mode toggle (Chart / Drill) — same chips style.

### 7. Drill mode polish
- Bucket cards with group counters: "G 1 · M 3 · C 4 · B 1" in header.
- Items grouped by kind (Goals → Milestones → Commitments → Blockers).
- "NOW" badge on the bucket containing today.
- Drift count for past-due items.
- Hover gives micro-preview (date, status, kind).

### 8. Premium header strip
- Micro-caps stat summary above the chart: "{N} goals · {M} milestones · {K} open commitments · {B} blockers · {A} recent activity".
- JetBrains Mono uppercase.

### 9. Empty state
- Cleaner illustration with `CalendarClock` icon + a copy line + the "Ask the coach" CTA.

### 10. Keyboard navigation
- Tab order: mode toggle → span chips → zoom +/- → back/year nav → goal rows.
- `←` / `→` shifts span preset; `+` / `-` zooms; `Esc` goes back in drill mode.
- All interactive elements get `data-testid`.

## Color refinements
- weekly → `--accent` solid
- short → `--warning` solid
- medium → `--accent` with a 1px dotted top border to differentiate from weekly
- long → `--success` solid
- commitments → `--accent` (kept; better legibility via flag shape, not color)
- blockers → `--danger` striped (less alarming than solid red)
- today → `--accent` (was `--danger` — too alarmist for a date marker)

## Data-testids (all preserved)
`timeline-view`, `timeline-prefill-button`, `timeline-mode-chart`, `timeline-mode-drill`, `timeline-back`, `timeline-prev-year`, `timeline-next-year`, `timeline-span-{day|week|month|quarter|year|5y}`, `timeline-span-auto`, `timeline-zoom-out`, `timeline-zoom-in`, `timeline-drift`, `timeline-chart`, `timeline-commitments-row`, `timeline-blockers-row`, `timeline-row-{g.id}`, `timeline-bucket-{level}-{idx}`, `timeline-chart-ask-coach`

## Files touched
- `frontend/src/components/Timeline.js` (single file, full rewrite)

## Out of scope (deferred)
- New API endpoints
- Adding memories to /api/state (memories already on a separate panel — surfacing them in Timeline is for later)
- Multi-row groups per goal (long-horizon goals sometimes span months)
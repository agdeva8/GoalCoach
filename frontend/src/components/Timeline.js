import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import {
  ChevronLeft,
  ChevronRight,
  CalendarClock,
  AlertOctagon,
  Circle,
  CheckCircle2,
  ListTree,
  LayoutGrid,
  Layers,
  Milestone as MilestoneIcon,
  Flag,
  Activity,
  Target,
  Clock,
  Inbox,
  Sparkles,
  ChevronDown,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "./ui/dropdown-menu";

/* ---------------------------------------------------------------------------
 * Sutra Timeline — 3-view dropdown: Day by day (Drill), At a glance (Strip),
 * Calendar (multi-day spanning tiles).
 *
 * Replaces the prior Chart (Gantt) / Drill toggle. The Gantt `ChartView`,
 * `ListView`, and chart-only header controls are gone; the dropdown is the
 * single way to switch views.
 *
 * Props: { state, onPrefill, onOpenChatWith, onOpenChat }.
 *   onPrefill      — generic opener, accepts a prefill string only.
 *   onOpenChatWith — preferred opener, accepts (prefill, scope) so the
 *                    chat modal can thread `scope/refId/kind/title/
 *                    helperText` into the new conversation.
 *   onOpenChat     — legacy alias for onPrefill (string-only), kept so
 *                    older call sites still work.
 * ------------------------------------------------------------------------ */

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const MONTHS_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DOW_SHORT = ["M", "T", "W", "T", "F", "S", "S"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* Horizon → color token. weekly + medium share `--accent`. */
const HORIZON_COLOR = {
  weekly: "var(--accent)",
  short: "var(--warning)",
  medium: "var(--accent)",
  long: "var(--success)",
};
const HORIZON_LABEL = { weekly: "WK", short: "SHORT", medium: "MED", long: "LONG" };

/* Status → color token. Issue 2/3 (Iteration 5) — tile color is now
   driven by status, not horizon, so on-track / overdue / in-progress /
   not-started reads at a glance. Goal tiles still fall back to
   HORIZON_COLOR when no status is set (goal is a container, not a
   deliverable). */
const STATUS_COLOR = {
  done: "var(--success)",       // green — on-track / completed
  active: "var(--success)",     // green — on-track
  on_track: "var(--success)",   // green — alias
  overdue: "var(--danger)",     // red — past due / not done
  blocked: "var(--danger)",     // red — blocked
  in_progress: "var(--warning)",// yellow — medium / partial
  open: "var(--warning)",       // yellow — open / partial
  paused: "var(--text-muted)",  // grey — paused
  not_started: "var(--text-muted)", // grey
  dropped: "var(--text-muted)", // grey
};
function statusColor(item) {
  if (!item) return "var(--text-muted)";
  const s = (item.status || "").toLowerCase();
  if (s && STATUS_COLOR[s]) return STATUS_COLOR[s];
  // Goals without status → use horizon. Items without status → warning.
  if (item.kind === "goal" && item.horizon && HORIZON_COLOR[item.horizon]) {
    return HORIZON_COLOR[item.horizon];
  }
  return "var(--warning)";
}

/* ---------------------------------------------------------------------------
 * Bar treatment — long spans vs single days.
 *
 * The 3-months and Year views were painting *every* item as an opaque
 * fill of `statusColor()`. A goal with no target_date gets a 90-day
 * window from its horizon, so it painted a full-width `--success` block
 * that repeated in all 13 week rows — the view became a wall of flat
 * pastel green, and a quarter-long goal carried the same visual weight
 * as a one-day commitment. The data hierarchy was completely flat.
 *
 * Gantt convention fixes this, and it is what these two views now do:
 *
 *   long run  → tinted body (the hue at low alpha over the card) plus a
 *               saturated leading edge. The body says "this runs", the
 *               edge says "and its status is this".
 *   short run → the solid, higher-emphasis fill, unchanged.
 *
 * The tint is deliberately *below* the 3:1 data-mark threshold against
 * the card (1.3–1.4:1) because it is a surface, not the mark. The 3:1
 * data contrast is carried by the leading edge, which is the full
 * semantic hue (4.5–8.5:1 against every surface in both themes).
 *
 * `surface` is the card the bar is painted on — the 3-months rows sit
 * on --bg-primary, the Year plot on --bg-secondary — so the tint is
 * always mixed against what is actually behind it.
 * ------------------------------------------------------------------------- */

const SPAN_TINT_PCT = 18;      // hue share in the tinted body
const SPAN_SOLID_MAX_DAYS = 2; // ≤2 days still reads as "one thing, one day"

/* Length of an item in days, 1 for a single-day point. */
function spanDays(item) {
  if (!item) return 1;
  const s = item.start || item.date;
  const e = item.end || item.date;
  if (!s || !e) return 1;
  const a = startOfDay(s);
  const b = startOfDay(e);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return 1;
  return Math.max(1, Math.round((b - a) / DAY_MS) + 1);
}

/* Returns the paint recipe for one calendar bar. `stripePx` is the width
 * of the leading edge; 0 means the solid single-day treatment. */
function barPaint(item, surface, stripePx = 3) {
  const hue = statusColor(item);
  if (spanDays(item) <= SPAN_SOLID_MAX_DAYS) {
    return {
      background: hue,
      stripe: null,
      color: "var(--bg-primary)", // dark ink on a saturated fill
    };
  }
  return {
    background: `color-mix(in srgb, ${hue} ${SPAN_TINT_PCT}%, ${surface})`,
    stripe: hue,
    color: "var(--text-primary)", // label sits on a near-card tint
    boxShadow: `inset ${stripePx}px 0 0 0 ${hue}`,
  };
}

/* Scoped-chat context for a calendar item. Centralised because the same
   scope/kind/helperText map was duplicated across CalendarTile,
   CalendarDayItem and the quarter bars — the year view needs it too, and
   one source of truth keeps the chat modal titles consistent. */
const SCOPE_MAP = {
  goal: { scope: "goal", kind: "general" },
  milestone: { scope: "milestone", kind: "plan_day" },
  commitment: { scope: "commitment", kind: "plan_day" },
  blocker: { scope: "blocker", kind: "plan_day" },
};
const SCOPE_HELPER = {
  goal: "What do you want to work on for this goal?",
  milestone: "Where are you on this milestone?",
  commitment: "What's the next step on this commitment?",
  blocker: "What's the smallest unblock?",
};
function scopeForItem(item) {
  const m = SCOPE_MAP[item?.kind];
  if (!m) return null;
  return {
    scope: m.scope,
    kind: m.kind,
    refId: item.id,
    title: item.title,
    helperText: SCOPE_HELPER[item.kind],
  };
}

/* View-type dropdown options — plain-language labels for the general public. */
const VIEW_TYPES = [
  {
    key: "drill",
    label: "Day by day",
    sub: "See what's due each day",
    Icon: ListTree,
  },
  {
    key: "strip",
    label: "At a glance",
    sub: "Snapshots for today, this week, this month…",
    Icon: Layers,
  },
  {
    key: "calendar",
    label: "Calendar",
    sub: "See tasks across the days they span",
    Icon: LayoutGrid,
  },
];

/* Calendar span presets — Google-Calendar style. */
const CAL_SPANS = [
  { key: "day", label: "Day", days: 1 },
  { key: "week", label: "Week", days: 7 },
  { key: "month", label: "Month", days: 30 },
  { key: "quarter", label: "3 Months", days: 90 },
  { key: "year", label: "Year", days: 365 },
];

/* Strip-view horizons. */
const HORIZONS = [
  { key: "today", label: "Today", sub: "Due now", maxDays: 0 },
  { key: "thisWeek", label: "This Week", sub: "Next 7 days", maxDays: 7 },
  { key: "thisMonth", label: "This Month", sub: "Next 30 days", maxDays: 30 },
  { key: "thisQuarter", label: "This Quarter", sub: "Next 90 days", maxDays: 90 },
  { key: "thisYear", label: "This Year", sub: "Next 12 months", maxDays: 365 },
  { key: "later", label: "Later", sub: "Beyond a year", maxDays: Infinity },
];

const DAY_MS = 86400000;

/* ------------------------------- date helpers ----------------------------- */

const parse = (s) => {
  if (!s) return null;
  const d = new Date(s + "T00:00:00");
  return isNaN(d.getTime()) ? null : d;
};
const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();
const fmtDay = (d) => `${MONTHS[d.getMonth()]} ${d.getDate()}`;
const fmtIso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtMonth = (d) => `${MONTHS_FULL[d.getMonth()]} ${d.getFullYear()}`;
const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const startOfWeek = (d) => {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const daysUntil = (d, today) => {
  if (!d) return null;
  return Math.round((startOfDay(d).getTime() - today.getTime()) / DAY_MS);
};

/* ---------------------------------------------------------------------------
 * Goal span — a goal is a container that runs for weeks or months, so it
 * must read as a bar that crosses days, never a single-day dot.
 *
 * Coach-drafted goals frequently land with `start_date` AND `target_date`
 * both null. When that happens the old code fell back to
 * `date = today` for both ends, so every goal collapsed onto one cell and
 * the calendar looked like a pile of unrelated one-day blocks (the exact
 * symptom reported: "all goals show as if they are only for 1 day").
 *
 * Instead we derive a window from the goal's own horizon, which is the
 * field the coach already uses to express "how big is this". The window is
 * anchored to whichever real date we do have, and falls back to today so
 * an undated goal is still visible in the current view.
 * ------------------------------------------------------------------------- */
const HORIZON_SPAN_DAYS = { weekly: 7, short: 30, medium: 90, long: 365 };
const DEFAULT_SPAN_DAYS = 90;

function goalWindow(goal, today) {
  const explicitStart = parse(goal.start_date) || parse(goal.created_at);
  const explicitEnd = parse(goal.target_date);
  const span = HORIZON_SPAN_DAYS[goal.horizon] ?? DEFAULT_SPAN_DAYS;

  // Both dates real → trust them verbatim.
  if (explicitStart && explicitEnd) {
    return { start: explicitStart, end: explicitEnd, inferred: false };
  }
  // Only a target → the window runs the horizon's length *up to* it.
  if (explicitEnd) {
    return { start: addDays(explicitEnd, -(span - 1)), end: explicitEnd, inferred: true };
  }
  // Only a start → the window runs the horizon's length *from* it.
  if (explicitStart) {
    return { start: explicitStart, end: addDays(explicitStart, span - 1), inferred: true };
  }
  // Neither → run the window from today so the goal is on screen now.
  return { start: today, end: addDays(today, span - 1), inferred: true };
}

/* ------------------------------ drill buckets ----------------------------- */

function makeBuckets(level, anchor) {
  const y = anchor.getFullYear();
  if (level === "year") {
    return [0, 1, 2, 3].map((q) => ({
      start: new Date(y, q * 3, 1),
      end: new Date(y, q * 3 + 3, 1),
      label: `Q${q + 1}`,
      sub: `${MONTHS[q * 3]}–${MONTHS[q * 3 + 2]} ${y}`,
      next: "quarter",
    }));
  }
  if (level === "quarter") {
    const qm = anchor.getMonth();
    return [0, 1, 2].map((i) => ({
      start: new Date(y, qm + i, 1),
      end: new Date(y, qm + i + 1, 1),
      label: MONTHS[qm + i],
      sub: `${y}`,
      next: "month",
    }));
  }
  if (level === "month") {
    const m = anchor.getMonth();
    const res = [];
    let ws = startOfWeek(new Date(y, m, 1));
    const monthEnd = new Date(y, m + 1, 1);
    while (ws < monthEnd) {
      const we = new Date(ws);
      we.setDate(we.getDate() + 7);
      const lastDay = new Date(we.getTime() - DAY_MS);
      res.push({
        start: new Date(ws),
        end: new Date(we),
        label: `${fmtDay(ws)} – ${fmtDay(lastDay)}`,
        sub: "",
        next: "week",
      });
      ws = we;
    }
    return res;
  }
  const ws = startOfWeek(anchor);
  return [...Array(7)].map((_, i) => {
    const ds = new Date(ws);
    ds.setDate(ds.getDate() + i);
    const de = new Date(ds);
    de.setDate(de.getDate() + 1);
    return { start: ds, end: de, label: DOW[i], sub: fmtDay(ds), next: null };
  });
}

/* ============================================================================
 * Timeline — root component.
 * ========================================================================= */

export default function Timeline({ state, onPrefill, onOpenChatWith, onOpenChat }) {
  const [viewType, setViewType] = useState("calendar");
  const [view, setView] = useState({
    level: "year",
    anchor: new Date(new Date().getFullYear(), 0, 1),
  });
  const [calSpan, setCalSpan] = useState("month");
  const [calAnchor, setCalAnchor] = useState(() => startOfDay(new Date()));

  const today = useMemo(() => startOfDay(new Date()), []);

  // Iteration 5 (Bug 11) — prefer the scoped opener so tile-chip
  // clicks carry `scope`/`refId`/`kind` into the new conversation.
  // Falls back to onOpenChat / onPrefill (string-only) for legacy
  // mounts (e.g. storyboard).
  const openChat = useCallback(
    (prefill, scope) => {
      if (typeof onOpenChatWith === "function") {
        onOpenChatWith(prefill, scope);
        return;
      }
      const legacy = onOpenChat || onPrefill;
      if (typeof legacy === "function") legacy(prefill);
    },
    [onOpenChatWith, onOpenChat, onPrefill],
  );

  /* ---------- collect & normalize data from state ---------- */

  const goals = useMemo(
    () => (state?.goals || []).filter((g) => g.status !== "dropped"),
    [state],
  );

  const milestones = useMemo(
    () =>
      (state?.milestones || [])
        .map((m) => ({
          ...m,
          date: parse(m.target_date),
          goalId: m.goal_id,
          goalTitle:
            m.goal_title ||
            (m.goal_id && goals.find((g) => g.id === m.goal_id)?.title) ||
            "",
        }))
        .filter((m) => m.date && m.status !== "done"),
    [state, goals],
  );

  const blockers = useMemo(
    () =>
      (state?.blockers || [])
        .map((b) => ({
          ...b,
          start: parse(b.start_date),
          end: parse(b.end_date) || parse(b.start_date),
        }))
        .filter((b) => b.start),
    [state],
  );

  const openCommitments = useMemo(
    () => (state?.commitments || []).filter((c) => c.status === "open"),
    [state],
  );

  const recentActivity = useMemo(() => {
    const events = [];
    (state?.audit_summary?.recent || []).forEach((a) => {
      const d = a.created_at ? new Date(a.created_at) : null;
      if (d) events.push({ date: d, kind: a.type || "event", label: a.summary || a.type });
    });
    (state?.sources || []).forEach((s) => {
      const d = s.created_at ? new Date(s.created_at) : null;
      if (d) events.push({ date: d, kind: s.kind || "source", label: s.original_filename || "source" });
    });
    return events.sort((a, b) => a.date - b.date);
  }, [state]);

  /* single time-ordered items list — used by drill buckets and calendar. */
  const allItems = useMemo(() => {
    const out = [];
    goals.forEach((g) => {
      const explicitEnd = parse(g.target_date);
      const win = goalWindow(g, today);
      out.push({
        kind: "goal",
        // `date` is the item's anchor date for the drill buckets / sorting;
        // the calendar uses the explicit `start` / `end` span below.
        date: explicitEnd || win.start,
        start: win.start,
        end: win.end,
        id: g.id,
        title: g.title,
        horizon: g.horizon,
        status: g.status,
        // Surfaced in the tile tooltip so the user can tell a real
        // target date from a horizon-derived estimate.
        inferredSpan: win.inferred,
      });
    });
    milestones.forEach((m) => {
      out.push({
        kind: "milestone",
        date: m.date,
        start: m.date,
        end: m.date,
        id: m.id,
        title: m.title || "Milestone",
        goalTitle: m.goalTitle,
        status: m.status,
      });
    });
    openCommitments.forEach((c) => {
      const d = parse(c.due);
      if (d)
        out.push({
          kind: "commitment",
          date: d,
          start: d,
          end: d,
          id: c.id,
          title: c.text,
          goalTitle: c.goal_title,
          status: c.status,
        });
    });
    blockers.forEach((b) => {
      out.push({
        kind: "blocker",
        date: b.start,
        start: b.start,
        end: b.end || b.start,
        id: b.id,
        title: b.title,
      });
    });
    return out.sort((a, b) => a.date - b.date);
  }, [goals, milestones, openCommitments, blockers, today]);

  const isEmpty = allItems.length === 0 && goals.length === 0;

  const statsData = useMemo(
    () => ({
      goals: goals.length,
      milestones: milestones.length,
      commitments: openCommitments.length,
      blockers: blockers.length,
      activity: recentActivity.length,
      drift: allItems.filter(
        (it) => it.kind !== "goal" && it.date < today && (it.status || "open") !== "done",
      ).length,
    }),
    [goals, milestones, openCommitments, blockers, recentActivity, allItems, today],
  );

  /* ---------- drill nav helpers ---------- */

  const drill = (b) => b.next && setView({ level: b.next, anchor: b.start });
  const goBack = () => {
    const a = view.anchor;
    if (view.level === "quarter") setView({ level: "year", anchor: new Date(a.getFullYear(), 0, 1) });
    else if (view.level === "month")
      setView({ level: "quarter", anchor: new Date(a.getFullYear(), Math.floor(a.getMonth() / 3) * 3, 1) });
    else if (view.level === "week")
      setView({ level: "month", anchor: new Date(a.getFullYear(), a.getMonth(), 1) });
  };
  const shiftYear = (delta) => {
    const a = view.anchor;
    setView({ level: view.level, anchor: new Date(a.getFullYear() + delta, a.getMonth(), 1) });
  };

  const crumbs = useMemo(() => {
    const out = [];
    const ay = view.anchor.getFullYear();
    out.push({
      label: `${ay}`,
      onClick: () => setView({ level: "year", anchor: new Date(ay, 0, 1) }),
    });
    if (["quarter", "month", "week"].includes(view.level)) {
      const q = Math.floor(view.anchor.getMonth() / 3);
      out.push({
        label: `Q${q + 1}`,
        onClick: () => setView({ level: "quarter", anchor: new Date(ay, q * 3, 1) }),
      });
    }
    if (["month", "week"].includes(view.level)) {
      const m = view.anchor.getMonth();
      out.push({
        label: MONTHS[m],
        onClick: () => setView({ level: "month", anchor: new Date(ay, m, 1) }),
      });
    }
    if (view.level === "week") {
      const ws = startOfWeek(view.anchor);
      out.push({ label: fmtDay(ws), onClick: null });
    }
    return out;
  }, [view]);

  const buckets = useMemo(() => makeBuckets(view.level, view.anchor), [view]);
  const itemsIn = (s, e) => allItems.filter((it) => it.date >= s && it.date < e);
  const blockersIn = (s, e) =>
    blockers.filter((b) => b.start < e && (b.end || b.start) >= s);

  /* ---------- keyboard shortcuts ---------- */
  useEffect(() => {
    const onKey = (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Escape" && viewType === "drill" && view.level !== "year") {
        e.preventDefault();
        goBack();
        return;
      }
      if (viewType === "calendar") {
        const preset = CAL_SPANS.find((s) => s.key === calSpan);
        const spanIdx = CAL_SPANS.findIndex((s) => s.key === calSpan);
        if (e.key === "ArrowRight") {
          e.preventDefault();
          setCalAnchor((a) => addDays(a, preset?.days || 30));
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          setCalAnchor((a) => addDays(a, -(preset?.days || 30)));
        } else if (e.key === "t" || e.key === "T") {
          e.preventDefault();
          setCalAnchor(startOfDay(new Date()));
        } else if (["1", "2", "3", "4", "5"].includes(e.key)) {
          const idx = clamp(parseInt(e.key, 10) - 1, 0, CAL_SPANS.length - 1);
          if (CAL_SPANS[idx]) {
            e.preventDefault();
            setCalSpan(CAL_SPANS[idx].key);
          }
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewType, calSpan, view.level]);

  /* ---------- empty state ---------- */

  if (isEmpty) {
    return <EmptyState onPrefill={onPrefill} onOpenChatWith={onOpenChatWith} />;
  }

  return (
    <div data-testid="timeline-view" className="p-3 sm:p-5 md:p-6 space-y-4">
      <HeaderStrip
        viewType={viewType}
        setViewType={setViewType}
        view={view}
        crumbs={crumbs}
        goBack={goBack}
        shiftYear={shiftYear}
        stats={statsData}
        calSpan={calSpan}
        setCalSpan={setCalSpan}
        calAnchor={calAnchor}
        setCalAnchor={setCalAnchor}
        today={today}
      />

      {viewType === "drill" && (
        <DrillView
          buckets={buckets}
          itemsIn={itemsIn}
          blockersIn={blockersIn}
          today={today}
          level={view.level}
          drill={drill}
          stats={statsData}
        />
      )}

      {viewType === "strip" && (
        <StripView state={state} goals={goals} today={today} openChat={openChat} onPrefill={onPrefill} />
      )}

      {viewType === "calendar" && (
        <CalendarView
          allItems={allItems}
          goals={goals}
          milestones={milestones}
          commitments={openCommitments}
          blockers={blockers}
          today={today}
          span={calSpan}
          setSpan={setCalSpan}
          anchor={calAnchor}
          setAnchor={setCalAnchor}
          openChat={openChat}
          onPrefill={onPrefill}
        />
      )}
    </div>
  );
}

/* ============================================================================
 * HeaderStrip — view-type dropdown + drill crumbs / cal nav / stats.
 * ========================================================================= */

function HeaderStrip({
  viewType,
  setViewType,
  view,
  crumbs,
  goBack,
  shiftYear,
  stats,
  calSpan,
  setCalSpan,
  calAnchor,
  setCalAnchor,
  today,
}) {
  const activeView = VIEW_TYPES.find((v) => v.key === viewType) || VIEW_TYPES[0];
  const ActiveIcon = activeView.Icon;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
        {/* View-type dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-testid="timeline-viewtype-trigger"
              aria-label="Choose how to view your timeline"
              className="inline-flex items-center gap-2 h-11 sm:h-9 px-3 rounded-md border border-[var(--border)] bg-[color-mix(in_srgb,var(--bg-secondary)_40%,transparent)] hover:border-[var(--border-accent)] hover:bg-[var(--bg-secondary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)]"
            >
              <ActiveIcon className="w-3.5 h-3.5 text-[var(--accent)]" aria-hidden="true" />
              <span className="font-display text-[14px] font-semibold text-[var(--text-primary)]">
                {activeView.label}
              </span>
              <span className="hidden sm:inline font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)] max-w-[180px] truncate">
                · {activeView.sub}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)] ml-1" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              View type
            </DropdownMenuLabel>
            {VIEW_TYPES.map((v) => {
              const Icon = v.Icon;
              const active = v.key === viewType;
              return (
                <DropdownMenuItem
                  key={v.key}
                  data-testid={`timeline-viewtype-${v.key}`}
                  onSelect={() => setViewType(v.key)}
                  className="flex items-start gap-3 py-2.5 cursor-pointer"
                >
                  <Icon
                    className={`w-4 h-4 mt-0.5 shrink-0 ${active ? "text-[var(--accent)]" : "text-[var(--text-secondary)]"}`}
                    aria-hidden="true"
                  />
                  <div className="flex-1 min-w-0">
                    <div className={`text-[13px] font-medium ${active ? "text-[var(--accent)]" : "text-[var(--text-primary)]"}`}>
                      {v.label}
                      {active && <span className="ml-2 text-[10px] uppercase tracking-widest text-[var(--accent)]">· now</span>}
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)] mt-0.5 leading-snug">
                      {v.sub}
                    </div>
                  </div>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        {viewType === "drill" && view.level !== "year" && (
          <button
            data-testid="timeline-back"
            onClick={goBack}
            className="min-h-11 flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded"
          >
            <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" /> Back
          </button>
        )}
        {viewType === "drill" && (
          <div
            className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)]"
            data-testid="timeline-crumbs"
          >
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span className="opacity-40">/</span>}
                {c.onClick ? (
                  <button onClick={c.onClick} className="min-h-11 min-w-11 inline-flex items-center justify-center hover:text-[var(--accent)] transition-colors">
                    {c.label}
                  </button>
                ) : (
                  <span className="text-[var(--accent)]">{c.label}</span>
                )}
              </span>
            ))}
          </div>
        )}
        {viewType === "drill" && (
          <div className="flex items-center gap-0.5 ml-1">
            <button
              data-testid="timeline-prev-year"
              onClick={() => shiftYear(-1)}
              className="h-11 w-11 sm:h-9 sm:w-9 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-tertiary)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              title="Previous year"
              aria-label="Previous year"
            >
              <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
            <button
              data-testid="timeline-next-year"
              onClick={() => shiftYear(1)}
              className="h-11 w-11 sm:h-9 sm:w-9 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-tertiary)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              title="Next year"
              aria-label="Next year"
            >
              <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        )}

        {viewType === "calendar" && (
          <CalendarNav
            span={calSpan}
            setSpan={setCalSpan}
            anchor={calAnchor}
            setAnchor={setCalAnchor}
            today={today}
          />
        )}

        <div
          className="ml-auto flex items-center gap-x-3 sm:gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)] flex-wrap"
          data-testid="timeline-stats"
        >
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--accent)" }} />
            <span className="text-[var(--text-secondary)] tabular-nums">{stats.goals}</span>
            <span className="hidden sm:inline">goals</span>
          </span>
          <span className="flex items-center gap-1.5">
            <MilestoneIcon className="w-2.5 h-2.5 text-[var(--warning)]" aria-hidden="true" />
            <span className="text-[var(--text-secondary)] tabular-nums">{stats.milestones}</span>
            <span className="hidden sm:inline">ms</span>
          </span>
          <span className="flex items-center gap-1.5">
            <Flag className="w-2.5 h-2.5 text-[var(--accent)]" aria-hidden="true" />
            <span className="text-[var(--text-secondary)] tabular-nums">{stats.commitments}</span>
            <span className="hidden sm:inline">open</span>
          </span>
          <span className="flex items-center gap-1.5">
            <AlertOctagon className="w-2.5 h-2.5 text-[var(--warning)]" aria-hidden="true" />
            <span className="text-[var(--text-secondary)] tabular-nums">{stats.blockers}</span>
            <span className="hidden sm:inline">blockers</span>
          </span>
          {stats.drift > 0 && (
            <span
              className="flex items-center gap-1.5 text-[var(--danger)]"
              data-testid="timeline-drift"
              title="Past-due items"
            >
              <Circle className="w-2 h-2 fill-current" aria-hidden="true" />
              <span className="tabular-nums">{stats.drift}</span>
              <span className="hidden sm:inline">past due</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
 * CalendarNav — span chips + prev/next/today for the Calendar view.
 * ========================================================================= */

function CalendarNav({ span, setSpan, anchor, setAnchor, today }) {
  const preset = CAL_SPANS.find((s) => s.key === span) || CAL_SPANS[2];
  const stepDays = preset.days;

  const label = useMemo(() => {
    const a = anchor;
    if (span === "day") return fmtMonth(a);
    if (span === "week") {
      const ws = startOfWeek(a);
      const we = addDays(ws, 6);
      return `${fmtDay(ws)} – ${fmtDay(we)}, ${we.getFullYear()}`;
    }
    if (span === "month") return fmtMonth(a);
    if (span === "quarter") {
      const q = Math.floor(a.getMonth() / 3) * 3;
      const qEnd = new Date(a.getFullYear(), q + 3, 0);
      return `Q${Math.floor(a.getMonth() / 3) + 1} ${a.getFullYear()} · ${MONTHS[q]} – ${MONTHS[qEnd.getMonth()]}`;
    }
    return `${a.getFullYear()}`;
  }, [anchor, span]);

  const isToday = useMemo(() => {
    if (span === "day") return sameDay(anchor, today);
    if (span === "week") {
      const ws = startOfWeek(anchor);
      const we = addDays(ws, 7);
      return today >= ws && today < we;
    }
    if (span === "month") return anchor.getFullYear() === today.getFullYear() && anchor.getMonth() === today.getMonth();
    if (span === "quarter") return anchor.getFullYear() === today.getFullYear() && Math.floor(anchor.getMonth() / 3) === Math.floor(today.getMonth() / 3);
    return anchor.getFullYear() === today.getFullYear();
  }, [anchor, span, today]);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div
        className="inline-flex rounded-md border border-[var(--border)] bg-[color-mix(in_srgb,var(--bg-secondary)_40%,transparent)] p-0.5"
        role="tablist"
        aria-label="Calendar span"
      >
        {CAL_SPANS.map((s) => (
          <button
            key={s.key}
            type="button"
            data-testid={`timeline-cal-span-${s.key}`}
            onClick={() => setSpan(s.key)}
            role="tab"
            aria-selected={span === s.key}
            className={`h-11 sm:h-9 min-w-11 px-2 sm:px-2.5 text-[10px] font-mono uppercase tracking-widest transition-colors rounded ${
              span === s.key
                ? "bg-[var(--accent)] text-[var(--bg-primary)]"
                : "text-[var(--text-secondary)] hover:text-[var(--accent)]"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => setAnchor((a) => addDays(a, -stepDays))}
          className="h-11 w-11 sm:h-9 sm:w-9 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-tertiary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          title="Previous"
          aria-label="Previous"
        >
          <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
        <h2
          className="font-display text-[15px] sm:text-[17px] font-semibold text-[var(--text-primary)] tracking-tight min-w-[140px] sm:min-w-[200px] text-center"
          aria-live="polite"
        >
          {label}
        </h2>
        <button
          type="button"
          onClick={() => setAnchor((a) => addDays(a, stepDays))}
          className="h-11 w-11 sm:h-9 sm:w-9 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-tertiary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          title="Next"
          aria-label="Next"
        >
          <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => setAnchor(startOfDay(new Date()))}
          disabled={isToday}
          className="h-11 sm:h-9 px-2.5 rounded font-mono text-[10px] uppercase tracking-widest border border-[var(--border)] hover:border-[var(--border-accent)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50 disabled:cursor-default transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          style={{ background: "var(--bg-secondary)" }}
        >
          Today
        </button>
      </div>
    </div>
  );
}

/* ============================================================================
 * EmptyState — calmer, more inviting; keeps the prefill CTA.
 * ========================================================================= */

function EmptyState({ onPrefill, onOpenChatWith }) {
  // Scoped chat context — opens the chat in "About: Build my timeline"
  // mode with a helper hint, instead of the generic empty state. Without
  // this the CTA landed the user in the generic coach chat with no
  // indication of what they were about to talk about.
  const onBuildTimeline = () => {
    const helperText =
      "What does a realistic timeline look like for my goals — proposed target dates and 2-4 milestones each, with buffer for real life.";
    if (typeof onOpenChatWith === "function") {
      onOpenChatWith("", {
        title: "Build my timeline",
        helperText,
      });
      return;
    }
    if (typeof onPrefill === "function") {
      onPrefill(
        "Map out a realistic timeline for my goals — propose target dates and 2-4 milestones each, with buffer for real life.",
      );
    }
  };

  return (
    <div data-testid="timeline-view" className="p-4 sm:p-6">
      <div className="relative overflow-hidden border border-dashed border-[var(--border)] rounded-lg bg-[color-mix(in_srgb,var(--bg-secondary)_30%,transparent)] px-6 py-10 sm:py-14 text-center">
        <svg
          aria-hidden="true"
          className="mx-auto mb-5 opacity-90"
          width="160"
          height="56"
          viewBox="0 0 160 56"
        >
          <rect x="0.5" y="0.5" width="159" height="55" rx="6" fill="var(--bg-tertiary)" stroke="var(--border)" />
          {[...Array(30)].map((_, i) => {
            const x = (i % 10) * 15 + 6;
            const y = Math.floor(i / 10) * 18 + 10;
            const isToday = i === 14;
            return (
              <rect
                key={i}
                x={x}
                y={y}
                width="12"
                height="12"
                rx="2"
                fill={isToday ? "var(--accent)" : "var(--bg-secondary)"}
                stroke={isToday ? "var(--accent)" : "var(--border)"}
                opacity={isToday ? 1 : 0.7}
              />
            );
          })}
          <line x1="0" y1="28" x2="160" y2="28" stroke="var(--border-accent)" strokeWidth="0.5" opacity="0.5" />
        </svg>

        <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-[var(--bg-tertiary)] mb-3">
          <CalendarClock className="w-5 h-5 text-[var(--accent)]" aria-hidden="true" />
        </div>

        <h2 className="text-base sm:text-lg font-medium text-[var(--text-primary)] font-display">
          Your timeline is a blank page
        </h2>
        <p className="mt-2 text-sm text-[var(--text-secondary)] leading-relaxed max-w-md mx-auto">
          No dates on the map yet. Ask the coach to sketch a realistic timeline — it'll propose
          target dates and a few milestones per goal, with buffer built in.
        </p>

        {(onOpenChatWith || onPrefill) && (
          <button
            data-testid="timeline-prefill-button"
            onClick={onBuildTimeline}
            className="min-h-11 inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono uppercase tracking-widest text-[var(--bg-primary)] bg-[var(--accent)] hover:bg-[color-mix(in_srgb,var(--accent)_90%,transparent)] transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)]"
          >
            Ask the coach to build my timeline →
          </button>
        )}
      </div>
    </div>
  );
}

/* ============================================================================
 * DrillView — bucketed day-by-day view (kept verbatim from the original).
 * ========================================================================= */

function DrillView({ buckets, itemsIn, blockersIn, today, level, drill, stats }) {
  return (
    <>
      <div
        className={`grid gap-3 ${level === "week" ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2"}`}
      >
        {buckets.map((b, idx) => {
          const its = itemsIn(b.start, b.end);
          const bls = blockersIn(b.start, b.end);
          const drift = its.filter((it) => it.kind !== "goal" && !it.done && it.date < today);
          const isNow = today >= b.start && today < b.end;
          const clickable = !!b.next;

          const goalsInBucket = its.filter((it) => it.kind === "goal");
          const msInBucket = its.filter((it) => it.kind === "milestone");
          const csInBucket = its.filter((it) => it.kind === "commitment");
          const bsInBucket = bls;

          return (
            <div
              key={idx}
              data-testid={`timeline-bucket-${level}-${idx}`}
              className={`group relative border rounded transition-colors overflow-hidden ${
                isNow
                  ? "border-[var(--accent)] bg-[var(--bg-secondary)]"
                  : "border-[var(--border)] bg-[color-mix(in_srgb,var(--bg-secondary)_40%,transparent)] hover:border-[var(--border-accent)]"
              }`}
            >
              {clickable && (
                <button
                  type="button"
                  onClick={() => drill(b)}
                  aria-label={`Drill into ${b.label}`}
                  className="absolute inset-0 z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-[-2px]"
                />
              )}
              {isNow && <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-[var(--accent)]" />}

              <div className="flex items-baseline justify-between gap-2 px-3 pt-2.5">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span
                    className={`text-sm font-medium truncate ${
                      isNow ? "text-[var(--accent)]" : "text-[var(--text-primary)]"
                    }`}
                  >
                    {b.label}
                  </span>
                  {isNow && (
                    <span className="font-mono text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-[var(--accent)] text-[var(--bg-primary)]">
                      now
                    </span>
                  )}
                </div>
                <span className="font-mono text-[10px] text-[var(--text-muted)] shrink-0">{b.sub}</span>
              </div>

              {(goalsInBucket.length + msInBucket.length + csInBucket.length + bsInBucket.length) > 0 && (
                <div className="flex items-center gap-3 px-3 mt-1.5 font-mono text-[9px] uppercase tracking-widest text-[var(--text-muted)]">
                  {goalsInBucket.length > 0 && (
                    <span className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--accent)" }} />
                      {goalsInBucket.length}g
                    </span>
                  )}
                  {msInBucket.length > 0 && (
                    <span className="flex items-center gap-1">
                      <MilestoneIcon className="w-2.5 h-2.5" aria-hidden="true" />
                      {msInBucket.length}m
                    </span>
                  )}
                  {csInBucket.length > 0 && (
                    <span className="flex items-center gap-1">
                      <Flag className="w-2.5 h-2.5" aria-hidden="true" />
                      {csInBucket.length}c
                    </span>
                  )}
                  {bsInBucket.length > 0 && (
                    <span className="flex items-center gap-1 text-[var(--danger)]">
                      <AlertOctagon className="w-2.5 h-2.5" aria-hidden="true" />
                      {bsInBucket.length}b
                    </span>
                  )}
                  {drift.length > 0 && (
                    <span className="text-[var(--danger)] ml-auto">−{drift.length} past due</span>
                  )}
                </div>
              )}

              <div className="px-3 pt-1.5 pb-2.5 space-y-1 relative z-0">
                {goalsInBucket.map((it) => (
                  <div key={'g-' + it.id} className="flex items-center gap-1.5 text-xs">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: HORIZON_COLOR[it.horizon] || "var(--accent)" }} />
                    <span className="truncate text-[var(--text-primary)]">{it.title}</span>
                    <span className="ml-auto font-mono text-[9px] uppercase tracking-widest text-[var(--text-muted)] shrink-0">
                      {fmtIso(it.date)}
                    </span>
                  </div>
                ))}
                {msInBucket.map((it) => (
                  <div key={'m-' + it.id} className="flex items-center gap-1.5 text-xs">
                    <MilestoneIcon className="w-3 h-3 text-[var(--warning)] shrink-0" aria-hidden="true" />
                    <span className="truncate text-[var(--text-secondary)]">{it.title}</span>
                    <span className="ml-auto font-mono text-[9px] uppercase tracking-widest text-[var(--text-muted)] shrink-0">
                      {fmtIso(it.date)}
                    </span>
                  </div>
                ))}
                {csInBucket.map((it) => (
                  <div key={'c-' + it.id} className="flex items-center gap-1.5 text-xs">
                    <Flag className="w-3 h-3 text-[var(--accent)] shrink-0" aria-hidden="true" />
                    <span className="truncate text-[var(--text-secondary)]">{it.title}</span>
                    <span className="ml-auto font-mono text-[9px] uppercase tracking-widest text-[var(--text-muted)] shrink-0">
                      {fmtIso(it.date)}
                    </span>
                  </div>
                ))}
                {bsInBucket.map((b, i) => (
                  <div key={'b-' + i} className="flex items-center gap-1.5 text-xs">
                    <AlertOctagon className="w-3 h-3 text-[var(--danger)] shrink-0" aria-hidden="true" />
                    <span className="truncate text-[var(--danger)]">{b.title}</span>
                  </div>
                ))}
                {its.length === 0 && bsInBucket.length === 0 && (
                  <div className="text-[11px] text-[var(--text-muted)] italic">nothing scheduled</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ============================================================================
 * StripView — "At a glance" horizon strips (ported from TimelineVariantB).
 * ========================================================================= */

function bucketFromDate(d, today) {
  if (!d) return "later";
  const diff = daysUntil(d, today);
  if (diff <= 0) return "today";
  if (diff <= 7) return "thisWeek";
  if (diff <= 30) return "thisMonth";
  if (diff <= 90) return "thisQuarter";
  if (diff <= 365) return "thisYear";
  return "later";
}

const HORIZON_PILL = {
  weekly: { bg: "var(--accent)", fg: "var(--bg-primary)", label: "WK" },
  short: { bg: "var(--warning)", fg: "var(--bg-primary)", label: "SHORT" },
  medium: { bg: "var(--accent)", fg: "var(--bg-primary)", label: "MED" },
  long: { bg: "var(--success)", fg: "var(--bg-primary)", label: "LONG" },
};

function StripView({ state, today, openChat, onPrefill }) {
  const buckets = useMemo(() => {
    const out = Object.fromEntries(HORIZONS.map((h) => [h.key, []]));
    const push = (kind, item, date) => {
      const k = bucketFromDate(date, today);
      out[k].push({ kind, item, date });
    };
    (state?.goals || []).forEach((g) => {
      const d = parse(g.target_date) || parse(g.start_date) || today;
      push("goal", g, d);
    });
    (state?.milestones || []).forEach((m) => {
      const d = parse(m.target_date) || today;
      push("milestone", m, d);
    });
    (state?.commitments || []).forEach((c) => {
      if (c.status === "done") return;
      const d = parse(c.due) || today;
      push("commitment", c, d);
    });
    (state?.blockers || []).forEach((b) => {
      if (b.end_date && new Date(b.end_date) < today) return;
      out.today.push({ kind: "blocker", item: b, date: today });
    });
    return out;
  }, [state, today]);

  const totals = useMemo(() => {
    const goals = state?.goals?.length || 0;
    const openCommitments = (state?.commitments || []).filter(
      (c) => c.status !== "done",
    ).length;
    const milestones = state?.milestones?.length || 0;
    const blockers = (state?.blockers || []).filter(
      (b) => !b.end_date || new Date(b.end_date) >= today,
    ).length;
    return { goals, openCommitments, milestones, blockers };
  }, [state, today]);

  const totalItems = HORIZONS.reduce((sum, h) => sum + buckets[h.key].length, 0);

  if (totalItems === 0) {
    return <StripEmptyState onAsk={openChat || onPrefill} />;
  }

  const handlers = {
    goal: (g) =>
      openChat(
        `Let's focus on the goal "${g.title}". What's the next small step I should take this week?`,
      ),
    commitment: (c) =>
      openChat(
        `I want to follow through on: "${c.text}". What's the best way to start?`,
      ),
    milestone: (m) =>
      openChat(
        `Let's check in on the milestone "${m.title}"${m.goal_title ? ` for ${m.goal_title}` : ""}.`,
      ),
    blocker: (b) =>
      openChat(`I'm stuck on "${b.title}". Can you help me unblock this?`),
    horizon: (h) =>
      openChat(
        `Help me plan something for ${h.label.toLowerCase()} — what should I commit to?`,
      ),
  };

  return (
    <div className="flex flex-col gap-5 gc-fade-in" aria-label="Timeline — at a glance">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1 font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
        <span>
          <strong className="text-[var(--text-primary)] font-semibold">{totals.goals}</strong>{" "}
          goals
        </span>
        <span aria-hidden="true">·</span>
        <span>
          <strong className="text-[var(--text-primary)] font-semibold">{totals.milestones}</strong>{" "}
          milestones
        </span>
        <span aria-hidden="true">·</span>
        <span>
          <strong className="text-[var(--text-primary)] font-semibold">{totals.openCommitments}</strong>{" "}
          open commitments
        </span>
        <span aria-hidden="true">·</span>
        <span>
          <strong className="text-[var(--text-primary)] font-semibold">{totals.blockers}</strong>{" "}
          blockers
        </span>
        <span aria-hidden="true" className="hidden sm:inline">·</span>
        <button
          type="button"
          onClick={() =>
            openChat(
              "Look at my whole timeline and suggest where to focus this week.",
            )
          }
          className="hidden sm:inline ml-auto text-[var(--accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded"
        >
          Ask the coach to re-plan →
        </button>
      </div>

      <div className="flex flex-col gap-5">
        {HORIZONS.map((h) => {
          const items = buckets[h.key];
          return (
            <section
              key={h.key}
              aria-labelledby={`strip-${h.key}`}
              role="group"
              data-density={items.length === 0 ? "empty" : items.length <= 2 ? "low" : "high"}
            >
              <div id={`strip-${h.key}`} className="flex items-baseline justify-between gap-2 mb-2 px-1">
                <div className="flex items-baseline gap-2 min-w-0">
                  <h3 className="font-display text-[15px] font-semibold text-[var(--text-primary)] truncate">
                    {h.label}
                  </h3>
                  <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)] truncate">
                    {h.sub}
                  </span>
                </div>
                <span
                  className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)] shrink-0"
                  aria-label={`${items.length} item${items.length === 1 ? "" : "s"}`}
                >
                  {items.length}
                </span>
              </div>
              <StripBody testId={`timeline-b-strip-${h.key}`}>
                {items.length === 0 ? (
                  <EmptyStrip horizon={h} onAsk={handlers.horizon} />
                ) : (
                  items.map((entry) => {
                    if (entry.kind === "goal") {
                      return (
                        <div key={`g-${entry.item.id}`} role="listitem">
                          <GoalCard
                            goal={entry.item}
                            today={today}
                            onActivate={handlers.goal}
                          />
                        </div>
                      );
                    }
                    if (entry.kind === "commitment") {
                      return (
                        <div key={`c-${entry.item.id}`} role="listitem">
                          <CommitmentCard
                            c={entry.item}
                            today={today}
                            onActivate={handlers.commitment}
                          />
                        </div>
                      );
                    }
                    if (entry.kind === "milestone") {
                      return (
                        <div key={`m-${entry.item.id}`} role="listitem">
                          <MilestoneCard
                            m={entry.item}
                            today={today}
                            onActivate={handlers.milestone}
                          />
                        </div>
                      );
                    }
                    if (entry.kind === "blocker") {
                      return (
                        <div key={`b-${entry.item.id}`} role="listitem">
                          <BlockerCard
                            b={entry.item}
                            onActivate={handlers.blocker}
                          />
                        </div>
                      );
                    }
                    return null;
                  })
                )}
              </StripBody>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function StripEmptyState({ onAsk }) {
  return (
    <div
      data-testid="timeline-view"
      className="gc-fade-in flex flex-col items-center justify-center text-center gap-4 py-16 px-6 rounded-lg border border-dashed border-[var(--border)] bg-[color-mix(in_srgb,var(--bg-secondary)_30%,transparent)]"
      role="region"
      aria-label="Timeline empty state"
    >
      <div
        className="w-12 h-12 rounded-full flex items-center justify-center"
        style={{ background: "color-mix(in srgb, var(--accent) 12%, transparent)" }}
      >
        <CalendarClock size={22} style={{ color: "var(--accent)" }} aria-hidden="true" />
      </div>
      <div className="space-y-1.5 max-w-md">
        <h3 className="font-display text-[18px] font-semibold text-[var(--text-primary)]">
          Nothing to glance at yet
        </h3>
        <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">
          Once you and your coach set a goal or commitment, it'll appear here organized by when
          it's due — from today out to the long view.
        </p>
      </div>
      {typeof onAsk === "function" && (
        <button
          type="button"
          data-testid="timeline-prefill-button"
          onClick={() =>
            onAsk(
              "Help me set my first goal and a small commitment for this week.",
            )
          }
          className="min-h-11 inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[var(--accent)] text-[var(--bg-primary)] font-medium text-[13px] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)] transition-all"
        >
          <Sparkles size={14} aria-hidden="true" />
          Ask the coach to start
        </button>
      )}
    </div>
  );
}

function StripBody({ children, testId }) {
  const ref = useRef(null);
  return (
    <div className="relative">
      <div
        ref={ref}
        data-testid={testId}
        className="gc-strip-body flex overflow-x-auto snap-x snap-mandatory gap-3 pb-2 pt-1 -mx-1 px-1"
        role="list"
      >
        {children}
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 w-6"
        style={{ background: "linear-gradient(to right, var(--bg-primary), transparent)" }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 w-6"
        style={{ background: "linear-gradient(to left, var(--bg-primary), transparent)" }}
      />
    </div>
  );
}

function EmptyStrip({ horizon, onAsk }) {
  return (
    <div
      className="snap-start shrink-0 min-w-[260px] w-[280px] sm:w-[300px] rounded-md border border-dashed border-[var(--border)] bg-[color-mix(in_srgb,var(--bg-secondary)_40%,transparent)] px-3.5 py-4 flex flex-col items-start gap-2"
      role="note"
      aria-label={`No items in ${horizon.label.toLowerCase()}`}
    >
      <Inbox size={14} style={{ color: "var(--text-muted)" }} aria-hidden="true" />
      <div className="font-display text-[13px] leading-snug text-[var(--text-secondary)]">
        Nothing in {horizon.label.toLowerCase()} yet.
      </div>
      <button
        type="button"
        onClick={() => onAsk(horizon)}
        className="mt-1 min-h-11 inline-flex items-center font-mono text-[10px] uppercase tracking-widest text-[var(--accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded"
      >
        Ask the coach →
      </button>
    </div>
  );
}

function HorizonPill({ horizon }) {
  const t = HORIZON_PILL[horizon];
  if (!t) return null;
  return (
    <span
      className="font-mono text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded"
      style={{ background: t.bg, color: t.fg }}
      aria-label={`horizon: ${horizon}`}
    >
      {t.label}
    </span>
  );
}

function StripStatusDot({ status, kind }) {
  const tone =
    status === "done" || status === "completed"
      ? "var(--success)"
      : status === "overdue" || status === "dropped"
      ? "var(--danger)"
      : kind === "blocker"
      ? "var(--danger)"
      : "var(--accent)";
  return (
    <span
      aria-hidden="true"
      className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
      style={{ background: tone }}
    />
  );
}

function StripMetaLine({ icon: Icon, children, tone = "var(--text-muted)" }) {
  return (
    <span
      className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest"
      style={{ color: tone }}
    >
      <Icon size={11} aria-hidden="true" />
      {children}
    </span>
  );
}

function StripCardBase({ tone = "var(--bg-secondary)", children, onActivate, testId, label }) {
  return (
    <button
      type="button"
      onClick={onActivate}
      data-testid={testId}
      aria-label={label}
      className={[
        "group text-left rounded-md border transition-all duration-150",
        "min-w-[260px] w-[280px] sm:w-[300px] snap-start shrink-0",
        "p-3.5 flex flex-col gap-2",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)]",
        "hover:-translate-y-px hover:border-[var(--border-accent)]",
      ].join(" ")}
      style={{ background: tone, borderColor: "var(--border)" }}
    >
      {children}
    </button>
  );
}

function GoalCard({ goal, today, onActivate }) {
  const target = parse(goal.target_date);
  const days = daysUntil(target, today);
  const tone =
    days !== null && days < 0
      ? "color-mix(in srgb, var(--danger) 8%, var(--bg-secondary))"
      : days !== null && days <= 7
      ? "color-mix(in srgb, var(--accent) 10%, var(--bg-secondary))"
      : "var(--bg-secondary)";

  return (
    <StripCardBase
      tone={tone}
      testId={`timeline-b-goal-${goal.id}`}
      label={`Open chat about goal ${goal.title}`}
      onActivate={() => onActivate(goal)}
    >
      <div className="flex items-center justify-between gap-2">
        <HorizonPill horizon={goal.horizon} />
        <StripStatusDot status={goal.status} />
      </div>
      <div className="font-display text-[14px] leading-snug font-semibold text-[var(--text-primary)] line-clamp-2">
        {goal.title}
      </div>
      {goal.next_action && (
        <div className="text-[12px] leading-snug text-[var(--text-secondary)] line-clamp-2">
          Next: {goal.next_action}
        </div>
      )}
      <div className="mt-auto pt-2 border-t border-[var(--border)] flex items-center justify-between gap-2">
        {target ? (
          <StripMetaLine icon={Clock} tone={days !== null && days < 0 ? "var(--danger)" : undefined}>
            {days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? "today" : `${days}d`}
          </StripMetaLine>
        ) : (
          <StripMetaLine icon={Clock}>unscheduled</StripMetaLine>
        )}
      </div>
    </StripCardBase>
  );
}

function CommitmentCard({ c, today, onActivate }) {
  const due = parse(c.due);
  const days = daysUntil(due, today);
  const tone =
    days !== null && days < 0
      ? "color-mix(in srgb, var(--danger) 8%, var(--bg-secondary))"
      : days === 0
      ? "color-mix(in srgb, var(--accent) 10%, var(--bg-secondary))"
      : "var(--bg-secondary)";

  return (
    <StripCardBase
      tone={tone}
      testId={`timeline-b-commitment-${c.id}`}
      label={`Open chat about commitment ${c.text}`}
      onActivate={() => onActivate(c)}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[9px] uppercase tracking-widest text-[var(--text-secondary)]">
          commitment
        </span>
        <StripStatusDot status={c.status} kind="commitment" />
      </div>
      <div className="font-display text-[14px] leading-snug text-[var(--text-primary)] line-clamp-3">
        {c.text}
      </div>
      {c.goal_title && (
        <div className="text-[11px] text-[var(--text-muted)] line-clamp-1">↳ {c.goal_title}</div>
      )}
      <div className="mt-auto pt-2 border-t border-[var(--border)] flex items-center justify-between gap-2">
        {due ? (
          <StripMetaLine icon={Flag} tone={days !== null && days < 0 ? "var(--danger)" : undefined}>
            {days < 0 ? `${Math.abs(days)}d late` : days === 0 ? "today" : `${days}d`}
          </StripMetaLine>
        ) : (
          <StripMetaLine icon={Flag}>no due</StripMetaLine>
        )}
      </div>
    </StripCardBase>
  );
}

function MilestoneCard({ m, today, onActivate }) {
  const target = parse(m.target_date);
  const days = daysUntil(target, today);
  const tone =
    days !== null && days < 0
      ? "color-mix(in srgb, var(--danger) 8%, var(--bg-secondary))"
      : days === 0
      ? "color-mix(in srgb, var(--accent) 10%, var(--bg-secondary))"
      : "var(--bg-secondary)";

  return (
    <StripCardBase
      tone={tone}
      testId={`timeline-b-milestone-${m.id}`}
      label={`Open chat about milestone ${m.title}`}
      onActivate={() => onActivate(m)}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[9px] uppercase tracking-widest text-[var(--text-secondary)]">
          milestone
        </span>
        <StripStatusDot status={m.status} kind="milestone" />
      </div>
      <div className="font-display text-[14px] leading-snug font-semibold text-[var(--text-primary)] line-clamp-2">
        {m.title}
      </div>
      {m.goal_title && (
        <div className="text-[11px] text-[var(--text-muted)] line-clamp-1">↳ {m.goal_title}</div>
      )}
      <div className="mt-auto pt-2 border-t border-[var(--border)] flex items-center justify-between gap-2">
        {target ? (
          <StripMetaLine icon={Target} tone={days !== null && days < 0 ? "var(--danger)" : undefined}>
            {days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? "today" : `${days}d`}
          </StripMetaLine>
        ) : (
          <StripMetaLine icon={Target}>no date</StripMetaLine>
        )}
      </div>
    </StripCardBase>
  );
}

function BlockerCard({ b, onActivate }) {
  return (
    <StripCardBase
      tone="color-mix(in srgb, var(--danger) 8%, var(--bg-secondary))"
      testId={`timeline-b-blocker-${b.id}`}
      label={`Open chat about blocker ${b.title}`}
      onActivate={() => onActivate(b)}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[9px] uppercase tracking-widest text-[var(--danger)]">
          blocker
        </span>
        <AlertOctagon size={11} style={{ color: "var(--danger)" }} aria-hidden="true" />
      </div>
      <div className="font-display text-[14px] leading-snug text-[var(--text-primary)] line-clamp-3">
        {b.title}
      </div>
      <div className="mt-auto pt-2 border-t border-[var(--border)] flex items-center justify-between gap-2">
        <StripMetaLine icon={Clock} tone="var(--danger)">active</StripMetaLine>
      </div>
    </StripCardBase>
  );
}

/* Kind → a short glyph carried in the bar's own label. Status hue is one
 * signal; this is the non-colour one, so a goal never has to be told from
 * a commitment by colour alone. Matches the glyphs CalendarTile uses. */
const KIND_GLYPH = { commitment: "▸ ", milestone: "◆ ", blocker: "! ", goal: "" };
function itemKindGlyph(kind) {
  return KIND_GLYPH[kind] ?? "";
}

/* ============================================================================
 * BarLegendSwatch — draws the *actual* bar recipe (tinted body + saturated
 * leading edge) so the legend can never drift from what is painted.
 * ========================================================================== */

function BarLegendSwatch({ hue, label }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className="inline-block h-3 w-4 rounded-[2px]"
        style={{
          background: `color-mix(in srgb, ${hue} ${SPAN_TINT_PCT}%, var(--bg-secondary))`,
          boxShadow: `inset 3px 0 0 0 ${hue}`,
        }}
      />
      <span>{label}</span>
    </span>
  );
}

/* ============================================================================
 * CalendarView — multi-day spanning tiles across all item kinds.
 * ========================================================================= */

function CalendarView({
  allItems,
  goals,
  milestones,
  commitments,
  blockers,
  today,
  span,
  setSpan,
  anchor,
  setAnchor,
  openChat,
  onPrefill,
}) {
  const preset = CAL_SPANS.find((s) => s.key === span) || CAL_SPANS[2];
  const days = preset.days;

  const { days: dayList, cells, itemsByDay } = useMemo(() => {
    const start = span === "week" ? startOfWeek(anchor) : anchor;
    const daysArr = [];
    for (let i = 0; i < days; i++) daysArr.push(addDays(start, i));
    const end = addDays(start, days);

    const cellsArr = [];
    if (span === "week" || span === "month" || span === "quarter") {
      const padStart = start.getDay() === 0 ? 6 : start.getDay() - 1;
      for (let i = padStart; i > 0; i--) cellsArr.push({ date: addDays(start, -i), inSpan: false });
      daysArr.forEach((d) => cellsArr.push({ date: d, inSpan: true }));
      while (cellsArr.length % 7 !== 0) {
        const last = cellsArr[cellsArr.length - 1].date;
        cellsArr.push({ date: addDays(last, 1), inSpan: false });
      }
    } else {
      daysArr.forEach((d) => cellsArr.push({ date: d, inSpan: true }));
    }

    const itemsIdx = {};
    allItems.forEach((it) => {
      if (!it) return;
      const rawStart = it.start || it.date;
      const rawEnd = it.end || it.date;
      if (!rawStart && !rawEnd) return;
      const s = startOfDay(rawStart || rawEnd);
      const e = startOfDay(rawEnd || rawStart);
      if (!s || !e || isNaN(s.getTime()) || isNaN(e.getTime())) return;
      const cur = new Date(s);
      while (cur <= e) {
        const key = fmtIso(cur);
        (itemsIdx[key] = itemsIdx[key] || []).push(it);
        cur.setDate(cur.getDate() + 1);
      }
    });

    return { days: daysArr, cells: cellsArr, itemsByDay: itemsIdx };
  }, [allItems, anchor, days, span]);

  /* For week/month/quarter: render spanning tiles in a grid (lanes per week).
     For day: render a vertical list of items for that single day.
     For year: render the same lane-per-week grid laid out as 4
     quarter-columns (Iteration 7 — was a separate bar-chart). */
  const year = anchor.getFullYear();

  const weeks = useMemo(() => {
    const w = [];
    for (let i = 0; i < cells.length; i += 7) w.push(cells.slice(i, i + 7));
    return w;
  }, [cells]);

  const tracksByWeek = useMemo(() => {
    return weeks.map((week) => {
      if (!week || !Array.isArray(week) || week.length === 0) {
        return { tracks: [], maxLanes: 1 };
      }
      const firstValidCell = week.find((c) => c?.date);
      const lastValidCell = [...week].reverse().find((c) => c?.date);
      if (!firstValidCell?.date || !lastValidCell?.date) {
        return { tracks: [], maxLanes: 1 };
      }
      const weekStart = week[0]?.date || firstValidCell.date;
      const weekEnd = addDays(week[6]?.date || lastValidCell.date, 1);
      const tracks = [];
      allItems.forEach((it) => {
        if (!it) return;
        const rawStart = it.start || it.date;
        const rawEnd = it.end || it.date;
        if (!rawStart && !rawEnd) return;
        const s = startOfDay(rawStart || rawEnd);
        const e = startOfDay(rawEnd || rawStart);
        if (!s || !e || isNaN(s.getTime()) || isNaN(e.getTime())) return;
        if (e < weekStart || s >= weekEnd) return;
        const segStart = s < weekStart ? weekStart : s;
        const lastCellDate = week[6]?.date || lastValidCell.date;
        const segEnd = e >= weekEnd ? addDays(lastCellDate, 1) : addDays(e, 1);
        let startCol = 1;
        let endCol = 7;
        for (let i = 0; i < 7; i++) {
          const cDate = week[i]?.date;
          if (cDate && cDate >= segStart) { startCol = i + 1; break; }
        }
        for (let i = 6; i >= 0; i--) {
          const cDate = week[i]?.date;
          if (cDate && cDate < segEnd) { endCol = i + 1; break; }
        }
        tracks.push({ item: it, startCol, endCol, lane: -1 });
      });
      /* Greedy lane assignment per week, sorted by start then length. */
      tracks.sort((a, b) => {
        if (a.startCol !== b.startCol) return a.startCol - b.startCol;
        return (b.endCol - b.startCol) - (a.endCol - a.startCol);
      });
      const laneEnds = [];
      tracks.forEach((t) => {
        let placed = false;
        for (let i = 0; i < laneEnds.length; i++) {
          if (laneEnds[i] < t.startCol) {
            laneEnds[i] = t.endCol;
            t.lane = i;
            placed = true;
            break;
          }
        }
        if (!placed) {
          t.lane = laneEnds.length;
          laneEnds.push(t.endCol);
        }
      });
      return { tracks, maxLanes: Math.max(laneEnds.length, 1) };
    });
  }, [weeks, allItems]);


  
  if (allItems.length === 0) {
    return <CalendarEmptyState onAsk={openChat || onPrefill} />;
  }

  /* === Year view (Iteration 7 — Ask 3) ===
   * Same lane-per-week pattern as Quarter, laid out as 4 quarter-columns
   * side by side for ~52 weeks. The previous bar-chart (one column per
   * month, stacked blocks in a 220px plot) read nothing like the
   * Month/Week/3-month views — different shape, different density, the
   * items-as-cells metaphor broke. Here every item renders the same way
   * regardless of span: a status-coloured bar with a left/right position
   * derived from its actual day-of-week span within the row.
   *
   * Layout:
   *   - 4 quarter-columns × 13 week-rows ≈ 52 rows
   *   - Each row is its own 7-day cell grid; bar's offset/width = its
   *     Mon..Sun position
   *   - Today row is accent-highlighted (matches Quarter's accent ring)
   */
  if (span === "year") {
    const yearStart = new Date(anchor.getFullYear(), 0, 1);
    const yearEnd = new Date(anchor.getFullYear() + 1, 0, 1);
    const quarters = [
      { label: "Q1 · Jan – Mar", start: new Date(anchor.getFullYear(), 0, 1) },
      { label: "Q2 · Apr – Jun", start: new Date(anchor.getFullYear(), 3, 1) },
      { label: "Q3 · Jul – Sep", start: new Date(anchor.getFullYear(), 6, 1) },
      { label: "Q4 · Oct – Dec", start: new Date(anchor.getFullYear(), 9, 1) },
    ];

    const buildQuarterRows = (qStart) => {
      const rows = [];
      let cursor = startOfWeek(qStart);
      let i = 0;
      // 14 weeks covers the 13 it could land in for the latest quarter
      while (cursor < yearEnd && i < 14) {
        const rowEnd = addDays(cursor, 7);
        if (cursor >= qStart && cursor < addDays(qStart, 92)) {
          const overlaps = allItems.filter((it) => {
            if (!it) return false;
            const s = startOfDay(it.start || it.date);
            const e = startOfDay(it.end || it.date);
            if (!s || !e || isNaN(s.getTime()) || isNaN(e.getTime())) return false;
            return e >= cursor && s < rowEnd;
          });
          rows.push({ start: cursor, end: addDays(cursor, 6), items: overlaps });
        }
        cursor = rowEnd;
        i++;
      }
      return rows;
    };

    const rowHeight = 26;
    return (
      <div className="space-y-3">
        <div
          className="rounded-lg border border-[var(--border-accent)] overflow-hidden"
          style={{ background: "var(--bg-primary)" }}
        >
          <div
            className="grid grid-cols-4 font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)] border-b border-[var(--border-accent)] bg-[color-mix(in_srgb,var(--bg-secondary)_40%,transparent)]"
          >
            {quarters.map((q, qi) => (
              <div key={qi} className="px-2 py-2 text-center select-none border-r last:border-r-0 border-[var(--border-accent)]">
                {q.label}
              </div>
            ))}
          </div>
          <div
            className="grid grid-cols-4 divide-x divide-[var(--border-accent)]"
            role="rowgroup"
          >
            {quarters.map((q, qi) => {
              const rows = buildQuarterRows(q.start);
              return (
                <div key={qi} role="rowgroup" data-testid={`timeline-cal-year-col-${qi}`}>
                  {rows.map((r, ri) => {
                    const isToday = today >= r.start && today < addDays(r.start, 7);
                    const wkLabel = `${MONTHS_SHORT[r.start.getMonth()]} ${r.start.getDate()}`;
                    return (
                      <div
                        key={ri}
                        data-testid={`timeline-cal-year-row-${qi}-${ri}`}
                        className="grid grid-cols-[44px_1fr] border-b last:border-b-0 border-[var(--border)]"
                        style={{ minHeight: `${rowHeight}px`, background: isToday ? "color-mix(in srgb, var(--accent) 8%, var(--bg-primary))" : undefined }}
                      >
                        <div className={`px-1.5 py-1 font-mono text-[9px] uppercase tracking-widest text-[var(--text-muted)] flex items-center ${isToday ? "text-[var(--accent)] font-semibold" : ""}`}>
                          {wkLabel}
                        </div>
                        <div className="relative px-1 py-0.5" style={{ minHeight: `${rowHeight}px` }}>
                          <div className="grid grid-cols-7 h-full pointer-events-none absolute inset-0">
                            {Array.from({ length: 7 }).map((_, idx) => (
                              <div
                                key={idx}
                                className={`${idx === 0 ? "" : "border-l border-[var(--border)]"}`}
                                aria-hidden="true"
                              />
                            ))}
                          </div>
                          <div className="relative space-y-0.5">
                            {r.items.length === 0 ? null : (
                              r.items.slice(0, 2).map((it) => {
                                const s = startOfDay(it.start || it.date);
                                const e = startOfDay(it.end || it.date);
                                const segStart = s < r.start ? r.start : s;
                                const segEnd = e > r.end ? r.end : e;
                                const offset = (segStart.getTime() - r.start.getTime()) / (7 * DAY_MS);
                                const width = Math.max(
                                  0.05,
                                  (segEnd.getTime() - segStart.getTime() + DAY_MS) / (7 * DAY_MS),
                                );
                                const paint = barPaint(it, "var(--bg-primary)");
                                const scoped = scopeForItem(it);
                                return (
                                  <button
                                    key={`${it.kind}-${it.id}`}
                                    type="button"
                                    data-testid={`timeline-cal-year-bar-${it.kind}-${it.id}`}
                                    onClick={() => openChat("", scoped)}
                                    title={it.title}
                                    aria-label={`${it.kind}: ${it.title}`}
                                    className="group block min-h-11 rounded-[2px] text-left text-[10px] px-1 truncate hover:brightness-110 transition-[filter] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                                    style={{
                                      marginLeft: `${offset * 100}%`,
                                      width: `${width * 100}%`,
                                      background: paint.background,
                                      boxShadow: paint.boxShadow,
                                      color: paint.color,
                                      paddingLeft: paint.stripe ? 8 : undefined,
                                    }}
                                  >
                                    {it.title}
                                  </button>
                                );
                              })
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
          <span>
            <span className="text-[var(--text-secondary)]">← →</span> year ·{" "}
            <span className="text-[var(--text-secondary)]">T</span> today ·{" "}
            <span className="text-[var(--text-secondary)]">1–5</span> change span
          </span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <BarLegendSwatch hue="var(--success)" label="on track" />
            <BarLegendSwatch hue="var(--warning)" label="in progress" />
            <BarLegendSwatch hue="var(--danger)" label="overdue" />
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-block h-3 w-4 rounded-[2px] bg-[var(--warning)]"
              />
              <span>single day</span>
            </span>
          </span>
        </div>
      </div>
    );
  }

  /* === Quarter view (Issue 4) — week-grain quantization ===
   * 90 days / 7 = ~13 weeks. The previous code dropped the user into the
   * same 7-day grid used by the week/month view, which made "3 months"
   * indistinguishable from "month" except for being scrolled further.
   * The point of picking 3 months is to see rhythm across weeks, not to
   * read individual days. So: one row per ISO week (Mon-anchored… matches
   * the existing week start), a single lane, each item rendered as a bar
   * that spans the whole 7-column row and is colored by status. The
   * bar's left/right within the row is its actual day-of-week span.
   * Hover shows the title; click opens a scoped chat. */
  if (span === "quarter") {
    const quarterStart = startOfDay(anchor);
    const quarterEnd = addDays(quarterStart, 90);
    const rows = [];
    let cursor = startOfWeek(quarterStart);
    let i = 0;
    while (cursor < quarterEnd && i < 16) {
      const rowEnd = addDays(cursor, 7);
      const overlaps = allItems.filter((it) => {
        if (!it) return false;
        const s = startOfDay(it.start || it.date);
        const e = startOfDay(it.end || it.date);
        if (!s || !e || isNaN(s.getTime()) || isNaN(e.getTime())) return false;
        return e >= cursor && s < rowEnd;
      });
      rows.push({ start: cursor, end: addDays(cursor, 6), items: overlaps });
      cursor = rowEnd;
      i++;
    }
    const rowHeight = 30;
    return (
      <div className="space-y-3">
        <div
          className="rounded-lg border border-[var(--border-accent)] overflow-hidden"
          style={{ background: "var(--bg-primary)" }}
        >
          <div
            className="grid grid-cols-[88px_1fr] font-mono text-[12px] uppercase tracking-widest text-[var(--text-muted)] border-b border-[var(--border-accent)] bg-[color-mix(in_srgb,var(--bg-secondary)_40%,transparent)]"
          >
            <div className="px-2 py-2">Week</div>
            <div className="px-2 py-2">Items · status-colored bars</div>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {rows.map((r, ri) => {
              const wkLabel = `${MONTHS_SHORT[r.start.getMonth()]} ${r.start.getDate()}`;
              return (
                <div
                  key={ri}
                  data-testid={`timeline-cal-quarter-row-${ri}`}
                  className="grid grid-cols-[88px_1fr]"
                  style={{ minHeight: `${rowHeight}px` }}
                >
                  <div className="px-2 py-2 font-mono text-[12px] uppercase tracking-widest text-[var(--text-muted)] border-r border-[var(--border-accent)] bg-[color-mix(in_srgb,var(--bg-secondary)_30%,transparent)] flex items-center">
                    {wkLabel}
                  </div>
                  <div
                    className="relative px-2 py-1.5"
                    style={{ minHeight: `${rowHeight}px` }}
                  >
                    {/* 7 day-grid guides so the user can read "Mon–Sun". */}
                    <div className="grid grid-cols-7 h-full pointer-events-none absolute inset-0 px-2">
                      {Array.from({ length: 7 }).map((_, idx) => (
                        <div
                          key={idx}
                          className={`border-l ${idx === 0 ? "border-transparent" : "border-[var(--border)]"}`}
                          aria-hidden="true"
                        />
                      ))}
                    </div>
                    <div className="relative space-y-1">
                      {r.items.length === 0 ? (
                        <span className="font-mono text-[12px] text-[var(--text-muted)] italic">nothing scheduled</span>
                      ) : (
                        r.items.slice(0, 4).map((it) => {
                          const s = startOfDay(it.start || it.date);
                          const e = startOfDay(it.end || it.date);
                          const segStart = s < r.start ? r.start : s;
                          const segEnd = e > r.end ? r.end : e;
                          const offset = (segStart.getTime() - r.start.getTime()) / (7 * 86400000);
                          const width = Math.max(
                            0.05,
                            (segEnd.getTime() - segStart.getTime() + 86400000) / (7 * 86400000),
                          );
                          const paint = barPaint(it, "var(--bg-primary)");
                          const scoped = scopeForItem(it);
                          return (
                            <button
                              key={`${it.kind}-${it.id}`}
                              type="button"
                              data-testid={`timeline-cal-quarter-bar-${it.kind}-${it.id}`}
                              onClick={() => openChat("", scoped)}
                              title={it.title}
                              aria-label={`${it.kind}: ${it.title}`}
                              className="group block min-h-11 rounded-[3px] text-left text-[12px] px-2 truncate hover:brightness-110 transition-[filter] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                              style={{
                                marginLeft: `${offset * 100}%`,
                                width: `${width * 100}%`,
                                background: paint.background,
                                boxShadow: paint.boxShadow,
                                color: paint.color,
                                // Keep the label off the accent stripe.
                                paddingLeft: paint.stripe ? 10 : undefined,
                              }}
                            >
                              {itemKindGlyph(it.kind)}
                              {it.title}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-mono text-[12px] uppercase tracking-widest text-[var(--text-muted)]">
            ← → 3 months · T today · 1–5 change span
          </div>
          <div className="font-mono text-[12px] uppercase tracking-widest text-[var(--text-muted)] flex flex-wrap items-center gap-x-2 gap-y-1">
            <BarLegendSwatch hue="var(--success)" label="on track" />
            <BarLegendSwatch hue="var(--warning)" label="in progress" />
            <BarLegendSwatch hue="var(--danger)" label="overdue" />
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-block h-3 w-4 rounded-[2px] bg-[var(--warning)]"
              />
              <span>single day</span>
            </span>
          </div>
        </div>
      </div>
    );
  }

  /* === Day view === */
  if (span === "day") {
    const key = fmtIso(anchor);
    const its = itemsByDay[key] || [];
    return (
      <div className="space-y-3">
        <div className="border border-[var(--border-accent)] rounded p-4" style={{ background: "var(--bg-secondary)" }}>
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="font-display text-[16px] font-semibold text-[var(--text-primary)]">
              {fmtDay(anchor)}, {MONTHS_FULL[anchor.getMonth()]} {anchor.getDate()}
            </h3>
            <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              {its.length} item{its.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="space-y-2">
            {its.length === 0 && (
              <div className="text-[12px] text-[var(--text-muted)] italic">nothing scheduled</div>
            )}
            {its.map((it) => (
              <CalendarDayItem key={`${it.kind}-${it.id}`} item={it} today={today} openChat={openChat} />
            ))}
          </div>
        </div>
        <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
          ← → day · T today · 1–5 change span
        </div>
      </div>
    );
  }

  // Lane height for the week/month grids. Must fit a full tap target:
  // CalendarTile is min-h-11 (44px) and its grid item carries 2px
  // vertical padding on each side, so 44 + 4 = 48. At the old 26px the
  // 44px tiles overflowed the lane and painted over the next week's
  // day-number row.
  const baseBarHeight = 48;

  return (
    <div className="space-y-3">
      <div
        className="rounded-lg border border-[var(--border-accent)] overflow-hidden shadow-[0_1px_0_color-mix(in_srgb,var(--accent)_15%,transparent)]"
        style={{ background: "var(--bg-primary)" }}
      >
        <div
          className="grid grid-cols-7 font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)] border-b border-[var(--border-accent)] bg-[color-mix(in_srgb,var(--bg-secondary)_40%,transparent)]"
        >
          {DOW.map((d, i) => (
            <div key={d} className="px-2 py-2 text-center select-none">
              <span className="hidden sm:inline">{DOW[i]}</span>
              <span className="sm:hidden">{DOW_SHORT[i]}</span>
            </div>
          ))}
        </div>

        <div className="divide-y divide-[var(--border)]">
          {weeks.map((week, wi) => {
            const weekTrackInfo = tracksByWeek[wi] || { tracks: [], maxLanes: 1 };
            const { tracks, maxLanes } = weekTrackInfo;
            const gridStyle = {
              gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
              gridTemplateRows: `auto repeat(${maxLanes}, ${baseBarHeight}px)`,
            };
            return (
              <div key={wi} className="grid relative" style={gridStyle}>
                {/* Column guides span the FULL row height, including the
                    tile lanes. Previously only the day-number row (gridRow
                    1) drew a right border, so the day columns visually
                    dissolved underneath any spanning tile. */}
                <div
                  aria-hidden="true"
                  className="absolute inset-0 grid grid-cols-7 pointer-events-none"
                >
                  {Array.from({ length: 7 }).map((_, ci) => (
                    <div
                      key={ci}
                      className={ci === 6 ? "" : "border-r border-[var(--border-accent)]"}
                    />
                  ))}
                </div>
                {week.map((cell, ci) => {
                  if (!cell || !cell.date) {
                    return (
                      <div
                        key={ci}

                        className="relative px-1.5 pt-1 pb-1 min-h-[36px] opacity-70"
                        style={{ gridColumn: ci + 1, gridRow: 1 }}
                      />
                    );
                  }
                  const isToday = sameDay(cell.date, today);
                  const key = fmtIso(cell.date);
                  const count = (itemsByDay[key] || []).length;
                  return (
                    <div
                      key={ci}

                      aria-label={`${MONTHS_FULL[cell.date.getMonth()]} ${cell.date.getDate()}${isToday ? ", today" : ""}${count ? `, ${count} item${count === 1 ? "" : "s"}` : ""}`}
                      className={[
                        "relative px-1.5 pt-1 pb-1 min-h-[36px]",
                        cell.inSpan ? "" : "opacity-70",
                        isToday
                          ? "ring-1 ring-inset ring-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_8%,var(--bg-primary))]"
                          : "",
                      ].join(" ")}
                      style={{ gridColumn: ci + 1, gridRow: 1 }}
                    >
                      <div className="flex items-start justify-between">
                        <span
                          className={[
                            "font-mono text-[10px] tabular-nums leading-none",
                            isToday ? "font-bold text-[var(--accent)]" : "text-[var(--text-secondary)]",
                          ].join(" ")}
                        >
                          {cell.date.getDate()}
                        </span>
                      </div>
                    </div>
                  );
                })}

                {tracks.map((t) => (
                  <div
                    key={`${t.item?.kind || "item"}-${t.item?.id || Math.random()}-${wi}`}
                    style={{
                      gridColumn: `${t.startCol} / ${t.endCol + 1}`,
                      gridRow: t.lane + 2,
                      padding: "2px 4px",
                      zIndex: 1,
                    }}
                  >
                    {t.item && <CalendarTile item={t.item} today={today} openChat={openChat} />}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
        <span>
          <span className="text-[var(--text-secondary)]">← →</span> {span === "week" ? "week" : span === "month" ? "month" : "3 months"} ·{" "}
          <span className="text-[var(--text-secondary)]">T</span> today ·{" "}
          <span className="text-[var(--text-secondary)]">1–5</span> change span
        </span>
        <span>click a tile to chat with the coach</span>
      </div>
    </div>
  );
}

function CalendarTile({ item, today, openChat }) {
  if (!item) return null;
  // Iteration 5 — color is now status-driven (green/red/yellow/grey)
  // so the calendar reads as on-track vs overdue at a glance.
  const color = statusColor(item);

  const isDone = (item.status || "").toLowerCase() === "done";
  const rawDate = item.end || item.date || item.start;
  const itemDate = rawDate ? new Date(rawDate) : null;
  const isPast = itemDate && !isNaN(itemDate.getTime()) ? itemDate < today && !isDone : false;
  const spanDays = item.start && item.end && !isNaN(new Date(item.start).getTime()) && !isNaN(new Date(item.end).getTime())
    ? Math.max(1, Math.round((startOfDay(item.end) - startOfDay(item.start)) / DAY_MS) + 1)
    : 1;

  const tileTestId = `timeline-cal-tile-${item.kind}-${item.id}`;
  // Spanning items get an explicit "Sep 30 – Dec 28" range in the tooltip
  // so the bar's width is legible as a duration, not just a block.
  const range =
    spanDays > 1 && item.start && item.end
      ? ` · ${fmtDay(startOfDay(item.start))} – ${fmtDay(startOfDay(item.end))}`
      : "";
  const inferredNote = item.inferredSpan ? " · estimated from horizon" : "";
  const tip = item.kind === "goal"
    ? `Goal: ${item.title}${item.horizon ? ` · ${HORIZON_LABEL[item.horizon] || ""}` : ""}${range}${inferredNote}`
    : item.kind === "milestone"
    ? `Milestone: ${item.title}${item.goalTitle ? ` · ${item.goalTitle}` : ""}`
    : item.kind === "commitment"
    ? `Commitment: ${item.title}${item.goalTitle ? ` · ${item.goalTitle}` : ""}`
    : `Blocker: ${item.title}`;

  // Iteration 5 (Issue 7+8) — thread scoped chat context. No more
  // hardcoded "Let's work on my goal: …" prefills; the user types
  // their own intent in an empty chat that already has the entity's
  // title + kind + id pinned in the conversation.
  const onActivate = () => openChat("", scopeForItem(item));

  // Iteration 7 (consistency fix) — Month/Week now use the same
  // barPaint() recipe as 3-Months/Year. Previously CalendarTile
  // painted solid-saturated backgrounds for multi-day bars, while
  // the 3-Months/Year path used the tinted-body-with-leading-edge
  // treatment — same item, different look across spans, which
  // read as a bug ("is this a different goal?"). barPaint handles
  // the span logic: ≤2-day items get the solid single-day fill
  // (unchanged), longer items get the tinted body + saturated
  // leading edge.
  const paint = barPaint(item, "var(--bg-primary)");

  if (item.kind === "blocker") {
    return (
      <button
        type="button"
        data-testid={tileTestId}
        onClick={onActivate}
        title={tip}
        aria-label={tip}
        className="min-h-11 min-w-11 w-full rounded-[3px] flex items-center gap-1.5 px-1.5 font-mono text-[10px] uppercase tracking-widest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg-primary)] transition-all hover:brightness-110"
        style={{
          background: paint.background,
          // Keep the diagonal-stripe treatment that flags blockers as
          // "active constraint" — the leading-edge stripe alone reads
          // like a milestone. Combines the tint base with a repeating
          // stripe pattern on top.
          backgroundImage: `repeating-linear-gradient(45deg, ${color}, ${color} 4px, color-mix(in srgb, ${color} 60%, var(--bg-primary)) 4px, color-mix(in srgb, ${color} 60%, var(--bg-primary)) 8px)`,
          color: paint.color,
          opacity: isPast ? 0.85 : 1,
          fontWeight: 500,
          // Pad the label off the leading-edge stripe (if any).
          paddingLeft: paint.stripe ? 10 : undefined,
        }}
      >
        <AlertOctagon size={10} aria-hidden="true" />
        <span className="truncate">{item.title}</span>
      </button>
    );
  }

  if (item.kind === "milestone" && spanDays === 1) {
    return (
      <button
        type="button"
        data-testid={tileTestId}
        onClick={onActivate}
        title={tip}
        aria-label={tip}
        className="min-h-11 min-w-11 w-full rounded-[3px] px-1.5 font-mono text-[10px] uppercase tracking-widest text-[var(--bg-primary)] flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg-primary)] transition-all hover:brightness-110"
        style={{ background: color, opacity: isDone ? 0.55 : 1, fontWeight: 500 }}
      >
        <Target size={9} aria-hidden="true" />
        <span className="truncate">{item.title}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      data-testid={tileTestId}
      onClick={onActivate}
      title={tip}
      aria-label={tip}
      className="group min-h-11 min-w-11 w-full text-left rounded-[3px] px-1.5 truncate font-mono text-[10px] uppercase tracking-widest transition-all hover:brightness-110 hover:z-10 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg-primary)]"
      style={{
        background: paint.background,
        boxShadow: paint.boxShadow,
        color: paint.color,
        opacity: isDone ? 0.55 : isPast ? 0.85 : 1,
        fontWeight: 500,
        // Pad the label off the leading-edge stripe (if any).
        paddingLeft: paint.stripe ? 10 : undefined,
      }}
    >
      <span className="block truncate">
        {item.kind === "commitment" ? "▸ " : item.kind === "milestone" ? "◆ " : ""}{item.title}
      </span>
    </button>
  );
}

function CalendarMiniItem({ item, today }) {
  const color = item.kind === "goal"
    ? (HORIZON_COLOR[item.horizon] || "var(--accent)")
    : item.kind === "milestone"
    ? "var(--warning)"
    : item.kind === "commitment"
    ? "var(--accent)"
    : "var(--danger)";

  return (
    <div className="flex items-center gap-1.5 text-[11px] leading-tight">
      <span className="w-1 h-1 rounded-full shrink-0" style={{ background: color }} />
      <span className="truncate text-[var(--text-secondary)]">{item.title}</span>
    </div>
  );
}

function CalendarDayItem({ item, today, openChat }) {
  // Iteration 5 (Issue 2-3) — status color
  const color = statusColor(item);

  // Iteration 5 (Issue 7+8) — scoped chat, no hardcoded prefill
  const onActivate = () => openChat("", scopeForItem(item));

  return (
    <button
      type="button"
      onClick={onActivate}
      className="min-h-11 w-full flex items-center gap-3 p-2 rounded border border-[var(--border)] hover:border-[var(--border-accent)] hover:bg-[var(--bg-tertiary)] transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      style={{ background: "var(--bg-primary)" }}
    >
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
      <span className="font-mono text-[9px] uppercase tracking-widest text-[var(--text-muted)] shrink-0">
        {item.kind}
      </span>
      <span className="truncate text-[var(--text-primary)] text-[13px]">{item.title}</span>
    </button>
  );
}

function CalendarEmptyState({ onAsk }) {
  return (
    <div
      data-testid="timeline-view"
      className="flex flex-col items-center justify-center text-center px-6 py-16 rounded-lg border border-dashed border-[var(--border)]"
      style={{ background: "var(--bg-secondary)" }}
    >
      <div
        className="w-12 h-12 rounded-full flex items-center justify-center mb-3"
        style={{ background: "color-mix(in srgb, var(--accent) 15%, var(--bg-secondary))" }}
      >
        <CalendarClock size={22} className="text-[var(--accent)]" aria-hidden="true" />
      </div>
      <h3 className="font-display text-[18px] font-semibold text-[var(--text-primary)]">
        Nothing on the calendar yet
      </h3>
      <p className="text-[13px] text-[var(--text-secondary)] mt-1.5 max-w-sm">
        Goals, milestones, and commitments will appear here as colored tiles across the days they cover.
      </p>
      {typeof onAsk === "function" && (
        // Iteration 5 (Issue 8) — empty-state CTA no longer pre-fills a
        // canned goal prompt. Opens the generic chat so the user can
        // describe whatever they actually want to talk about.
        <button
          type="button"
          data-testid="timeline-prefill-button"
          onClick={() => onAsk("")}
          className="mt-4 inline-flex items-center gap-1.5 h-11 sm:h-9 px-3.5 rounded-md font-mono text-[11px] uppercase tracking-widest text-[var(--bg-primary)] hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-secondary)]"
          style={{ background: "var(--accent)" }}
        >
          <Sparkles size={13} aria-hidden="true" />
          Ask the coach
        </button>
      )}
    </div>
  );
}

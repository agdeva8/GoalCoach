import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, CalendarClock, AlertOctagon, Circle, CheckCircle2, BarChart3, ListTree, ZoomIn, ZoomOut } from "lucide-react";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const HORIZON_COLORS = {
  weekly: "var(--accent)",
  short: "var(--warning)",
  medium: "var(--accent)",
  long: "var(--success)",
};

/**
 * Span presets the user can pick in the timeline chart mode. The
 * chart's visible date range = today ± half(days). "auto" falls
 * back to the user's data range with default padding (used when the
 * dataset is too tight to fit a year otherwise).
 */
const SPAN_PRESETS = [
  { key: "day", label: "Day", days: 1 },
  { key: "week", label: "Week", days: 7 },
  { key: "month", label: "Month", days: 30 },
  { key: "quarter", label: "Quarter", days: 90 },
  { key: "year", label: "Year", days: 365 },
  { key: "5y", label: "5 Yr", days: 365 * 5 },
]

const parse = (s) => {
  if (!s) return null;
  const d = new Date(s + "T00:00:00");
  return isNaN(d.getTime()) ? null : d;
};
const fmtDay = (d) => `${MONTHS[d.getMonth()]} ${d.getDate()}`;
const startOfWeek = (d) => {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
};
const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const fmtIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

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
      const lastDay = new Date(we.getTime() - 86400000);
      res.push({ start: new Date(ws), end: new Date(we), label: `${fmtDay(ws)} – ${fmtDay(lastDay)}`, sub: "", next: "week" });
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

export default function Timeline({ state, onPrefill }) {
  const [view, setView] = useState({ level: "year", anchor: new Date(new Date().getFullYear(), 0, 1) });
  const [mode, setMode] = useState("chart"); // 'chart' | 'drill'
  const [zoom, setZoom] = useState(1); // 0.5 / 1 / 2 for chart mode
  const [span, setSpan] = useState("auto"); // span preset key for chart mode
  const today = useMemo(() => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; }, []);

  const goals = useMemo(() => (state?.goals || []).filter((g) => g.status !== "dropped"), [state]);

  const items = useMemo(() => {
    const out = [];
    goals.forEach((g) => {
      const d = parse(g.target_date);
      if (d) out.push({ date: d, label: g.title, sub: "goal target", kind: "goal", done: false });
    });
    (state?.milestones || []).forEach((m) => {
      const d = parse(m.target_date);
      if (d) out.push({ date: d, label: m.title || "Milestone", sub: m.goal_title, kind: "milestone", done: m.status === "done" });
    });
    (state?.commitments || []).forEach((c) => {
      const d = parse(c.due);
      if (d) out.push({ date: d, label: c.text, sub: c.goal_title, kind: "commitment", done: c.status === "done" });
    });
    return out;
  }, [state, goals]);

  const milestones = useMemo(
    () => (state?.milestones || []).map((m) => ({
      ...m,
      date: parse(m.target_date),
      goalTitle: m.goal_title || (m.goal_id && goals.find((g) => g.id === m.goal_id)?.title) || "",
    })).filter((m) => m.date && m.status !== "done"),
    [state, goals],
  );

  const blockers = useMemo(
    () =>
      (state?.blockers || [])
        .map((b) => ({ start: parse(b.start_date), end: parse(b.end_date) || parse(b.start_date), title: b.title }))
        .filter((b) => b.start),
    [state]
  );

  const buckets = makeBuckets(view.level, view.anchor);
  const isEmpty = items.length === 0 && blockers.length === 0 && goals.length === 0;

  const itemsIn = (s, e) => items.filter((it) => it.date >= s && it.date < e);
  const blockersIn = (s, e) => blockers.filter((b) => b.start < e && b.end >= s);

  const drill = (b) => b.next && setView({ level: b.next, anchor: b.start });
  const goBack = () => {
    const a = view.anchor;
    if (view.level === "quarter") setView({ level: "year", anchor: new Date(a.getFullYear(), 0, 1) });
    else if (view.level === "month") setView({ level: "quarter", anchor: new Date(a.getFullYear(), Math.floor(a.getMonth() / 3) * 3, 1) });
    else if (view.level === "week") setView({ level: "month", anchor: new Date(a.getFullYear(), a.getMonth(), 1) });
  };

  const shiftYear = (delta) => {
    const a = view.anchor;
    setView({
      level: view.level,
      anchor: new Date(a.getFullYear() + delta, a.getMonth(), 1),
    });
  };

  const crumbs = [];
  const ay = view.anchor.getFullYear();
  crumbs.push({ label: `${ay}`, onClick: () => setView({ level: "year", anchor: new Date(ay, 0, 1) }) });
  if (["quarter", "month", "week"].includes(view.level)) {
    const q = Math.floor(view.anchor.getMonth() / 3);
    crumbs.push({ label: `Q${q + 1}`, onClick: () => setView({ level: "quarter", anchor: new Date(ay, q * 3, 1) }) });
  }
  if (["month", "week"].includes(view.level)) {
    const m = view.anchor.getMonth();
    crumbs.push({ label: MONTHS[m], onClick: () => setView({ level: "month", anchor: new Date(ay, m, 1) }) });
  }
  if (view.level === "week") {
    const ws = startOfWeek(view.anchor);
    crumbs.push({ label: fmtDay(ws), onClick: null });
  }

  if (isEmpty) {
    return (
      <div data-testid="timeline-view" className="p-4 sm:p-6">
        <div className="border border-dashed border-[var(--border)] p-6 text-center">
          <CalendarClock className="w-6 h-6 mx-auto text-[var(--text-muted)] mb-2" />
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            No dates on the map yet. Ask the coach to sketch a realistic timeline — it'll propose target
            dates and a few milestones per goal, with buffer built in.
          </p>
          {onPrefill && (
            <button
              data-testid="timeline-prefill-button"
              onClick={() => onPrefill("Map out a realistic timeline for my goals — propose target dates and 2-4 milestones each, with buffer for real life.")}
              className="mt-3 text-xs font-medium text-[var(--accent)] hover:underline"
            >
              Ask the coach to build my timeline →
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div data-testid="timeline-view" className="p-4 sm:p-6 space-y-4">
      {/* Top control bar — mode toggle + breadcrumbs + year nav + zoom */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="inline-flex rounded-md border border-[var(--border)] bg-[var(--bg-secondary)]/40 p-0.5">
          <button
            data-testid="timeline-mode-chart"
            onClick={() => setMode("chart")}
            title="Gantt-style chart"
            className={`flex items-center gap-1.5 px-2.5 h-7 rounded text-[11px] font-mono uppercase tracking-widest transition-colors ${
              mode === "chart"
                ? "bg-[var(--accent)] text-[var(--bg-primary)]"
                : "text-[var(--text-secondary)] hover:text-[var(--accent)]"
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" /> Chart
          </button>
          <button
            data-testid="timeline-mode-drill"
            onClick={() => setMode("drill")}
            title="Bucketed drill-down"
            className={`flex items-center gap-1.5 px-2.5 h-7 rounded text-[11px] font-mono uppercase tracking-widest transition-colors ${
              mode === "drill"
                ? "bg-[var(--accent)] text-[var(--bg-primary)]"
                : "text-[var(--text-secondary)] hover:text-[var(--accent)]"
            }`}
          >
            <ListTree className="w-3.5 h-3.5" /> Drill
          </button>
        </div>

        {mode === "drill" && view.level !== "year" && (
          <button data-testid="timeline-back" onClick={goBack} className="flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
            <ChevronLeft className="w-3.5 h-3.5" /> Back
          </button>
        )}
        {mode === "drill" && (
          <div className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span className="opacity-50">/</span>}
                {c.onClick ? (
                  <button onClick={c.onClick} className="hover:text-[var(--accent)] transition-colors">{c.label}</button>
                ) : (
                  <span className="text-[var(--accent)]">{c.label}</span>
                )}
              </span>
            ))}
          </div>
        )}
        {mode === "drill" && (
          <div className="flex items-center gap-0.5 ml-1">
            <button
              data-testid="timeline-prev-year"
              onClick={() => shiftYear(-1)}
              className="h-6 w-6 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-tertiary)] transition-colors"
              title="Previous year"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              data-testid="timeline-next-year"
              onClick={() => shiftYear(1)}
              className="h-6 w-6 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-tertiary)] transition-colors"
              title="Next year"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        {mode === "chart" && (
          <>
            <div className="inline-flex rounded-md border border-[var(--border)] bg-[var(--bg-secondary)]/40 p-0.5">
              {SPAN_PRESETS.map((s) => (
                <button
                  key={s.key}
                  data-testid={`timeline-span-${s.key}`}
                  onClick={() => setSpan(s.key)}
                  className={`px-2 h-7 text-[10px] font-mono uppercase tracking-widest transition-colors ${
                    span === s.key
                      ? "bg-[var(--accent)] text-[var(--bg-primary)] rounded"
                      : "text-[var(--text-secondary)] hover:text-[var(--accent)]"
                  }`}
                >
                  {s.label}
                </button>
              ))}
              <button
                data-testid="timeline-span-auto"
                onClick={() => setSpan("auto")}
                title="Fit to actual goal data"
                className={`px-2 h-7 text-[10px] font-mono uppercase tracking-widest transition-colors ${
                  span === "auto"
                    ? "bg-[var(--accent)] text-[var(--bg-primary)] rounded"
                    : "text-[var(--text-secondary)] hover:text-[var(--accent)]"
                }`}
              >
                auto
              </button>
            </div>
            <div className="flex items-center gap-0.5 ml-1">
              <button
                data-testid="timeline-zoom-out"
                onClick={() => setZoom((z) => clamp(z - 0.25, 0.5, 2))}
                className="h-7 w-7 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-tertiary)] border border-[var(--border)] transition-colors"
                title="Zoom out (more time on screen)"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)] px-1.5 min-w-[3rem] text-center">
                {Math.round(zoom * 100)}%
              </span>
              <button
                data-testid="timeline-zoom-in"
                onClick={() => setZoom((z) => clamp(z + 0.25, 0.5, 2))}
                className="h-7 w-7 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-tertiary)] border border-[var(--border)] transition-colors"
                title="Zoom in (less time on screen)"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>
          </>
        )}
        <span className="ml-auto font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
          {mode === "chart" ? "chart view" : `${view.level} view`}
        </span>
      </div>

      {mode === "chart" ? (
        <ChartView
          goals={goals}
          milestones={milestones}
          blockers={blockers}
          commitments={(state?.commitments || []).filter((c) => c.status === "open")}
          today={today}
          zoom={zoom}
          span={span}
          onOpenChat={onPrefill}
        />
      ) : (
        <>
          <div className={`grid gap-2 ${view.level === "week" ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2"}`}>
            {buckets.map((b, idx) => {
              const its = itemsIn(b.start, b.end);
              const bls = blockersIn(b.start, b.end);
              const drift = its.filter((it) => !it.done && it.date < today);
              const isNow = today >= b.start && today < b.end;
              const clickable = !!b.next;
              return (
                <div
                  key={idx}
                  data-testid={`timeline-bucket-${view.level}-${idx}`}
                  onClick={() => clickable && drill(b)}
                  className={`border p-3 transition-colors ${isNow ? "border-[var(--accent)]" : "border-[var(--border)]"} ${clickable ? "cursor-pointer hover:border-[var(--border-accent)] hover:bg-[var(--bg-secondary)]" : ""} bg-[var(--bg-secondary)]/40`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-[var(--text-primary)]">{b.label}</span>
                    <span className="font-mono text-[10px] text-[var(--text-muted)]">{b.sub}{isNow ? " · now" : ""}</span>
                  </div>

                  {its.length === 0 && bls.length === 0 ? (
                    <div className="mt-1.5 text-[11px] text-[var(--text-muted)]">clear</div>
                  ) : (
                    <div className="mt-2 space-y-1">
                      {its.slice(0, 6).map((it, i) => {
                        const overdue = !it.done && it.date < today;
                        const color = it.done ? "var(--success)" : overdue ? "var(--danger)" : "var(--text-secondary)";
                        return (
                          <div key={i} className="flex items-start gap-1.5 text-[11px]" style={{ color }}>
                            {it.done ? <CheckCircle2 className="w-3 h-3 mt-0.5 shrink-0" /> : <Circle className="w-3 h-3 mt-0.5 shrink-0" />}
                            <span className={it.done ? "line-through" : ""}>{it.label}{it.sub ? ` · ${it.sub}` : ""}</span>
                          </div>
                        );
                      })}
                      {its.length > 6 && <div className="text-[10px] text-[var(--text-muted)]">+{its.length - 6} more</div>}
                    </div>
                  )}

                  {bls.map((bl, i) => (
                    <div key={`bl-${i}`} className="mt-1.5 flex items-center gap-1.5 text-[10px] font-mono text-[var(--warning)]">
                      <AlertOctagon className="w-3 h-3 shrink-0" /> blocker: {bl.title}
                    </div>
                  ))}

                  {drift.length > 0 && (
                    <div data-testid="timeline-drift" className="mt-1.5 pt-1.5 border-t border-[var(--danger)]/30 text-[10px] font-mono uppercase tracking-wider text-[var(--danger)]">
                      drift · {drift.length} past due
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-3 pt-1 font-mono text-[10px] text-[var(--text-muted)]">
            {[["done", "var(--success)"], ["upcoming", "var(--text-secondary)"], ["drift", "var(--danger)"]].map(([k, v]) => (
              <span key={k} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: v }} /> {k}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * ChartView — Gantt-style horizontal-bars visualisation.
 *
 * Layout:
 *   [ goal-name | bar from start_date to target_date, coloured by horizon ]
 *   [           | milestone dots along the bar at their target_dates     ]
 *   [           | open-commitment flags along the date axis              ]
 *   [ blockers  | red stripes spanning start_date → end_date             ]
 *   [ today line — vertical red dashed line                              ]
 *
 * The chart auto-fits the visible range to the user's actual goals
 * (with a small ±30-day padding so today and the latest target are
 * always visible). Zoom adjusts pixels-per-day so the chart works
 * across a 1-week horizon and a 3-year horizon.
 */
function ChartView({ goals, milestones, blockers, commitments, today, zoom, span, onOpenChat }) {
  const pxPerDay = Math.round(14 * zoom); // 7 / 14 / 28
  const range = useMemo(() => {
    // Span presets: today-centered, fixed-width window.
    if (span && span !== "auto") {
      const preset = SPAN_PRESETS.find((s) => s.key === span)
      if (preset) {
        return {
          start: addDays(today, -Math.floor(preset.days / 2)),
          end: addDays(today, Math.ceil(preset.days / 2)),
        }
      }
    }
    // 'auto' — fit the user's actual data with ±padding, so the
    // chart never lies empty.
    if (goals.length === 0 && blockers.length === 0) {
      return {
        start: addDays(today, -30),
        end: addDays(today, 60),
      }
    }
    const allDates = []
    goals.forEach((g) => {
      const s = parse(g.start_date || g.created_at)
      const e = parse(g.target_date)
      if (s) allDates.push(s)
      if (e) allDates.push(e)
    })
    milestones.forEach((m) => m.date && allDates.push(m.date))
    commitments.forEach((c) => {
      const d = parse(c.due)
      if (d) allDates.push(d)
    })
    blockers.forEach((b) => {
      if (b.start) allDates.push(b.start)
      if (b.end) allDates.push(b.end)
    })
    if (allDates.length === 0) {
      return { start: addDays(today, -30), end: addDays(today, 60) }
    }
    let min = allDates[0]
    let max = allDates[0]
    for (const d of allDates) {
      if (d < min) min = d
      if (d > max) max = d
    }
    return { start: addDays(min, -7), end: addDays(max, 30) }
  }, [goals, blockers, milestones, commitments, today, span])

  const startMs = range.start.getTime()
  const totalDays = Math.max(1, Math.round((range.end.getTime() - startMs) / 86400000))
  const totalWidth = totalDays * pxPerDay
  const leftPad = 180 // goal-name column on the left
  const totalHeight =
    56 /* date axis */ +
    Math.max(goals.length, 1) * 38 /* one row per goal */ +
    (commitments.length > 0 ? 28 : 0) +
    (blockers.length > 0 ? 28 : 0) +
    12 /* breathing room */

  const dayToPx = (d) => Math.max(0, (d.getTime() - startMs) / 86400000) * pxPerDay
  const todayPx = dayToPx(today)

  // Top-of-axis month markers
  const monthMarkers = useMemo(() => {
    const out = []
    const cur = new Date(range.start.getFullYear(), range.start.getMonth(), 1)
    while (cur <= range.end) {
      out.push({ date: new Date(cur), px: dayToPx(cur) })
      cur.setMonth(cur.getMonth() + 1)
    }
    return out
  }, [range])

  if (goals.length === 0) {
    return (
      <div className="border border-dashed border-[var(--border)] rounded p-6 text-center">
        <BarChart3 className="w-6 h-6 mx-auto text-[var(--text-muted)] mb-2" />
        <p className="text-xs text-[var(--text-muted)]">
          The chart needs active goals to plot. Add a goal with a target date and we'll draw it here.
        </p>
      </div>
    )
  }

  return (
    <div className="border border-[var(--border)] rounded bg-[var(--bg-secondary)]/40 overflow-hidden">
      <div className="overflow-x-auto" data-testid="timeline-chart">
        <div
          className="relative"
          style={{ width: leftPad + totalWidth, height: totalHeight }}
        >
          {/* Top month axis */}
          <div
            className="absolute top-0 h-14"
            style={{ left: leftPad, width: totalWidth }}
          >
            {monthMarkers.map((m, i) => (
              <div
                key={i}
                className="absolute top-0 h-full border-l border-[var(--border)]/50"
                style={{ left: m.px }}
              >
                <span className="absolute top-1 left-1.5 font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)] leading-none">
                  {MONTHS[m.date.getMonth()]}{" "}
                  <span className="opacity-60">{m.date.getFullYear()}</span>
                </span>
              </div>
            ))}
            {/* Today line spanning the axis — DEDICATED strip with its
                own space so the date label never collides with the
                month tick to its left. The strip is a fixed-width
                band (40px) so the dashed line and the "today" text
                live together, independently of the surrounding month
                labels. */}
            {todayPx >= 0 && todayPx <= totalWidth && (
              <div
                className="absolute top-0 h-full border-l-2 border-dashed border-[var(--danger)]/70"
                style={{ left: todayPx - 14 }}
                title="Today"
              >
                <span
                  className="absolute top-1 left-1.5 whitespace-nowrap px-1.5 py-0.5 rounded bg-[var(--danger)]/15 text-[var(--danger)] font-mono text-[9px] uppercase tracking-widest leading-none"
                >
                  today
                </span>
              </div>
            )}
          </div>

          {/* Today line spanning the full chart body */}
          {todayPx >= 0 && todayPx <= totalWidth && (
            <div
              className="absolute bottom-0 top-14 border-l-2 border-dashed border-[var(--danger)]/30 pointer-events-none"
              style={{ left: leftPad + todayPx }}
            />
          )}

          {/* Goal rows */}
          {goals.map((g, gi) => {
            const rowTop = 56 + gi * 38
            const s = parse(g.start_date || g.created_at)
            const e = parse(g.target_date)
            const color = HORIZON_COLORS[g.horizon] || "var(--accent)"
            const left = s ? dayToPx(s) : dayToPx(today)
            const right = e ? dayToPx(e) : left + 60 * pxPerDay
            const width = Math.max(8, right - left)
            const overdue = e && e < today
            const done = (g.status || "").toLowerCase() === "done"

            // Milestones tagged to this goal
            const ms = milestones.filter(
              (m) => m.goalId === g.id || (g.title && m.goalTitle === g.title),
            )
            // Commitments tagged to this goal
            const cs = commitments.filter(
              (c) => c.goal_id === g.id || (g.title && c.goal_title === g.title),
            )

            return (
              <div
                key={g.id}
                className="absolute"
                style={{ top: rowTop, left: 0, right: 0, height: 38 }}
                data-testid={`timeline-row-${g.id}`}
              >
                {/* Goal label on the left */}
                <div
                  className="absolute top-0 left-0 h-full flex items-center pl-3 pr-2"
                  style={{ width: leftPad }}
                >
                  <span className="truncate text-xs text-[var(--text-primary)]">{g.title}</span>
                  <span className="ml-2 shrink-0 font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                    {g.horizon}
                  </span>
                </div>
                {/* The bar */}
                <div
                  className="absolute top-2 h-7 rounded transition-shadow"
                  style={{
                    left: leftPad + left,
                    width,
                    background: `${color}33`,
                    borderLeft: `3px solid ${color}`,
                    opacity: done ? 0.5 : 1,
                    boxShadow: overdue ? `0 0 0 1px var(--danger)` : "none",
                  }}
                  title={`${g.title}${e ? ` · target ${fmtIso(e)}` : ""}`}
                >
                  <span
                    className="absolute inset-y-0 left-2 flex items-center truncate text-[11px]"
                    style={{ color: done ? "var(--text-muted)" : "var(--text-primary)" }}
                  >
                    {g.title}
                  </span>
                </div>
                {/* Milestone dots */}
                {ms.map((m) => (
                  <div
                    key={m.id}
                    className="absolute top-4 h-3 w-3 rounded-full border-2 border-[var(--bg-primary)]"
                    style={{
                      left: leftPad + dayToPx(m.date) - 6,
                      background: m.date < today ? "var(--danger)" : "var(--warning)",
                    }}
                    title={`Milestone: ${m.title}${m.goalTitle ? ` · ${m.goalTitle}` : ""}`}
                  />
                ))}
                {/* Commitment flags on this row */}
                {cs.map((c) => {
                  const d = parse(c.due)
                  if (!d) return null
                  return (
                    <div
                      key={c.id}
                      className="absolute top-5 h-4 w-px"
                      style={{
                        left: leftPad + dayToPx(d),
                        background: "var(--accent)",
                      }}
                      title={`Commitment: ${c.text}`}
                    />
                  )
                })}
              </div>
            )
          })}

          {/* Open commitments row (separate from per-goal flags above) */}
          {commitments.length > 0 && (
            <div
              className="absolute"
              style={{
                top: 56 + Math.max(goals.length, 1) * 38,
                left: 0,
                right: 0,
                height: 28,
              }}
              data-testid="timeline-commitments-row"
            >
              <div className="absolute top-0 left-0 h-full flex items-center pl-3 pr-2" style={{ width: leftPad }}>
                <span className="truncate font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                  Commitments
                </span>
              </div>
              {commitments.map((c) => {
                const d = parse(c.due)
                if (!d) return null
                return (
                  <div
                    key={c.id}
                    className="absolute top-3 h-4 px-1.5 flex items-center text-[10px] truncate rounded"
                    style={{
                      left: leftPad + dayToPx(d) - 2,
                      background: "var(--accent)",
                      color: "var(--bg-primary)",
                      maxWidth: 120,
                    }}
                    title={c.text}
                  >
                    {c.text}
                  </div>
                )
              })}
            </div>
          )}

          {/* Blocker stripes at the bottom */}
          {blockers.length > 0 && (
            <div
              className="absolute"
              style={{
                top:
                  56 +
                  Math.max(goals.length, 1) * 38 +
                  (commitments.length > 0 ? 28 : 0),
                left: 0,
                right: 0,
                height: 28,
              }}
              data-testid="timeline-blockers-row"
            >
              <div className="absolute top-0 left-0 h-full flex items-center pl-3 pr-2" style={{ width: leftPad }}>
                <span className="truncate font-mono text-[10px] uppercase tracking-widest text-[var(--warning)]">
                  Blockers
                </span>
              </div>
              {blockers.map((b) => {
                const left = dayToPx(b.start)
                const right = dayToPx(b.end || b.start)
                const width = Math.max(8, right - left)
                return (
                  <div
                    key={b.title + String(left)}
                    className="absolute top-3 h-4 px-1.5 flex items-center text-[10px] truncate rounded"
                    style={{
                      left: leftPad + left,
                      width,
                      background: "var(--danger)",
                      color: "white",
                    }}
                    title={`Blocker: ${b.title}`}
                  >
                    {b.title}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 border-t border-[var(--border)] font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded border-l-2 border-[var(--accent)]" style={{ background: "rgba(255,107,53,0.2)" }} /> Goal bar
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-[var(--warning)] border-2 border-[var(--bg-primary)]" /> Milestone
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm" style={{ background: "var(--accent)" }} /> Open commitment
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm" style={{ background: "var(--danger)" }} /> Blocker
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full border-2 border-dashed border-[var(--danger)]" /> Today
        </span>
      </div>
      {onOpenChat && (
        <div className="border-t border-[var(--border)] px-3 py-2 flex items-center justify-end">
          <button
            data-testid="timeline-chart-ask-coach"
            onClick={() =>
              onOpenChat(
                "Re-plan my timeline based on the chart. Move risky milestones closer or suggest dropping ones that no longer matter.",
              )
            }
            className="text-[11px] font-mono uppercase tracking-widest text-[var(--accent)] hover:underline"
          >
            Ask the coach to re-plan →
          </button>
        </div>
      )}
    </div>
  )
}

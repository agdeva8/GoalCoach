import { useMemo } from "react";
import {
  CheckCircle2,
  Circle,
  MessageSquare,
  Sparkles,
  Target,
  Flame,
  Clock,
  CalendarDays,
} from "lucide-react";

/**
 * TrackerCard — the hero accountability surface on the Goals tab.
 *
 * The user logged in and asked for: 'these goals you have to do
 * today / today timetable / how's the things going, what all
 * completed / some kind of main dialogue box that holds the user
 * accountable and gives direction right'.
 *
 * This card does all four:
 *   1. "Today's commitments" — open commitments that are due today
 *      or earlier, with overdue items in danger colour and done
 *      items struck through + a checked circle.
 *   2. "Today timetable" — the dated agenda in chronological
 *      order so the user can scan their day at a glance.
 *   3. "How's the things going" — three stat tiles: open count,
 *      completed-today count, overdue count.
 *   4. "Direction dialogue" — a CTA that opens the chat with the
 *      pre-filled prompt 'Hold me accountable for today: walk me
 *      through what I committed to and where I'm slipping.' Surfaces
 *      the coach as the user-facing accountability partner.
 *
 * Layout: a single horizontal card with three columns on `lg`,
 * stacking on smaller screens. No new state — pure derived views
 * from the existing `state` prop. An `onOpenChat(prompt)` callback
 * surfaces the "ask the coach" handoff so the card never tries to
 * own chat state itself.
 */
export default function TrackerCard({ state, onOpenChat }) {
  const data = useMemo(() => {
    const todayIso = new Date().toISOString().slice(0, 10)
    const todayCommits = (state?.commitments || []).filter(
      (c) => c.due === todayIso || (c.due && c.due < todayIso && c.status === "open"),
    )
    const overdue = todayCommits.filter((c) => c.due && c.due < todayIso && c.status === "open")
    const upcomingToday = todayCommits.filter(
      (c) => c.due === todayIso && c.status === "open",
    )
    const doneToday = (state?.commitments || []).filter(
      (c) => c.status === "done" && c.due === todayIso,
    )
    const allOpen = (state?.commitments || []).filter((c) => c.status === "open")
    const goalsActive = (state?.goals || []).filter((g) => g.status === "active")
    const goalsPaused = (state?.goals || []).filter((g) => g.status === "paused")
    const milestonesThisWeek = (state?.milestones || []).filter((m) => {
      if (m.status === "done") return false
      const d = m.target_date
      if (!d) return false
      const target = new Date(d + "T00:00:00")
      const now = new Date()
      const week = new Date(now)
      week.setDate(week.getDate() + 7)
      return target >= now && target <= week
    })
    const completionPct = todayCommits.length
      ? Math.round((doneToday.length / todayCommits.length) * 100)
      : 0

    return {
      todayCommits: todayCommits.slice().sort((a, b) => (a.due || "").localeCompare(b.due || "")),
      overdue,
      upcomingToday,
      doneToday,
      allOpen,
      goalsActive,
      goalsPaused,
      milestonesThisWeek,
      completionPct,
      hasWork: todayCommits.length > 0 || goalsActive.length > 0,
    }
  }, [state])

  // Empty-state handling: if there's nothing to track we let the
  // outer dashboard's empty-state take over and we render nothing
  // here. Otherwise we'd double up with the AddYourFirstGoal CTA.
  if (!data.hasWork) return null

  return (
    <div
      data-testid="tracker-card"
      className="border border-[var(--border)] bg-[var(--bg-secondary)]/60 rounded-xl overflow-hidden"
    >
      <div className="p-5 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Col 1 — greeting + stats */}
        <div className="lg:col-span-4 space-y-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              Today
            </div>
            <h2 className="font-display text-2xl sm:text-3xl font-semibold text-[var(--text-primary)] tracking-tight leading-tight mt-1">
              You're tracking{" "}
              <span className="text-[var(--accent)]">{data.goalsActive.length}</span>{" "}
              active goal{data.goalsActive.length === 1 ? "" : "s"}
            </h2>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed mt-1.5">
              {data.todayCommits.length === 0 ? (
                <>
                  Nothing due today — pick a goal below and ask the coach to draft tomorrow's plan.
                </>
              ) : data.overdue.length > 0 ? (
                <>
                  <span className="text-[var(--danger)] font-medium">
                    {data.overdue.length} overdue
                  </span>{" "}
                  and {data.upcomingToday.length} due today. Hit them one at a time.
                </>
              ) : (
                <>
                  {data.todayCommits.length} commitment
                  {data.todayCommits.length === 1 ? "" : "s"} on the agenda today.
                </>
              )}
            </p>
          </div>

          {/* Progress ring (CSS-only) */}
          <CompletionRing
            pct={data.completionPct}
            done={data.doneToday.length}
            total={data.todayCommits.length || 0}
          />

          {/* Stat tiles */}
          <div className="grid grid-cols-3 gap-2">
            <StatTile
              icon={Target}
              value={data.allOpen.length}
              label="Open"
              tone="var(--accent)"
            />
            <StatTile
              icon={CheckCircle2}
              value={data.doneToday.length}
              label="Done today"
              tone="var(--success)"
            />
            <StatTile
              icon={Clock}
              value={data.overdue.length}
              label="Overdue"
              tone="var(--danger)"
            />
          </div>

          {/* Primary CTA — opens the chat with an accountability prompt */}
          <button
            data-testid="tracker-coach-cta"
            onClick={() =>
              onOpenChat?.(
                "Hold me accountable for today. Walk me through what I committed to, what's slipping, and where I should be spending the next hour. If anything looks off, propose what to drop or postpone.",
              )
            }
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-[var(--accent)] text-[var(--bg-primary)] font-medium text-sm hover:opacity-90 transition-opacity"
          >
            <MessageSquare className="w-4 h-4" />
            Ask the coach for today's read
          </button>
        </div>

        {/* Col 2 — today's timetable */}
        <div className="lg:col-span-5">
          <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-2.5">
            <CalendarDays className="w-3 h-3" />
            Today timetable
          </div>
          {data.todayCommits.length === 0 ? (
            <div className="px-3 py-4 border border-dashed border-[var(--border)] rounded-md text-xs text-[var(--text-muted)] leading-relaxed">
              Nothing on the docket today. Ask the coach to plan tomorrow, or pick a goal and add a milestone.
            </div>
          ) : (
            <ul className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
              {data.todayCommits.map((c) => {
                const due = c.due || ""
                const isOverdue = due < new Date().toISOString().slice(0, 10) && c.status === "open"
                const isToday = due === new Date().toISOString().slice(0, 10) && c.status === "open"
                const isDone = c.status === "done"
                return (
                  <li
                    key={c.id}
                    data-testid={`tracker-commit-${c.id}`}
                    className={`flex items-start gap-2 px-3 py-2 rounded-md border ${
                      isDone
                        ? "border-[var(--success)]/30 bg-[var(--success)]/5"
                        : isOverdue
                          ? "border-[var(--danger)]/30 bg-[var(--danger)]/5"
                          : isToday
                            ? "border-[var(--accent)]/30 bg-[var(--accent)]/5"
                            : "border-[var(--border)] bg-[var(--bg-primary)]/40"
                    }`}
                  >
                    {isDone ? (
                      <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[var(--success)]" />
                    ) : (
                      <Circle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[var(--text-muted)]" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div
                        className={`text-sm leading-snug ${isDone ? "line-through text-[var(--text-muted)]" : "text-[var(--text-primary)]"}`}
                      >
                        {c.text}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                          {c.goal_title || "free"}
                        </span>
                        {due && (
                          <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                            · {due}
                          </span>
                        )}
                        {isOverdue && !isDone && (
                          <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--danger)]">
                            · overdue
                          </span>
                        )}
                        {isToday && (
                          <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--accent)]">
                            · today
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Col 3 — week + flame */}
        <div className="lg:col-span-3 space-y-4">
          <div className="border border-[var(--border)] bg-[var(--bg-primary)]/40 rounded-md p-3">
            <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-2">
              <Flame className="w-3 h-3" />
              Streak
            </div>
            <div className="text-lg font-semibold text-[var(--text-primary)]">
              {data.doneToday.length > 0
                ? `On a ${data.doneToday.length}-commit day`
                : "Quiet today"}
            </div>
            <div className="text-[11px] text-[var(--text-muted)] leading-relaxed mt-1">
              {data.doneToday.length > 0
                ? "Use the momentum — pick the next item."
                : "Tiny is fine. One commitment done > none."}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-2">
              <Sparkles className="w-3 h-3" />
              This week
            </div>
            {data.milestonesThisWeek.length === 0 ? (
              <div className="px-3 py-3 border border-dashed border-[var(--border)] rounded-md text-[11px] text-[var(--text-muted)] leading-relaxed">
                No milestones in the next 7 days.
              </div>
            ) : (
              <ul className="space-y-1">
                {data.milestonesThisWeek.slice(0, 5).map((m) => (
                  <li
                    key={m.id}
                    data-testid={`tracker-milestone-${m.id}`}
                    className="text-[12px] text-[var(--text-secondary)] leading-snug px-2 py-1.5 border border-[var(--border)] bg-[var(--bg-primary)]/40 rounded"
                  >
                    <span className="block">{m.title || "Milestone"}</span>
                    <span className="block font-mono text-[9px] uppercase tracking-widest text-[var(--text-muted)] mt-0.5">
                      {m.goal_title || "free"} · {m.target_date}
                    </span>
                  </li>
                ))}
                {data.milestonesThisWeek.length > 5 && (
                  <li className="text-[10px] text-[var(--text-muted)] pl-1">
                    +{data.milestonesThisWeek.length - 5} more
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function StatTile({ icon: Icon, value, label, tone }) {
  return (
    <div
      data-testid={`tracker-stat-${label.toLowerCase().replace(/\s+/g, "-")}`}
      className="border border-[var(--border)] bg-[var(--bg-primary)]/40 rounded-md px-2.5 py-2 flex flex-col items-start"
    >
      <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: tone }} />
      <div className="text-lg font-semibold text-[var(--text-primary)] leading-none mt-1">
        {value}
      </div>
      <div className="font-mono text-[9px] uppercase tracking-widest text-[var(--text-muted)] mt-1">
        {label}
      </div>
    </div>
  )
}

function CompletionRing({ pct, done, total }) {
  const r = 24
  const c = 2 * Math.PI * r
  const offset = c * (1 - pct / 100)
  return (
    <div data-testid="tracker-completion-ring" className="flex items-center gap-3">
      <svg width="64" height="64" viewBox="0 0 64 64" className="shrink-0">
        <circle
          cx="32"
          cy="32"
          r={r}
          stroke="var(--border)"
          strokeWidth="6"
          fill="none"
        />
        <circle
          cx="32"
          cy="32"
          r={r}
          stroke="var(--accent)"
          strokeWidth="6"
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 32 32)"
        />
        <text
          x="32"
          y="36"
          textAnchor="middle"
          fontSize="14"
          fontWeight="600"
          fill="var(--text-primary)"
        >
          {pct}%
        </text>
      </svg>
      <div>
        <div className="text-sm font-medium text-[var(--text-primary)]">
          {done} of {total} done
        </div>
        <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
          Today's commitments
        </div>
      </div>
    </div>
  )
}

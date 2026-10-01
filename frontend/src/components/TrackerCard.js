import { useMemo } from "react";
import { localDateKey } from "../lib/utils";
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
 * Iteration 7: this used to host the TodayTimetable in Col 2; that
 * has moved to a dedicated Today tab (`frontend/src/components/Today.jsx`).
 * This card now shows the greeting + accountability CTAs (Col 1) and
 * the streak + this-week-milestones sidebar (Col 3). Col 1 carries an
 * "Open today →" jump button so the user can still reach the timetable
 * in one click from here.
 *
 * What's left:
 *   1. "How's the things going" — three stat tiles: open count,
 *      completed-today count, overdue count.
 *   2. "Direction dialogue" — CTAs that open the chat with a pre-filled
 *      prompt ("Hold me accountable for today" + "Plan my day").
 *   3. Streak + next 7 days of milestones.
 */
export default function TrackerCard({ state, onOpenChat, onOpenToday }) {
  const data = useMemo(() => {
    const todayIso = localDateKey()
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
      className="border border-[var(--border)] bg-[color-mix(in_srgb,var(--bg-secondary)_60%,transparent)] rounded-xl overflow-hidden"
    >
      <div className="p-5 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Col 1 — greeting + stats + CTAs */}
        <div className="lg:col-span-8 space-y-4">
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

          <div className="flex items-center gap-3 flex-wrap">
            <CompletionRing
              pct={data.completionPct}
              done={data.doneToday.length}
              total={data.todayCommits.length || 0}
            />
            {/* Stat tiles */}
            <div className="grid grid-cols-3 gap-2 flex-1 min-w-[180px]">
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
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {/* Jump to the Today tab (Iteration 7 — Col 2 used to host the
                timetable here; that lives on its own tab now). */}
            <button
              data-testid="tracker-open-today-cta"
              onClick={() => onOpenToday?.()}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-[var(--accent)] text-[var(--bg-primary)] font-medium text-sm hover:opacity-90 transition-opacity"
            >
              <CalendarDays className="w-4 h-4" />
              Open today
            </button>
            {/* Primary CTA — opens the chat with an accountability prompt */}
            <button
              data-testid="tracker-coach-cta"
              onClick={() =>
                onOpenChat?.(
                  "Hold me accountable for today. Walk me through what I committed to, what's slipping, and where I should be spending the next hour. If anything looks off, propose what to drop or postpone.",
                )
              }
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-md border border-[var(--border)] text-[var(--text-secondary)] font-medium text-sm hover:border-[var(--border-accent)] hover:text-[var(--accent)] transition-colors"
            >
              <MessageSquare className="w-4 h-4" />
              Ask the coach for today's read
            </button>

            {/* Plan my day — opens the chat in interview mode. The coach
                then walks the user wake-time → bedtime, slotting
                commitments into specific hours as it goes. */}
            <button
              data-testid="tracker-plan-day-cta"
              onClick={() => {
                const today = localDateKey()
                onOpenChat?.(
                  `Plan my day with me. Today is ${today}. ` +
                    `Walk me through it hour by hour, from when I wake up to when I sleep. ` +
                    `Ask one question at a time. After each answer, propose concrete ` +
                    `add_commitment + add_milestone entries so the day lands in the system. ` +
                    `When we're done, I'll have a real timetable I can put on screen. ` +
                    `Let's start: what time are you actually getting out of bed tomorrow?`,
                )
              }}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-md border border-[var(--border)] text-[var(--text-secondary)] font-medium text-sm hover:border-[var(--border-accent)] hover:text-[var(--accent)] transition-colors"
            >
              <Sparkles className="w-4 h-4" />
              Plan my day
            </button>
          </div>
        </div>

        {/* Col 2 — week + flame (Col 2 used to be the timetable; that
            moved to the Today tab in Iteration 7) */}
        <div className="lg:col-span-4 space-y-4">
          <div className="border border-[var(--border)] bg-[color-mix(in_srgb,var(--bg-primary)_40%,transparent)] rounded-md p-3">
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
                    className="text-[12px] text-[var(--text-secondary)] leading-snug px-2 py-1.5 border border-[var(--border)] bg-[color-mix(in_srgb,var(--bg-primary)_40%,transparent)] rounded"
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
      className="border border-[var(--border)] bg-[color-mix(in_srgb,var(--bg-primary)_40%,transparent)] rounded-md px-2.5 py-2 flex flex-col items-start"
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

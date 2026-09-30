import { useState, useEffect } from "react";
import { Calendar, CheckCircle2, Circle, Loader2, MessageSquareWarning, MessageSquarePlus, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { localDateKey } from "../lib/utils";

/**
 * TodayTimetable — interactive list of today's commitments and blockers.
 *
 * Per-item controls:
 *   - Clickable circle checkbox → mark done (PATCH /api/commitments/:id)
 *   - Two CTA buttons that open the chat with a prefill:
 *       · "I can't do this"   → asks the coach to renegotiate
 *       · "Break it down with coach" → asks the coach to break it down
 *
 * Per-item "what you did" note + per-item free-text chat input were
 * removed in Iteration 7 (Ask 1) — they cluttered every row and the
 * user only needs ONE place to talk about the day as a whole. The
 * section-level "Tell the coach anything about today" input now lives
 * inside the new Today tab (`frontend/src/components/Today.jsx`),
 * which renders this component and adds the section-level input
 * below.
 *
 * Designed to be rendered standalone on the Today tab. Also rendered
 * inside the TrackerCard with `compact=true` (list only, no header)
 * — kept for the Goals-tab quick glance until that path is folded in.
 */
export default function TodayTimetable({ state, onChange, onOpenChat, compact = false, fullTimetable = false }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(null); // id of item being saved

  const refresh = () => {
    setLoading(true);
    setError(null);
    Promise.all([
      api.blockers(),
      api.commitments(),
    ])
      .then(([blockersRes, commitmentsRes]) => {
        const rawBlockers = Array.isArray(blockersRes)
          ? blockersRes
          : (blockersRes?.blockers || []);
        const rawCommitments = Array.isArray(commitmentsRes)
          ? commitmentsRes
          : (commitmentsRes?.commitments || []);

        const todayKey = localDateKey();
        const todayBlocks = rawBlockers.filter(
          (b) => b.start_date === todayKey || (b.start_date <= todayKey && b.end_date >= todayKey),
        );
        // Match TrackerCard's `todayCommits` predicate exactly, so the
        // header counters ("N overdue", "M due today") always agree with
        // the rows below them:
        //   • anything due today, done or not
        //   • anything overdue while still open
        // A strict `due === today` match made an overdue commitment
        // vanish the moment you un-ticked it, and left the
        // "overdue first" sort below unreachable.
        const todayCommits = rawCommitments.filter(
          (c) => c.due === todayKey || (c.due && c.due < todayKey && c.status === "open"),
        );
        const merged = [
          ...todayBlocks.map((b) => ({ ...b, _kind: "blocker" })),
          ...todayCommits.map((c) => ({ ...c, _kind: "commitment" })),
        ];
        // Sort: overdue first, then today, by created_at desc.
        merged.sort((a, b) => {
          const aOver = a._kind === "commitment" && a.due < todayKey;
          const bOver = b._kind === "commitment" && b.due < todayKey;
          if (aOver !== bOver) return aOver ? -1 : 1;
          return 0;
        });
        setItems(merged);
      })
      .catch((err) => {
        console.error("Failed to load timetable items:", err);
        setError(err);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  const toggleDone = async (c) => {
    if (c._kind !== "commitment") return;
    setSaving(c.id);
    // Optimistic flip
    setItems((prev) =>
      prev.map((b) => (b.id === c.id && b._kind === "commitment"
        ? { ...b, status: c.status === "done" ? "open" : "done" }
        : b))
    );
    try {
      await api.updateCommitment(c.id, {
        status: c.status === "done" ? "open" : "done",
      });
      onChange?.();
    } catch {
      refresh();
    } finally {
      setSaving(null);
    }
  };

  const cantDoThis = (item) => {
    const title = item.text || item.title || "this commitment";
    onOpenChat?.(
      `I'm having trouble with: "${title}". Can we renegotiate — keep, shrink, or drop it?`,
      {
        scope: item._kind === "blocker" ? "blocker" : "commitment",
        refId: item.id,
        kind: item._kind === "blocker" ? "plan_day" : "plan_day",
        title,
        helperText:
          "What part feels off? Be specific — the coach will suggest a keep / shrink / drop.",
      },
    );
  };
  const addToPlan = (item) => {
    const title = item.text || item.title || "this commitment";
    onOpenChat?.(
      `For "${title}" — break it into the smallest possible first step and slot it into my week.`,
      {
        scope: item._kind === "blocker" ? "blocker" : "commitment",
        refId: item.id,
        kind: "plan_day",
        title,
        helperText: "Describe the smallest concrete next step and the rough when.",
      },
    );
  };

  if (loading && items.length === 0) {
    // Iteration 5 (Bug 1) — always show a shimmer, even in compact mode.
    // TrackerCard renders TodayTimetable with `compact=true` and the old
    // path returned null, leaving the dashboard stuck on a blank spot
    // while the fetch ran.
    return (
      <div
        className={
          compact
            ? "flex items-center gap-1.5 py-1"
            : "border border-[var(--border)] rounded-lg p-4 space-y-2"
        }
        aria-busy="true"
        aria-live="polite"
      >
        <div className="h-3 w-32 gc-skeleton" />
        <div className="h-3 w-56 gc-skeleton" />
      </div>
    );
  }

  if (!loading && error) {
    return compact ? null : (
      <div className="border border-[var(--border)] rounded-lg p-4 text-center space-y-2 bg-[var(--bg-secondary)]/40" data-testid="timetable-error">
        <p className="text-xs text-[var(--text-secondary)]">Couldn't load today's schedule</p>
        <button
          type="button"
          onClick={refresh}
          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-[var(--accent)] text-[var(--bg-primary)] font-medium hover:opacity-90 transition-opacity"
        >
          <RefreshCw className="w-3 h-3" />
          Couldn't load — retry
        </button>
      </div>
    );
  }

  if (!loading && items.length === 0) return null;

  const todayKey = localDateKey();

  return (
    <section
      data-testid="today-timetable"
      className="border border-[var(--border)] bg-[var(--bg-secondary)]/40 rounded-lg"
    >
      {!compact && (
        <header className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)]">
          <Calendar className="w-3.5 h-3.5 text-[var(--accent)]" aria-hidden="true" />
          <h3 className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">
            {fullTimetable ? "Today · full timetable" : "Today · tasks"}
          </h3>
          <span className="ml-auto font-mono text-[10px] text-[var(--text-muted)]">
            {items.length} item{items.length === 1 ? "" : "s"}
          </span>
        </header>
      )}
      {fullTimetable && !compact && (
        // Iteration 5 (Issue 6) — when the user has finalized, show the
        // wake/sleep day-shape above the tasks. Times are illustrative
        // until timetableBlocks ships a full UI; rendered as a thin
        // day-band so the tab feels like a "full timetable" not just a
        // task list.
        <div
          data-testid="today-dayband"
          className="px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-primary)]/50"
        >
          <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-2">
            <span>07:00 · Wake</span>
            <span>23:00 · Sleep</span>
          </div>
          <div className="relative h-2 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
            <div className="absolute left-0 top-0 h-full w-[8%] bg-[var(--accent)]/40" aria-hidden="true" />
            <div className="absolute left-[8%] top-0 h-full w-[78%] bg-[var(--accent)]/20" aria-hidden="true" />
            <div className="absolute left-[86%] top-0 h-full w-[14%] bg-[var(--border-accent)]/40" aria-hidden="true" />
          </div>
          <div className="mt-2 flex items-center gap-3 font-mono text-[10px] uppercase tracking-widest">
            <span className="inline-flex items-center gap-1 text-[var(--text-secondary)]">
              <span className="inline-block h-1.5 w-3 bg-[var(--accent)]/40" /> Routine
            </span>
            <span className="inline-flex items-center gap-1 text-[var(--text-secondary)]">
              <span className="inline-block h-1.5 w-3 bg-[var(--accent)]/20" /> Available
            </span>
            <span className="inline-flex items-center gap-1 text-[var(--text-secondary)]">
              <span className="inline-block h-1.5 w-3 bg-[var(--border-accent)]/40" /> Rest
            </span>
          </div>
        </div>
      )}
      <ul className="divide-y divide-[var(--border)]" role="list">
        {items.map((item) => {
          const isCommitment = item._kind === "commitment";
          const done = isCommitment && item.status === "done";
          const overdue = isCommitment && item.due && item.due < todayKey;
          return (
            <li
              key={`${item._kind}-${item.id}`}
              data-testid={`timetable-item-${item._kind}-${item.id}`}
              className={`px-4 py-3 flex flex-col gap-2 ${done ? "opacity-60" : ""}`}
            >
              {/* Top row: checkbox + title + meta */}
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  onClick={() => toggleDone(item)}
                  disabled={!isCommitment || saving === item.id}
                  aria-label={done ? `Mark "${item.text || item.title}" as not done` : `Mark "${item.text || item.title}" as done`}
                  aria-pressed={done}
                  data-testid={`timetable-checkbox-${item.id}`}
                  className={`mt-0.5 h-9 w-9 shrink-0 flex items-center justify-center border transition-colors rounded ${
                    done
                      ? "border-[var(--success)] bg-[var(--success)]/10 text-[var(--success)]"
                      : "border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                  } ${!isCommitment ? "opacity-30 cursor-not-allowed" : ""}`}
                >
                  {saving === item.id
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : done
                    ? <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                    : <Circle className="w-4 h-4" aria-hidden="true" />}
                </button>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm leading-snug ${done ? "line-through text-[var(--text-muted)]" : "text-[var(--text-primary)]"}`}>
                    {item.text || item.title}
                  </p>
                  <div className="mt-1 flex items-center gap-2 flex-wrap font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                    {item.goal_title && (
                      <span className="px-1.5 py-0.5 border border-[var(--border)] rounded normal-case tracking-normal text-[var(--text-secondary)]">
                        {item.goal_title}
                      </span>
                    )}
                    {(item.due || item.start_date) && (
                      <span>{item.due || item.start_date}</span>
                    )}
                    {overdue && (
                      <span className="text-[var(--danger)] font-semibold">Overdue</span>
                    )}
                    {isCommitment && !overdue && item.due === todayKey && (
                      <span className="text-[var(--accent)] font-semibold">Today</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Action buttons — open chat with a prefill */}
              {!done && (
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => cantDoThis(item)}
                    data-testid={`timetable-cant-${item.id}`}
                    className="h-9 inline-flex items-center gap-1.5 px-3 border border-[var(--border)] hover:border-[var(--danger)] hover:text-[var(--danger)] text-[var(--text-secondary)] text-xs transition-colors rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                  >
                    <MessageSquareWarning className="w-3.5 h-3.5" aria-hidden="true" />
                    I can't do this
                  </button>
                  <button
                    type="button"
                    onClick={() => addToPlan(item)}
                    data-testid={`timetable-plan-${item.id}`}
                    className="h-9 inline-flex items-center gap-1.5 px-3 border border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)] text-[var(--text-secondary)] text-xs transition-colors rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                  >
                    <MessageSquarePlus className="w-3.5 h-3.5" aria-hidden="true" />
                    Break it down with coach
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* Iteration 7 (Ask 1) — per-tile free-text note + per-tile chat input
 * were removed. The single section-level "Tell the coach anything about
 * today" input now lives in `frontend/src/components/Today.jsx` and is
 * rendered once for the whole "Today · tasks" section. */

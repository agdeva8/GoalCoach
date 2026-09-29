import { useState, useEffect, useRef } from "react";
import { Calendar, CheckCircle2, Circle, Loader2, MessageSquareWarning, MessageSquarePlus, RefreshCw } from "lucide-react";
import { api } from "../lib/api";

/**
 * TodayTimetable — interactive card for today's commitments, blockers,
 * and intentions. Each item:
 *
 *   - Clickable circle checkbox → mark done (PATCH /api/commitments/:id)
 *   - Free-text "what you did" note (blur-saves to the commitment)
 *   - Two CTA buttons that open the chat with a prefill:
 *       · "I can't do this"   → asks the coach to renegotiate
 *       · "Add to plan"        → asks the coach to break it down / slot it
 *
 * Designed for the Goals tab dashboard so the user can triage today
 * without leaving the page. Also rendered inside the Today tab if
 * `compact` is true (just the list, no header).
 */
export default function TodayTimetable({ state, onChange, onOpenChat, compact = false }) {
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
      .then(([{ blockers = [] } = {}, commitments = []]) => {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const todayKey = today.toISOString().slice(0, 10);
        const todayBlocks = (blockers || []).filter(
          (b) => b.start_date === todayKey || (b.start_date <= todayKey && b.end_date >= todayKey),
        );
        const todayCommits = (commitments || []).filter((c) => c.due === todayKey);
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

  const saveNote = async (item, note) => {
    if (item._kind !== "commitment") return;
    setSaving(item.id);
    try {
      await api.updateCommitment(item.id, { note });
      onChange?.();
    } catch { /* ignore */ } finally { setSaving(null); }
  };

  const cantDoThis = (item) => {
    const title = item.text || item.title || "this commitment";
    onOpenChat?.(`I'm having trouble with: "${title}". Can we renegotiate — keep, shrink, or drop it?`);
  };
  const addToPlan = (item) => {
    const title = item.text || item.title || "this commitment";
    onOpenChat?.(`For "${title}" — break it into the smallest possible first step and slot it into my week.`);
  };

  if (loading && items.length === 0) {
    return compact ? null : (
      <div className="border border-[var(--border)] rounded-lg p-4 space-y-2" aria-busy="true" aria-live="polite">
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

  const todayKey = new Date().toISOString().slice(0, 10);

  return (
    <section
      data-testid="today-timetable"
      className="border border-[var(--border)] bg-[var(--bg-secondary)]/40 rounded-lg"
    >
      {!compact && (
        <header className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)]">
          <Calendar className="w-3.5 h-3.5 text-[var(--accent)]" aria-hidden="true" />
          <h3 className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">
            Today Timetable
          </h3>
          <span className="ml-auto font-mono text-[10px] text-[var(--text-muted)]">
            {items.length} item{items.length === 1 ? "" : "s"}
          </span>
        </header>
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

              {/* Free-text "what you did" — commitments only */}
              {isCommitment && (
                <InlineNote item={item} onSave={saveNote} saving={saving === item.id} />
              )}

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

function InlineNote({ item, onSave, saving }) {
  const [note, setNote] = useState(item.note || "");
  const [dirty, setDirty] = useState(false);
  const timerRef = useRef(null);

  // Blur-save
  const handleBlur = () => {
    if (dirty && note !== (item.note || "")) {
      onSave(note);
      setDirty(false);
    }
  };

  // Debounced auto-save 1.5s after last keystroke
  useEffect(() => {
    if (!dirty) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (note !== (item.note || "")) {
        onSave(note);
        setDirty(false);
      }
    }, 1500);
    return () => clearTimeout(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note, dirty]);

  return (
    <textarea
      data-testid={`timetable-note-${item.id}`}
      value={note}
      onChange={(e) => { setNote(e.target.value); setDirty(true); }}
      onBlur={handleBlur}
      rows={2}
      placeholder="What did you do? Or what's blocking you? (saves on blur)"
      aria-label={`Notes for "${item.text || item.title}"`}
      className="w-full bg-[var(--bg-primary)] border border-[var(--border)] rounded px-2.5 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-accent)] resize-none"
    />
  );
}

import { useState, useEffect } from "react";
import { CheckCircle2, Circle, Clock, Trash2 } from "lucide-react";
import { api } from "../lib/api";

const fmtDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const fmtTime = (t) => {
  if (!t) return "";
  const [h, m] = t.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "pm" : "am";
  const h12 = hour % 12 || 12;
  return `${h12}:${m}${ampm}`;
};

/**
 * Today — a focused daily planner view.
 *
 * Shows today's blockers and commitments fetched fresh from the API,
 * grouped by kind. Each item has:
 *   - Done checkbox (toggles commitment status via PUT /api/commitments/:id)
 *   - Note textarea (saves to blocker.note via PUT /api/blockers/:id)
 *
 * Refreshes on mount and after any mutation.
 */
export default function Today({ state, onChange }) {
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null); // id of item being saved

  const today = fmtDate(new Date());

  const fetchBlocks = () => {
    setLoading(true);
    Promise.all([
      api.blockers().catch(() => ({ blockers: [] })),
      api.commitments().catch(() => []),
    ])
      .then(([{ blockers }, commitments]) => {
        // Filter to today
        const todayBlocks = blockers.filter(
          (b) => b.start_date === today || (b.start_date <= today && b.end_date >= today),
        );
        const todayCommitments = commitments.filter((c) => c.due === today);
        setBlocks([
          ...todayBlocks.map((b) => ({ ...b, _kind: "blocker" })),
          ...todayCommitments.map((c) => ({ ...c, _kind: "commitment" })),
        ]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchBlocks();
  }, [today]);

  const toggleDone = async (c) => {
    if (c._kind !== "commitment") return;
    setSaving(c.id);
    try {
      const updated = await api.updateCommitment(c.id, {
        status: c.status === "done" ? "open" : "done",
      });
      setBlocks((prev) =>
        prev.map((b) => (b.id === c.id && b._kind === "commitment" ? { ...b, status: updated?.status || (c.status === "done" ? "open" : "done") } : b)),
      );
      onChange?.();
    } catch {
      // revert optimistically — just refetch
      fetchBlocks();
    } finally {
      setSaving(null);
    }
  };

  const saveNote = async (b, note) => {
    if (b._kind !== "blocker") return;
    setSaving(b.id);
    try {
      await api.updateBlocker(b.id, { note });
      setBlocks((prev) => prev.map((blk) => (blk.id === b.id ? { ...blk, note } : blk)));
      onChange?.();
    } catch {
      // no-op
    } finally {
      setSaving(null);
    }
  };

  const blockers = blocks.filter((b) => b._kind === "blocker");
  const commitments = blocks.filter((b) => b._kind === "commitment");
  const hasItems = blockers.length > 0 || commitments.length > 0;

  return (
    <div data-testid="today-view" className="space-y-6">
      <div>
        <h2 className="font-display text-sm font-semibold tracking-tight">
          Today &nbsp;
          <span className="text-[var(--text-muted)] font-mono text-xs">
            {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </span>
        </h2>
        <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
          Your day at a glance — blockers, commitments, and a place to jot notes as you go.
        </p>
      </div>

      {loading && blocks.length === 0 && (
        <div className="text-xs text-[var(--text-muted)]">loading…</div>
      )}

      {!loading && !hasItems && (
        <div className="border border-dashed border-[var(--border)] rounded-lg p-8 text-center bg-[var(--bg-secondary)]/40">
          <Clock className="w-8 h-8 mx-auto text-[var(--text-muted)] mb-2" />
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed max-w-sm mx-auto">
            Clear day. No blockers or commitments scheduled — go make something happen.
          </p>
        </div>
      )}

      {blockers.length > 0 && (
        <div className="space-y-2">
          <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--danger)]">Blockers</div>
          {blockers.map((b) => (
            <TodayBlockerCard
              key={b.id}
              block={b}
              saving={saving === b.id}
              onSaveNote={(note) => saveNote(b, note)}
            />
          ))}
        </div>
      )}

      {commitments.length > 0 && (
        <div className="space-y-2">
          <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--accent)]">Commitments</div>
          {commitments.map((c) => (
            <TodayCommitmentCard
              key={c.id}
              commitment={c}
              saving={saving === c.id}
              onToggle={() => toggleDone(c)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TodayBlockerCard({ block, saving, onSaveNote }) {
  const [note, setNote] = useState(block.note || "");
  const [dirty, setDirty] = useState(false);

  const handleBlur = () => {
    if (dirty && note !== (block.note || "")) {
      onSaveNote(note);
      setDirty(false);
    }
  };

  return (
    <div
      data-testid={`today-blocker-${block.id}`}
      className="border border-[var(--danger)]/30 bg-[var(--bg-secondary)]/40 rounded-lg p-3 space-y-2"
    >
      <div className="flex items-start gap-2">
        <div className="w-2 h-2 rounded-full bg-[var(--danger)] mt-1.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-[var(--text-primary)]">{block.title}</p>
          {block.start_date && block.end_date && block.start_date !== block.end_date && (
            <p className="font-mono text-[10px] text-[var(--text-muted)] mt-0.5">
              {fmtDate(new Date(block.start_date + "T00:00:00"))}{" "}
              <span className="opacity-60">→</span>{" "}
              {fmtDate(new Date(block.end_date + "T00:00:00"))}
            </p>
          )}
        </div>
        {saving && (
          <span className="font-mono text-[10px] text-[var(--text-muted)]">saving…</span>
        )}
      </div>
      <textarea
        value={note}
        onChange={(e) => { setNote(e.target.value); setDirty(true); }}
        onBlur={handleBlur}
        placeholder="Add a note — what's the situation?"
        rows={2}
        className="w-full bg-[var(--bg-primary)] border border-[var(--border)] rounded px-2.5 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-accent)] resize-none"
      />
    </div>
  );
}

function TodayCommitmentCard({ commitment, saving, onToggle }) {
  const done = commitment.status === "done";

  return (
    <div
      data-testid={`today-commitment-${commitment.id}`}
      className={`flex items-start gap-2.5 border border-[var(--border)] bg-[var(--bg-secondary)]/40 rounded-lg p-3 transition-opacity ${done ? "opacity-50" : ""}`}
    >
      <button
        onClick={onToggle}
        disabled={saving}
        className="mt-0.5 shrink-0 text-[var(--accent)] hover:opacity-70 transition-opacity"
        title={done ? "Mark incomplete" : "Mark done"}
      >
        {done ? (
          <CheckCircle2 className="w-4 h-4" />
        ) : (
          <Circle className="w-4 h-4" />
        )}
      </button>
      <div className="flex-1 min-w-0">
        <p className={`text-xs ${done ? "line-through text-[var(--text-muted)]" : "text-[var(--text-primary)]"}`}>
          {commitment.text}
        </p>
        {commitment.goal_title && (
          <p className="font-mono text-[10px] text-[var(--text-muted)] mt-0.5 truncate">
            {commitment.goal_title}
          </p>
        )}
      </div>
      {saving && <span className="font-mono text-[10px] text-[var(--text-muted)]">…</span>}
    </div>
  );
}

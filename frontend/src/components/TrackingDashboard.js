import { useState } from "react";
import { Sparkles, CircleDot, PauseCircle, CheckCircle2, Circle, Plus, Pencil, Trash2, Pause, X } from "lucide-react";

const HORIZON_ORDER = ["weekly", "short", "medium", "long"];
const HORIZON_LABELS = {
  weekly: "This week",
  short: "Short-term · < 3 months",
  medium: "Medium-term · 3–12 months",
  long: "Long-term · 1–3 years",
};

const LEVEL_STYLES = {
  clear: { color: "var(--success)", label: "on track" },
  moderate: { color: "var(--accent)", label: "keep an eye on it" },
  high: { color: "var(--warning)", label: "stretched" },
  critical: { color: "var(--danger)", label: "too much on" },
};

const AREAS = ["Health", "Career", "Learning", "Relationship", "Finance", "Side project"];

function OverCommitmentIndicator({ oc }) {
  const style = LEVEL_STYLES[oc.level] || LEVEL_STYLES.clear;
  return (
    <div
      data-testid="over-commitment-indicator"
      role="status"
      className="border p-4 rounded-md"
      style={{ borderColor: style.color, background: "color-mix(in srgb, " + style.color + " 8%, transparent)" }}
    >
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="w-4 h-4" style={{ color: style.color }} />
        <span className="text-xs font-semibold" style={{ color: style.color }}>
          Your week · {style.label}
        </span>
        <span className="ml-auto font-mono text-[10px] text-[var(--text-muted)]">
          {oc.active_goals} {oc.active_goals === 1 ? "goal" : "goals"} · {oc.open_commitments} to-do{oc.open_commitments === 1 ? "" : "s"}
        </span>
      </div>
      <p className="text-xs leading-relaxed text-[var(--text-primary)]">{oc.message}</p>
      {oc.conflicting?.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {oc.conflicting.map((c) => (
            <span key={c} className="font-mono text-[10px] px-1.5 py-0.5 border rounded" style={{ borderColor: style.color, color: style.color }}>
              {c}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const STATUS_ICON = {
  active: <CircleDot className="w-3.5 h-3.5 text-[var(--accent)]" />,
  paused: <PauseCircle className="w-3.5 h-3.5 text-[var(--warning)]" />,
};

function IconBtn({ testid, title, onClick, children }) {
  return (
    <button
      data-testid={testid}
      title={title}
      onClick={onClick}
      className="h-6 w-6 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
    >
      {children}
    </button>
  );
}

function GoalCard({ goal, commitments, onPrefill }) {
  const goalCommits = commitments.filter((c) => c.goal_id === goal.id);
  const t = goal.title;
  return (
    <div data-testid={`goal-card-${goal.id}`} className="group border border-[var(--border)] bg-[var(--bg-secondary)] p-3 rounded-md">
      <div className="flex items-start gap-2">
        <span className="mt-0.5">{STATUS_ICON[goal.status] || <CircleDot className="w-3.5 h-3.5 text-[var(--text-muted)]" />}</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-[var(--text-primary)] leading-snug">{t}</div>
          {goal.why && <div className="text-xs text-[var(--text-muted)] mt-0.5 leading-relaxed">{goal.why}</div>}
          {goal.target_date && <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-[var(--accent)]">target · {goal.target_date}</div>}
          {goal.next_action && (
            <div className="mt-2 text-xs text-[var(--text-secondary)]">
              <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">next</span>{" "}
              {goal.next_action}
            </div>
          )}
          {goalCommits.length > 0 && (
            <div className="mt-2 space-y-1 border-t border-[var(--border)] pt-2">
              {goalCommits.map((c) => (
                <div key={c.id} className="flex items-start gap-1.5 text-xs">
                  {c.status === "done" ? (
                    <CheckCircle2 className="w-3 h-3 text-[var(--success)] mt-0.5 shrink-0" />
                  ) : (
                    <Circle className="w-3 h-3 text-[var(--text-muted)] mt-0.5 shrink-0" />
                  )}
                  <span className={c.status === "done" ? "line-through text-[var(--text-muted)]" : "text-[var(--text-secondary)]"}>
                    {c.text}{c.due ? ` · ${c.due}` : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="mt-2 pt-2 border-t border-[var(--border)] flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
        <IconBtn testid={`goal-add-step-${goal.id}`} title="Add a step / milestone" onClick={() => onPrefill(`Add a milestone to "${t}": `)}>
          <Plus className="w-3.5 h-3.5" />
        </IconBtn>
        <IconBtn testid={`goal-edit-${goal.id}`} title="Refine or rename this goal" onClick={() => onPrefill(`I want to refine my goal "${t}": `)}>
          <Pencil className="w-3.5 h-3.5" />
        </IconBtn>
        <IconBtn testid={`goal-pause-${goal.id}`} title="Pause this goal" onClick={() => onPrefill(`Let's pause "${t}" for now because `)}>
          <Pause className="w-3.5 h-3.5" />
        </IconBtn>
        <IconBtn testid={`goal-drop-${goal.id}`} title="Drop this goal" onClick={() => onPrefill(`I want to drop "${t}" because `)}>
          <Trash2 className="w-3.5 h-3.5" />
        </IconBtn>
      </div>
    </div>
  );
}

export default function TrackingDashboard({ state, onPrefill = () => {} }) {
  const [showAreas, setShowAreas] = useState(false);
  if (!state) {
    return <div className="p-6 font-mono text-xs text-[var(--text-muted)]">loading…</div>;
  }
  const visibleGoals = state.goals.filter((g) => g.status !== "dropped");
  const grouped = HORIZON_ORDER.map((h) => ({
    horizon: h,
    goals: visibleGoals.filter((g) => g.horizon === h),
  })).filter((g) => g.goals.length > 0);

  const addArea = (area) => {
    setShowAreas(false);
    onPrefill(`Help me set up a ${area.toLowerCase()} goal. Ask me anything you need, then propose it.`);
  };

  return (
    <div data-testid="tracking-dashboard" className="p-4 sm:p-6 space-y-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-display text-sm font-semibold tracking-tight text-[var(--text-primary)]">Your goals</h2>
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">Everything the coach is keeping track of for you.</p>
        </div>
        <button
          data-testid="add-goal-button"
          onClick={() => setShowAreas((v) => !v)}
          className="flex items-center gap-1.5 px-2.5 h-8 rounded-md bg-[var(--accent)] text-[var(--bg-primary)] text-xs font-medium hover:opacity-90 transition-opacity shrink-0"
        >
          <Plus className="w-3.5 h-3.5" /> Add goal
        </button>
      </div>

      {showAreas && (
        <div data-testid="area-chips" className="flex flex-wrap gap-1.5 -mt-3">
          {AREAS.map((a) => (
            <button
              key={a}
              data-testid={`area-chip-${a.toLowerCase().replace(/\s/g, "-")}`}
              onClick={() => addArea(a)}
              className="text-xs px-2.5 py-1 rounded-full border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
            >
              {a}
            </button>
          ))}
          <button
            data-testid="area-chip-custom"
            onClick={() => { setShowAreas(false); onPrefill("I want to add a new goal. Here's what I'm thinking: "); }}
            className="text-xs px-2.5 py-1 rounded-full border border-dashed border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            Something else…
          </button>
        </div>
      )}

      <OverCommitmentIndicator oc={state.over_commitment} />

      {visibleGoals.length === 0 ? (
        <div className="border border-dashed border-[var(--border)] p-6 text-center rounded-md">
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            Nothing tracked yet. Hit <span className="text-[var(--text-primary)]">Add goal</span> or just say what you're
            working on in the chat — the coach proposes it, and it shows up here once you confirm.
          </p>
        </div>
      ) : (
        grouped.map((group) => (
          <div key={group.horizon} data-testid={`horizon-${group.horizon}`}>
            <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)] mb-2 pb-1 border-b border-[var(--border)]">
              {HORIZON_LABELS[group.horizon]}
            </div>
            <div className="space-y-2">
              {group.goals.map((g) => (
                <GoalCard key={g.id} goal={g} commitments={state.commitments} onPrefill={onPrefill} />
              ))}
            </div>
          </div>
        ))
      )}

      <div className="border-t border-[var(--border)] pt-4" data-testid="upcoming-features">
        <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-2">Upcoming — headed your way</div>
        <div className="flex flex-wrap gap-1.5">
          {["Calendar view", "Weekly / daily scheduler", "Reminders", "Trackers"].map((u) => (
            <span key={u} className="font-mono text-[10px] px-2 py-1 border border-dashed border-[var(--border)] rounded text-[var(--text-muted)]">{u}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

import { AlertTriangle, CircleDot, PauseCircle, CheckCircle2, Circle } from "lucide-react";

const HORIZON_ORDER = ["weekly", "short", "medium", "long"];
const HORIZON_LABELS = {
  weekly: "This week",
  short: "Short-term · < 3 months",
  medium: "Medium-term · 3–12 months",
  long: "Long-term · 1–3 years",
};

const LEVEL_STYLES = {
  clear: { color: "var(--success)", label: "sustainable" },
  moderate: { color: "var(--accent)", label: "watch" },
  high: { color: "var(--warning)", label: "spread thin" },
  critical: { color: "var(--danger)", label: "over-committed" },
};

function OverCommitmentIndicator({ oc }) {
  const style = LEVEL_STYLES[oc.level] || LEVEL_STYLES.clear;
  return (
    <div
      data-testid="over-commitment-indicator"
      role="status"
      className="border p-4"
      style={{ borderColor: style.color, background: "color-mix(in srgb, " + style.color + " 8%, transparent)" }}
    >
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="w-4 h-4" style={{ color: style.color }} />
        <span className="font-mono text-[10px] uppercase tracking-widest" style={{ color: style.color }}>
          load · {style.label}
        </span>
        <span className="ml-auto font-mono text-[10px] text-[var(--text-muted)]">
          {oc.active_goals} goals · {oc.open_commitments} open
        </span>
      </div>
      <p className="text-xs leading-relaxed text-[var(--text-primary)]">{oc.message}</p>
      {oc.conflicting?.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {oc.conflicting.map((c) => (
            <span key={c} className="font-mono text-[10px] px-1.5 py-0.5 border" style={{ borderColor: style.color, color: style.color }}>
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

function GoalCard({ goal, commitments }) {
  const goalCommits = commitments.filter((c) => c.goal_id === goal.id);
  return (
    <div data-testid={`goal-card-${goal.id}`} className="border border-[var(--border)] bg-[var(--bg-secondary)] p-3">
      <div className="flex items-start gap-2">
        <span className="mt-0.5">{STATUS_ICON[goal.status] || <CircleDot className="w-3.5 h-3.5 text-[var(--text-muted)]" />}</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-[var(--text-primary)] leading-snug">{goal.title}</div>
          {goal.why && <div className="text-xs text-[var(--text-muted)] mt-0.5 leading-relaxed">{goal.why}</div>}
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
        {goal.status === "paused" && (
          <span className="font-mono text-[9px] uppercase tracking-widest text-[var(--warning)]">paused</span>
        )}
      </div>
    </div>
  );
}

export default function TrackingDashboard({ state }) {
  if (!state) {
    return (
      <div className="p-6 font-mono text-xs text-[var(--text-muted)]">loading state…</div>
    );
  }
  const visibleGoals = state.goals.filter((g) => g.status !== "dropped");
  const grouped = HORIZON_ORDER.map((h) => ({
    horizon: h,
    goals: visibleGoals.filter((g) => g.horizon === h),
  })).filter((g) => g.goals.length > 0);

  return (
    <div data-testid="tracking-dashboard" className="p-4 sm:p-6 space-y-6">
      <div>
        <h2 className="font-display text-sm font-semibold tracking-tight text-[var(--text-primary)]">State</h2>
        <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)] mt-0.5">
          the coach's writeable truth · read-only here
        </p>
      </div>

      <OverCommitmentIndicator oc={state.over_commitment} />

      {visibleGoals.length === 0 ? (
        <div className="border border-dashed border-[var(--border)] p-6 text-center">
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            No goals tracked yet. Name what you're working on in the chat — the coach will propose
            adding it, and it appears here once you confirm.
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
                <GoalCard key={g.id} goal={g} commitments={state.commitments} />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

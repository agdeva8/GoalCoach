import { useState, useRef } from "react";
import { Sparkles, CircleDot, PauseCircle, CheckCircle2, Circle, Plus, Pencil, Trash2, Pause, Milestone, Paperclip, FileText, Link2, ExternalLink, X } from "lucide-react";
import { sourceDownloadUrl } from "../lib/api";
import AddGoalDialog from "./AddGoalDialog";
import SourceActionDialog from "./SourceActionDialog";

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
// GOAL_CATEGORIES is now defined in AddGoalDialog.js — the dialog is the
// single source of truth for category tiles so we don't fragment the
// surface.

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
        <span className="text-xs font-semibold" style={{ color: style.color }}>Your week · {style.label}</span>
        <span className="ml-auto font-mono text-[10px] text-[var(--text-muted)]">
          {oc.active_goals} {oc.active_goals === 1 ? "goal" : "goals"} · {oc.open_commitments} to-do{oc.open_commitments === 1 ? "" : "s"}
        </span>
      </div>
      <p className="text-xs leading-relaxed text-[var(--text-primary)]">{oc.message}</p>
      {oc.conflicting?.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {oc.conflicting.map((c) => (
            <span key={c} className="font-mono text-[10px] px-1.5 py-0.5 border rounded" style={{ borderColor: style.color, color: style.color }}>{c}</span>
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
    <button data-testid={testid} title={title} onClick={onClick} className="h-6 w-6 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors">
      {children}
    </button>
  );
}

const TODAY = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();
const mileColor = (m) => {
  if (m.status === "done") return "var(--success)";
  const d = m.target_date ? new Date(m.target_date + "T00:00:00") : null;
  if (d && !isNaN(d.getTime()) && d < TODAY) return "var(--danger)";
  return "var(--warning)";
};

function MilestonesChip({ milestones }) {
  const [open, setOpen] = useState(false);
  if (!milestones.length) return null;
  const counts = { green: 0, amber: 0, red: 0 };
  milestones.forEach((m) => {
    const c = mileColor(m);
    counts[c.includes("success") ? "green" : c.includes("danger") ? "red" : "amber"]++;
  });
  return (
    <div className="mt-2">
      <button data-testid="milestones-chip" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-full border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-accent)] transition-colors">
        <Milestone className="w-3 h-3" /> {milestones.length} milestone{milestones.length === 1 ? "" : "s"}
        <span className="flex items-center gap-1 ml-0.5">
          {counts.green > 0 && <span className="flex items-center gap-0.5" style={{ color: "var(--success)" }}>●{counts.green}</span>}
          {counts.amber > 0 && <span className="flex items-center gap-0.5" style={{ color: "var(--warning)" }}>●{counts.amber}</span>}
          {counts.red > 0 && <span className="flex items-center gap-0.5" style={{ color: "var(--danger)" }}>●{counts.red}</span>}
        </span>
      </button>
      {open && (
        <div className="mt-1.5 space-y-1 pl-1">
          {milestones.map((m) => (
            <div key={m.id} className="flex items-center gap-1.5 text-[11px]">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: mileColor(m) }} />
              <span className={m.status === "done" ? "line-through text-[var(--text-muted)]" : "text-[var(--text-secondary)]"}>{m.title}</span>
              {m.target_date && <span className="ml-auto font-mono text-[10px] text-[var(--text-muted)]">{m.target_date}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SourcesChip({ goal, sources, onUpload, onAddLink, onDelete }) {
  const [open, setOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState(null);
  const [dialogSource, setDialogSource] = useState(null);
  return (
    <div className="mt-1.5">
      <div className="flex items-center gap-1.5">
        <button data-testid={`sources-chip-${goal.id}`} onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-full border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-accent)] transition-colors">
          <Paperclip className="w-3 h-3" /> {sources.length ? `${sources.length} source${sources.length === 1 ? "" : "s"}` : "add source"}
        </button>
        <IconBtn testid={`goal-upload-${goal.id}`} title="Attach a file to this goal" onClick={() => setDialogMode("upload")}><Plus className="w-3.5 h-3.5" /></IconBtn>
        <IconBtn testid={`goal-link-${goal.id}`} title="Add a link as a source" onClick={() => setDialogMode("link")}><Link2 className="w-3 h-3" /></IconBtn>
      </div>
      {open && sources.length > 0 && (
        <div className="mt-1.5 space-y-1">
          {sources.map((s) => (
            <div key={s.id} className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
              {s.kind === "link" ? <Link2 className="w-3 h-3 shrink-0" /> : <FileText className="w-3 h-3 shrink-0" />}
              <a href={s.kind === "link" ? s.url : sourceDownloadUrl(s.id)} target="_blank" rel="noreferrer" className="truncate hover:text-[var(--accent)] flex items-center gap-1">
                {s.original_filename} <ExternalLink className="w-2.5 h-2.5" />
              </a>
              <button
                data-testid={`goal-delete-source-${s.id}`}
                onClick={() => { setDialogSource(s); setDialogMode("delete"); }}
                className="ml-auto text-[var(--text-muted)] hover:text-[var(--danger)]"
                title="Remove this source"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <SourceActionDialog
        open={!!dialogMode}
        onClose={() => { setDialogMode(null); setDialogSource(null); }}
        mode={dialogMode || "upload"}
        source={dialogSource}
        goalId={goal.id}
        goalTitle={goal.title}
        onUploadFile={onUpload}
        onAddLink={onAddLink}
        onDeleteSource={onDelete}
      />
    </div>
  );
}

function GoalCard({ goal, commitments, milestones, onAction, onUploadSource, onAddLink, onDeleteSource }) {
  const goalCommits = commitments.filter((c) => c.goal_id === goal.id);
  const goalMiles = milestones.filter((m) => m.goal_id === goal.id || m.goal_title === goal.title);
  const sources = goal.sources || [];
  return (
    <div data-testid={`goal-card-${goal.id}`} className="group border border-[var(--border)] bg-[var(--bg-secondary)] p-3 rounded-md">
      <div className="flex items-start gap-2">
        <span className="mt-0.5">{STATUS_ICON[goal.status] || <CircleDot className="w-3.5 h-3.5 text-[var(--text-muted)]" />}</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-[var(--text-primary)] leading-snug">{goal.title}</div>
          {goal.why && <div className="text-xs text-[var(--text-muted)] mt-0.5 leading-relaxed">{goal.why}</div>}
          {goal.target_date && <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-[var(--accent)]">target · {goal.target_date}</div>}
          {goal.next_action && (
            <div className="mt-2 text-xs text-[var(--text-secondary)]">
              <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">next</span> {goal.next_action}
            </div>
          )}
          <MilestonesChip milestones={goalMiles} />
          <SourcesChip goal={goal} sources={sources} onUpload={onUploadSource} onAddLink={onAddLink} onDelete={onDeleteSource} />
          {goalCommits.length > 0 && (
            <div className="mt-2 space-y-1 border-t border-[var(--border)] pt-2">
              {goalCommits.map((c) => (
                <div key={c.id} className="flex items-start gap-1.5 text-xs">
                  {c.status === "done" ? <CheckCircle2 className="w-3 h-3 text-[var(--success)] mt-0.5 shrink-0" /> : <Circle className="w-3 h-3 text-[var(--text-muted)] mt-0.5 shrink-0" />}
                  <span className={c.status === "done" ? "line-through text-[var(--text-muted)]" : "text-[var(--text-secondary)]"}>{c.text}{c.due ? ` · ${c.due}` : ""}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="mt-2 pt-2 border-t border-[var(--border)] flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
        <IconBtn testid={`goal-add-step-${goal.id}`} title="Add a step / milestone" onClick={() => onAction(goal, "add_step")}><Milestone className="w-3.5 h-3.5" /></IconBtn>
        <IconBtn testid={`goal-edit-${goal.id}`} title="Refine or rename this goal" onClick={() => onAction(goal, "edit")}><Pencil className="w-3.5 h-3.5" /></IconBtn>
        <IconBtn testid={`goal-pause-${goal.id}`} title="Pause this goal" onClick={() => onAction(goal, "pause")}><Pause className="w-3.5 h-3.5" /></IconBtn>
        <IconBtn testid={`goal-drop-${goal.id}`} title="Drop this goal" onClick={() => onAction(goal, "drop")}><Trash2 className="w-3.5 h-3.5" /></IconBtn>
      </div>
    </div>
  );
}

export default function TrackingDashboard({
  state,
  onPrefill = () => {},
  onAction = () => {},
  onUploadSource = () => {},
  onAddLink = () => {},
  onDeleteSource = () => {},
  onCreated = () => {},
  autoAnswer = false,
  grillMe = false,
}) {
  const [addGoalOpen, setAddGoalOpen] = useState(false);
  if (!state) return <div className="p-6 font-mono text-xs text-[var(--text-muted)]">loading…</div>;
  const visibleGoals = state.goals.filter((g) => g.status !== "dropped");
  const milestones = state.milestones || [];
  const grouped = HORIZON_ORDER.map((h) => ({ horizon: h, goals: visibleGoals.filter((g) => g.horizon === h) })).filter((g) => g.goals.length > 0);

  const openAddGoalDialog = () => setAddGoalOpen(true);
  const closeAddGoalDialog = () => setAddGoalOpen(false);

  return (
    <div data-testid="tracking-dashboard" className="p-4 sm:p-6 space-y-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-display text-sm font-semibold tracking-tight text-[var(--text-primary)]">Your goals</h2>
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">Everything the coach is keeping track of for you.</p>
        </div>
        <button data-testid="add-goal-button" onClick={openAddGoalDialog} className="flex items-center gap-1.5 px-2.5 h-8 rounded-md bg-[var(--accent)] text-[var(--bg-primary)] text-xs font-medium hover:opacity-90 transition-opacity shrink-0">
          <Plus className="w-3.5 h-3.5" /> Add goal
        </button>
      </div>

      <OverCommitmentIndicator oc={state.over_commitment} />

      {visibleGoals.length === 0 ? (
        <div className="border border-dashed border-[var(--border)] p-6 text-center rounded-md">
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">Nothing tracked yet. Hit <span className="text-[var(--text-primary)]">Add goal</span> or just say what you're working on in the chat.</p>
        </div>
      ) : (
        grouped.map((group) => (
          <div key={group.horizon} data-testid={`horizon-${group.horizon}`}>
            <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)] mb-2 pb-1 border-b border-[var(--border)]">{HORIZON_LABELS[group.horizon]}</div>
            <div className="space-y-2">
              {group.goals.map((g) => (
                <GoalCard key={g.id} goal={g} commitments={state.commitments} milestones={milestones} onAction={onAction} onUploadSource={onUploadSource} onAddLink={onAddLink} onDeleteSource={onDeleteSource} />
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

      <AddGoalDialog
        open={addGoalOpen}
        onClose={closeAddGoalDialog}
        autoAnswer={autoAnswer}
        grillMe={grillMe}
      />
    </div>
  );
}

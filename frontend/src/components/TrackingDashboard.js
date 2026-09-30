import { useState, useRef, useEffect } from "react";
import { Sparkles, CircleDot, PauseCircle, CheckCircle2, Circle, Plus, Pencil, Trash2, Pause, Milestone, Paperclip, FileText, Link2, ExternalLink, X, MessageSquare, ArrowRight, BookImage } from "lucide-react";
import { sourceDownloadUrl } from "../lib/api";
import AddGoalDialog from "./AddGoalDialog";
import SourceActionDialog from "./SourceActionDialog";
import TrackerCard from "./TrackerCard";
import MotivationCard from "./MotivationCard";
import GoalMemoryDialog from "./GoalMemoryDialog";

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
          {oc.active_goals} {oc.active_goals === 1 ? "goal" : "goals"} · {oc.open_commitments} open {oc.open_commitments === 1 ? "commitment" : "commitments"}
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

function IconBtn({ testid, title, onClick, children, "aria-label": ariaLabel }) {
  return (
    <button
      data-testid={testid}
      title={title}
      aria-label={ariaLabel || title}
      onClick={onClick}
      className="h-10 w-10 sm:h-8 sm:w-10 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
    >
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
      <button
        data-testid="milestones-chip"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={`milestones-list-${milestones[0]?.id ?? "x"}`}
        className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-full border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-accent)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
      >
        <Milestone className="w-3 h-3" aria-hidden="true" /> {milestones.length} milestone{milestones.length === 1 ? "" : "s"}
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
        {sources.length > 0 && (
          <button
            data-testid={`sources-chip-${goal.id}`}
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={`sources-list-${goal.id}`}
            className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-full border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-accent)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            <Paperclip className="w-3 h-3" aria-hidden="true" /> {sources.length} source{sources.length === 1 ? "" : "s"}
          </button>
        )}
        <IconBtn testid={`goal-upload-${goal.id}`} title="Attach a file to this goal" onClick={() => setDialogMode("upload")}><Plus className="w-3.5 h-3.5" /></IconBtn>
        <IconBtn testid={`goal-link-${goal.id}`} title="Add a link as a source" onClick={() => setDialogMode("link")}><Link2 className="w-3 h-3" /></IconBtn>
        {sources.length === 0 && (
          <span className="text-[10px] text-[var(--text-muted)] font-mono uppercase tracking-wider ml-1">attach a source</span>
        )}
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

function GoalCard({ goal, commitments, milestones, onAction, onUploadSource, onAddLink, onDeleteSource, onAddMemory }) {
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
      <div className="mt-2 pt-2 border-t border-[var(--border)] flex items-center gap-1">
        <IconBtn testid={`goal-add-step-${goal.id}`} title="Add a step / milestone" onClick={() => onAction(goal, "add_step")}><Milestone className="w-3.5 h-3.5" /></IconBtn>
        <IconBtn testid={`goal-edit-${goal.id}`} title="Refine or rename this goal" onClick={() => onAction(goal, "edit")}><Pencil className="w-3.5 h-3.5" /></IconBtn>
        <IconBtn testid={`goal-pause-${goal.id}`} title="Pause this goal" onClick={() => onAction(goal, "pause")}><Pause className="w-3.5 h-3.5" /></IconBtn>
        <button
          data-testid={`goal-add-memory-${goal.id}`}
          title="Attach a memory (photo or Instagram) to this goal"
          aria-label="Attach a memory (photo or Instagram) to this goal"
          onClick={() => onAddMemory(goal)}
          className="h-8 sm:h-10 px-2.5 inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] hover:border-[var(--accent)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          <BookImage className="w-3 h-3" aria-hidden="true" />
          <span className="font-mono text-[10px] uppercase tracking-wider">memories</span>
        </button>
        <div className="ml-auto" />
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
  onOpenChat = () => {},
  onOpenChatWith = () => {},
  onOpenToday = () => {},
  autoAnswer = false,
  grillMe = false,
  isGuest = false,
}) {
  const [addGoalOpen, setAddGoalOpen] = useState(false);
  const [memoryGoal, setMemoryGoal] = useState(null); // { id, title } | null

  const visibleGoals = (state?.goals || []).filter((g) => g.status !== "dropped");
  const milestones = state?.milestones || [];

  // First-visit auto-open: when there are zero goals AND the
  // localStorage sentinel is unset, surface the AddGoalDialog half a
  // second after paint so the user lands inside it instead of staring
  // at an empty dark panel. The sentinel sticks so a returning user
  // never gets re-surprised. `closeAddGoalDialog` writes the same
  // sentinel, so closing the dialog is enough to mark the user onboarded.
  useEffect(() => {
    if (!state) return;
    if (visibleGoals.length !== 0) return;
    try {
      if (localStorage.getItem("gc_first_visit_v1") === "done") return;
    } catch { return; }
    const t = setTimeout(() => setAddGoalOpen(true), 600);
    return () => clearTimeout(t);
  }, [state, visibleGoals.length]);

  if (!state) {
    return (
      <div data-testid="tracking-dashboard-loading" className="p-4 sm:p-6 space-y-6" aria-busy="true" aria-live="polite">
        <div>
          <div className="h-4 w-28 gc-skeleton" />
          <div className="h-3 w-64 gc-skeleton mt-1.5" />
        </div>
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="border border-[var(--border)] bg-[var(--bg-secondary)] p-3.5 rounded-md space-y-2.5">
              <div className="flex items-start gap-2.5">
                <div className="w-4 h-4 rounded-full gc-skeleton mt-0.5 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-2/5 gc-skeleton" />
                  <div className="h-3 w-3/4 gc-skeleton" />
                </div>
              </div>
              <div className="h-2.5 w-28 gc-skeleton ml-6" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const grouped = HORIZON_ORDER.map((h) => ({ horizon: h, goals: visibleGoals.filter((g) => g.horizon === h) })).filter((g) => g.goals.length > 0);

  const openAddGoalDialog = () => setAddGoalOpen(true);
  const openGoalMemory = (goal) => setMemoryGoal({ id: goal.id, title: goal.title });
  const closeAddGoalDialog = () => {
    setAddGoalOpen(false);
    try { localStorage.setItem("gc_first_visit_v1", "done"); } catch { /* ignore */ }
  };

  return (
    <div data-testid="tracking-dashboard" className="p-4 sm:p-6 space-y-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-display text-sm font-semibold tracking-tight text-[var(--text-primary)]">Your goals</h2>
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">Everything the coach is keeping track of for you.</p>
        </div>
        {visibleGoals.length > 0 && (
          <button data-testid="add-goal-button" onClick={openAddGoalDialog} className="flex items-center gap-1.5 px-2.5 h-8 rounded-md bg-[var(--accent)] text-[var(--bg-primary)] text-xs font-medium hover:opacity-90 transition-opacity shrink-0">
            <Plus className="w-3.5 h-3.5" /> Add goal
          </button>
        )}
      </div>

      <OverCommitmentIndicator oc={state.over_commitment} />

      <TrackerCard state={state} onOpenChat={onOpenChatWith} onOpenToday={onOpenToday} />

      {visibleGoals.length === 0 ? (
        <div data-testid="empty-state" className="border border-dashed border-[var(--border)] rounded-lg p-8 sm:p-12 text-center bg-[var(--bg-secondary)]/40">
          <div className="mx-auto h-12 w-12 rounded-full bg-[var(--accent)]/10 border border-[var(--accent)]/30 flex items-center justify-center mb-4">
            <Sparkles className="h-6 w-6 text-[var(--accent)]" aria-hidden="true" />
          </div>
          <h3 className="font-display text-lg font-semibold text-[var(--text-primary)]">
            What's the first thing you want to sort out?
          </h3>
          <p className="mt-2 text-sm text-[var(--text-secondary)] max-w-md mx-auto leading-relaxed">
            Pick a category and the coach will propose a goal with milestones — you confirm it before anything gets saved.
          </p>
          <div className="mt-6 flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center justify-center gap-3">
            <button
              data-testid="empty-state-add-goal"
              onClick={openAddGoalDialog}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[var(--accent)] text-[var(--bg-primary)] font-medium text-sm hover:opacity-90 active:scale-[0.98] transition-[opacity,transform] duration-150 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)]"
            >
              <Plus className="h-4 w-4" aria-hidden="true" /> Add your first goal
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              data-testid="empty-state-open-chat"
              onClick={onOpenChat}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 border border-[var(--border)] text-[var(--text-secondary)] text-sm hover:border-[var(--border-accent)] active:scale-[0.98] transition-[border-color,transform] duration-150 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)]"
            >
              <MessageSquare className="h-4 w-4" aria-hidden="true" /> Or just chat with the coach
            </button>
          </div>
        </div>
      ) : (
        grouped.map((group) => (
          <div key={group.horizon} data-testid={`horizon-${group.horizon}`}>
            <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)] mb-2 pb-1 border-b border-[var(--border)]">{HORIZON_LABELS[group.horizon]}</div>
            <div className="space-y-2">
              {group.goals.map((g) => (
                <GoalCard key={g.id} goal={g} commitments={state.commitments} milestones={milestones} onAction={onAction} onUploadSource={onUploadSource} onAddLink={onAddLink} onDeleteSource={onDeleteSource} onAddMemory={openGoalMemory} />
              ))}
            </div>
          </div>
        ))
      )}

      <div className="border-t border-[var(--border)] pt-4 mt-2" data-testid="upcoming-features">
        <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-2">
          On the roadmap
        </div>
        <div className="flex flex-wrap gap-1.5">
          {["Calendar view", "Weekly / daily scheduler", "Reminders", "Trackers"].map((u) => (
            <span
              key={u}
              className="font-mono text-[10px] px-2 py-1 border border-dashed border-[var(--border)] rounded text-[var(--text-muted)]"
              title="Coming soon"
            >
              {u}
            </span>
          ))}
        </div>
      </div>

      {/* Motivation / curated nudges — moved to the bottom so it doesn't
          compete with the goals grid for attention on first paint. */}
      <div className="mt-6">
        <MotivationCard state={state} />
      </div>

      <AddGoalDialog
        open={addGoalOpen}
        onClose={closeAddGoalDialog}
        autoAnswer={autoAnswer}
        grillMe={grillMe}
        onUploadSource={onUploadSource}
        onAddLink={onAddLink}
        onDeleteSource={onDeleteSource}
        onGoalConfirmed={onCreated}
      />

      <GoalMemoryDialog
        open={!!memoryGoal}
        goalId={memoryGoal?.id}
        goalTitle={memoryGoal?.title}
        onClose={() => setMemoryGoal(null)}
        onSaved={() => { setMemoryGoal(null); onCreated?.(); }}
      />
    </div>
  );
}

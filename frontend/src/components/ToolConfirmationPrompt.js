import { X, GitCommit, Pencil, Target, FileText, Calendar } from "lucide-react";

const ACTION_LABELS = {
  create_goal: "Add goal",
  update_goal: "Update goal",
  set_goal_dates: "Set timeline",
  add_milestone: "Add milestone",
  add_blocker: "Add blocker",
  drop_goal: "Drop goal",
  pause_goal: "Pause goal",
  add_commitment: "Add commitment",
  complete_commitment: "Mark done",
  update_commitment: "Update commitment",
};

const HORIZON_LABELS = { weekly: "This week", short: "Short-term", medium: "Medium-term", long: "Long-term" };

/**
 * Section badge for the body — founder feedback (Iteration 9+): the
 * proposal card body needs to read clearly as "GOAL" vs "COMMITMENT"
 * vs "MILESTONE" vs "BLOCKER" instead of a flat list of fields.
 *
 * Mapping:
 *   - create_goal / update_goal / set_goal_dates → GOAL
 *   - add_milestone → MILESTONE
 *   - add_commitment / update_commitment / complete_commitment → COMMITMENT
 *   - add_blocker → BLOCKER
 *   - drop_goal / pause_goal → GOAL (the goal they're acting on)
 */
const SECTION_BY_ACTION = {
  create_goal: "GOAL",
  update_goal: "GOAL",
  set_goal_dates: "GOAL",
  drop_goal: "GOAL",
  pause_goal: "GOAL",
  add_milestone: "MILESTONE",
  add_commitment: "COMMITMENT",
  complete_commitment: "COMMITMENT",
  update_commitment: "COMMITMENT",
  add_blocker: "BLOCKER",
};

function SectionBadge({ section }) {
  if (!section) return null;
  return (
    <div className="flex items-center gap-1.5 mb-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--accent)] font-medium">
        {section}
      </span>
      <span className="flex-1 h-px bg-[var(--border)]" aria-hidden="true" />
    </div>
  );
}

function FieldRow({ icon: Icon, label, value, accent }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2 py-1">
      <Icon className="w-3.5 h-3.5 text-[var(--text-muted)] mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-0.5">
          {label}
        </div>
        <div className={`text-sm leading-relaxed break-words ${accent ? "text-[var(--accent)]" : "text-[var(--text-primary)]"}`}>
          {value}
        </div>
      </div>
    </div>
  );
}

/**
 * Flatten a proposal so field access works regardless of whether the
 * server wrapped fields in `args` (canonical post-parse shape from
 * `parseProposals` at api/lib/emergent/llm.ts:166) or kept them at
 * the top level (some legacy / hand-crafted test fixtures). The
 * canonical shape is `args`, but we tolerate both so a single
 * proposal object always renders the same.
 */
function flatProposal(p) {
  if (!p) return {};
  const args = p.args && typeof p.args === "object" ? p.args : {};
  // Top-level fields win on conflict; args fills the gaps.
  return { ...args, ...p, args };
}

/**
 * Iteration 9+ (founder feedback): the per-proposal Confirm is gone;
 * the pinned Confirm/Recreate button in AddGoalDialog handles the
 * whole batch. Only Refine (opens modal) and Reject (opens modal)
 * remain inline so users can still modify individual proposals.
 *
 * Iteration 9+ structure: every proposal body now carries a SECTION
 * badge (GOAL / MILESTONE / COMMITMENT / BLOCKER) so a multi-proposal
 * plan reads at a glance as "the goal, then its commitments" instead
 * of a flat field dump.
 */
export default function ToolConfirmationPrompt({ proposal, onConfirm, onOpenRefine, onOpenReject, busy }) {
  const status = proposal.status || "pending";
  const isDrop = proposal.action === "drop_goal" || proposal.action === "pause_goal";
  const d = flatProposal(proposal);
  const section = SECTION_BY_ACTION[proposal.action] || "";

  // Per-section field set. Each section shows exactly the fields the
  // founder asked for: GOAL has title + description + deadline,
  // COMMITMENT has text + why added + deadline, MILESTONE has title
  // + deadline, BLOCKER has window.
  const showGoalFields = section === "GOAL";
  const showCommitmentFields = section === "COMMITMENT";
  const showMilestoneFields = section === "MILESTONE";
  const showBlockerFields = section === "BLOCKER";

  return (
    <div
      data-testid="tool-confirmation-prompt"
      data-section={section}
      className={`border rounded-md overflow-hidden ${status === "pending" ? "border-[var(--accent)]" : "border-[var(--border)]"} bg-[var(--tool-bg)] my-2`}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)]">
        <GitCommit className={`w-3.5 h-3.5 ${isDrop ? "text-[var(--warning)]" : "text-[var(--accent)]"}`} />
        <span className="text-xs font-medium text-[var(--text-secondary)]">
          The coach wants to · {ACTION_LABELS[proposal.action] || proposal.action}
        </span>
        {status !== "pending" && (
          <span className={`ml-auto font-mono text-[10px] uppercase tracking-widest ${status === "confirmed" ? "text-[var(--success)]" : "text-[var(--text-muted)]"}`}>
            {status}
          </span>
        )}
      </div>

      <div className="px-3 py-3 space-y-3">
        <SectionBadge section={section} />

        {showGoalFields && (
          <div className="space-y-2">
            <FieldRow
              icon={Target}
              label="Title"
              value={d.title || d.new_title || d.goal_title}
            />
            <FieldRow
              icon={FileText}
              label="Description / ask"
              value={d.why}
            />
            <FieldRow
              icon={Calendar}
              label="Deadline"
              value={d.target_date || (d.horizon ? HORIZON_LABELS[d.horizon] : null)}
              accent={!!d.target_date}
            />
            {d.first_action && (
              <FieldRow icon={Target} label="First action" value={d.first_action} />
            )}
          </div>
        )}

        {showMilestoneFields && (
          <div className="space-y-2">
            <FieldRow icon={Target} label="Title" value={d.title} />
            <FieldRow
              icon={Calendar}
              label="Deadline"
              value={d.target_date}
              accent={!!d.target_date}
            />
          </div>
        )}

        {showCommitmentFields && (
          <div className="space-y-2">
            <FieldRow icon={Target} label="Commitment" value={d.text} />
            <FieldRow icon={FileText} label="Why this was added" value={d.why || d.note || d.reason} />
            <FieldRow
              icon={Calendar}
              label="Due"
              value={d.due || d.target_date}
              accent={!!(d.due || d.target_date)}
            />
          </div>
        )}

        {showBlockerFields && (
          <div className="space-y-2">
            <FieldRow icon={FileText} label="Blocker" value={d.title || d.text} />
            <FieldRow
              icon={Calendar}
              label="Window"
              value={d.start_date ? `${d.start_date}${d.end_date ? " – " + d.end_date : ""}` : null}
              accent
            />
          </div>
        )}

        {section === "" && (
          <div className="space-y-2">
            <FieldRow icon={Target} label="Title" value={d.title || d.text} />
            <FieldRow icon={FileText} label="Why" value={d.why} />
            <FieldRow icon={Calendar} label="Date" value={d.target_date || d.due} accent />
          </div>
        )}
      </div>

      {status === "pending" && (
        <div className="flex border-t border-[var(--border)]">
          <button
            data-testid="refine-tool-button"
            disabled={busy}
            onClick={() => onOpenRefine?.(proposal)}
            className="min-h-11 flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--accent)] hover:bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] disabled:opacity-40 transition-colors border-r border-[var(--border)]"
          >
            <Pencil className="w-3.5 h-3.5" /> Refine
          </button>
          <button
            data-testid="reject-tool-button"
            disabled={busy}
            onClick={() => onOpenReject?.(proposal)}
            className="min-h-11 flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] disabled:opacity-40 transition-colors"
          >
            <X className="w-3.5 h-3.5" /> Reject
          </button>
        </div>
      )}
    </div>
  );
}
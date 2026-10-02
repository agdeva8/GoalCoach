import { X, GitCommit, Pencil, Target, FileText, Calendar } from "lucide-react";

const ACTION_LABELS = {
  create_goal: "Goal",
  update_goal: "Goal",
  set_goal_dates: "Timeline",
  add_milestone: "Milestone",
  add_blocker: "Blocker",
  drop_goal: "Goal",
  pause_goal: "Goal",
  add_commitment: "Commitment",
  complete_commitment: "Commitment",
  update_commitment: "Commitment",
};

const HORIZON_LABELS = { weekly: "This week", short: "Short-term", medium: "Medium-term", long: "Long-term" };

/**
 * Section badge for the body — founder feedback (Iteration 9+): the
 * proposal card body needs to read clearly as "GOAL" vs "COMMITMENT"
 * vs "MILESTONE" vs "BLOCKER" instead of a flat list of fields.
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
        {label && (
          <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-0.5">
            {label}
          </div>
        )}
        <div className={`text-sm leading-relaxed break-words whitespace-pre-wrap ${accent ? "text-[var(--accent)]" : "text-[var(--text-primary)]"} ${!label && "font-semibold"}`}>
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
  return { ...args, ...p, args };
}

/**
 * Iteration 9+ structure:
 *   - Two-line header: section badge (GOAL/MILESTONE/COMMITMENT/BLOCKER)
 *     on top + "<Section>: <title>" as the second line (founder request).
 *   - Body shows the right fields per section: GOAL = title +
 *     description + deadline; MILESTONE = title + description + why +
 *     deadline; COMMITMENT = text + why added + due; BLOCKER = window.
 *   - No per-item Confirm (handled by the pinned button); Refine +
 *     Reject stay inline and open their respective modals.
 */
export default function ToolConfirmationPrompt({ proposal, onOpenRefine, onOpenReject, busy }) {
  const status = proposal.status || "pending";
  const isDrop = proposal.action === "drop_goal" || proposal.action === "pause_goal";
  const d = flatProposal(proposal);
  const section = SECTION_BY_ACTION[proposal.action] || "";
  const actionLabel = ACTION_LABELS[proposal.action] || proposal.action || "Proposal";

  // Title used in the "<Section>: <title>" line. Goal takes the
  // title/new_title/goal_title; milestones take d.title; commitments
  // fall back to the first line of d.text; blockers to d.title.
  const headlineTitle =
    d.title ||
    d.new_title ||
    d.goal_title ||
    (typeof d.text === "string" ? d.text.split("\n")[0].slice(0, 80) : "");

  const showGoalFields = section === "GOAL";
  const showMilestoneFields = section === "MILESTONE";
  const showCommitmentFields = section === "COMMITMENT";
  const showBlockerFields = section === "BLOCKER";

  return (
    <div
      data-testid="tool-confirmation-prompt"
      data-section={section}
      className={`border rounded-2xl overflow-hidden ${status === "pending" ? "border-[var(--accent)]" : "border-[var(--border)]"} bg-[var(--tool-bg)] my-3`}
    >
      {/* Header — two-line layout per founder feedback (Iteration 9+):
          line 1 = section badge + GitCommit icon + status; line 2 =
          "<Section>: <title>" (e.g. "Milestone: Run 10k without
          stopping"). The old "Coach wants to · Add milestone" copy
          is replaced with this named-title format. */}
      <div className="px-3 py-2 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <GitCommit className={`w-3.5 h-3.5 ${isDrop ? "text-[var(--warning)]" : "text-[var(--accent)]"}`} />
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--accent)] font-medium">
            {section || actionLabel.toUpperCase()}
          </span>
          {status !== "pending" && (
            <span className={`ml-auto font-mono text-[10px] uppercase tracking-widest ${status === "confirmed" ? "text-[var(--success)]" : "text-[var(--text-muted)]"}`}>
              {status}
            </span>
          )}
        </div>
        {headlineTitle && (
          <div data-testid="proposal-headline" className="mt-1 text-sm font-medium text-[var(--text-primary)] whitespace-pre-wrap break-words">
            {actionLabel}: {headlineTitle}
          </div>
        )}
      </div>

      <div className="px-3 py-3 space-y-3">
        {showGoalFields && (
          <div className="space-y-2">
            <FieldRow
              icon={Target}
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
            <FieldRow icon={Target} value={d.title} />
            <FieldRow icon={FileText} label="Description" value={d.description || d.desc || d.note} />
            <FieldRow icon={FileText} label="Why" value={d.why} />
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
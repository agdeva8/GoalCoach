import { Check, X, GitCommit, Pencil } from "lucide-react";
import { canAutofocus } from "../lib/utils";

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

function Row({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex gap-2 text-xs">
      <span className="font-mono uppercase tracking-wider text-[var(--text-muted)] w-16 shrink-0">{label}</span>
      <span className="text-[var(--text-primary)]">{value}</span>
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
 * Iteration 9 — Refine / Reject no longer open an inline textarea or
 * call back into the chat stream. They each open a parent-owned modal
 * (`<RefineModal>` / `<RejectModal>`) that does ONE LLM round-trip and
 * either replaces the proposal in place (refine) or records the reason
 * and dismisses (reject).
 *
 *   onOpenRefine(proposal) → parent opens RefineModal
 *   onOpenReject(proposal) → parent opens RejectModal
 *   onConfirm()             → unchanged
 */
export default function ToolConfirmationPrompt({ proposal, onConfirm, onReject, onOpenRefine, onOpenReject, busy }) {
  const status = proposal.status || "pending";
  const isDrop = proposal.action === "drop_goal" || proposal.action === "pause_goal";
  const d = flatProposal(proposal);

  const displayName = d.title || d.new_title || d.goal_title || "";
  const actionLabel = (ACTION_LABELS[proposal.action] || proposal.action || "change").toLowerCase();

  return (
    <div
      data-testid="tool-confirmation-prompt"
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

      <div className="px-3 py-3 space-y-1.5">
        <Row label="Goal" value={displayName} />
        <Row label="Horizon" value={HORIZON_LABELS[d.horizon]} />
        <Row label="Why" value={d.why} />
        <Row label="Action" value={d.first_action || d.next_action} />
        <Row label="Milestone" value={d.action === "add_milestone" ? d.title : null} />
        <Row label="Target" value={d.target_date} />
        <Row label="Window" value={d.action === "add_blocker" ? `${d.start_date || ""}${d.end_date ? " – " + d.end_date : ""}` : null} />
        <Row label="Commit" value={d.text} />
        <Row label="Due" value={d.due} />
        <Row label="Status" value={d.action === "update_goal" ? d.status : null} />
        <Row label="Reason" value={d.reason || d.note} />
      </div>

      {status === "pending" && (
        <div className="flex border-t border-[var(--border)]">
          <button
            data-testid="confirm-tool-button"
            disabled={busy}
            onClick={onConfirm}
            className="min-h-11 flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium text-[var(--success)] hover:bg-[color-mix(in_srgb,var(--success)_10%,transparent)] disabled:opacity-40 transition-colors border-r border-[var(--border)]"
          >
            <Check className="w-3.5 h-3.5" /> Confirm
          </button>
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
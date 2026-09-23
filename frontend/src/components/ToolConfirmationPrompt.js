import { Check, X, GitCommit } from "lucide-react";

const ACTION_LABELS = {
  create_goal: "Create goal",
  update_goal: "Update goal",
  drop_goal: "Drop goal",
  pause_goal: "Pause goal",
  add_commitment: "Add commitment",
  complete_commitment: "Mark commitment done",
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

export default function ToolConfirmationPrompt({ proposal, onConfirm, onReject, busy }) {
  const status = proposal.status || "pending";
  const isDrop = proposal.action === "drop_goal" || proposal.action === "pause_goal";

  return (
    <div
      data-testid="tool-confirmation-prompt"
      className={`border ${status === "pending" ? "border-[var(--accent)]" : "border-[var(--border)]"} bg-[var(--tool-bg)] my-2`}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)]">
        <GitCommit className={`w-3.5 h-3.5 ${isDrop ? "text-[var(--warning)]" : "text-[var(--accent)]"}`} />
        <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">
          proposed state write · {ACTION_LABELS[proposal.action] || proposal.action}
        </span>
        {status !== "pending" && (
          <span className={`ml-auto font-mono text-[10px] uppercase tracking-widest ${status === "confirmed" ? "text-[var(--success)]" : "text-[var(--text-muted)]"}`}>
            {status}
          </span>
        )}
      </div>

      <div className="px-3 py-3 space-y-1.5">
        <Row label="Goal" value={proposal.title || proposal.new_title || proposal.goal_title} />
        <Row label="Horizon" value={HORIZON_LABELS[proposal.horizon]} />
        <Row label="Why" value={proposal.why} />
        <Row label="Action" value={proposal.first_action || proposal.next_action} />
        <Row label="Commit" value={proposal.text} />
        <Row label="Due" value={proposal.due} />
        <Row label="Status" value={proposal.action === "update_goal" ? proposal.status : null} />
        <Row label="Reason" value={proposal.reason} />
      </div>

      {status === "pending" && (
        <div className="flex border-t border-[var(--border)]">
          <button
            data-testid="confirm-tool-button"
            disabled={busy}
            onClick={onConfirm}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium text-[var(--success)] hover:bg-[var(--success)]/10 disabled:opacity-40 transition-colors border-r border-[var(--border)]"
          >
            <Check className="w-3.5 h-3.5" /> Confirm
          </button>
          <button
            data-testid="reject-tool-button"
            disabled={busy}
            onClick={onReject}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 disabled:opacity-40 transition-colors"
          >
            <X className="w-3.5 h-3.5" /> Reject
          </button>
        </div>
      )}
    </div>
  );
}

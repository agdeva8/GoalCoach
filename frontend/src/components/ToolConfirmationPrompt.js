import { useState } from "react";
import { Check, X, GitCommit, Pencil, Send } from "lucide-react";

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

export default function ToolConfirmationPrompt({ proposal, onConfirm, onReject, onRefine, busy }) {
  const status = proposal.status || "pending";
  const isDrop = proposal.action === "drop_goal" || proposal.action === "pause_goal";
  const [refining, setRefining] = useState(false);
  const [thought, setThought] = useState("");

  const sendRefine = () => {
    const t = thought.trim();
    if (!t) return;
    onRefine(t);
    setThought("");
    setRefining(false);
  };

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
        <Row label="Goal" value={proposal.title || proposal.new_title || proposal.goal_title} />
        <Row label="Horizon" value={HORIZON_LABELS[proposal.horizon]} />
        <Row label="Why" value={proposal.why} />
        <Row label="Action" value={proposal.first_action || proposal.next_action} />
        <Row label="Milestone" value={proposal.action === "add_milestone" ? proposal.title : null} />
        <Row label="Target" value={proposal.target_date} />
        <Row label="Window" value={proposal.action === "add_blocker" ? `${proposal.start_date || ""}${proposal.end_date ? " – " + proposal.end_date : ""}` : null} />
        <Row label="Commit" value={proposal.text} />
        <Row label="Due" value={proposal.due} />
        <Row label="Status" value={proposal.action === "update_goal" ? proposal.status : null} />
        <Row label="Reason" value={proposal.reason || proposal.note} />
      </div>

      {status === "pending" && !refining && (
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
            data-testid="refine-tool-button"
            disabled={busy}
            onClick={() => setRefining(true)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--accent)] hover:bg-[var(--accent)]/10 disabled:opacity-40 transition-colors border-r border-[var(--border)]"
          >
            <Pencil className="w-3.5 h-3.5" /> Refine
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

      {status === "pending" && refining && (
        <div className="border-t border-[var(--border)] p-2.5 space-y-2">
          <textarea
            data-testid="refine-input"
            autoFocus
            value={thought}
            onChange={(e) => setThought(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendRefine(); } }}
            rows={2}
            placeholder="What should change? e.g. push the target a month later, make the first step smaller…"
            className="w-full bg-[var(--bg-secondary)] border border-[var(--border)] rounded px-2.5 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-accent)] resize-none"
          />
          <div className="flex gap-2 justify-end">
            <button data-testid="refine-cancel" onClick={() => { setRefining(false); setThought(""); }} className="text-xs px-2.5 py-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
              Cancel
            </button>
            <button data-testid="refine-send" onClick={sendRefine} disabled={!thought.trim()} className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded bg-[var(--accent)] text-[var(--bg-primary)] disabled:opacity-40 hover:opacity-90 transition-opacity">
              <Send className="w-3 h-3" /> Send to coach
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

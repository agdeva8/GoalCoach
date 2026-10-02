import { Target, FileText, Calendar } from "lucide-react";

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
        <div className={`text-sm leading-relaxed break-words whitespace-pre-wrap ${accent ? "text-[var(--accent)]" : "text-[var(--text-primary)]"}`}>
          {value}
        </div>
      </div>
    </div>
  );
}

export default function ProposalPreview({ proposal }) {
  if (!proposal) return null;
  const d = proposal.args || {};
  const section = proposal.action.startsWith("create") || proposal.action.startsWith("update") ? "GOAL" : "";

  return (
    <div className="border rounded-md overflow-hidden bg-[var(--tool-bg)] my-2 p-3 space-y-3">
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
          value={d.target_date}
          accent={!!d.target_date}
        />
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { X, Download, ShieldCheck } from "lucide-react";
import { api, exportUrl } from "../lib/api";

function fmt(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export default function HonestyAuditView({ open, onClose }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.audit().then(setEvents).catch(() => setEvents([])).finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" data-testid="honesty-audit-view">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl max-h-[85vh] flex flex-col bg-[var(--bg-secondary)] border border-[var(--border)] shadow-2xl gc-fade-up">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-[var(--border)]">
          <ShieldCheck className="w-4 h-4 text-[var(--accent)]" />
          <h2 className="font-display text-sm font-semibold tracking-tight">Honesty Audit</h2>
          <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)] ml-1">
            every state change, timestamped
          </span>
          <a
            data-testid="export-audit-button"
            href={exportUrl()}
            className="ml-auto flex items-center gap-1.5 h-8 px-3 border border-[var(--border)] hover:border-[var(--border-accent)] text-xs text-[var(--text-secondary)] transition-colors"
          >
            <Download className="w-3.5 h-3.5" /> Export
          </a>
          <button data-testid="close-audit-button" onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors ml-1" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-2">
          {loading && <div className="font-mono text-xs text-[var(--text-muted)]">loading…</div>}
          {!loading && events.length === 0 && (
            <p className="text-xs text-[var(--text-muted)] leading-relaxed">
              Nothing recorded yet. Every time you confirm or reject a proposed change, it's logged here —
              so you can verify the coach has been honest with you, not just trust that it was.
            </p>
          )}
          {events.map((e) => (
            <div key={e.id} className="flex items-start gap-3 border-b border-[var(--border)] pb-2 last:border-0" data-testid="audit-entry">
              <span className="font-mono text-[10px] text-[var(--text-muted)] w-24 shrink-0 pt-0.5">{fmt(e.created_at)}</span>
              <div className="min-w-0">
                <span className={`font-mono text-[10px] uppercase tracking-wider ${e.type?.startsWith("reject") ? "text-[var(--text-muted)]" : "text-[var(--accent)]"}`}>
                  {e.type}
                </span>
                <div className="text-xs text-[var(--text-primary)] mt-0.5">{e.summary}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

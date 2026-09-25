import { useEffect, useState } from "react";
import { Sparkles, ExternalLink, Loader2, RefreshCw, X, BookOpen, Headphones, Video, FileText } from "lucide-react";
import { api } from "../lib/api";

/**
 * MotivationCard — surfaces 1-3 hand-curated motivation items when
 * the user lands on the Goals tab with overdue items. Sits inside
 * the tracker card so the user never has to dig for it.
 *
 * Data flow:
 *   1. fetch /api/motivation/recommend on mount (and on refresh).
 *   2. Server detects the user's current bucket (overdue / dormant
 *      / stuck) from a tiny slice of state.
 *   3. Returns up to N items, randomised within the bucket so the
 *      card varies across reloads.
 *   4. Each item carries a server-side frame that puts the item in
 *      the user's current moment (overdue vs. dormant vs. stuck).
 *
 * UX rules:
 *   - Skips itself silently when nothing interesting is happening
 *     (no overdue, no goals) — never nags the user.
 *   - Dismissable: a small × in the corner hides it for the rest of
 *     the session (per component mount).
 *   - Refresh button re-rolls items from the same bucket.
 */
export default function MotivationCard({ state }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  const overdueCount = (state?.commitments || []).filter(
    (c) =>
      c.status === "open" &&
      c.due &&
      c.due < new Date().toISOString().slice(0, 10),
  ).length
  const activeGoals = (state?.goals || []).filter((g) => g.status === "active").length

  const shouldShow = overdueCount > 0 || activeGoals > 0

  const fetchRecommendations = () => {
    setLoading(true)
    api
      .motivation()
      .then((d) => setItems(d.items || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (!shouldShow || dismissed) return
    fetchRecommendations()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldShow, dismissed])

  if (!shouldShow || dismissed) return null
  if (items.length === 0 && !loading) return null

  return (
    <div
      data-testid="motivation-card"
      className="border border-[var(--border)] bg-gradient-to-br from-amber-500/10 via-amber-400/5 to-transparent rounded-xl overflow-hidden"
    >
      <div className="px-4 sm:px-5 py-3.5 flex items-center gap-2 border-b border-[var(--border)]">
        <Sparkles className="w-4 h-4 text-[var(--accent)]" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-[var(--text-primary)]">
            {overdueCount > 0
              ? `${overdueCount} past-due — here's a re-frame`
              : "A nudge for today"}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
            Curated · server picked these from your week
          </div>
        </div>
        <button
          data-testid="motivation-refresh"
          type="button"
          onClick={fetchRecommendations}
          disabled={loading}
          className="h-7 w-7 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-tertiary)] border border-transparent transition-colors"
          title="Refresh"
        >
          {loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5" />
          )}
        </button>
        <button
          data-testid="motivation-dismiss"
          type="button"
          onClick={() => setDismissed(true)}
          className="h-7 w-7 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
          title="Hide for this view"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <ul className="px-4 sm:px-5 py-3 space-y-2.5">
        {loading && items.length === 0 && (
          <li className="flex items-center gap-2 text-xs text-[var(--text-muted)] py-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> re-framing…
          </li>
        )}
        {items.map((it) => (
          <li
            key={it.id}
            data-testid={`motivation-item-${it.id}`}
            className="flex items-start gap-3 p-2.5 rounded-md border border-[var(--border)] bg-[var(--bg-primary)]/40"
          >
            <KindIcon kind={it.kind} />
            <div className="flex-1 min-w-0">
              <a
                href={it.url}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors inline-flex items-center gap-1 group"
              >
                {it.title}
                <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
              </a>
              <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)] mt-0.5">
                {it.author} · {it.kind} · {it.duration}
              </div>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed mt-1.5">
                {it.frame}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function KindIcon({ kind }) {
  const map = {
    book: BookOpen,
    video: Video,
    article: FileText,
    talk: Headphones,
  }
  const Icon = map[kind] || Sparkles
  return (
    <div className="h-9 w-9 shrink-0 rounded-md bg-[var(--accent)]/15 border border-[var(--accent)]/30 flex items-center justify-center">
      <Icon className="w-4 h-4 text-[var(--accent)]" />
    </div>
  )
}

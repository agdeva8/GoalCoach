import { useEffect, useState, useRef } from "react";
import { Sparkles, ExternalLink, Loader2, RefreshCw, X, BookOpen, Headphones, Video, FileText } from "lucide-react";
import { api } from "../lib/api";
import { localDateKey } from "../lib/utils";

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
 * Stale-while-revalidate (SWR) poll — the server returns the
 * catalogue instantly on a cold cache and kicks the LLM pipeline
 * off in the background. We poll every 5s while we know a refresh
 * is in flight (`cache: 'miss'` / `'stale'`); once the server hands
 * us `cache: 'hit'` we know the fresh LLM-curated row landed and
 * we stop polling. Same response shape either way, so the swap is
 * invisible to the user — just one item quietly changes.
 *
 * UX rules:
 *   - Skips itself silently when nothing interesting is happening
 *     (no overdue, no goals) — never nags the user.
 *   - Dismissable: a small × in the corner hides it for the rest of
 *     the session (per component mount).
 *   - Refresh button re-rolls items from the same bucket.
 */
const POLL_INTERVAL_MS = 5_000
// Cap on how long we keep polling for a fresh LLM-curated row. The
// server's pipeline takes ~20-30s on a healthy day; we leave headroom
// and stop after this. Without a cap, a broken LLM / missing Tavily
// key leaves the frontend polling the route every 5s forever — every
// poll kicks off another `void runPipeline()` in the backend (the
// cost cap eventually short-circuits those, but the call itself still
// hits the route, runs the bucket detector, etc). 60s = 12 polls
// ceiling, well above the cold-miss window, well below the runaway.
const POLL_MAX_DURATION_MS = 60_000

export default function MotivationCard({ state }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [dismissed, setDismissed] = useState(false)
  // True while the server told us the cache is `miss` / `stale` —
  // i.e. a background refresh is in flight that we should poll
  // for. Stays false on `hit` and on hard errors (so we don't
  // hammer the route when the LLM is broken).
  const [awaitingFresh, setAwaitingFresh] = useState(false)
  // True once the poll cap is hit. Renders the "couldn't refresh"
  // hint next to the badge instead of a forever-spinner.
  const [pollGaveUp, setPollGaveUp] = useState(false)
  // Ref to the poll interval so we can clear it on unmount and on
  // transitions out of `awaitingFresh`.
  const pollRef = useRef(null)

  const overdueCount = (state?.commitments || []).filter(
    (c) =>
      c.status === "open" &&
      c.due &&
      c.due < localDateKey(),
  ).length
  const activeGoals = (state?.goals || []).filter((g) => g.status === "active").length

  const shouldShow = overdueCount > 0 || activeGoals > 0

  const stopPolling = () => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  const startPolling = () => {
    stopPolling()
    setPollGaveUp(false)
    const pollStartedAt = Date.now()
    pollRef.current = setInterval(() => {
      // Cap the poll window. The healthy cold-miss path lands in 20-30s;
      // after 60s we assume the LLM is broken and stop hammering the
      // route. The user can still hit the refresh button to retry.
      if (Date.now() - pollStartedAt > POLL_MAX_DURATION_MS) {
        setAwaitingFresh(false)
        setPollGaveUp(true)
        stopPolling()
        return
      }
      api
        .motivation()
        .then((d) => {
          setItems(d.items || [])
          if (d.cache === "hit") {
            // Fresh LLM-curated row landed — swap and stop polling.
            setAwaitingFresh(false)
            setPollGaveUp(false)
            stopPolling()
          }
          // If still 'miss' / 'stale', keep polling (until the cap).
        })
        .catch(() => {
          // Background poll failure is non-fatal — keep trying until
          // we either get a hit or the user dismisses the card.
        })
    }, POLL_INTERVAL_MS)
  }

  const fetchRecommendations = () => {
    setLoading(true)
    setError(null)
    setPollGaveUp(false)
    api
      .motivation()
      .then((d) => {
        setItems(d.items || [])
        if (d.cache === "hit") {
          setAwaitingFresh(false)
          stopPolling()
        } else {
          // 'miss' or 'stale' — server kicked off a background
          // refresh; start (or continue) polling until it lands
          // (or the poll cap fires).
          setAwaitingFresh(true)
          startPolling()
        }
      })
      .catch((err) => {
        console.error("Failed to load motivation recommendations:", err)
        setError(err)
        setAwaitingFresh(false)
        stopPolling()
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (!shouldShow || dismissed) return
    fetchRecommendations()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldShow, dismissed])

  // Always tear down the poll on unmount — otherwise the interval
  // would keep firing against a state we'd never see.
  useEffect(() => {
    return () => stopPolling()
  }, [])

  if (!shouldShow || dismissed) return null
  if (items.length === 0 && !loading && !error) return null

  return (
    <div
      data-testid="motivation-card"
      className="border border-[var(--border)] bg-gradient-to-br from-[color-mix(in_srgb,var(--accent)_10%,transparent)] via-[color-mix(in_srgb,var(--accent)_5%,transparent)] to-transparent rounded-xl overflow-hidden"
    >
      <div className="px-4 sm:px-5 py-3.5 flex items-center gap-2 border-b border-[var(--border)]">
        <Sparkles className="w-4 h-4 text-[var(--accent)]" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-[var(--text-primary)]">
            Articles & videos curated for you
          </div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
            Picked from what you're working on
          </div>
        </div>
        <button
          data-testid="motivation-refresh"
          type="button"
          onClick={fetchRecommendations}
          disabled={loading}
          className="h-11 w-11 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-tertiary)] border border-transparent transition-colors"
          title="Refresh"
        >
          {loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5" />
          )}
        </button>
        {awaitingFresh && (
          <span
            data-testid="motivation-refreshing"
            className="font-mono text-[9px] uppercase tracking-widest text-[var(--accent)] inline-flex items-center gap-1"
            title="Curating fresh picks — this view will update shortly"
          >
            <Loader2 className="w-3 h-3 animate-spin" /> refreshing
          </span>
        )}
        {pollGaveUp && !awaitingFresh && (
          <span
            data-testid="motivation-refresh-stalled"
            className="font-mono text-[9px] uppercase tracking-widest text-[var(--text-muted)] inline-flex items-center gap-1"
            title="Curator didn't land in time — tap refresh to try again"
          >
            tap refresh to retry
          </span>
        )}
        <button
          data-testid="motivation-dismiss"
          type="button"
          onClick={() => setDismissed(true)}
          className="h-11 w-11 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
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
        {!loading && error && (
          <li className="flex items-center justify-between text-xs text-[var(--text-muted)] py-2" data-testid="motivation-error">
            <span>Couldn't load recommendations</span>
            <button
              type="button"
              onClick={fetchRecommendations}
              className="min-h-11 inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
            >
              <RefreshCw className="w-3 h-3" /> Retry
            </button>
          </li>
        )}
        {items.map((it) => (
          <li
            key={it.id}
            data-testid={`motivation-item-${it.id}`}
            className="flex items-start gap-3 p-2.5 rounded-md border border-[var(--border)] bg-[color-mix(in_srgb,var(--bg-primary)_40%,transparent)]"
          >
            <KindIcon kind={it.kind} />
            <div className="flex-1 min-w-0">
              <a
                href={it.url}
                target="_blank"
                rel="noreferrer"
                className="min-h-11 text-sm font-medium text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors inline-flex items-center gap-1 group"
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
    <div className="h-11 w-11 shrink-0 rounded-md bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] border border-[color-mix(in_srgb,var(--accent)_30%,transparent)] flex items-center justify-center">
      <Icon className="w-4 h-4 text-[var(--accent)]" />
    </div>
  )
}

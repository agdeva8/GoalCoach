import { useEffect, useRef, useState } from "react";
import { UserRound, Plus, RefreshCw } from "lucide-react";
import { API, api } from "../lib/api";

/**
 * PersonaMenu — dev-only quick-swap dropdown for guest personas.
 *
 * Visible only when:
 *   1. The current user is a guest (not signed in with Google).
 *   2. The server has `ALLOW_DEV_LOGIN=true` (the same flag that
 *      enables /api/auth/dev-login and the SignInModal dev button).
 *
 * Reads the list of saved personas from GET /api/auth/personas,
 * shows them as one-click entries, and lets the user pick:
 *   - An existing persona (POSTs /api/auth/dev-login with the
 *     persona's user_id, then reloads so the auth context re-resolves).
 *   - A fresh guest (calls continueAsGuestAction from the server
 *     action, which sets the guest cookie + redirects to /coach).
 *
 * Why the dual implementation: persona switch reads from the existing
 * dev-login route so the cookie shape and DB row exactly match what
 * a "Continue as Dev User" click does; the "new guest" path uses the
 * real guest-token signup so a brand-new identity gets created.
 */
export default function PersonaMenu({ currentName }) {
  const [open, setOpen] = useState(false);
  const [personas, setPersonas] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    fetch(`${API}/auth/personas`, { credentials: "include" })
      .then(async (r) => {
        if (r.status === 404) {
          // Server doesn't have the flag on — keep the menu visible
          // but with a single "new guest" action so it degrades
          // gracefully.
          setPersonas([]);
          return
        }
        if (!r.ok) throw new Error(`${r.status}`)
        const data = await r.json()
        setPersonas(data.personas || [])
      })
      .catch((e) => setError(e?.message || "Couldn't load personas"))
      .finally(() => setLoading(false))
  }, [open])

  useEffect(() => {
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [])

  const switchTo = async (userId, name) => {
    const params = new URLSearchParams({ user_id: userId, name })
    const res = await fetch(`${API}/auth/dev-login?${params.toString()}`, {
      method: "POST",
      credentials: "include",
    })
    if (!res.ok) return
    window.location.reload()
  }

  const chipLabel = currentName ? currentName.split(" ")[0] || "Guest" : "Guest"

  const startFreshGuest = async () => {
    try {
      await api.guest()
      window.location.reload()
    } catch {
      // ignore — the menu closes either way
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        data-testid="persona-menu-trigger"
        onClick={() => setOpen((v) => !v)}
        title="Switch persona (dev-only)"
        className="h-9 px-3 flex items-center gap-1.5 border border-[var(--border)] hover:border-[var(--border-accent)] text-[var(--text-secondary)] font-mono text-[11px] uppercase tracking-wider transition-colors"
      >
        <UserRound className="w-3.5 h-3.5" />
        <span>{chipLabel}</span>
      </button>
      {open && (
        <div
          data-testid="persona-menu"
          className="absolute right-0 mt-1 w-72 bg-[var(--bg-secondary)] border border-[var(--border)] shadow-2xl z-50"
        >
          <div className="px-3 py-2 border-b border-[var(--border)] flex items-center justify-between">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-muted)]">
                Personas · dev only
              </div>
              <div className="text-xs text-[var(--text-secondary)] mt-0.5">
                Swap identity to test different starts.
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setLoading(true)
                fetch(`${API}/auth/personas`, { credentials: "include" })
                  .then((r) => (r.ok ? r.json() : { personas: [] }))
                  .then((d) => setPersonas(d.personas || []))
                  .finally(() => setLoading(false))
              }}
              title="Refresh"
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {loading && (
            <div className="px-3 py-3 text-xs text-[var(--text-muted)]">loading…</div>
          )}
          {error && !loading && (
            <div className="px-3 py-3 text-xs text-[var(--danger)]">{error}</div>
          )}

          {!loading && !error && (
            <ul className="max-h-72 overflow-y-auto">
              {personas.length === 0 ? (
                <li className="px-3 py-3 text-xs text-[var(--text-muted)]">
                  No saved personas yet. Pick "Continue as new guest" below to create the first.
                </li>
              ) : (
                personas.map((p) => (
                  <li key={p.user_id}>
                    <button
                      type="button"
                      data-testid={`persona-item-${p.user_id}`}
                      onClick={() => switchTo(p.user_id, p.name || "Guest")}
                      className="w-full text-left px-3 py-2.5 border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg-tertiary)] transition-colors"
                    >
                      <div className="text-sm text-[var(--text-primary)] truncate">
                        {p.name || "Guest"}
                      </div>
                      <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)] mt-0.5">
                        {p.user_id}
                        <span className="mx-1.5">·</span>
                        {new Date(p.created_at).toLocaleDateString()}
                      </div>
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}

          <div className="border-t border-[var(--border)]">
            <button
              type="button"
              data-testid="persona-new-guest"
              onClick={startFreshGuest}
              className="w-full flex items-center gap-2 px-3 py-3 text-xs text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Continue as new guest (new identity)
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
